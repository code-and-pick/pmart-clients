// 배송 확인(고객센터) · 배송·배차 확인(라이더 운영).
// 찾기 = execution 0.4.0 `GET /deliveries`(주문·라이더·상태 — BOD-5, BR-56 끝). 배송 수행 = delivery-execution `GET /deliveries/{id}`, 배차 = delivery-dispatch 0.3.1 `GET /deliveries/{id}/dispatch` — 원천이 달라 따로 읽고 따로 보인다.
// 전달 실패 확정·반려 `POST /deliveries/{id}/failure-decisions`(FAILURE_REPORTED 일 때만, X-Expected-Version = 수행 version).
// 픽업 전 배차 취소 `POST /deliveries/{id}/assignment-cancellations`(202 접수 → 짝 조회 `GET …/{requestId}` 로 결과 확인, X-Expected-Version = 배차 version).
// 권한은 서버 판정(PC 5 PR #17 — BOD-1·2 반영): 배차 조회는 CS_AGENT·RIDER_OPS 도, 결정은 RIDER_OPS 도, 취소는 RIDER_OPS·관리자(CS_AGENT 는 취소하지 않음 — ADR-0060).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { CommandRejectedFailure, pollUntil, request, UnknownResultFailure, type CommandResponse } from '@pmart/web-core';
import { QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components as Dispatch } from '../../api/generated/delivery-dispatch';
import type { components as Execution } from '../../api/generated/delivery-execution';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback } from '../../shared/Feedback';
import { messages as m } from '../../shared/messages';
import { Facts, label, text, when } from '../../shared/ops';

type DeliveryExecution = Execution['schemas']['DeliveryExecution'];
type DispatchView = Dispatch['schemas']['Delivery'];
type CancelReason = 'RIDER_UNABLE' | 'STORE_REQUEST' | 'NO_SHOW' | 'OPERATOR';

const CANCEL_REASONS = Object.keys(m.deliveries.cancelReasonName) as CancelReason[];
const MAX_DECISION_NOTE = 500;
const MAX_REASON_DETAIL = 300;

/** CommandResponse 를 확정·불명으로 나눈다. APPLIED·ACCEPTED 는 돌려주고(화면이 다르게 그린다), REJECTED 는 거절, UNKNOWN_RESULT 는 불명. */
function settled(res: CommandResponse): CommandResponse {
  if (res.status === 'REJECTED') throw new CommandRejectedFailure(res.nextAction, res.requestId);
  if (res.status === 'UNKNOWN_RESULT') throw new UnknownResultFailure(undefined, res.requestId);
  return res;
}

/** 한 번 보인 폼은 상태가 바뀌어도(결정 반영 뒤) 남겨 결과 문구를 보인다. */
function StickyWhen({ show, children }: { readonly show: boolean; readonly children: ReactNode }) {
  const [shown, setShown] = useState(show);
  if (show && !shown) setShown(true);
  return show || shown ? <>{children}</> : null;
}

type StaffDeliverySummary = Execution['schemas']['StaffDeliverySummary'];
type ExecutionState = Execution['schemas']['ExecutionState'];
const EXECUTION_STATES = Object.keys(m.deliveries.executionState) as ExecutionState[];

/** 직원 배송 목록 한 표(ID·상태·시각만 — 개인정보 없음) */
export function DeliveryTable({ rows }: { readonly rows: readonly StaffDeliverySummary[] }) {
  return (
    <table className="table table-sm rounded-box bg-base-100">
      <thead>
        <tr>
          <th>{m.deliveries.deliveryId}</th>
          <th>{m.deliveries.state}</th>
          <th>{m.deliveries.type}</th>
          <th>{m.deliveries.order}</th>
          <th>{m.deliveries.rider}</th>
          <th>{m.deliveries.mfc}</th>
          <th>{m.deliveries.createdAt}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d, i) => (
          <tr key={d.deliveryId ?? `dlv-${i}`} data-testid="delivery-row">
            <td>
              <Link className="link" to={`/deliveries/${encodeURIComponent(d.deliveryId ?? '')}`}>
                {text(d.deliveryId)}
              </Link>
            </td>
            <td>{label(m.deliveries.executionState, d.state)}</td>
            <td>{label(m.deliveries.typeName, d.type)}</td>
            <td>{d.orderId ? <Link className="link" to={`/orders/${encodeURIComponent(d.orderId)}`}>{d.orderId}</Link> : m.none}</td>
            <td>{d.riderId ? <Link className="link" to={`/riders/${encodeURIComponent(d.riderId)}`}>{d.riderId}</Link> : m.none}</td>
            <td>{text(d.mfcId)}</td>
            <td>{when(d.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 이 주문·이 라이더의 배송(execution 0.4.0 `GET /deliveries?orderId=|riderId=`) — 주문 상세·라이더 상세가 쓴다 */
export function DeliveriesOf({ riderId, orderId }: { readonly riderId?: string; readonly orderId?: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['deliveries', 'of', riderId ?? '', orderId ?? ''],
    queryFn: () => request('GET', api.execution.GET('/deliveries', { params: { query: { size: 50, ...(riderId ? { riderId } : {}), ...(orderId ? { orderId } : {}) } } })),
  });
  return (
    <QueryState state={toUiState(query, (r) => (r.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={m.deliveries.empty}>
      {(r) => <DeliveryTable rows={r.items ?? []} />}
    </QueryState>
  );
}

/**
 * 배송 확인 입구: 배송 번호로 바로 열기 + 직원 배송 찾기(execution 0.4.0 `GET /deliveries` — 주문 ID·라이더 ID·상태, 정렬, cursor "더 보기").
 * "전달 실패 확정 대기" = state=FAILURE_REPORTED&sort=OLDEST. 조건은 URL 쿼리.
 */
export function DeliveryOpenPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [id, setId] = useState('');
  const applied: { orderId: string; riderId: string; state: ExecutionState | ''; oldest: boolean } = {
    orderId: params.get('orderId') ?? '',
    riderId: params.get('riderId') ?? '',
    state: EXECUTION_STATES.find((s) => s === params.get('state')) ?? '',
    oldest: params.get('sort') === 'OLDEST',
  };
  const searched = applied.orderId !== '' || applied.riderId !== '' || applied.state !== '' || params.has('q');
  const [draft, setDraft] = useState(applied);
  const [extra, setExtra] = useState<{ key: string; rows: StaffDeliverySummary[]; cursor: string | null }>({ key: '', rows: [], cursor: null });
  const key = JSON.stringify(applied);
  const query = useQuery({
    queryKey: ['deliveries', 'search', applied],
    enabled: searched,
    queryFn: () =>
      request(
        'GET',
        api.execution.GET('/deliveries', {
          params: {
            query: {
              size: 50,
              sort: applied.oldest ? 'OLDEST' : 'NEWEST',
              ...(applied.orderId ? { orderId: applied.orderId } : {}),
              ...(applied.riderId ? { riderId: applied.riderId } : {}),
              ...(applied.state ? { state: applied.state } : {}),
            },
          },
        }),
      ),
  });
  const more = extra.key === key ? extra : { key, rows: [], cursor: null };
  const nextCursor = more.cursor ?? query.data?.page?.nextCursor ?? null;
  const loadMore = async () => {
    if (!nextCursor) return;
    const r = await request(
      'GET',
      api.execution.GET('/deliveries', {
        params: {
          query: {
            size: 50,
            cursor: nextCursor,
            sort: applied.oldest ? 'OLDEST' : 'NEWEST',
            ...(applied.orderId ? { orderId: applied.orderId } : {}),
            ...(applied.riderId ? { riderId: applied.riderId } : {}),
            ...(applied.state ? { state: applied.state } : {}),
          },
        },
      }),
    );
    setExtra({ key, rows: [...more.rows, ...(r.items ?? [])], cursor: r.page?.nextCursor ?? null });
  };
  const go = (f: typeof applied) =>
    setParams({
      q: '1',
      ...(f.orderId.trim() ? { orderId: f.orderId.trim() } : {}),
      ...(f.riderId.trim() ? { riderId: f.riderId.trim() } : {}),
      ...(f.state ? { state: f.state } : {}),
      ...(f.oldest ? { sort: 'OLDEST' } : {}),
    });
  const open = (e: FormEvent) => {
    e.preventDefault();
    if (id.trim()) void navigate(`/deliveries/${encodeURIComponent(id.trim())}`);
  };
  return (
    <section className="max-w-5xl space-y-4">
      <h1 className="text-xl font-bold">{m.deliveries.title}</h1>
      <p className="text-sm opacity-70">{m.deliveries.intro}</p>
      <form className="flex max-w-xl items-end gap-2 rounded-box bg-base-100 p-4" onSubmit={open} aria-label={m.deliveries.open}>
        <label className="flex-1 text-sm">
          {m.deliveries.deliveryId}
          <input className="input input-sm mt-1 w-full" value={id} onChange={(e) => setId(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!id.trim()}>
          {m.deliveries.open}
        </button>
      </form>
      <form
        className="flex flex-wrap items-end gap-2 rounded-box bg-base-100 p-4"
        aria-label={m.deliveries.search}
        onSubmit={(e) => {
          e.preventDefault();
          go(draft);
        }}
      >
        <label className="text-sm">
          {m.deliveries.orderIdFilter}
          <input className="input input-sm mt-1 block" value={draft.orderId} onChange={(e) => setDraft((d) => ({ ...d, orderId: e.target.value }))} />
        </label>
        <label className="text-sm">
          {m.deliveries.riderIdFilter}
          <input className="input input-sm mt-1 block" value={draft.riderId} onChange={(e) => setDraft((d) => ({ ...d, riderId: e.target.value }))} />
        </label>
        <label className="text-sm">
          {m.deliveries.stateFilter}
          <select className="select select-sm mt-1 block" value={draft.state} onChange={(e) => setDraft((d) => ({ ...d, state: EXECUTION_STATES.find((s) => s === e.target.value) ?? '' }))}>
            <option value="">{m.deliveries.any}</option>
            {EXECUTION_STATES.map((s) => (
              <option key={s} value={s}>
                {label(m.deliveries.executionState, s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" className="checkbox checkbox-xs" checked={draft.oldest} onChange={(e) => setDraft((d) => ({ ...d, oldest: e.target.checked }))} />
          {m.deliveries.sortOldest}
        </label>
        <button type="submit" className="btn btn-sm">
          {m.deliveries.search}
        </button>
        <button type="button" className="btn btn-sm btn-outline" onClick={() => go({ orderId: '', riderId: '', state: 'FAILURE_REPORTED', oldest: true })}>
          {m.deliveries.failureQueue}
        </button>
      </form>
      {searched && (
        <QueryState state={toUiState(query, (r) => (r.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={m.deliveries.empty}>
          {(r) => (
            <>
              <DeliveryTable rows={[...(r.items ?? []), ...more.rows]} />
              {nextCursor && (
                <button type="button" className="btn btn-sm" onClick={() => void loadMore()}>
                  {m.deliveries.more}
                </button>
              )}
            </>
          )}
        </QueryState>
      )}
    </section>
  );
}

function FailureDecisionForm({ delivery }: { readonly delivery: DeliveryExecution }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const deliveryId = delivery.deliveryId ?? '';
  const [decision, setDecision] = useState<'CONFIRM' | 'REJECT' | ''>('');
  const [custody, setCustody] = useState<'' | 'RIDER' | 'STORE'>('');
  const [note, setNote] = useState('');

  const decide = useCommand(async (body: { decision: 'CONFIRM' | 'REJECT'; custody?: 'RIDER' | 'STORE'; note?: string }, key) => {
    try {
      return settled(
        await request(
          'POST',
          api.execution.POST('/deliveries/{deliveryId}/failure-decisions', {
            ...commandParams(key, { path: { deliveryId }, version: delivery.version }),
            body,
          }),
        ),
      );
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['deliveries', deliveryId] });
    }
  });
  const locked = decide.busy || decide.phase.kind === 'done';

  return (
    <form
      className="space-y-2 rounded-box bg-base-100 p-4"
      aria-label={m.deliveries.decideTitle}
      onSubmit={(e) => {
        e.preventDefault();
        if (!decision || locked) return;
        void decide.run({
          decision,
          ...(decision === 'CONFIRM' && custody ? { custody } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        });
      }}
    >
      <h2 className="font-bold">{m.deliveries.decideTitle}</h2>
      <p className="text-xs opacity-60">{m.deliveries.decideIntro}</p>
      <fieldset className="flex gap-4 text-sm" disabled={locked}>
        <legend className="sr-only">{m.deliveries.decision}</legend>
        {(['CONFIRM', 'REJECT'] as const).map((d) => (
          <label key={d} className="flex items-center gap-1">
            <input type="radio" className="radio radio-sm" name="failure-decision" checked={decision === d} onChange={() => setDecision(d)} />
            {m.deliveries.decisionName[d]}
          </label>
        ))}
      </fieldset>
      {decision === 'CONFIRM' && (
        <label className="block text-sm">
          {m.deliveries.custody}
          <select className="select select-sm mt-1 block" value={custody} disabled={locked} onChange={(e) => setCustody(e.target.value as '' | 'RIDER' | 'STORE')}>
            {(['', 'RIDER', 'STORE'] as const).map((c) => (
              <option key={c} value={c}>
                {m.deliveries.custodyName[c]}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-sm">
        {m.deliveries.note}
        <textarea className="textarea mt-1 w-full" rows={2} maxLength={MAX_DECISION_NOTE} value={note} disabled={locked} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-primary btn-sm" disabled={!decision || locked}>
        {m.deliveries.decide}
      </button>
      <CommandFeedback command={decide} unknown={{ body: m.deliveries.decideUnknown }}>
        {(r) => (
          <p role="status" className={r.status === 'APPLIED' ? 'text-sm text-success' : 'text-sm text-info'} data-testid="decision-result">
            {r.status === 'APPLIED' ? m.deliveries.decidedApplied : m.deliveries.decidedAccepted}
          </p>
        )}
      </CommandFeedback>
    </form>
  );
}

function CancellationForm({ dispatch }: { readonly dispatch: DispatchView }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const deliveryId = dispatch.deliveryId ?? '';
  const [reason, setReason] = useState<CancelReason | ''>('');
  const [detail, setDetail] = useState('');
  const [reassign, setReassign] = useState(true);
  const [approvalRef, setApprovalRef] = useState('');

  const cancel = useCommand(
    async (
      body: { requestedBy: 'OPERATOR'; reason: CancelReason; reasonDetail?: string; reassign: boolean; approvalRef?: string },
      key,
    ) => {
      try {
        const res = settled(
          await request(
            'POST',
            api.dispatch.POST('/deliveries/{deliveryId}/assignment-cancellations', {
              ...commandParams(key, { path: { deliveryId }, version: dispatch.version }),
              body,
            }),
          ),
        );
        if (res.status === 'APPLIED') return 'CANCELLED_BEFORE_PICKUP' as const;
        // 202 접수 — 짝 조회로 결과를 확인한다(requestId = Idempotency-Key).
        const requestId = res.requestId || key.value;
        const outcome = await pollUntil(
          () =>
            request(
              'GET',
              api.dispatch.GET('/deliveries/{deliveryId}/assignment-cancellations/{requestId}', { params: { path: { deliveryId, requestId } } }),
            ),
          (r) => r.state === 'CANCELLED_BEFORE_PICKUP' || r.state === 'REJECTED_PICKED_UP',
        );
        if (outcome.kind === 'timeout') throw new UnknownResultFailure(outcome.lastFailure, requestId);
        return outcome.value.state ?? 'UNKNOWN';
      } finally {
        void queryClient.invalidateQueries({ queryKey: ['deliveries', deliveryId] });
      }
    },
  );
  const locked = cancel.busy || cancel.phase.kind === 'done';
  const needsApproval = reason === 'OPERATOR';
  const ready = reason !== '' && (!needsApproval || approvalRef.trim() !== '');

  return (
    <form
      className="space-y-2 rounded-box bg-base-100 p-4"
      aria-label={m.deliveries.cancelTitle}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || locked) return;
        void cancel.run({
          requestedBy: 'OPERATOR',
          reason,
          reassign,
          ...(detail.trim() ? { reasonDetail: detail.trim() } : {}),
          ...(needsApproval ? { approvalRef: approvalRef.trim() } : {}),
        });
      }}
    >
      <h2 className="font-bold">{m.deliveries.cancelTitle}</h2>
      <p className="text-xs opacity-60">{m.deliveries.cancelIntro}</p>
      <label className="block text-sm">
        {m.deliveries.cancelReason}
        <select className="select select-sm mt-1 block" value={reason} disabled={locked} onChange={(e) => setReason(e.target.value as CancelReason | '')}>
          <option value="">-</option>
          {CANCEL_REASONS.map((r) => (
            <option key={r} value={r}>
              {m.deliveries.cancelReasonName[r]}
            </option>
          ))}
        </select>
      </label>
      {needsApproval && (
        <label className="block text-sm">
          {m.deliveries.approvalRef}
          <input className="input input-sm mt-1 block" value={approvalRef} disabled={locked} onChange={(e) => setApprovalRef(e.target.value)} />
          {!approvalRef.trim() && <span className="text-xs text-warning">{m.deliveries.approvalRefRequired}</span>}
        </label>
      )}
      <label className="block text-sm">
        {m.deliveries.reasonDetail}
        <input className="input input-sm mt-1 w-full" maxLength={MAX_REASON_DETAIL} value={detail} disabled={locked} onChange={(e) => setDetail(e.target.value)} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="checkbox checkbox-sm" checked={reassign} disabled={locked} onChange={(e) => setReassign(e.target.checked)} />
        {m.deliveries.reassign}
      </label>
      <button type="submit" className="btn btn-warning btn-sm" disabled={!ready || locked}>
        {m.deliveries.cancel}
      </button>
      <CommandFeedback command={cancel} unknown={{ body: m.deliveries.cancelUnknown }}>
        {(state) => (
          <p role="status" className={state === 'CANCELLED_BEFORE_PICKUP' ? 'text-sm text-success' : 'text-sm text-warning'} data-testid="cancel-result">
            {label(m.deliveries.cancelState, state)}
          </p>
        )}
      </CommandFeedback>
    </form>
  );
}

function ExecutionPanel({ deliveryId }: { readonly deliveryId: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['deliveries', deliveryId, 'execution'],
    queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}', { params: { path: { deliveryId } } })),
  });
  return (
    <div className="space-y-2" data-testid="execution-panel">
      <h2 className="font-bold">{m.deliveries.execution}</h2>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(d) => (
          <>
            <Facts
              rows={[
                [m.deliveries.state, <span key="s" data-testid="execution-state">{label(m.deliveries.executionState, d.state)}</span>],
                [m.deliveries.type, label(m.deliveries.typeName, d.type)],
                [m.deliveries.rider, d.riderId ? <Link key="r" className="link" to={`/riders/${encodeURIComponent(d.riderId)}`}>{d.riderId}</Link> : m.none],
                [m.deliveries.order, d.orderId ? <Link key="o" className="link" to={`/orders/${encodeURIComponent(d.orderId)}`}>{d.orderId}</Link> : m.none],
                [m.deliveries.mfc, text(d.mfcId)],
                [m.deliveries.assignedAt, when(d.assignedAt)],
                [m.deliveries.completedAt, when(d.completedAt)],
              ]}
            />
            {d.failure && (
              <>
                <h3 className="text-sm font-bold">{m.deliveries.failure}</h3>
                <Facts
                  testId="delivery-failure"
                  rows={[
                    [m.deliveries.failureReason, text(d.failure.reason)],
                    [m.deliveries.failureDetail, <p key="d" className="whitespace-pre-wrap">{text(d.failure.detail)}</p>],
                    [m.deliveries.goodsLocation, text(d.failure.goodsLocation)],
                    [m.deliveries.contactAttempts, text(d.failure.contactAttempts)],
                    [m.deliveries.reportedAt, when(d.failure.reportedAt)],
                    [m.deliveries.decided, d.failure.decision ? `${label(m.deliveries.decisionName, d.failure.decision)} · ${when(d.failure.decidedAt)}` : m.none],
                  ]}
                />
              </>
            )}
            <StickyWhen show={d.state === 'FAILURE_REPORTED'}>
              <FailureDecisionForm delivery={d} />
            </StickyWhen>
            <h3 className="text-sm font-bold">{m.deliveries.incidents}</h3>
            {(d.incidents ?? []).length === 0 ? (
              <p className="text-sm opacity-70">{m.deliveries.noIncidents}</p>
            ) : (
              <ul className="text-sm">
                {(d.incidents ?? []).map((i, n) => (
                  <li key={i.incidentId ?? `incident-${n}`}>{`${text(i.category)} · ${when(i.raisedAt)}`}</li>
                ))}
              </ul>
            )}
            <h3 className="text-sm font-bold">{m.deliveries.history}</h3>
            <ol className="text-sm">
              {(d.history ?? []).map((h, n) => (
                <li key={`${h.state ?? ''}-${n}`}>{`${when(h.occurredAt)} · ${label(m.deliveries.executionState, h.state)} · ${text(h.actor)}`}</li>
              ))}
            </ol>
          </>
        )}
      </QueryState>
    </div>
  );
}

function DispatchPanel({ deliveryId }: { readonly deliveryId: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['deliveries', deliveryId, 'dispatch'],
    queryFn: () => request('GET', api.dispatch.GET('/deliveries/{deliveryId}/dispatch', { params: { path: { deliveryId } } })),
  });
  return (
    <div className="space-y-2" data-testid="dispatch-panel">
      <h2 className="font-bold">{m.deliveries.dispatch}</h2>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(d) => (
          <>
            <Facts
              rows={[
                [m.deliveries.state, <span key="s" data-testid="dispatch-state">{label(m.deliveries.dispatchState, d.state)}</span>],
                [m.deliveries.rider, d.assignment?.riderId ? <Link key="r" className="link" to={`/riders/${encodeURIComponent(d.assignment.riderId)}`}>{d.assignment.riderId}</Link> : m.deliveries.noAssignment],
                [m.deliveries.assignedAt, when(d.assignment?.assignedAt)],
                [m.deliveries.pickedUpAt, when(d.assignment?.pickedUpAt)],
                [m.deliveries.mfc, text(d.mfcId)],
              ]}
            />
            <StickyWhen show={d.state === 'ASSIGNED'}>
              <CancellationForm dispatch={d} />
            </StickyWhen>
            <h3 className="text-sm font-bold">{m.deliveries.attempts}</h3>
            {(d.attempts ?? []).length === 0 ? (
              <p className="text-sm opacity-70">{m.deliveries.noAttempts}</p>
            ) : (
              <ul className="text-sm">
                {(d.attempts ?? []).map((a, n) => (
                  <li key={a.attemptId ?? `attempt-${n}`}>
                    {`${when(a.startedAt)} · ${text(a.state)}${a.failureReason ? ` · ${label(m.deliveries.failureReasonName, a.failureReason)}` : ''}`}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}

export function DeliveryDetailPage() {
  const { deliveryId = '' } = useParams();
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">{`${m.deliveries.deliveryId} ${deliveryId}`}</h1>
        <Link className="btn btn-sm ml-auto" to={`/rider-complaints/new?deliveryId=${encodeURIComponent(deliveryId)}`}>
          {m.deliveries.recordComplaint}
        </Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ExecutionPanel deliveryId={deliveryId} />
        <DispatchPanel deliveryId={deliveryId} />
      </div>
      <Link className="link text-sm" to="/deliveries">
        {m.deliveries.back}
      </Link>
    </section>
  );
}
