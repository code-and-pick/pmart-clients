// 지원센터 사건함(case 0.4.0, 백엔드 요청 backoffice/2026-11-16-request-case-inbox-and-pending-work §1).
// - 목록 `GET /cases`: 탭 = 안 집은 것(unassigned=true)·내 것(assigneeId=나)·기한 넘김(overdue=true)·닫힌 것(state=CLOSED). 탭은 URL 쿼리. 긴급·기한 이른 것 먼저(서버 순서 그대로).
//   refs(deliveryId·orderId·riderId)는 배송·주문·라이더 화면으로. 기한 넘김은 빨간 표시(표시만).
// - 상세 `GET /cases/{caseId}`: 이력·종결. 집기 `POST …/assignments` {assigneeId: 나}(관리자는 다른 사람도), 닫기 `POST …/closures` {resolution, summary}.
//   응답은 사건 상세(200) — 그 값으로 바로 바꾼다. 409(이미 다른 사람이 집음·닫힘)는 문구로.
// - 오배송 열기 `POST /cases` {kind: MISDELIVERY, subjectType: DELIVERY, subjectRef: deliveryId, summary, evidence?} → 201 → 상세. 409 CASE_ALREADY_OPEN.
// - 역할: 집기·닫기 버튼은 RIDER_OPS·OPERATOR_ADMIN 에게만(CS_AGENT 는 보기). 다른 사람이 집은 사건 닫기는 관리자만. 판정은 서버.
// - 요약·근거에 고객 주소·연락처 원문을 적지 않게 안내한다.
// - case 0.5.0 배차 실패 DISPATCH_FAILED — 배송 쪽(모든 역할, 집기·닫기 RIDER_OPS·관리자), refs deliveryId·orderId, 뒤 실패는 이력 RECURRED(재발).
// - case 0.5.0(백엔드 PR #21, R-3): 사가·결제 이상 RECONCILIATION·PAYMENT_UNKNOWN — 관리자만 보이고(종류 필터도 관리자만),
//   사건은 알림·기록, 조치는 처리 대기(/pending)·각 메뉴. refs 에 orderId(주문 화면 링크)·sagaId·paymentAttemptId·resourceId.
// - 목록은 bff 0.5.0 `GET /backoffice/views/case-inbox`(백엔드 요청 request-case-inbox-linked-state) — case 목록 값 + 연결 배송·주문의 지금 상태(linked).
//   linked 칸: confidence UNKNOWN → "확인 불가"(장애이거나 그 역할이 못 보는 원천), state null + DIRECT → "원천에 없음". 원천 값은 기존 상태 이름표로만 옮긴다.
//   unavailableSources 에 case-service 가 있으면 목록 자체를 못 읽은 것 → 오류(빈 목록 아님). size 최대 50 → page.nextCursor 로 다음 쪽(URL cursor).
//   집기·닫기·상세는 그대로 case-service 직접.
// - case 0.6.0 다시 열기 `POST /cases/{id}/reopenings` {reason} — 닫힌 사건, 닫기와 같은 사람(배송 쪽 = 지원센터·관리자, 관리자 팀 사건 = 관리자).
//   REOPENED 는 열린 사건. 409 CASE_ALREADY_OPEN = 같은 일로 열린 사건이 있음 → 통합 조회로 그 대상의 사건을 찾게 안내. refs previousCaseId → "이전 사건" 링크.
// - case 0.7.0 넘기기 `POST /cases/{id}/transfers` {toGroup, reason} — 배송 쪽 사건만 지원센터(DELIVERY_OPS) ↔ 관리자 팀(ORDER_OPS). 담당 비움·기한 그대로.
//   관리자 팀으로 간 배송 쪽 사건은 지원센터·상담원이 보기만 — 목록·상세에 "관리자 처리 중"(해결된 것처럼 보이지 않게, 업무 원문 §5.3).
//   버튼은 할 수 있어 보일 때만(판정은 서버 — 403·409·422 는 코드 문구).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { ProblemFailure, request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { operations as BffOps } from '../../api/generated/backoffice-bff';
import type { components } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { messages as m } from '../../shared/messages';
import { label, text, when } from '../../shared/ops';
import { SourceStamps } from '../../shared/SourceStamps';
import { FollowUps, isOpenObligation } from './FollowUps';

type Case = components['schemas']['Case'];
type InboxView = BffOps['getCaseInboxView']['responses'][200]['content']['application/json'];
type InboxItem = NonNullable<InboxView['items']>[number];
type Linked = NonNullable<InboxItem['linked']>[number];

const CASE_SOURCE = 'case-service';

/** bff 가 case 목록을 못 읽었으면(unavailableSources 에 case-service) 빈 목록이 아니라 조회 실패 */
class CaseSourceUnavailable extends Error {}
type Summary = components['schemas']['CaseSummary'];
type Resolution = keyof typeof m.cases.resolutionName;
const RESOLUTIONS = Object.keys(m.cases.resolutionName) as Resolution[];
type Kind = components['schemas']['CaseKind'];
/** 배송 쪽(0.4.0 넷 + 0.5.0 배차 실패 — RIDER_OPS·CS_AGENT·관리자) */
const DELIVERY_KINDS: readonly Kind[] = ['RIDER_HELP', 'DELIVERY_INCIDENT', 'RIDER_LOCATION_STALE', 'MISDELIVERY', 'DISPATCH_FAILED'];
/** 사가·결제 이상(0.5.0 — 관리자만) */
const ORDER_KINDS: readonly Kind[] = ['RECONCILIATION', 'PAYMENT_UNKNOWN'];
const isOrderKind = (k: Kind | undefined) => k !== undefined && ORDER_KINDS.includes(k);
/** 관리자 팀으로 넘어간 배송 쪽 사건 — 지원센터·상담원은 보기만(0.7.0) */
const withAdminTeam = (c: { readonly kind?: string | null; readonly assigneeGroup?: string | null }) =>
  c.assigneeGroup === 'ORDER_OPS' && !isOrderKind((c.kind ?? undefined) as Kind | undefined);
type Tab = keyof typeof m.cases.tabs;
const TABS = Object.keys(m.cases.tabs) as Tab[];
const isTab = (v: string | null): v is Tab => TABS.some((t) => t === v);

function useCaseRoles() {
  const { session } = useSession();
  const roles = session?.roles ?? [];
  return {
    me: session?.subject ?? '',
    admin: roles.includes('OPERATOR_ADMIN'),
    team: roles.includes('RIDER_OPS'),
  };
}

const refLink = (refType: string | undefined, refId: string | undefined) => {
  if (!refId) return null;
  const to =
    refType === 'deliveryId'
      ? `/deliveries/${encodeURIComponent(refId)}`
      : refType === 'orderId'
        ? `/orders/${encodeURIComponent(refId)}`
        : refType === 'riderId'
          ? `/riders/${encodeURIComponent(refId)}`
          : refType === 'previousCaseId'
            ? `/cases/${encodeURIComponent(refId)}`
            : null;
  const name = `${label(m.cases.refName, refType)} ${refId}`;
  return to ? (
    <Link key={`${refType}:${refId}`} className="link" to={to}>
      {name}
    </Link>
  ) : (
    <span key={`${refType}:${refId}`}>{name}</span>
  );
};

function Refs({ c }: { readonly c: Pick<Summary, 'refs' | 'subjectRef'> }) {
  const refs = c.refs ?? [];
  if (refs.length === 0) return <span>{text(c.subjectRef)}</span>;
  return <span className="flex flex-wrap gap-x-2">{refs.map((r) => refLink(r.refType, r.refId))}</span>;
}

/** 연결 배송·주문 한 칸 — 원천 값을 기존 상태 이름표로만 옮긴다(합치거나 해석하지 않음) */
function LinkedState({ l }: { readonly l: Linked }) {
  const name = l.kind === 'ORDER' ? m.cases.linkedOrder : m.cases.linkedDelivery;
  const unknown = l.source?.confidence === 'UNKNOWN';
  const value = unknown ? (
    <span className="text-warning">{m.cases.linkedUnknown}</span>
  ) : l.state ? (
    label(l.kind === 'ORDER' ? m.orders.statusName : m.deliveries.executionState, l.state)
  ) : (
    <span className="opacity-70">{m.cases.linkedMissing}</span>
  );
  return (
    <li data-testid="case-linked" data-kind={l.kind} data-id={l.id}>
      <span className="opacity-70">{name}</span> {value}
    </li>
  );
}

function Sla({ c }: { readonly c: Pick<Summary, 'slaDueAt' | 'overdue'> }) {
  if (!c.slaDueAt) return <span>{m.none}</span>;
  return (
    <span className={c.overdue ? 'font-semibold text-error' : ''} data-overdue={c.overdue ? 'true' : 'false'}>
      {when(c.slaDueAt)}
      {c.overdue && ` · ${m.cases.overdue}`}
    </span>
  );
}

export function CaseListPage() {
  const api = useApi();
  const { me, admin } = useCaseRoles();
  const kinds = admin ? [...DELIVERY_KINDS, ...ORDER_KINDS] : DELIVERY_KINDS;
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = isTab(tabParam) ? tabParam : 'unassigned';
  const kind = kinds.find((k) => k === params.get('kind'));
  const cursor = params.get('cursor') ?? '';
  const setQuery = (next: { tab?: Tab; kind?: Kind | ''; cursor?: string }) => {
    const k = next.kind === undefined ? kind : next.kind || undefined;
    setParams({ tab: next.tab ?? tab, ...(k ? { kind: k } : {}), ...(next.cursor ? { cursor: next.cursor } : {}) });
  };
  const query = useQuery({
    queryKey: ['cases', tab, me, kind ?? '', cursor],
    queryFn: async (): Promise<InboxView> => {
      const view = await request(
        'GET',
        api.bff.GET('/views/case-inbox', {
          params: {
            query: {
              size: 50,
              ...(kind ? { kind } : {}),
              ...(tab === 'unassigned' ? { unassigned: true } : {}),
              ...(tab === 'mine' ? { assignee: me } : {}),
              ...(tab === 'overdue' ? { overdue: true } : {}),
              ...(tab === 'closed' ? { state: 'CLOSED' } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      );
      if ((view.unavailableSources ?? []).includes(CASE_SOURCE)) throw new CaseSourceUnavailable(CASE_SOURCE);
      return view;
    },
  });
  return (
    <section className="max-w-6xl space-y-4">
      <h1 className="text-xl font-bold">{m.cases.title}</h1>
      <p className="text-sm opacity-70">{m.cases.intro}</p>
      {admin && <p className="text-sm opacity-70">{m.cases.orderNote}</p>}
      <div role="tablist" className="tabs tabs-box w-fit">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={t === tab} className={`tab ${t === tab ? 'tab-active' : ''}`} onClick={() => setQuery({ tab: t })}>
            {m.cases.tabs[t]}
          </button>
        ))}
      </div>
      <label className="flex w-fit items-center gap-2 text-sm">
        {m.cases.kind}
        <select className="select select-sm" value={kind ?? ''} onChange={(e) => setQuery({ kind: kinds.find((k) => k === e.target.value) ?? '' })}>
          <option value="">{m.cases.anyKind}</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {label(m.cases.kindName, k)}
            </option>
          ))}
        </select>
      </label>
      <QueryState state={toUiState(query, (r) => (r.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={m.cases.empty}>
        {(r) => (
          <>
          <SourceStamps sources={r.sources} unavailableSources={r.unavailableSources} />
          <table className="table table-sm rounded-box bg-base-100">
            <thead>
              <tr>
                <th>{m.cases.priority}</th>
                <th>{m.cases.kind}</th>
                <th>{m.cases.summary}</th>
                <th>{m.cases.refs}</th>
                <th>{m.cases.linked}</th>
                <th>{m.cases.sla}</th>
                <th>{m.cases.assignee}</th>
                <th>{m.cases.state}</th>
              </tr>
            </thead>
            <tbody>
              {(r.items ?? []).map((c, i) => (
                <tr key={c.caseId ?? `case-${i}`} data-testid="case-row" className={c.overdue ? 'bg-error/5' : ''}>
                  <td>
                    <span className={`badge badge-sm ${c.priority === 'P1' ? 'badge-error' : 'badge-ghost'}`}>{text(c.priority)}</span>
                  </td>
                  <td>{label(m.cases.kindName, c.kind)}</td>
                  <td>
                    <Link className="link" to={`/cases/${encodeURIComponent(c.caseId ?? '')}`}>
                      {c.summary ? c.summary : label(m.cases.kindName, c.kind)}
                    </Link>
                  </td>
                  <td>
                    <Refs c={{ subjectRef: c.subjectRef ?? '', refs: (c.linkedRefs ?? []).map((x) => ({ refType: x.kind ?? '', refId: x.id ?? '' })) }} />
                  </td>
                  <td>
                    {(c.linked ?? []).length === 0 ? (
                      <span className="opacity-70">{m.none}</span>
                    ) : (
                      <ul className="space-y-0.5 text-xs">
                        {(c.linked ?? []).map((l) => (
                          <LinkedState key={`${l.kind ?? ''}:${l.id ?? ''}`} l={l} />
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>
                    <Sla c={{ slaDueAt: c.slaDueAt ?? null, overdue: c.overdue ?? false }} />
                  </td>
                  <td>
                    {withAdminTeam(c) && (
                      <span className="badge badge-warning badge-sm mr-1" data-testid="case-admin-team">
                        {m.cases.adminHandling}
                      </span>
                    )}
                    {c.assigneeId ?? m.cases.unassigned}
                  </td>
                  <td>{label(m.cases.stateName, c.state)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(cursor || r.page?.nextCursor) && (
            <div className="flex gap-2">
              {cursor && (
                <button type="button" className="btn btn-sm" onClick={() => setQuery({})}>
                  {m.cases.firstPage}
                </button>
              )}
              {r.page?.nextCursor && (
                <button type="button" className="btn btn-sm" onClick={() => setQuery({ cursor: r.page?.nextCursor ?? '' })}>
                  {m.cases.nextPage}
                </button>
              )}
            </div>
          )}
          </>
        )}
      </QueryState>
    </section>
  );
}

function AssignForm({ c, onDone }: { readonly c: Case; readonly onDone: (c: Case) => void }) {
  const api = useApi();
  const { me, admin, team } = useCaseRoles();
  const [other, setOther] = useState('');
  const assign = useCommand(async (v: { assigneeId: string }, key) => {
    const r = await request(
      'POST',
      api.cases.POST('/cases/{caseId}/assignments', { ...commandParams(key, { path: { caseId: c.caseId ?? '' }, version: c.version }), body: { assigneeId: v.assigneeId } }),
    );
    onDone(r);
    return r;
  });
  const run = (assigneeId: string) => {
    if (assign.phase.kind === 'rejected' || assign.phase.kind === 'done') assign.reset();
    void assign.run({ assigneeId });
  };
  const canPick = ((team && !withAdminTeam(c)) || admin) && !c.assigneeId;
  if (!canPick && !admin) return null;
  return (
    <div className="space-y-2 rounded-box bg-base-100 p-3 text-sm">
      {canPick && (
        <button type="button" className="btn btn-sm btn-primary" disabled={assign.busy} onClick={() => run(me)}>
          {m.cases.pick}
        </button>
      )}
      {admin && (
        <form
          className="flex flex-wrap items-end gap-2"
          aria-label={m.cases.assignTo}
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (other.trim()) run(other.trim());
          }}
        >
          <label className="flex flex-col gap-1">
            {m.cases.assignTo}
            <input className="input input-sm w-48" placeholder={m.cases.assignee_} value={other} onChange={(e) => setOther(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-sm" disabled={!other.trim() || assign.busy}>
            {m.cases.assign}
          </button>
        </form>
      )}
      <CommandFeedback command={assign}>{() => <span className="text-xs text-success">{m.cases.picked}</span>}</CommandFeedback>
    </div>
  );
}

function CloseForm({ c, onDone, openFollowUps }: { readonly c: Case; readonly onDone: (c: Case) => void; readonly openFollowUps: number }) {
  const api = useApi();
  const [resolution, setResolution] = useState<Resolution>('RESOLVED');
  const [summary, setSummary] = useState('');
  const close = useCommand(async (v: { resolution: Resolution; summary: string }, key) => {
    const r = await request(
      'POST',
      api.cases.POST('/cases/{caseId}/closures', { ...commandParams(key, { path: { caseId: c.caseId ?? '' }, version: c.version }), body: { resolution: v.resolution, summary: v.summary } }),
    );
    onDone(r);
    return r;
  });
  return (
    <form
      className="space-y-2 rounded-box bg-base-100 p-3 text-sm"
      aria-label={m.cases.close}
      onSubmit={(e) => {
        e.preventDefault();
        if (!summary.trim()) return;
        if (close.phase.kind === 'rejected') close.reset();
        void close.run({ resolution, summary: summary.trim() });
      }}
    >
      <h2 className="font-semibold">{m.cases.close}</h2>
      <label className="flex flex-col gap-1">
        {m.cases.resolution}
        <select className="select select-sm w-56" value={resolution} onChange={(e) => setResolution(RESOLUTIONS.find((r) => r === e.target.value) ?? 'RESOLVED')}>
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {m.cases.resolutionName[r]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        {m.cases.closeSummary}
        <textarea className="textarea textarea-sm w-full max-w-lg" maxLength={1000} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>
      <p className="text-xs opacity-70">{m.cases.piiHint}</p>
      {openFollowUps > 0 && (
        <p role="note" className="text-xs text-warning" data-testid="close-blocked">
          {m.followUps.closeBlocked(openFollowUps)}
        </p>
      )}
      <button type="submit" className="btn btn-sm" disabled={!summary.trim() || close.busy || openFollowUps > 0}>
        {m.cases.close}
      </button>
      <CommandFeedback command={close}>{() => <span className="text-xs text-success">{m.cases.closed}</span>}</CommandFeedback>
    </form>
  );
}

/** 사유 하나 받는 명령 폼(다시 열기·넘기기 공통) — 사유 1~500자 필수, 개인정보 금지 안내 */
function ReasonForm({
  title,
  submitLabel,
  doneText,
  testId,
  warn,
  send,
  failureHint,
}: {
  readonly title: string;
  readonly submitLabel: string;
  readonly doneText: string;
  readonly testId: string;
  readonly warn?: string;
  readonly send: (reason: string, key: Parameters<Parameters<typeof useCommand>[0]>[1]) => Promise<Case>;
  readonly failureHint?: (code: string | undefined) => ReactNode;
}) {
  const [reason, setReason] = useState('');
  const cmd = useCommand(async (v: { reason: string }, key) => send(v.reason, key));
  const ok = reason.trim().length >= 1 && reason.trim().length <= 500;
  const code = cmd.phase.kind === 'rejected' && cmd.phase.failure instanceof ProblemFailure ? cmd.phase.failure.problem.code : undefined;
  return (
    <form
      className="space-y-2 rounded-box bg-base-100 p-3 text-sm"
      aria-label={title}
      data-testid={testId}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        if (cmd.phase.kind === 'rejected') cmd.reset();
        void cmd.run({ reason: reason.trim() });
      }}
    >
      <h2 className="font-semibold">{title}</h2>
      {warn && <p className="text-xs opacity-70">{warn}</p>}
      <label className="flex flex-col gap-1">
        {m.cases.reason}
        <textarea className="textarea textarea-sm w-full max-w-lg" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <p className="text-xs opacity-70">{m.cases.piiHint}</p>
      <button type="submit" className="btn btn-sm" disabled={!ok || cmd.busy}>
        {submitLabel}
      </button>
      <CommandFeedback command={cmd}>{() => <span className="text-xs text-success">{doneText}</span>}</CommandFeedback>
      {cmd.phase.kind === 'rejected' && failureHint?.(code)}
    </form>
  );
}

/** 이 사건의 대상(배송·주문) 번호 — 통합 조회로 같은 대상의 사건을 찾게 */
const subjectOf = (c: Case) => (c.refs ?? []).find((r) => r.refType === 'deliveryId' || r.refType === 'orderId')?.refId ?? c.subjectRef ?? '';

function ReopenForm({ c, onDone }: { readonly c: Case; readonly onDone: (c: Case) => void }) {
  const api = useApi();
  const target = subjectOf(c);
  return (
    <ReasonForm
      title={m.cases.reopen}
      submitLabel={m.cases.reopen}
      doneText={m.cases.reopened}
      testId="case-reopen"
      warn={m.cases.reopenNote}
      send={async (reason, key) => {
        const r = await request('POST', api.cases.POST('/cases/{caseId}/reopenings', { ...commandParams(key, { path: { caseId: c.caseId ?? '' }, version: c.version }), body: { reason } }));
        onDone(r);
        return r;
      }}
      failureHint={(code) =>
        code === 'CASE_ALREADY_OPEN' && target ? (
          <Link className="link text-xs" to={`/lookup?q=${encodeURIComponent(target)}`} data-testid="case-open-elsewhere">
            {m.cases.findOpenCase(target)}
          </Link>
        ) : null
      }
    />
  );
}

function TransferForm({ c, toGroup, onDone }: { readonly c: Case; readonly toGroup: 'DELIVERY_OPS' | 'ORDER_OPS'; readonly onDone: (c: Case) => void }) {
  const api = useApi();
  const toAdmin = toGroup === 'ORDER_OPS';
  return (
    <ReasonForm
      title={toAdmin ? m.cases.transferToAdmin : m.cases.transferToSupport}
      submitLabel={toAdmin ? m.cases.transferToAdmin : m.cases.transferToSupport}
      doneText={m.cases.transferred}
      testId="case-transfer"
      warn={toAdmin ? m.cases.transferToAdminNote : m.cases.transferToSupportNote}
      send={async (reason, key) => {
        const r = await request('POST', api.cases.POST('/cases/{caseId}/transfers', { ...commandParams(key, { path: { caseId: c.caseId ?? '' }, version: c.version }), body: { toGroup, reason } }));
        onDone(r);
        return r;
      }}
    />
  );
}

/**
 * 라이더 도움요청·전달 실패 사건: refs 의 requestId·deliveryId(case 0.4.1 부터), 없으면(그 전 사건) incidentId(= `<deliveryId>:<requestId>`)를 나눠 execution `GET /deliveries/{id}/help-requests/{requestId}`
 * (라이더가 쓴 내용·사진 참조). 사건 처리는 사건 집기·닫기로(백엔드 알림 2026-11-16 rider-delivery-staff-apis §3).
 */
function HelpRequestOfCase({ c }: { readonly c: Case }) {
  const api = useApi();
  const ref = (t: string) => (c.refs ?? []).find((r) => r.refType === t)?.refId ?? '';
  const incident = ref('incidentId');
  const sep = incident.lastIndexOf(':');
  // 따로 실린 requestId(case 0.4.1)를 먼저 — 그 전 사건은 incidentId 에서 `<deliveryId>:` 를 뗀다(백엔드 회신 reply-rider-delivery-staff-apis §1)
  const deliveryId = ref('deliveryId') || (sep > 0 ? incident.slice(0, sep) : '');
  const requestId = ref('requestId') || (sep > 0 ? incident.slice(sep + 1) : '');
  const query = useQuery({
    queryKey: ['help-request', deliveryId, requestId],
    enabled: deliveryId !== '' && requestId !== '',
    queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}/help-requests/{requestId}', { params: { path: { deliveryId, requestId } } })),
  });
  if (!deliveryId || !requestId) return null;
  return (
    <>
      <h2 className="font-bold">{m.cases.helpRequest}</h2>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(h) => (
          <dl className="grid grid-cols-[8rem_1fr] gap-1 rounded-box bg-base-100 p-4 text-sm" data-testid="case-help-request">
            <dt>{m.helpQueue.category}</dt>
            <dd>{label(m.helpQueue.categoryName, h.category)}</dd>
            <dt>{m.helpQueue.stage}</dt>
            <dd>{label(m.deliveries.executionState, h.stage)}</dd>
            <dt>{m.cases.helpDetail}</dt>
            <dd className="whitespace-pre-wrap">{text(h.detail)}</dd>
            <dt>{m.helpQueue.photos}</dt>
            <dd>{(h.evidenceRefs ?? []).join(', ') || m.none}</dd>
            <dt>{m.cases.state}</dt>
            <dd>{label(m.helpQueue.state, h.state)}</dd>
            <dt>{m.helpQueue.createdAt}</dt>
            <dd>{when(h.createdAt)}</dd>
          </dl>
        )}
      </QueryState>
    </>
  );
}

export function CaseDetailPage() {
  const { caseId = '' } = useParams();
  const api = useApi();
  const queryClient = useQueryClient();
  const { me, admin, team } = useCaseRoles();
  const key = ['cases', 'detail', caseId];
  const query = useQuery({ queryKey: key, queryFn: () => request('GET', api.cases.GET('/cases/{caseId}', { params: { path: { caseId } } })) });
  const onDone = (c: Case) => {
    queryClient.setQueryData(key, c);
    void queryClient.invalidateQueries({ queryKey: ['cases'], exact: false, predicate: (q) => q.queryKey[1] !== 'detail' });
  };
  return (
    <section className="max-w-4xl space-y-4">
      <h1 className="text-xl font-bold">{m.cases.detailTitle(caseId)}</h1>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(c) => {
          const closed = c.state === 'CLOSED';
          const adminTeam = withAdminTeam(c);
          // 지원센터는 자기 팀(배송 쪽, 관리자 팀으로 가지 않은) 사건만 — 관리자 팀 사건·사가 사건은 관리자만(서버 판정)
          const teamCan = team && !adminTeam && !isOrderKind(c.kind);
          const canClose = !closed && (admin || (teamCan && (!c.assigneeId || c.assigneeId === me)));
          const canReopen = closed && (admin || teamCan);
          const deliverySide = !isOrderKind(c.kind);
          const canToAdmin = !closed && deliverySide && !adminTeam && (admin || (teamCan && (!c.assigneeId || c.assigneeId === me)));
          const canToSupport = !closed && deliverySide && adminTeam && admin;
          return (
            <>
              <dl className="grid grid-cols-[8rem_1fr] gap-1 rounded-box bg-base-100 p-4 text-sm" data-testid="case-facts">
                <dt>{m.cases.kind}</dt>
                <dd>{label(m.cases.kindName, c.kind)}</dd>
                <dt>{m.cases.priority}</dt>
                <dd>{text(c.priority)}</dd>
                <dt>{m.cases.state}</dt>
                <dd data-testid="case-state">{label(m.cases.stateName, c.state)}</dd>
                <dt>{m.cases.summary}</dt>
                <dd>{text(c.summary)}</dd>
                <dt>{m.cases.refs}</dt>
                <dd>
                  <Refs c={c} />
                </dd>
                <dt>{m.cases.sla}</dt>
                <dd>
                  <Sla c={c} />
                </dd>
                <dt>{m.cases.assigneeGroup}</dt>
                <dd data-testid="case-group">
                  {label(m.cases.groupName, c.assigneeGroup)}
                  {adminTeam && (
                    <span className="badge badge-warning badge-sm ml-1" data-testid="case-admin-team">
                      {m.cases.adminHandling}
                    </span>
                  )}
                </dd>
                <dt>{m.cases.assignee}</dt>
                <dd data-testid="case-assignee">{c.assigneeId ?? m.cases.unassigned}</dd>
                <dt>{m.cases.openedAt}</dt>
                <dd>{when(c.openedAt)}</dd>
              </dl>

              {(c.kind === 'RIDER_HELP' || c.kind === 'DELIVERY_INCIDENT') && <HelpRequestOfCase c={c} />}

              {isOrderKind(c.kind) && (
                <div className="space-y-1 rounded-box bg-base-100 p-3 text-sm" data-testid="case-order-note">
                  <p className="opacity-70">{m.cases.orderNote}</p>
                  <Link className="link" to="/pending">
                    {m.cases.orderAction}
                  </Link>
                </div>
              )}

              {!admin && !team && <p className="text-sm opacity-70">{m.cases.viewOnly}</p>}
              {adminTeam && !admin && (
                <p role="note" className="alert alert-warning text-sm">
                  {m.cases.adminHandlingNote}
                </p>
              )}
              {!closed && <AssignForm c={c} onDone={onDone} />}
              <FollowUps c={c} canAdd={!closed && (admin || teamCan)} />
              {canClose && <CloseForm c={c} onDone={onDone} openFollowUps={(c.obligations ?? []).filter(isOpenObligation).length} />}
              {canToAdmin && <TransferForm c={c} toGroup="ORDER_OPS" onDone={onDone} />}
              {canToSupport && <TransferForm c={c} toGroup="DELIVERY_OPS" onDone={onDone} />}
              {canReopen && <ReopenForm c={c} onDone={onDone} />}

              {c.closure && (
                <>
                  <h2 className="font-bold">{closed ? m.cases.closure : m.cases.lastClosure}</h2>
                  <p className="rounded-box bg-base-100 p-3 text-sm" data-testid="case-closure">
                    {`${label(m.cases.resolutionName, c.closure.resolution)} · ${text(c.closure.summary)} · ${text(c.closure.closedBy)} · ${when(c.closure.closedAt)}`}
                  </p>
                </>
              )}

              <h2 className="font-bold">{m.cases.history}</h2>
              <ul className="space-y-1 text-sm">
                {(c.history ?? []).map((h, i) => (
                  <li key={`${h.at ?? ''}-${i}`} className="rounded-box bg-base-100 p-2">
                    {`${when(h.at)} · ${h.action ? label(m.cases.actionName, h.action) : text(h.action)} · ${text(h.actorId)}${h.toState ? ` → ${label(m.cases.stateName, h.toState)}` : ''}${h.note ? ` · ${h.note}` : ''}`}
                  </li>
                ))}
              </ul>
            </>
          );
        }}
      </QueryState>
      <Link className="link text-sm" to="/cases">
        {m.cases.back}
      </Link>
    </section>
  );
}

export function NewMisdeliveryPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [deliveryId, setDeliveryId] = useState(params.get('deliveryId') ?? '');
  const [summary, setSummary] = useState('');
  const [evidence, setEvidence] = useState('');
  const open = useCommand(async (v: { deliveryId: string; summary: string; evidence: string }, key) => {
    const c = await request(
      'POST',
      api.cases.POST('/cases', {
        ...commandParams(key),
        body: {
          kind: 'MISDELIVERY',
          subjectType: 'DELIVERY',
          subjectRef: v.deliveryId,
          summary: v.summary,
          ...(v.evidence ? { evidence: [{ system: 'backoffice-web', ref: v.evidence, kind: 'PHOTO' as const }] } : {}),
        },
      }),
    );
    void navigate(`/cases/${encodeURIComponent(c.caseId ?? '')}`);
    return c;
  });
  const ok = deliveryId.trim() !== '' && summary.trim() !== '';
  return (
    <section className="max-w-2xl space-y-4">
      <h1 className="text-xl font-bold">{m.cases.newTitle}</h1>
      <p className="text-sm opacity-70">{m.cases.newIntro}</p>
      <form
        className="space-y-3 rounded-box bg-base-100 p-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          if (open.phase.kind === 'rejected') open.reset();
          void open.run({ deliveryId: deliveryId.trim(), summary: summary.trim(), evidence: evidence.trim() });
        }}
      >
        <label className="flex flex-col gap-1">
          {m.cases.deliveryId}
          <input className="input input-sm w-64" value={deliveryId} onChange={(e) => setDeliveryId(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {m.cases.summary}
          <textarea className="textarea textarea-sm w-full" maxLength={1000} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {m.cases.evidence}
          <input className="input input-sm w-64" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
        </label>
        <p className="text-xs opacity-70">{m.cases.piiHint}</p>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!ok || open.busy}>
          {m.cases.open}
        </button>
        <CommandFeedback command={open} />
      </form>
    </section>
  );
}
