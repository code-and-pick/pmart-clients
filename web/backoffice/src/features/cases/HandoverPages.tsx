// 교대 인계(case 0.9.0 shift-handovers — 백엔드 요청 backoffice/2026-11-16-request-shift-handover, PR #42, 업무 원문 BO-27).
// - 탭(URL ?tab=): 인계서 쓰기(기본) · 나에게 온 인계 · 내가 쓴 인계 · 미인수(관리자).
// - 쓰기: 내가 맡은(집은) 처리 중 접수 건 `GET /cases?assigneeId=<나>` 을 팀별로 — 기본 전부 선택, 건마다 다음 조치(필수)·확인 기한(선택) → 후임 운영자 ID → `POST /shift-handovers`.
//   관리자는 전임을 바꿔(대신 쓰기 — 전임 부재) 그 사람의 접수 건으로 쓴다(fromOperatorId).
// - 인계서를 쓰는 것만으로는 담당이 바뀌지 않는다(수락 전 = 전임 그대로). 자동으로 넘어가거나 돌아가지 않고 알림도 없다 — 화면에 그대로 안내.
// - 수락 `POST /shift-handovers/{id}/acceptances` {excludedCaseIds} — 후임 본인만(관리자도 403). 결과는 건별 outcome 을 그대로(받음·안 받음·바뀌어 건너뜀·권한 없어 건너뜀).
// - 취소 `…/cancellations` — 수락 전, 전임·관리자. 목록 `GET /shift-handovers?state=&unreceived=` — 관리자는 모두, 그 밖은 내가 전임·후임인 것.
// - 다음 조치·메모는 직원이 쓴 글 — 화면에만(로그 없음), 개인정보 금지 안내.
// - case 0.13.1 역할(백엔드 요청 2026-11-17 request-handover-roles, 사용자 "(나)"): 작성은 지원센터 팀 = RIDER_OPS·OPERATOR_ADMIN, 관리자 팀 = OPERATOR_ADMIN.
//   메뉴·작성 탭은 그 역할에만, 라이더 운영은 팀 고정. 수락은 후임에게 그 팀 역할이 없으면 403 — 인계서는 PENDING 그대로(전임·관리자가 취소 뒤 다시 씀).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { ProblemFailure, request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { messages } from '../../shared/messages';
import { label, text, when } from '../../shared/ops';
import { PageHeader } from '../../shared/admin';

const m = messages.handovers;
type Handover = components['schemas']['ShiftHandover'];
type Summary = components['schemas']['CaseSummary'];
type Group = 'DELIVERY_OPS' | 'ORDER_OPS';
type Tab = 'write' | 'inbox' | 'sent' | 'unreceived';

function useMe() {
  const { session } = useSession();
  const roles = session?.roles ?? [];
  const admin = roles.includes('OPERATOR_ADMIN');
  return { me: session?.subject ?? '', admin, canWrite: admin || roles.includes('RIDER_OPS') };
}

export function HandoverPage() {
  const { admin, canWrite } = useMe();
  const [params, setParams] = useSearchParams();
  const tabs: readonly Tab[] = [...(canWrite ? (['write'] as const) : []), 'inbox', 'sent', ...(admin ? (['unreceived'] as const) : [])];
  const raw = params.get('tab');
  const tab: Tab = tabs.find((t) => t === raw) ?? tabs[0] ?? 'inbox';
  return (
    <section className="max-w-5xl space-y-4">
      <PageHeader title={m.title} description={m.intro} />
      <p role="note" className="alert alert-info text-sm">
        {m.noAuto}
      </p>
      <div role="tablist" className="tabs tabs-box w-fit">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={t === tab} className={`tab ${t === tab ? 'tab-active' : ''}`} onClick={() => setParams(t === tabs[0] ? {} : { tab: t })}>
            {m.tabs[t]}
          </button>
        ))}
      </div>
      {tab === 'write' && <WriteForm />}
      {tab === 'inbox' && <HandoverList mode="inbox" />}
      {tab === 'sent' && <HandoverList mode="sent" />}
      {tab === 'unreceived' && <HandoverList mode="unreceived" />}
    </section>
  );
}

// ---------------------------------------------------------------- 쓰기

interface Row {
  readonly picked: boolean;
  readonly nextAction: string;
  readonly checkDue: string;
}

function WriteForm() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { me, admin } = useMe();
  const [from, setFrom] = useState(''); // 관리자 대신 쓰기 — 비우면 나
  const [fromApplied, setFromApplied] = useState('');
  const [group, setGroup] = useState<Group>('DELIVERY_OPS');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Record<string, Row>>({});
  const owner = fromApplied || me;
  const query = useQuery({
    queryKey: ['cases', 'mine-for-handover', owner],
    queryFn: () => request('GET', api.cases.GET('/cases', { params: { query: { assigneeId: owner, size: 100 } } })),
  });
  const mine: readonly Summary[] = (query.data?.items ?? []).filter((c) => (c.assigneeGroup ?? 'DELIVERY_OPS') === group && c.state !== 'CLOSED');
  const rowOf = (id: string): Row => rows[id] ?? { picked: true, nextAction: '', checkDue: '' };
  const setRow = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...rowOf(id), ...patch } }));
  const picked = mine.filter((c) => rowOf(c.caseId ?? '').picked);
  const ok = to.trim().length > 0 && to.trim() !== owner && picked.length > 0 && picked.every((c) => rowOf(c.caseId ?? '').nextAction.trim().length > 0);
  const cmd = useCommand(async (_v: null, key) => {
    const r = await request(
      'POST',
      api.cases.POST('/shift-handovers', {
        ...commandParams(key),
        body: {
          group,
          toOperatorId: to.trim(),
          ...(fromApplied ? { fromOperatorId: fromApplied } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          items: picked.map((c) => {
            const row = rowOf(c.caseId ?? '');
            return { caseId: c.caseId ?? '', nextAction: row.nextAction.trim(), ...(row.checkDue ? { checkDueAt: `${row.checkDue}:00+09:00` } : {}) };
          }),
        },
      }),
    );
    void queryClient.invalidateQueries({ queryKey: ['handovers'] });
    return r;
  });
  return (
    <form
      className="space-y-3"
      aria-label={m.write}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        if (cmd.phase.kind === 'rejected' || cmd.phase.kind === 'done') cmd.reset();
        void cmd.run(null);
      }}
    >
      <div className="flex flex-wrap items-end gap-2 rounded-box border border-base-300 bg-base-100 p-3 text-sm">
        {admin && (
          <>
            <label className="flex flex-col gap-1">
              {m.fromOther}
              <input className="input input-sm w-56 font-mono" placeholder={me} value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <button type="button" className="btn btn-sm" onClick={() => setFromApplied(from.trim() === me ? '' : from.trim())}>
              {m.loadCases}
            </button>
          </>
        )}
        {admin ? (
          <label className="flex flex-col gap-1">
            {m.group}
            <select className="select select-sm" value={group} onChange={(e) => setGroup(e.target.value === 'ORDER_OPS' ? 'ORDER_OPS' : 'DELIVERY_OPS')}>
              <option value="DELIVERY_OPS">{label(messages.cases.groupName, 'DELIVERY_OPS')}</option>
              <option value="ORDER_OPS">{label(messages.cases.groupName, 'ORDER_OPS')}</option>
            </select>
          </label>
        ) : (
          // 라이더 운영은 지원센터 팀만 쓴다(관리자 팀 인계서는 관리자만 — 서버 403)
          <p className="flex flex-col gap-1" data-testid="handover-group-fixed">
            {m.group}
            <span className="font-medium">{label(messages.cases.groupName, 'DELIVERY_OPS')}</span>
          </p>
        )}
        <label className="flex flex-col gap-1">
          {m.to}
          <input className="input input-sm w-56 font-mono" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <p className="max-w-xs text-xs text-base-content/60" data-testid="handover-to-hint">
          {m.toRoleHint}
        </p>
      </div>
      <p className="text-sm">{m.ownerLine(owner)}</p>
      <QueryState state={toUiState(query, () => mine.length === 0)} onRetry={() => void query.refetch()} emptyText={m.noCases}>
        {() => (
          <ul className="space-y-2">
            {mine.map((c) => {
              const id = c.caseId ?? '';
              const row = rowOf(id);
              return (
                <li key={id} className="space-y-1 rounded-box border border-base-300 bg-base-100 p-3 text-sm" data-testid="handover-case">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="checkbox checkbox-sm" checked={row.picked} onChange={(e) => setRow(id, { picked: e.target.checked })} />
                    <span className="badge badge-ghost badge-sm">{text(c.priority)}</span>
                    <span>{label(messages.cases.kindName, c.kind)}</span>
                    <Link className="link" to={`/cases/${encodeURIComponent(id)}`}>
                      {c.summary || id}
                    </Link>
                    {(c.openObligationCount ?? 0) > 0 && <span className="badge badge-warning badge-sm">{m.followUpsLeft(c.openObligationCount ?? 0)}</span>}
                  </label>
                  {row.picked && (
                    <div className="flex flex-wrap items-end gap-2 pl-6">
                      <label className="flex flex-col gap-1">
                        {m.nextAction}
                        <input className="input input-sm w-96" maxLength={500} value={row.nextAction} onChange={(e) => setRow(id, { nextAction: e.target.value })} />
                      </label>
                      <label className="flex flex-col gap-1">
                        {m.checkDue}
                        <input type="datetime-local" className="input input-sm" value={row.checkDue} onChange={(e) => setRow(id, { checkDue: e.target.value })} />
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
      <label className="flex flex-col gap-1 text-sm">
        {m.note}
        <textarea className="textarea textarea-sm w-full max-w-lg" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="text-xs text-base-content/60">{m.piiHint}</p>
      <button type="submit" className="btn btn-sm btn-primary" disabled={!ok || cmd.busy}>
        {m.write}
      </button>
      <CommandFeedback command={cmd}>{(h) => <span className="text-xs text-success">{m.written(h.shiftHandoverId ?? '')}</span>}</CommandFeedback>
    </form>
  );
}

// ---------------------------------------------------------------- 목록·수락·취소

function HandoverList({ mode }: { readonly mode: 'inbox' | 'sent' | 'unreceived' }) {
  const api = useApi();
  const { me } = useMe();
  const query = useQuery({
    queryKey: ['handovers', mode],
    queryFn: () =>
      request('GET', api.cases.GET('/shift-handovers', { params: { query: mode === 'unreceived' ? { unreceived: true, size: 50 } : { size: 50 } } })),
  });
  const items = (query.data?.items ?? []).filter((h) =>
    mode === 'inbox' ? h.toOperatorId === me : mode === 'sent' ? h.fromOperatorId === me || h.createdBy === me : true,
  );
  const empty = mode === 'inbox' ? m.emptyInbox : mode === 'sent' ? m.emptySent : m.emptyUnreceived;
  return (
    <QueryState state={toUiState(query, () => items.length === 0)} onRetry={() => void query.refetch()} emptyText={empty}>
      {() => (
        <ul className="space-y-3">
          {items.map((h) => (
            <HandoverCard key={h.shiftHandoverId} h={h} mode={mode} />
          ))}
        </ul>
      )}
    </QueryState>
  );
}

const outcomeTone: Readonly<Record<string, string>> = {
  ACCEPTED: 'badge-success',
  EXCLUDED: 'badge-warning',
  SKIPPED_CHANGED: 'badge-ghost',
  SKIPPED_NOT_ALLOWED: 'badge-error',
  PENDING: 'badge-info',
  CANCELLED: 'badge-ghost',
};

function HandoverCard({ h, mode }: { readonly h: Handover; readonly mode: 'inbox' | 'sent' | 'unreceived' }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { me, admin } = useMe();
  const pending = h.state === 'PENDING';
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['handovers'] });
    void queryClient.invalidateQueries({ queryKey: ['cases'] });
  };
  const accept = useCommand(async (_v: null, key) => {
    const r = await request(
      'POST',
      api.cases.POST('/shift-handovers/{shiftHandoverId}/acceptances', {
        ...commandParams(key, { path: { shiftHandoverId: h.shiftHandoverId ?? '' } }),
        body: excluded.size > 0 ? { excludedCaseIds: [...excluded] } : {},
      }),
    );
    refresh();
    return r;
  });
  const cancel = useCommand(async (_v: null, key) => {
    const r = await request('POST', api.cases.POST('/shift-handovers/{shiftHandoverId}/cancellations', { ...commandParams(key, { path: { shiftHandoverId: h.shiftHandoverId ?? '' } }) }));
    refresh();
    return r;
  });
  const canAccept = pending && h.toOperatorId === me && mode === 'inbox';
  const canCancel = pending && (h.fromOperatorId === me || h.createdBy === me || admin) && mode !== 'inbox';
  return (
    <li className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3 text-sm" data-testid="handover" data-state={h.state}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono">{h.shiftHandoverId}</span>
        <span className="badge badge-sm">{label(m.stateName, h.state)}</span>
        {h.unreceived && <span className="badge badge-warning badge-sm">{m.unreceived}</span>}
        <span>{m.fromTo(text(h.fromOperatorId), text(h.toOperatorId))}</span>
        <span className="opacity-70">{label(messages.cases.groupName, h.group)}</span>
        <span className="opacity-70">{when(h.createdAt)}</span>
      </div>
      {pending && <p className="text-xs text-base-content/60">{m.pendingNote}</p>}
      {h.note && <p className="whitespace-pre-wrap opacity-80">{h.note}</p>}
      <ul className="space-y-1">
        {(h.items ?? []).map((it) => {
          const id = it.caseId ?? '';
          return (
            <li key={id} className="flex flex-wrap items-center gap-2" data-testid="handover-item" data-outcome={it.outcome}>
              {canAccept && (
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  aria-label={m.receive(id)}
                  checked={!excluded.has(id)}
                  onChange={(e) =>
                    setExcluded((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.delete(id);
                      else n.add(id);
                      return n;
                    })
                  }
                />
              )}
              <Link className="link font-mono" to={`/cases/${encodeURIComponent(id)}`}>
                {id}
              </Link>
              <span className={`badge badge-sm ${outcomeTone[it.outcome ?? 'PENDING'] ?? ''}`}>{label(m.outcomeName, it.outcome)}</span>
              <span>{`${m.nextAction}: ${text(it.nextAction)}`}</span>
              {it.checkDueAt && <span className="opacity-70">{`${m.checkDue} ${when(it.checkDueAt)}`}</span>}
              {(it.openObligationsAt ?? 0) > 0 && <span className="opacity-70">{m.followUpsLeft(it.openObligationsAt ?? 0)}</span>}
            </li>
          );
        })}
      </ul>
      {(h.teamSnapshot?.length ?? 0) > 0 && <p className="text-xs text-base-content/60">{m.snapshot(h.teamSnapshot?.length ?? 0)}</p>}
      {canAccept && (
        <div className="space-y-1">
          <button type="button" className="btn btn-sm btn-primary" disabled={accept.busy} onClick={() => void accept.run(null)}>
            {excluded.size > 0 ? m.acceptSome(excluded.size) : m.acceptAll}
          </button>
          {accept.phase.kind === 'rejected' && accept.phase.failure instanceof ProblemFailure && accept.phase.failure.problem.code === 'FORBIDDEN' ? (
            // 0.13.1: 후임에게 그 팀 역할이 없으면 403 — 인계서는 받기 전 그대로
            <p role="alert" className="alert alert-warning text-sm" data-testid="handover-accept-forbidden">
              {m.acceptForbidden}
            </p>
          ) : (
            <CommandFeedback command={accept}>{() => <span className="text-xs text-success">{m.accepted}</span>}</CommandFeedback>
          )}
        </div>
      )}
      {canCancel && (
        <div className="space-y-1">
          <button type="button" className="btn btn-sm btn-outline" disabled={cancel.busy} onClick={() => void cancel.run(null)}>
            {m.cancel}
          </button>
          <CommandFeedback command={cancel}>{() => <span className="text-xs text-success">{m.cancelled}</span>}</CommandFeedback>
        </div>
      )}
    </li>
  );
}
