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
import { useStaffText } from '../../shared/employeeLabels';
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
import { caseSummaryText } from '../../shared/blockReason';
import { label, text, when } from '../../shared/ops';
import { CodeLabel, NextAction, Notice, PageHeader } from '../../shared/admin';
import { StaffName } from '../lookup/parts';
import { OperatorRefStatus, operatorRefBlocked, useOperatorRef } from '../../shared/operatorRef';

const seoulParts = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' });
/** "11/19 오전 교대 인계" — 서울 시각 기준 표시만 */
export function handoverLabel(iso: string | null | undefined): string {
  if (!iso) return messages.handovers.label('', '');
  const p = Object.fromEntries(seoulParts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return messages.handovers.label(`${p.month}/${p.day}`, Number(p.hour) < 12 ? '오전' : '오후');
}

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
    <section className="space-y-4">
      <PageHeader title={m.title} />
      {/* 관리자 형식(2026-11-18): 회색 안내 상자 + 밑줄 탭(접수 건과 같게) */}
      <Notice>{m.noAuto}</Notice>
      {/* 탭 + 내용을 한 카드에(2026-11-18) */}
      <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
        <div role="tablist" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-base-300 px-3">
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={t === tab} className={`-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${t === tab ? 'border-primary font-semibold text-base-content' : 'border-transparent text-base-content/55 hover:text-base-content'}`} onClick={() => setParams(t === tabs[0] ? {} : { tab: t })}>
              {m.tabs[t]}
            </button>
          ))}
        </div>
        <div className="bg-base-200/30 p-4">
          {tab === 'write' && <WriteForm />}
          {tab === 'inbox' && <HandoverList mode="inbox" />}
          {tab === 'sent' && <HandoverList mode="sent" />}
          {tab === 'unreceived' && <HandoverList mode="unreceived" />}
        </div>
      </div>
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
  const ownerName = useStaffText(owner);
  const query = useQuery({
    queryKey: ['cases', 'mine-for-handover', owner],
    queryFn: () => request('GET', api.cases.GET('/cases', { params: { query: { assigneeId: owner, size: 100 } } })),
  });
  const mine: readonly Summary[] = (query.data?.items ?? []).filter((c) => (c.assigneeGroup ?? 'DELIVERY_OPS') === group && c.state !== 'CLOSED');
  const rowOf = (id: string): Row => rows[id] ?? { picked: true, nextAction: '', checkDue: '' };
  const setRow = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...rowOf(id), ...patch } }));
  const picked = mine.filter((c) => rowOf(c.caseId ?? '').picked);
  // 후임 — 사번이면 hr 로 운영자를 찾아 "[이름] · 사번 에게 넘겨요"로 확인(2026-11-24 HR-5). 찾지 못했으면 보내지 않는다
  const toRef = useOperatorRef(to);
  const toId = toRef.id ?? '';
  const ok = toId !== '' && !operatorRefBlocked(toRef) && toId !== owner && picked.length > 0 && picked.every((c) => rowOf(c.caseId ?? '').nextAction.trim().length > 0);
  // 보낼 값은 누른 때 만들어 명령 값으로(2026-11-23 #410 후속) — 결과 불명 뒤 "같은 요청으로 결과 확인"(같은 키)은 처음 값 그대로
  const writeBody = () => ({
    group,
    toOperatorId: toId,
    ...(fromApplied ? { fromOperatorId: fromApplied } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
    items: picked.map((c) => {
      const row = rowOf(c.caseId ?? '');
      return { caseId: c.caseId ?? '', nextAction: row.nextAction.trim(), ...(row.checkDue ? { checkDueAt: `${row.checkDue}:00+09:00` } : {}) };
    }),
  });
  const cmd = useCommand(async (body: ReturnType<typeof writeBody>, key) => {
    const r = await request('POST', api.cases.POST('/shift-handovers', { ...commandParams(key), body }));
    void queryClient.invalidateQueries({ queryKey: ['handovers'] });
    return r;
  });
  return (
    // 두 칸(2026-11-18): 왼쪽 = 넘길 접수 건 체크 목록(건마다 다음 조치), 오른쪽 = 후임·팀·메모·쓰기
    <form
      className="grid items-start gap-4 lg:grid-cols-3 [&>*]:min-w-0"
      aria-label={m.write}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        if (cmd.phase.kind === 'rejected' || cmd.phase.kind === 'done') cmd.reset();
        void cmd.run(writeBody());
      }}
    >
      <div className="min-w-0 space-y-3 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">{m.ownerLine(ownerName)}</p>
          {query.isSuccess && mine.length > 0 && <span className="badge badge-ghost badge-sm">{`${picked.length} / ${mine.length}`}</span>}
        </div>
        <QueryState state={toUiState(query, () => mine.length === 0)} onRetry={() => void query.refetch()} emptyText={m.noCases}>
          {() => (
            <ul className="space-y-2">
              {mine.map((c) => {
                const id = c.caseId ?? '';
                const row = rowOf(id);
                return (
                  <li
                    key={id}
                    className={`space-y-2 rounded-box border bg-base-100 p-3 text-sm shadow-sm transition-colors ${row.picked ? 'border-primary/40' : 'border-base-300 opacity-70'}`}
                    data-testid="handover-case"
                  >
                    <label className="flex flex-wrap items-center gap-2">
                      <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={row.picked} onChange={(e) => setRow(id, { picked: e.target.checked })} />
                      <span className={`badge badge-sm font-mono ${c.priority === 'P1' ? 'badge-error' : 'badge-ghost'}`}>{text(c.priority)}</span>
                      <span className="text-base-content/60">{c.kind ? <CodeLabel code={c.kind} names={messages.cases.kindName} /> : messages.none}</span>
                      <Link className="font-medium hover:text-primary hover:underline" to={`/cases/${encodeURIComponent(id)}`}>
                        {c.summary ? caseSummaryText(c.summary) : id}
                      </Link>
                      {(c.openObligationCount ?? 0) > 0 && <span className="badge badge-warning badge-soft badge-sm">{m.followUpsLeft(c.openObligationCount ?? 0)}</span>}
                    </label>
                    {row.picked && (
                      <div className="grid gap-2 pl-6 sm:grid-cols-[1fr_auto]">
                        <label className="flex flex-col gap-1 text-xs text-base-content/60">
                          {m.nextAction}
                          <input className="input input-sm w-full" maxLength={500} value={row.nextAction} onChange={(e) => setRow(id, { nextAction: e.target.value })} />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-base-content/60">
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
      </div>

      <aside className="min-w-0 space-y-3 rounded-box border border-base-300 bg-base-100 p-4 text-sm shadow-sm lg:sticky lg:top-4">
        {admin && (
          <div className="flex items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-base-content/60">
              {m.fromOther}
              <input className="input input-sm w-full font-mono" placeholder={me} value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <button type="button" className="btn btn-sm" onClick={() => setFromApplied(from.trim() === me ? '' : from.trim())}>
              {m.loadCases}
            </button>
          </div>
        )}
        {admin ? (
          <label className="flex flex-col gap-1 text-xs text-base-content/60">
            {m.group}
            <select className="select select-sm w-full" value={group} onChange={(e) => setGroup(e.target.value === 'ORDER_OPS' ? 'ORDER_OPS' : 'DELIVERY_OPS')}>
              <option value="DELIVERY_OPS">{label(messages.cases.groupName, 'DELIVERY_OPS')}</option>
              <option value="ORDER_OPS">{label(messages.cases.groupName, 'ORDER_OPS')}</option>
            </select>
          </label>
        ) : (
          // 라이더 운영은 지원센터 팀만 쓴다(관리자 팀 인계서는 관리자만 — 서버 403)
          <p className="flex flex-col gap-1 text-xs text-base-content/60" data-testid="handover-group-fixed">
            {m.group}
            <span className="text-sm font-medium text-base-content">{label(messages.cases.groupName, 'DELIVERY_OPS')}</span>
          </p>
        )}
        <label className="flex flex-col gap-1 text-xs text-base-content/60">
          {m.to}
          <input className="input input-sm w-full font-mono" placeholder={m.toPlaceholder} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {/* 전임 자신이면 "넘겨요"(초록) 대신 막는 안내만(2026-11-24 점검 — 둘이 한 줄에 같이 뜨던 것) */}
        {toId !== '' && toId === owner ? (
          <span className="block text-xs text-warning" role="status" data-testid="handover-to-self">
            {m.toSelf}
          </span>
        ) : (
          <OperatorRefStatus r={toRef} foundText={m.toFound} testId="handover-to-status" />
        )}
        <p className="text-xs text-base-content/60" data-testid="handover-to-hint">
          {m.toRoleHint}
        </p>
        <label className="flex flex-col gap-1 text-xs text-base-content/60">
          {m.note}
          <textarea className="textarea textarea-sm w-full" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className="text-xs text-base-content/60">{m.piiHint}</p>
        <button type="submit" className="btn btn-sm btn-primary w-full" disabled={!ok || cmd.busy}>
          {m.write}
        </button>
        <CommandFeedback command={cmd}>{(h) => <span className="text-xs text-success">{m.written(h.shiftHandoverId ?? '')}</span>}</CommandFeedback>
      </aside>
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
        <div className="space-y-3">
          <HandoverNext items={items} mode={mode} />
          <ul className="space-y-3">
            {items.map((h) => (
              <HandoverCard key={h.shiftHandoverId} h={h} mode={mode} />
            ))}
          </ul>
        </div>
      )}
    </QueryState>
  );
}

/**
 * 다음 할 일(2026-11-18) — 이미 읽은 목록의 받기 전(PENDING) 인계만 센다(새 판정 없음).
 * 나에게 온 인계: 받을 것이 있으면 첫 인계서로. 내가 쓴 인계: 아직 안 받은 것이 있으면 담당은 그대로라는 안내만.
 */
function HandoverNext({ items, mode }: { readonly items: readonly Handover[]; readonly mode: 'inbox' | 'sent' | 'unreceived' }) {
  const pending = items.filter((h) => h.state === 'PENDING');
  const first = pending[0];
  if (!first || mode === 'unreceived') return null;
  if (mode === 'sent') return <NextAction tone="info" title={m.nextSent(pending.length)} />;
  return (
    <NextAction tone="warning" title={m.nextInbox(pending.length)} body={m.nextInboxBody}>
      <a href={`#handover-${first.shiftHandoverId ?? ''}`} className="btn btn-sm btn-primary">
        {m.nextGo}
      </a>
    </NextAction>
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
  // 보낼 값은 누른 때 만들어 명령 값으로(2026-11-23 #410 후속) — 결과 불명 뒤 "같은 요청으로 결과 확인"(같은 키)은 처음 값 그대로
  const accept = useCommand(async (excludedCaseIds: readonly string[], key) => {
    const r = await request(
      'POST',
      api.cases.POST('/shift-handovers/{shiftHandoverId}/acceptances', {
        ...commandParams(key, { path: { shiftHandoverId: h.shiftHandoverId ?? '' } }),
        body: excludedCaseIds.length > 0 ? { excludedCaseIds: [...excludedCaseIds] } : {},
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
    // 카드(2026-11-18): 머리 = 전임 → 후임(머리글자)·상태·팀·시각, 몸통 = 건별 줄, 아래 = 받기·취소
    <li id={`handover-${h.shiftHandoverId ?? ''}`} className={`scroll-mt-4 overflow-hidden rounded-box border bg-base-100 text-sm shadow-sm ${h.unreceived ? 'border-warning/50' : 'border-base-300'}`} data-testid="handover" data-state={h.state}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-base-300 px-4 py-3">
        <span className="flex items-center gap-2">
          <Initial id={h.fromOperatorId} />
          <span className="text-base-content/40" aria-hidden="true">
            →
          </span>
          <Initial id={h.toOperatorId} />
        </span>
        <span className="font-medium" data-testid="handover-people">
          <StaffName id={h.fromOperatorId} /> → <StaffName id={h.toOperatorId} />
        </span>
        <span className={`badge badge-sm badge-soft ${STATE_TONE[h.state ?? ''] ?? ''}`}>{h.state ? <CodeLabel code={h.state} names={m.stateName} /> : messages.none}</span>
        {h.unreceived && <span className="badge badge-warning badge-sm">{m.unreceived}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-2 text-xs text-base-content/55">
          <span>{h.group ? <CodeLabel code={h.group} names={messages.cases.groupName} /> : messages.none}</span>
          <span>{when(h.createdAt)}</span>
          {/* 교대 인계 표기(ADR-0070 덧붙임): 날짜 + 오전/오후 — 시스템 ID 는 보이지 않는다 */}
          <span data-testid="handover-label">{handoverLabel(h.createdAt)}</span>
        </span>
      </div>
      <div className="space-y-3 px-4 py-3">
        {pending && <p className="text-xs text-base-content/60">{m.pendingNote}</p>}
        {h.note && <p className="whitespace-pre-wrap rounded-box bg-base-200/60 px-3 py-2">{h.note}</p>}
        <ul className="divide-y divide-base-300/70 rounded-box border border-base-300">
          {(h.items ?? []).map((it) => {
            const id = it.caseId ?? '';
            // 건 이름 — 작성 때 팀 기록(teamSnapshot)에 있는 종류를 먼저, 번호는 작게(2026-11-18 "제목이 번호뿐")
            const kind = (h.teamSnapshot ?? []).find((s) => s.caseId === id)?.kind;
            return (
              <li key={id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2" data-testid="handover-item" data-outcome={it.outcome}>
                {canAccept && (
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm checkbox-primary mt-0.5"
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
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link className="text-primary hover:underline" to={`/cases/${encodeURIComponent(id)}`}>
                      {kind && (
                        <span className="mr-1.5 font-medium">
                          <CodeLabel code={kind} names={messages.cases.kindName} />
                        </span>
                      )}
                      <span className="font-mono text-xs">{id}</span>
                    </Link>
                    <span className={`badge badge-sm ${outcomeTone[it.outcome ?? 'PENDING'] ?? ''}`}>{it.outcome ? <CodeLabel code={it.outcome} names={m.outcomeName} /> : messages.none}</span>
                    {(it.openObligationsAt ?? 0) > 0 && <span className="badge badge-warning badge-soft badge-sm">{m.followUpsLeft(it.openObligationsAt ?? 0)}</span>}
                  </div>
                  <p>{`${m.nextAction}: ${text(it.nextAction)}`}</p>
                  {it.checkDueAt && <p className="text-xs text-base-content/55">{`${m.checkDue} ${when(it.checkDueAt)}`}</p>}
                </div>
              </li>
            );
          })}
        </ul>
        {(h.teamSnapshot?.length ?? 0) > 0 && <p className="text-xs text-base-content/60">{m.snapshot(h.teamSnapshot?.length ?? 0)}</p>}
      </div>
      {(canAccept || canCancel) && (
        <div className="space-y-2 border-t border-base-300 bg-base-200/40 px-4 py-3">
          {canAccept && (
            <div className="space-y-1">
              <button type="button" className="btn btn-sm btn-primary" disabled={accept.busy} onClick={() => void accept.run([...excluded])}>
                {excluded.size > 0 ? m.acceptSome(excluded.size) : m.acceptAll}
              </button>
              {accept.phase.kind === 'rejected' && accept.phase.failure instanceof ProblemFailure && accept.phase.failure.problem.code === 'FORBIDDEN' ? (
                // 0.13.1: 후임에게 그 팀 역할이 없으면 403 — 인계서는 받기 전 그대로
                <p role="alert" className="alert alert-warning alert-soft text-sm" data-testid="handover-accept-forbidden">
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
        </div>
      )}
    </li>
  );
}

const STATE_TONE: Readonly<Record<string, string>> = { PENDING: 'badge-info', COMPLETED: 'badge-success', CANCELLED: 'badge-ghost' };

/** 운영자 머리글자 동그라미(ID 는 옆 글자로 읽힌다) */
function Initial({ id }: { readonly id: string | null | undefined }) {
  const letter = (id ?? '').replace(/^op-/i, '').charAt(0).toUpperCase() || '?';
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary" aria-hidden="true" title={id ?? undefined}>
      {letter}
    </span>
  );
}
