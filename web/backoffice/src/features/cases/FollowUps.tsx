// 후속 처리(case 0.8.0 의무 obligation — 백엔드 요청 backoffice/2026-11-16-request-case-obligations, 화면 용어 "후속 처리" 사용자 2026-11-16).
// - 접수 건 상세의 "후속 처리" 칸: 목록(종류·담당 팀·수량/기록 금액·기한·상태·결과 이력)·결과 남기기·추가.
// - 고객센터 메뉴 "고객센터 후속 처리": `GET /obligations?owner=CS`(기본 처리 중) — 상담원이 고객 연락 결과를 남긴다(접수 건 자체는 보기만).
// - 추가 `POST /cases/{id}/obligations` {kind(8종), owner?, qty?, amount?, dueAt?, note?} — 접수 건을 다룰 수 있는 사람(지원센터·관리자). 지원센터·고객센터 몫은 배송 쪽 접수 건에만.
// - 결과 `POST /obligations/{id}/resolutions` {outcome, resolvedQty?, resolvedAmount?, evidence{system, ref}, note?}
//   완료 FULFILLED(수량·금액은 일부도) · 시도 기록 ATTEMPTED(상태 그대로, 메모 필수) · 면제 WAIVED·실패 FAILED(관리자만, 사유 필수). 근거 필수(서버는 확인하지 않음).
// - 금액은 기록만 — 환불·보상 실행은 클레임·결제 메뉴. 이 화면에서 환불되는 것처럼 보이지 않게 "기록 금액"으로만.
// - 메모·사유는 직원이 쓴 글 — 화면에만, 로그에 남기지 않는다. 판정은 서버(403·409·422 는 코드 문구).
// 화면(2026-11-18 사용자 "밋밋하다"): 한 카드 안 항목 줄(종류 아이콘·담당 팀·상태 점 꼬리표·기한, 수량·기록 금액 막대, 결과 이력 줄), 아래 추가 칸. 고객센터 메뉴는 밑줄 탭 + 같은 줄. 동작은 그대로.
import { CaseNumber } from '../../shared/CaseNumber';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/case';
import { useCenterScope } from '../../shared/centerScope';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { messages } from '../../shared/messages';
import { label, text, when, won } from '../../shared/ops';
import { CodeLabel, NextAction, PageHeader, StatusBadge, type Tone } from '../../shared/admin';
import { EmptyBox, Icon, ICON } from '../inquiries/HelpdeskParts';

const m = messages.followUps;
/** 코드 값 → 한국어 이름(원래 코드는 마우스를 올리면), 값이 없으면 "—" */
const codeOf = (names: Readonly<Record<string, string>>, v: string | null | undefined) => (v ? <CodeLabel code={v} names={names} /> : messages.none);
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

/** 상태 꼬리표 색(보기만) */
const STATE_TONE: Readonly<Record<string, Tone>> = { OPEN: 'warning', PARTIALLY_RESOLVED: 'info', RESOLVED: 'success', WAIVED: 'ghost', FAILED: 'error' };
/** 종류 아이콘(보기만 — 모르는 종류는 목록 아이콘) */
const KIND_ICON: Readonly<Record<string, string>> = {
  REFUND: 'M4 7h16v10H4zM4 11h16M8 15h2',
  RETURN_PICKUP: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  REDELIVERY: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4',
  CUSTOMER_CONTACT: ICON.phone,
  EVIDENCE_COLLECTION: ICON.note,
  COMPENSATION: ICON.star,
};

/** 진행 막대 — 서버가 준 처리량/전체를 그대로(막대 길이는 보기용) */
function Progress({ done, all, children }: { readonly done: number; readonly all: number; readonly children: ReactNode }) {
  const pct = all > 0 ? Math.min(100, (done / all) * 100) : 0;
  return (
    <div className="min-w-40 flex-1 space-y-1">
      <span className="text-xs text-base-content/70">{children}</span>
      <span className="block h-1.5 overflow-hidden rounded-full bg-base-200" aria-hidden="true">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

function ObligationItem({ o, caseGroup, onChanged, caseLink }: { readonly o: Obligation; readonly caseGroup: string | null | undefined; readonly onChanged: () => void; readonly caseLink?: ReactNode }) {
  const roles = useRoles();
  const [open, setOpen] = useState(false);
  const live = isOpenObligation(o);
  return (
    <li className="flex gap-3 px-4 py-3.5 text-sm" data-testid="follow-up" data-state={o.state}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${live ? 'bg-warning/15 text-warning' : 'bg-success/10 text-success'}`} aria-hidden="true">
        <Icon d={KIND_ICON[o.kind ?? ''] ?? ICON.task} className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        {caseLink}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{codeOf(m.kindName, o.kind)}</span>
          <span className="badge badge-ghost badge-sm">{codeOf(messages.cases.groupName, o.owner ?? caseGroup)}</span>
          <StatusBadge tone={STATE_TONE[o.state ?? 'OPEN'] ?? 'ghost'}>{codeOf(m.stateName, o.state)}</StatusBadge>
          {o.dueAt && (
            <span className="ml-auto inline-flex items-center gap-1 whitespace-nowrap text-xs text-base-content/60">
              <Icon d={ICON.clock} className="h-3.5 w-3.5" />
              {`${m.due} ${when(o.dueAt)}`}
            </span>
          )}
        </div>
        {(o.qty !== undefined || o.amount !== undefined) && (
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {o.qty !== undefined && (
              <Progress done={o.resolvedQty ?? 0} all={o.qty}>
                {m.qtyText(o.resolvedQty ?? 0, o.qty)}
              </Progress>
            )}
            {o.amount !== undefined && (
              <Progress done={o.resolvedAmount ?? 0} all={o.amount}>
                {m.amountText(won(o.resolvedAmount ?? 0), won(o.amount))}
              </Progress>
            )}
          </div>
        )}
        {o.note && <p className="whitespace-pre-wrap rounded-box bg-base-200/60 px-3 py-2 text-base-content/80">{o.note}</p>}
        {(o.resolutions ?? []).length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-base-content/50">{m.results}</p>
            <ul className="space-y-1 border-l-2 border-base-300 pl-3 text-xs text-base-content/75" data-testid="follow-up-results">
              {(o.resolutions ?? []).map((r, i) => (
                <li key={`${r.resolvedAt ?? ''}-${i}`}>
                  {/* 근거가 있는 곳은 업무 이름(원래 서비스 이름은 마우스를 올리면) */}
                  {[
                    when(r.resolvedAt),
                    codeOf(m.outcomeName, r.outcome),
                    r.qty !== undefined ? m.qtyDone(r.qty) : null,
                    r.amount !== undefined ? m.amountDone(won(r.amount)) : null,
                    r.evidence ? (
                      <>
                        {`${m.evidence} `}
                        {codeOf(m.systemName, r.evidence.system)}
                        {` ${r.evidence.ref}`}
                      </>
                    ) : null,
                    text(r.resolvedBy),
                    r.note ?? null,
                  ]
                    .filter(Boolean)
                    .map((part, j) => (
                      <Fragment key={j}>
                        {j > 0 && ' · '}
                        {part}
                      </Fragment>
                    ))}
                </li>
              ))}
            </ul>
          </div>
        )}
        {canResolve(o, caseGroup, roles) &&
          (open ? (
            <ResolveForm o={o} admin={roles.admin} onClose={() => setOpen(false)} onDone={onChanged} />
          ) : (
            <button type="button" className="btn btn-xs btn-outline btn-primary" onClick={() => setOpen(true)}>
              {m.resolve}
            </button>
          ))}
      </div>
    </li>
  );
}

const fieldLabel = 'flex flex-col gap-1 text-sm font-semibold text-base-content/85'; // 2026-11-20 AWS 개편

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
  // 보낼 값은 누른 때 만들어 명령 값으로(2026-11-23 #410 후속) — 결과 불명 뒤 "같은 요청으로 결과 확인"(같은 키)은 처음 값 그대로
  const resolveBody = () => ({
    outcome,
    evidence: { system: system.trim(), ref: ref.trim() },
    ...(fulfilled && o.qty !== undefined ? { resolvedQty: Number(qty) } : {}),
    ...(fulfilled && o.amount !== undefined ? { resolvedAmount: Number(amount) } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
  });
  const cmd = useCommand(async (body: ReturnType<typeof resolveBody>, key) => {
    const r = await request(
      'POST',
      api.cases.POST('/obligations/{obligationId}/resolutions', { ...commandParams(key, { path: { obligationId: o.obligationId ?? '' }, version: o.version }), body }),
    );
    onDone();
    return r;
  });
  return (
    <form
      className="space-y-3 rounded-box border border-primary/30 bg-primary/5 p-3"
      aria-label={m.resolve}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        if (cmd.phase.kind === 'rejected') cmd.reset();
        void cmd.run(resolveBody());
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className={fieldLabel}>
          {m.outcome}
          <select className="select select-sm text-sm text-base-content" value={outcome} onChange={(e) => setOutcome(outcomes.find((x) => x === e.target.value) ?? 'FULFILLED')}>
            {outcomes.map((x) => (
              <option key={x} value={x}>
                {m.outcomeName[x]}
              </option>
            ))}
          </select>
        </label>
        {fulfilled && o.qty !== undefined && (
          <label className={fieldLabel}>
            {m.doneQty}
            <input type="number" min={1} className="input input-sm w-24 text-sm text-base-content" value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
        )}
        {fulfilled && o.amount !== undefined && (
          <label className={fieldLabel}>
            {m.doneAmount}
            <input type="number" min={0} className="input input-sm w-32 text-sm text-base-content" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        )}
        <label className={fieldLabel}>
          {m.evidenceSystem}
          <select className="select select-sm text-sm text-base-content" value={system} onChange={(e) => setSystem(e.target.value)}>
            {EVIDENCE_SYSTEMS.map((s) => (
              <option key={s} value={s}>
                {label(m.systemName, s)}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldLabel}>
          {m.evidenceRef}
          <input className="input input-sm w-48 font-mono text-sm text-base-content" maxLength={120} value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
      </div>
      <label className={fieldLabel}>
        {noteRequired ? m.noteRequired : m.noteOptional}
        <textarea className="textarea textarea-sm w-full text-sm text-base-content" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-base-content/60">{fulfilled && o.amount !== undefined ? m.amountRecordOnly : m.piiHint}</p>
        <button type="button" className="btn btn-sm btn-ghost" disabled={cmd.busy} onClick={onClose}>
          {m.cancel}
        </button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!ok || cmd.busy}>
          {m.save}
        </button>
      </div>
      {/* 지울 수 없다는 안내(2026-11-19 사용자 "지원센터에서 후속 처리 삭제가 안 된다"): 계약에 삭제가 없고, 할 필요가 없어진 것은 관리자 면제(사유 필수)로만 끝난다 */}
      {!admin && (
        <p className="text-xs text-base-content/60" data-testid="followup-no-delete">
          {m.noDeleteHint}
        </p>
      )}
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
  // 보낼 값은 누른 때 만들어 명령 값으로(2026-11-23 #410 후속) — 결과 불명 뒤 "같은 요청으로 결과 확인"(같은 키)은 처음 값 그대로
  const addBody = () => ({
    kind,
    ...(owner ? { owner } : {}),
    ...(qty ? { qty: Number(qty) } : {}),
    ...(amount ? { amount: Number(amount) } : {}),
    ...(due ? { dueAt: `${due}:00+09:00` } : {}), // datetime-local(한국 시간) → +09:00
    ...(note.trim() ? { note: note.trim() } : {}),
  });
  const cmd = useCommand(async (body: ReturnType<typeof addBody>, key) => {
    const r = await request('POST', api.cases.POST('/cases/{caseId}/obligations', { ...commandParams(key, { path: { caseId: c.caseId ?? '' } }), body }));
    onDone();
    return r;
  });
  return (
    <form
      className="space-y-3 border-t border-base-300 bg-base-200/40 px-4 py-4 text-sm"
      aria-label={m.add}
      data-testid="follow-up-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (cmd.phase.kind === 'rejected' || cmd.phase.kind === 'done') cmd.reset();
        void cmd.run(addBody());
      }}
    >
      <div>
        <h3 className="flex items-center gap-2 font-semibold">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
            +
          </span>
          {m.add}
        </h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <label className={fieldLabel}>
          {m.kind}
          <select className="select select-sm w-full text-sm text-base-content" value={kind} onChange={(e) => setKind(KINDS.find((k) => k === e.target.value) ?? 'OTHER')}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {label(m.kindName, k)}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldLabel}>
          {m.owner}
          <select className="select select-sm w-full text-sm text-base-content" value={owner} onChange={(e) => setOwner(owners.find((x) => x === e.target.value) ?? '')}>
            <option value="">{m.ownerDefault}</option>
            {owners.map((x) => (
              <option key={x} value={x}>
                {label(messages.cases.groupName, x)}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldLabel}>
          {m.dueAt}
          <input type="datetime-local" className="input input-sm w-full text-sm text-base-content" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className={fieldLabel}>
          {m.qty}
          <input type="number" min={1} className="input input-sm w-full text-sm text-base-content" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className={fieldLabel}>
          {m.amount}
          <input type="number" min={0} className="input input-sm w-full text-sm text-base-content" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      </div>
      <label className={fieldLabel}>
        {m.noteOptional}
        <textarea className="textarea textarea-sm w-full text-sm text-base-content" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-base-content/60">{m.amountRecordOnly}</p>
        <button type="submit" className="btn btn-sm btn-primary" disabled={cmd.busy}>
          {m.add}
        </button>
      </div>
      <CommandFeedback command={cmd}>{() => <span className="text-xs text-success">{m.added}</span>}</CommandFeedback>
    </form>
  );
}

/** 접수 건 상세의 "후속 처리" 칸 — 한 카드: 제목 줄 → 항목 줄들 → 아래 추가 */
export function FollowUps({ c, canAdd }: { readonly c: Case; readonly canAdd: boolean }) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['cases'] });
    void queryClient.invalidateQueries({ queryKey: ['obligations'] });
  };
  const list = c.obligations ?? [];
  const openCount = list.filter(isOpenObligation).length;
  return (
    <section className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm" aria-label={m.title}>
      <div className="flex items-center gap-2 border-b border-base-300 px-4 py-3">
        <Icon d={ICON.task} className="h-4 w-4 text-base-content/50" />
        <h2 className="font-semibold">{openCount > 0 ? m.titleOpen(openCount) : m.title}</h2>
      </div>
      {list.length === 0 ? (
        <p className="px-4 py-5 text-center text-sm text-base-content/55">{m.none}</p>
      ) : (
        <ul className="divide-y divide-base-200">
          {list.map((o) => (
            <ObligationItem key={o.obligationId} o={o} caseGroup={c.assigneeGroup} onChanged={refresh} />
          ))}
        </ul>
      )}
      {canAdd && <AddForm c={c} onDone={refresh} />}
    </section>
  );
}

/** 고객센터 메뉴 "고객센터 후속 처리" — owner=CS. 한 카드 안 밑줄 탭 → 항목 줄(위에 접수 건 번호) */
export function CsFollowUpPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const done = params.get('tab') === 'done';
  const queryClient = useQueryClient();
  const centerId = useCenterScope(); // 머리줄 센터 고르기(2026-11-23, case 0.33.0 R-12 — 범위 ∩ 고른 센터)
  const at = centerId ? { centerId } : {};
  const query = useQuery({
    queryKey: ['obligations', 'CS', done, centerId],
    queryFn: async () => {
      if (!done) return request('GET', api.cases.GET('/obligations', { params: { query: { owner: 'CS', size: 50, ...at } } }));
      // 처리 끝남 = 해소·면제·실패(서버 state 하나씩 — 세 번 읽어 합친다)
      const parts = await Promise.all(
        (['RESOLVED', 'WAIVED', 'FAILED'] as const).map((state) => request('GET', api.cases.GET('/obligations', { params: { query: { owner: 'CS', state, size: 50, ...at } } }))),
      );
      return { items: parts.flatMap((p) => p.items ?? []) };
    },
  });
  const state = toUiState(query, (r) => (r.items ?? []).length === 0);
  const roles = useRoles();
  // 다음 할 일 — 처리 중 탭을 읽었을 때만, 서버가 준 목록·역할로(결과 남기기 버튼이 보이는 건수). 판정은 서버
  const resolvable = !done && state.kind === 'ready' ? (state.data.items ?? []).filter((o) => canResolve(o, 'CS', roles)).length : null;
  return (
    <section className="space-y-4">
      <PageHeader title={m.csTitle} />
      {resolvable !== null &&
        (resolvable > 0 ? (
          <NextAction tone="warning" title={m.nextResolve(resolvable)} />
        ) : (
          <NextAction tone="info" title={m.nextReadOnly} body={m.nextReadOnlyBody} />
        ))}
      <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
        <div role="tablist" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-base-300 px-3">
          {([false, true] as const).map((d) => (
            <button
              key={String(d)}
              type="button"
              role="tab"
              aria-selected={d === done}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${d === done ? 'border-primary font-semibold text-base-content' : 'border-transparent text-base-content/55 hover:text-base-content'}`}
              onClick={() => setParams(d ? { tab: 'done' } : {})}
            >
              {d ? m.tabDone : m.tabOpen}
            </button>
          ))}
        </div>
        {state.kind === 'empty' ? (
          <EmptyBox icon={done ? ICON.check : ICON.task}>{done ? m.csEmptyDone : m.csEmpty}</EmptyBox>
        ) : state.kind === 'ready' ? (
          <ul className="divide-y divide-base-200">
            {(state.data.items ?? []).map((o) => (
              <ObligationItem
                key={o.obligationId}
                o={o}
                caseGroup="CS"
                onChanged={() => void queryClient.invalidateQueries({ queryKey: ['obligations'] })}
                caseLink={
                  <Link className="font-mono text-xs text-base-content/50 hover:text-primary hover:underline" to={`/cases/${encodeURIComponent(o.caseId ?? '')}`}>
                    {m.ofCaseLabel} <CaseNumber caseId={o.caseId ?? ''} />
                  </Link>
                }
              />
            ))}
          </ul>
        ) : (
          // 읽는 중·실패(403 포함)는 빈 목록이 아니라 그 상태로
          <div className="p-4">
            <QueryState state={state} onRetry={() => void query.refetch()}>
              {() => null}
            </QueryState>
          </div>
        )}
      </div>
    </section>
  );
}
