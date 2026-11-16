// 후속 처리(case 0.8.0 의무 obligation — 백엔드 요청 backoffice/2026-11-16-request-case-obligations, 화면 용어 "후속 처리" 사용자 2026-11-16).
// - 접수 건 상세의 "후속 처리" 칸: 목록(종류·담당 팀·수량/기록 금액·기한·상태·결과 이력)·결과 남기기·추가.
// - 고객센터 메뉴 "고객센터 후속 처리": `GET /obligations?owner=CS`(기본 처리 중) — 상담원이 고객 연락 결과를 남긴다(접수 건 자체는 보기만).
// - 추가 `POST /cases/{id}/obligations` {kind(8종), owner?, qty?, amount?, dueAt?, note?} — 접수 건을 다룰 수 있는 사람(지원센터·관리자). 지원센터·고객센터 몫은 배송 쪽 접수 건에만.
// - 결과 `POST /obligations/{id}/resolutions` {outcome, resolvedQty?, resolvedAmount?, evidence{system, ref}, note?}
//   완료 FULFILLED(수량·금액은 일부도) · 시도 기록 ATTEMPTED(상태 그대로, 메모 필수) · 면제 WAIVED·실패 FAILED(관리자만, 사유 필수). 근거 필수(서버는 확인하지 않음).
// - 금액은 기록만 — 환불·보상 실행은 클레임·결제 메뉴. 이 화면에서 환불되는 것처럼 보이지 않게 "기록 금액"으로만.
// - 메모·사유는 직원이 쓴 글 — 화면에만, 로그에 남기지 않는다. 판정은 서버(403·409·422 는 코드 문구).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { messages } from '../../shared/messages';
import { label, text, when, won } from '../../shared/ops';

const m = messages.followUps;
type Case = components['schemas']['Case'];
type Obligation = components['schemas']['Obligation'];
type Kind = components['schemas']['ObligationBody']['kind'];
type Owner = NonNullable<components['schemas']['ObligationBody']['owner']>;
type Outcome = 'FULFILLED' | 'ATTEMPTED' | 'WAIVED' | 'FAILED';

/** 직원이 등록할 수 있는 종류(요청서 §1 — 그 밖은 서버 422 UNSUPPORTED_KIND) */
const KINDS: readonly Kind[] = ['REFUND', 'RETURN_PICKUP', 'REDELIVERY', 'RECONCILIATION', 'CUSTOMER_CONTACT', 'EVIDENCE_COLLECTION', 'COMPENSATION', 'OTHER'];
const OPEN_STATES = ['OPEN', 'PARTIALLY_RESOLVED'];
export const isOpenObligation = (o: Obligation) => OPEN_STATES.includes(o.state ?? 'OPEN');
/** 근거가 있는 곳 — 보기만 돕는다(자유 입력도 된다) */
const EVIDENCE_SYSTEMS = ['claim-service', 'payment-service', 'delivery-execution-service', 'order-service', 'phone', 'other'] as const;

function useRoles() {
  const { session } = useSession();
  const roles = session?.roles ?? [];
  return { admin: roles.includes('OPERATOR_ADMIN'), team: roles.includes('RIDER_OPS'), cs: roles.includes('CS_AGENT') };
}

/** 결과를 남길 수 있어 보이나 — 담당 팀(비우면 접수 건 팀)과 관리자. 판정은 서버 */
function canResolve(o: Obligation, caseGroup: string | null | undefined, r: ReturnType<typeof useRoles>) {
  if (!isOpenObligation(o)) return false;
  const owner = o.owner ?? caseGroup ?? 'DELIVERY_OPS';
  return r.admin || (owner === 'DELIVERY_OPS' && r.team) || (owner === 'CS' && r.cs);
}

function ObligationItem({ o, caseGroup, onChanged }: { readonly o: Obligation; readonly caseGroup: string | null | undefined; readonly onChanged: () => void }) {
  const roles = useRoles();
  const [open, setOpen] = useState(false);
  return (
    <li className="space-y-1 rounded-box bg-base-100 p-3 text-sm" data-testid="follow-up" data-state={o.state}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{label(m.kindName, o.kind)}</span>
        <span className="badge badge-ghost badge-sm">{label(messages.cases.groupName, o.owner ?? caseGroup)}</span>
        <span className={`badge badge-sm ${isOpenObligation(o) ? 'badge-warning' : 'badge-success'}`}>{label(m.stateName, o.state)}</span>
        {o.qty !== undefined && <span>{m.qtyText(o.resolvedQty ?? 0, o.qty)}</span>}
        {o.amount !== undefined && <span>{m.amountText(won(o.resolvedAmount ?? 0), won(o.amount))}</span>}
        {o.dueAt && <span className="opacity-70">{`${m.due} ${when(o.dueAt)}`}</span>}
      </div>
      {o.note && <p className="whitespace-pre-wrap opacity-80">{o.note}</p>}
      {(o.resolutions ?? []).length > 0 && (
        <ul className="space-y-0.5 text-xs opacity-80" data-testid="follow-up-results">
          {(o.resolutions ?? []).map((r, i) => (
            <li key={`${r.resolvedAt ?? ''}-${i}`}>
              {[
                when(r.resolvedAt),
                label(m.outcomeName, r.outcome),
                r.qty !== undefined ? m.qtyDone(r.qty) : null,
                r.amount !== undefined ? m.amountDone(won(r.amount)) : null,
                r.evidence ? `${m.evidence} ${r.evidence.system}:${r.evidence.ref}` : null,
                text(r.resolvedBy),
                r.note ?? null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </li>
          ))}
        </ul>
      )}
      {canResolve(o, caseGroup, roles) &&
        (open ? (
          <ResolveForm o={o} admin={roles.admin} onClose={() => setOpen(false)} onDone={onChanged} />
        ) : (
          <button type="button" className="btn btn-xs" onClick={() => setOpen(true)}>
            {m.resolve}
          </button>
        ))}
    </li>
  );
}

function ResolveForm({ o, admin, onClose, onDone }: { readonly o: Obligation; readonly admin: boolean; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi();
  const outcomes: readonly Outcome[] = admin ? ['FULFILLED', 'ATTEMPTED', 'WAIVED', 'FAILED'] : ['FULFILLED', 'ATTEMPTED'];
  const [outcome, setOutcome] = useState<Outcome>('FULFILLED');
  const [qty, setQty] = useState('');
  const [amount, setAmount] = useState('');
  const [system, setSystem] = useState<string>(o.kind === 'CUSTOMER_CONTACT' ? 'phone' : 'claim-service');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const noteRequired = outcome !== 'FULFILLED';
  const fulfilled = outcome === 'FULFILLED';
  const qtyOk = !fulfilled || o.qty === undefined || (qty !== '' && Number(qty) >= 1);
  const amountOk = !fulfilled || o.amount === undefined || (amount !== '' && Number(amount) >= 0);
  const ok = ref.trim().length > 0 && system.trim().length > 0 && (!noteRequired || note.trim().length > 0) && qtyOk && amountOk;
  const cmd = useCommand(async (_v: null, key) => {
    const r = await request(
      'POST',
      api.cases.POST('/obligations/{obligationId}/resolutions', {
        ...commandParams(key, { path: { obligationId: o.obligationId ?? '' }, version: o.version }),
        body: {
          outcome,
          evidence: { system: system.trim(), ref: ref.trim() },
          ...(fulfilled && o.qty !== undefined ? { resolvedQty: Number(qty) } : {}),
          ...(fulfilled && o.amount !== undefined ? { resolvedAmount: Number(amount) } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      }),
    );
    onDone();
    return r;
  });
  return (
    <form
      className="space-y-2 border-t border-base-200 pt-2"
      aria-label={m.resolve}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        if (cmd.phase.kind === 'rejected') cmd.reset();
        void cmd.run(null);
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          {m.outcome}
          <select className="select select-sm" value={outcome} onChange={(e) => setOutcome(outcomes.find((x) => x === e.target.value) ?? 'FULFILLED')}>
            {outcomes.map((x) => (
              <option key={x} value={x}>
                {m.outcomeName[x]}
              </option>
            ))}
          </select>
        </label>
        {fulfilled && o.qty !== undefined && (
          <label className="flex flex-col gap-1">
            {m.doneQty}
            <input type="number" min={1} className="input input-sm w-24" value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
        )}
        {fulfilled && o.amount !== undefined && (
          <label className="flex flex-col gap-1">
            {m.doneAmount}
            <input type="number" min={0} className="input input-sm w-32" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        )}
        <label className="flex flex-col gap-1">
          {m.evidenceSystem}
          <select className="select select-sm" value={system} onChange={(e) => setSystem(e.target.value)}>
            {EVIDENCE_SYSTEMS.map((s) => (
              <option key={s} value={s}>
                {label(m.systemName, s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {m.evidenceRef}
          <input className="input input-sm w-48 font-mono" maxLength={120} value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        {noteRequired ? m.noteRequired : m.noteOptional}
        <textarea className="textarea textarea-sm w-full max-w-lg" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="text-xs opacity-70">{fulfilled && o.amount !== undefined ? m.amountRecordOnly : m.piiHint}</p>
      <div className="flex gap-1">
        <button type="submit" className="btn btn-sm btn-primary" disabled={!ok || cmd.busy}>
          {m.save}
        </button>
        <button type="button" className="btn btn-sm" disabled={cmd.busy} onClick={onClose}>
          {m.cancel}
        </button>
      </div>
      <CommandFeedback command={cmd}>{() => <span className="text-xs text-success">{m.saved}</span>}</CommandFeedback>
    </form>
  );
}

function AddForm({ c, onDone }: { readonly c: Case; readonly onDone: () => void }) {
  const api = useApi();
  const deliverySide = c.assigneeGroup !== 'ORDER_OPS' || !['RECONCILIATION', 'PAYMENT_UNKNOWN'].includes(c.kind ?? '');
  const owners: readonly Owner[] = deliverySide ? ['DELIVERY_OPS', 'CS', 'ORDER_OPS'] : ['ORDER_OPS'];
  const [kind, setKind] = useState<Kind>('CUSTOMER_CONTACT');
  const [owner, setOwner] = useState<Owner | ''>('');
  const [qty, setQty] = useState('');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const cmd = useCommand(async (_v: null, key) => {
    const r = await request(
      'POST',
      api.cases.POST('/cases/{caseId}/obligations', {
        ...commandParams(key, { path: { caseId: c.caseId ?? '' } }),
        body: {
          kind,
          ...(owner ? { owner } : {}),
          ...(qty ? { qty: Number(qty) } : {}),
          ...(amount ? { amount: Number(amount) } : {}),
          ...(due ? { dueAt: `${due}:00+09:00` } : {}), // datetime-local(한국 시간) → +09:00
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      }),
    );
    onDone();
    return r;
  });
  return (
    <form
      className="space-y-2 rounded-box bg-base-100 p-3 text-sm"
      aria-label={m.add}
      data-testid="follow-up-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (cmd.phase.kind === 'rejected' || cmd.phase.kind === 'done') cmd.reset();
        void cmd.run(null);
      }}
    >
      <h3 className="font-semibold">{m.add}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          {m.kind}
          <select className="select select-sm" value={kind} onChange={(e) => setKind(KINDS.find((k) => k === e.target.value) ?? 'OTHER')}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {label(m.kindName, k)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {m.owner}
          <select className="select select-sm" value={owner} onChange={(e) => setOwner(owners.find((x) => x === e.target.value) ?? '')}>
            <option value="">{m.ownerDefault}</option>
            {owners.map((x) => (
              <option key={x} value={x}>
                {label(messages.cases.groupName, x)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {m.qty}
          <input type="number" min={1} className="input input-sm w-24" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {m.amount}
          <input type="number" min={0} className="input input-sm w-32" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {m.dueAt}
          <input type="datetime-local" className="input input-sm" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        {m.noteOptional}
        <textarea className="textarea textarea-sm w-full max-w-lg" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="text-xs opacity-70">{m.amountRecordOnly}</p>
      <button type="submit" className="btn btn-sm" disabled={cmd.busy}>
        {m.add}
      </button>
      <CommandFeedback command={cmd}>{() => <span className="text-xs text-success">{m.added}</span>}</CommandFeedback>
    </form>
  );
}

/** 접수 건 상세의 "후속 처리" 칸 */
export function FollowUps({ c, canAdd }: { readonly c: Case; readonly canAdd: boolean }) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['cases'] });
    void queryClient.invalidateQueries({ queryKey: ['obligations'] });
  };
  const list = c.obligations ?? [];
  const openCount = list.filter(isOpenObligation).length;
  return (
    <section className="space-y-2" aria-label={m.title}>
      <h2 className="font-bold">{openCount > 0 ? m.titleOpen(openCount) : m.title}</h2>
      {list.length === 0 ? (
        <p className="text-sm opacity-70">{m.none}</p>
      ) : (
        <ul className="space-y-2">
          {list.map((o) => (
            <ObligationItem key={o.obligationId} o={o} caseGroup={c.assigneeGroup} onChanged={refresh} />
          ))}
        </ul>
      )}
      {canAdd && <AddForm c={c} onDone={refresh} />}
    </section>
  );
}

/** 고객센터 메뉴 "고객센터 후속 처리" — owner=CS */
export function CsFollowUpPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const done = params.get('tab') === 'done';
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['obligations', 'CS', done],
    queryFn: async () => {
      if (!done) return request('GET', api.cases.GET('/obligations', { params: { query: { owner: 'CS', size: 50 } } }));
      // 처리 끝남 = 해소·면제·실패(서버 state 하나씩 — 세 번 읽어 합친다)
      const parts = await Promise.all(
        (['RESOLVED', 'WAIVED', 'FAILED'] as const).map((state) => request('GET', api.cases.GET('/obligations', { params: { query: { owner: 'CS', state, size: 50 } } }))),
      );
      return { items: parts.flatMap((p) => p.items ?? []) };
    },
  });
  return (
    <section className="max-w-5xl space-y-4">
      <h1 className="text-xl font-bold">{m.csTitle}</h1>
      <p className="text-sm opacity-70">{m.csIntro}</p>
      <div role="tablist" className="tabs tabs-box w-fit">
        {([false, true] as const).map((d) => (
          <button key={String(d)} type="button" role="tab" aria-selected={d === done} className={`tab ${d === done ? 'tab-active' : ''}`} onClick={() => setParams(d ? { tab: 'done' } : {})}>
            {d ? m.tabDone : m.tabOpen}
          </button>
        ))}
      </div>
      <QueryState state={toUiState(query, (r) => (r.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={done ? m.csEmptyDone : m.csEmpty}>
        {(r) => (
          <ul className="space-y-2">
            {(r.items ?? []).map((o) => (
              <li key={o.obligationId} className="space-y-1">
                <Link className="link text-xs" to={`/cases/${encodeURIComponent(o.caseId ?? '')}`}>
                  {m.ofCase(o.caseId ?? '')}
                </Link>
                <ul>
                  <ObligationItem o={o} caseGroup="CS" onChanged={() => void queryClient.invalidateQueries({ queryKey: ['obligations'] })} />
                </ul>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </section>
  );
}
