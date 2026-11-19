// 배송 확인(고객센터) · 배송·배차 확인(라이더 운영).
// 찾기 = execution 0.4.0 `GET /deliveries`(주문·라이더·상태 — BOD-5, BR-56 끝). 배송 수행 = delivery-execution `GET /deliveries/{id}`, 배차 = delivery-dispatch 0.3.1 `GET /deliveries/{id}/dispatch` — 원천이 달라 따로 읽고 따로 보인다.
// 전달 실패 확정·반려 `POST /deliveries/{id}/failure-decisions`(FAILURE_REPORTED 일 때만, X-Expected-Version = 수행 version).
// 픽업 전 배차 취소 `POST /deliveries/{id}/assignment-cancellations`(202 접수 → 짝 조회 `GET …/{requestId}` 로 결과 확인, X-Expected-Version = 배차 version).
// 2026-11-19 사용자 "라이더 백오피스만"(백엔드 delivery PR #255, execution 0.32.2): 라이더·배송 일의 처리 주인은 라이더 백오피스(지원센터) 하나 —
//   이 앱에서는 전달 실패 확정·반려와 배차 취소를 관리자(OPERATOR_ADMIN)에게만 보이고, 그 밖 직원은 보기만 + 이 배송의 접수 건(지원센터 처리 상태)으로 잇는다(RiderOpsHandoff).
//   이관(case transfers)은 상담원이 부를 수 없어(그 사건을 다루는 사람만) 상담원에게 넘기기 단추를 두지 않는다 — 관리자 팀으로 간 건을 돌려보내는 일은 관리자가 접수 건 상세에서.
// 권한은 서버 판정(PC 5 PR #17 — BOD-1·2 반영): 배차 조회는 CS_AGENT·RIDER_OPS 도, 결정은 RIDER_OPS 도, 취소는 RIDER_OPS·관리자(CS_AGENT 는 취소하지 않음 — ADR-0060).
import { QueueNav, RememberQueue } from '../../shared/workQueue';
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
import { DisplayNumber, RiderLabel, SystemNumbers } from '../../shared/displayNumber';
import { RiderCard } from '../riders/RiderCard';
import { PreviewDrawer, PreviewFacts, usePreview } from '../../shared/Preview';
import { StartGuide } from '../../shared/StartGuide';
import { useWorkCounts, workText } from '../../app/DashboardWidgets';
import { useSession } from '../../app/SessionContext';
import { DeliveryStartActions } from '../../shared/StartActions';
import { deliveryIdOfNumber, isDeliveryNumber, isOrderNumber, isRiderNumber, riderIdOfNumber, useRiderLabels } from '../../shared/numberLookups';
import { SavedViews } from '../../shared/SavedViews';
import { CopyButton } from '../../shared/CopyButton';
import { useRecordRecent } from '../../shared/recentViews';
import { messages as m } from '../../shared/messages';
import { label, text, when } from '../../shared/ops';
import { ChipGroup, CodeLabel, DataTable, DetailHeader, FieldList, NextAction, PageHeader, ResultBar, SearchPanel, SearchRow, Section, StatusBadge, type Tone, useRowLink } from '../../shared/admin';
import { Icon, KindChip, ListFoot, Timeline, When } from '../lookup/parts';

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

/** 수행 상태 꼬리표 색(표시만 — 판정은 서버 상태 값) */
export const executionTone = (s: string | null | undefined): Tone =>
  s === 'COMPLETED' || s === 'RETURNED_TO_STORE'
    ? 'success'
    : s === 'FAILED'
      ? 'error'
      : s === 'FAILURE_REPORTED' || s === 'SUSPENDED' || s === 'UNASSIGNED'
        ? 'warning'
        : s === 'CANCELLED'
          ? 'ghost'
          : 'info';
/** 배차 상태 꼬리표 색 */
const dispatchTone = (s: string | null | undefined): Tone =>
  s === 'PICKED_UP' || s === 'CLOSED' ? 'success' : s === 'DISPATCH_FAILED' || s === 'BLOCKED' ? 'error' : s === 'CANCELLED_BEFORE_PICKUP' ? 'ghost' : s === 'DISPATCHING' || s === 'CREATED' ? 'warning' : 'info';
const TYPE_TONE: Readonly<Record<string, Tone>> = { FORWARD: 'info', RETURN: 'warning', RESHIPMENT: 'accent' };

/** 직원 배송 목록 한 표(ID·상태·시각만 — 개인정보 없음) */
/** preview 를 주면 줄을 눌렀을 때 미리보기 칸(배송 확인 화면만 — 주문·라이더 상세 안의 표는 상세로) */
export function DeliveryTable({ rows, preview }: { readonly rows: readonly StaffDeliverySummary[]; readonly preview?: ReturnType<typeof usePreview> }) {
  const rowLink = useRowLink();
  // 화면 번호(ADR-0070, 2026-11-18): 배송·주문은 응답의 deliveryNumber·orderNumber, 라이더는 rider 일괄 조회(riderIds)
  const riders = useRiderLabels(rows.map((d) => d.riderId));
  return (
    <DataTable>
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
          <tr key={d.deliveryId ?? `dlv-${i}`} data-testid="delivery-row" {...(d.deliveryId ? (preview ? preview.row(d.deliveryId) : rowLink(`/deliveries/${encodeURIComponent(d.deliveryId)}`)) : {})}>
            {/* 첫 칸: 배송 번호 굵게(링크) — 상세로 가는 첫 링크 */}
            <td>
              <Link className="font-semibold text-base-content hover:text-primary hover:underline" to={`/deliveries/${encodeURIComponent(d.deliveryId ?? '')}`} data-testid="delivery-number">
                <DisplayNumber number={d.deliveryNumber} systemId={d.deliveryId} />
              </Link>
            </td>
            <td>
              <StatusBadge tone={executionTone(d.state)}>{d.state ? <CodeLabel code={d.state} names={m.deliveries.executionState} /> : m.none}</StatusBadge>
            </td>
            <td>
              <KindChip tone={TYPE_TONE[d.type ?? ''] ?? 'ghost'} icon={d.type === 'FORWARD' ? 'truck' : 'return'}>
                {label(m.deliveries.typeName, d.type)}
              </KindChip>
            </td>
            <td data-testid="delivery-order">
              {d.orderId ? (
                <Link className="text-sm hover:text-primary hover:underline" to={`/orders/${encodeURIComponent(d.orderId)}`}>
                  <DisplayNumber number={d.orderNumber} systemId={d.orderId} />
                </Link>
              ) : (
                m.none
              )}
            </td>
            <td data-testid="delivery-rider">
              {d.riderId ? (
                <Link className="text-sm hover:text-primary hover:underline" to={`/riders/${encodeURIComponent(d.riderId)}`}>
                  <RiderLabel rider={riders.get(d.riderId)} riderId={d.riderId} failed={riders.failed} />
                </Link>
              ) : (
                <span className="text-sm text-base-content/50">{m.deliveries.noAssignment}</span>
              )}
            </td>
            <td className="text-sm">{text(d.mfcId)}</td>
            <td>
              <When iso={d.createdAt} />
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
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
  // 미리보기 칸(2026-11-18)
  const pv = usePreview((id) => `/deliveries/${encodeURIComponent(id)}`);
  const admin = useSession().session?.roles.includes('OPERATOR_ADMIN') ?? false;
  const wc = useWorkCounts(admin);
  const stateCount = (st: string) => {
    const rows = wc.segments('DELIVERIES', 'ACTIVE').filter((c) => c.segment === st);
    if (rows.length === 0) return undefined;
    return workText({ value: rows.reduce((n, c) => n + c.value, 0), complete: rows.every((c) => c.complete) });
  };
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [id, setId] = useState('');
  // 화면 번호(ADR-0070, 2026-11-18): 주문번호(8자리)·라이더 번호(6자리)로도 찾는다. 다른 화면 링크의 시스템 ID(?orderId=·?riderId=)도 그대로 받는다.
  const applied: { orderId: string; riderId: string; orderNumber: string; riderNumber: string; state: ExecutionState | ''; oldest: boolean } = {
    orderId: params.get('orderId') ?? '',
    riderId: params.get('riderId') ?? '',
    orderNumber: params.get('orderNumber') ?? '',
    riderNumber: params.get('riderNumber') ?? '',
    state: EXECUTION_STATES.find((s) => s === params.get('state')) ?? '',
    oldest: params.get('sort') === 'OLDEST',
  };
  const searched = applied.orderId !== '' || applied.riderId !== '' || applied.orderNumber !== '' || applied.riderNumber !== '' || applied.state !== '' || params.has('q');
  const [draft, setDraft] = useState({ order: applied.orderNumber || applied.orderId, rider: applied.riderNumber || applied.riderId, state: applied.state, oldest: applied.oldest });
  /** 찾기 조건 — 라이더 번호는 rider 조회로 라이더 ID 로 바꾼다(없는 번호면 null = 결과 없음) */
  const baseQuery = async () => {
    const riderId = applied.riderId || (applied.riderNumber ? await riderIdOfNumber(api, applied.riderNumber) : '');
    if (riderId === null) return null;
    return {
      size: 50,
      sort: applied.oldest ? ('OLDEST' as const) : ('NEWEST' as const),
      ...(applied.orderId ? { orderId: applied.orderId } : {}),
      ...(applied.orderNumber ? { orderNumber: applied.orderNumber } : {}),
      ...(riderId ? { riderId } : {}),
      ...(applied.state ? { state: applied.state } : {}),
    };
  };
  const [extra, setExtra] = useState<{ key: string; rows: StaffDeliverySummary[]; cursor: string | null }>({ key: '', rows: [], cursor: null });
  const key = JSON.stringify(applied);
  const query = useQuery({
    queryKey: ['deliveries', 'search', applied],
    enabled: searched,
    queryFn: async () => {
      const q = await baseQuery();
      // 없는 라이더 번호 — 서버에 물을 것이 없다(그 번호의 배송 없음)
      if (!q) return { items: [], page: { nextCursor: null, size: 0 } };
      return request('GET', api.execution.GET('/deliveries', { params: { query: q } }));
    },
  });
  const more = extra.key === key ? extra : { key, rows: [], cursor: null };
  const nextCursor = more.cursor ?? query.data?.page?.nextCursor ?? null;
  const loadMore = async () => {
    if (!nextCursor) return;
    const q = await baseQuery();
    if (!q) return;
    const r = await request('GET', api.execution.GET('/deliveries', { params: { query: { ...q, cursor: nextCursor } } }));
    setExtra({ key, rows: [...more.rows, ...(r.items ?? [])], cursor: r.page?.nextCursor ?? null });
  };
  const go = (f: { order: string; rider: string; state: ExecutionState | ''; oldest: boolean }) => {
    const order = f.order.trim();
    const rider = f.rider.trim();
    setParams({
      q: '1',
      ...(order ? (isOrderNumber(order) ? { orderNumber: order.replace(/[\s-]/g, '') } : { orderId: order }) : {}),
      ...(rider ? (isRiderNumber(rider) ? { riderNumber: rider } : { riderId: rider }) : {}),
      ...(f.state ? { state: f.state } : {}),
      ...(f.oldest ? { sort: 'OLDEST' } : {}),
    });
  };
  // 바로 열기 — 배송 번호(74939255-1)도 받는다(2026-11-19). 못 찾으면 칸 아래에 알리고 옮기지 않는다
  const [openMiss, setOpenMiss] = useState<'notFound' | 'failed' | null>(null);
  const open = async (e: FormEvent) => {
    e.preventDefault();
    const v = id.trim();
    if (!v) return;
    setOpenMiss(null);
    let target: string | null = v;
    if (isDeliveryNumber(v)) {
      try {
        target = await deliveryIdOfNumber(api, v);
      } catch {
        setOpenMiss('failed');
        return;
      }
    }
    if (!target) {
      setOpenMiss('notFound');
      return;
    }
    void navigate(`/deliveries/${encodeURIComponent(target)}`);
  };
  return (
    <section className="space-y-5">
      {/* 화면(2026-11-18 Shopify 목록처럼): 머리 오른쪽 "바로 열기" → 한 카드(빠른 보기 → 검색 조건 → 결과 줄·표 → 더 보기) */}
      <PageHeader
        title={m.deliveries.title}
        actions={
          <form className="join" onSubmit={(e) => void open(e)} aria-label={m.deliveries.open}>
            <label className="input input-sm join-item w-60">
              <Icon name="search" className="h-4 w-4 text-base-content/40" />
              <input aria-label={m.deliveries.deliveryId} placeholder={`${m.deliveries.quickOpen} — ${m.refField.deliveryHint}`} className="font-mono" value={id} onChange={(e) => setId(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-primary btn-sm join-item" disabled={!id.trim()}>
              {m.deliveries.open}
            </button>
            {openMiss && (
              <span role="status" className="ml-2 self-center text-xs text-warning" data-testid="delivery-open-miss">
                {openMiss === 'notFound' ? m.refField.notFound(m.refField.kind.delivery, id.trim()) : m.refField.failed}
              </span>
            )}
          </form>
        }
      />
      {/* 내 보기(2026-11-18 Saleor 참고) — 지금 주소 조건을 이름 붙여 저장 */}
      <SavedViews listKey="deliveries" />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={m.deliveries.quickViews}>
        <span className="text-xs font-medium text-base-content/55">{m.deliveries.quickViews}</span>
        <button
          type="button"
          aria-pressed={applied.state === 'FAILURE_REPORTED' && applied.oldest && !applied.orderId && !applied.riderId && !applied.orderNumber && !applied.riderNumber}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${applied.state === 'FAILURE_REPORTED' && applied.oldest && !applied.orderId && !applied.riderId && !applied.orderNumber && !applied.riderNumber ? 'border-warning bg-warning/15 font-semibold text-warning' : 'border-base-300 bg-base-100 hover:border-warning/60'}`}
          onClick={() => go({ order: '', rider: '', state: 'FAILURE_REPORTED', oldest: true })}
        >
          <Icon name="alert" className="h-3.5 w-3.5" />
          {m.deliveries.failureQueue}
        </button>
      </div>
      <SearchPanel
        onSubmit={(e) => {
          e.preventDefault();
          go(draft);
        }}
        onReset={() => setDraft({ order: '', rider: '', state: '', oldest: false })}
        submitLabel={m.deliveries.search}
        resetLabel={m.deliveries.reset}
        label={m.deliveries.search}
        // 조건을 건 뒤에는 한 줄 칩으로 접힌다(2026-11-19) — 번호는 화면 번호 그대로, 다른 화면에서 온 시스템 ID 는 "한 주문/한 라이더"
        summary={[
          [m.searchChip.order, applied.orderNumber || (applied.orderId ? m.searchChip.oneOrder : '')],
          [m.searchChip.rider, applied.riderNumber || (applied.riderId ? m.searchChip.oneRider : '')],
          [m.searchChip.state, applied.state ? label(m.deliveries.executionState, applied.state) : ''],
          [m.searchChip.sort, applied.oldest ? m.searchChip.oldest : ''],
        ]}
      >
        <SearchRow label={m.deliveries.ids}>
          <input aria-label={m.deliveries.orderIdFilter} placeholder={m.deliveries.orderIdFilter} className="input input-sm w-52" value={draft.order} onChange={(e) => setDraft((d) => ({ ...d, order: e.target.value }))} />
          <input aria-label={m.deliveries.riderIdFilter} placeholder={m.deliveries.riderIdFilter} className="input input-sm w-52" value={draft.rider} onChange={(e) => setDraft((d) => ({ ...d, rider: e.target.value }))} />
        </SearchRow>
        <SearchRow label={m.deliveries.sort}>
          <label className="flex h-8 items-center gap-1 text-sm">
            <input type="checkbox" className="checkbox checkbox-xs" checked={draft.oldest} onChange={(e) => setDraft((d) => ({ ...d, oldest: e.target.checked }))} />
            {m.deliveries.sortOldest}
          </label>
        </SearchRow>
        <div className="basis-full">
          <SearchRow label={m.deliveries.stateFilter}>
            <ChipGroup
              label={m.deliveries.stateFilter}
              value={draft.state}
              // 관리자는 상태 옆에 진행 중 건수(bff work-counts DELIVERIES·ACTIVE, 2026-11-18) — 서버가 그 상태 줄을 준 것만, 끝난 상태·못 읽음은 빈칸
              options={[{ value: '', label: m.deliveries.any }, ...EXECUTION_STATES.map((s) => ({ value: s, label: label(m.deliveries.executionState, s), count: stateCount(s) }))]}
              onChange={(v) => setDraft((d) => ({ ...d, state: v }))}
            />
          </SearchRow>
        </div>
      </SearchPanel>
      {searched ? (
        <QueryState state={toUiState(query, (r) => (r.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={m.deliveries.empty}>
          {(r) => {
            const rows = [...(r.items ?? []), ...more.rows];
            return (
              <>
                <ResultBar count={rows.length} more={!!nextCursor} />
                {/* 상세에서 이전·다음으로 넘기도록 지금 목록 순서를 기억(2026-11-19) */}
                <RememberQueue kind="delivery" ids={rows.flatMap((d) => (d.deliveryId ? [d.deliveryId] : []))} from={`/deliveries?${params.toString()}`} />
                <DeliveryTable rows={rows} preview={pv} />
                {pv.id && (
                  <PreviewDrawer
                    id={pv.id}
                    ids={rows.map((d) => d.deliveryId ?? '').filter(Boolean)}
                    onMove={pv.open}
                    onClose={pv.close}
                    title={<DisplayNumber number={rows.find((d) => d.deliveryId === pv.id)?.deliveryNumber} systemId={pv.id} />}
                    detailTo={`/deliveries/${encodeURIComponent(pv.id)}`}
                  >
                    <DeliveryPreview deliveryId={pv.id} />
                    {/* 여기서 바로 시작(2026-11-19) — 번호를 옮겨 적지 않는다 */}
                    <div className="mt-4 border-t border-base-300 pt-3">
                      <DeliveryStartActions deliveryId={pv.id} size="xs" />
                    </div>
                  </PreviewDrawer>
                )}
                {nextCursor && (
                  <ListFoot>
                    <span className="text-base-content/55">{m.approvals.shown(rows.length, true)}</span>
                    <button type="button" className="btn btn-sm" onClick={() => void loadMore()}>
                      {m.deliveries.more}
                    </button>
                  </ListFoot>
                )}
              </>
            );
          }}
        </QueryState>
      ) : (
        // 찾기 전(2026-11-18): 넣을 번호 모양 + 최근 본 배송
        <StartGuide recentKinds={['delivery']} />
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
      id="failure-decision"
      className="scroll-mt-12 space-y-3 rounded-box border border-warning/40 bg-warning/5 p-4"
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
      className="space-y-3 rounded-box border border-warning/40 bg-warning/5 p-4"
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

/** 원천 칸 머리(그림 + 이름) — 수행·배차를 따로 읽는다는 것을 칸마다 보인다. 서비스 이름은 마우스를 올리면(2026-11-18 "직관적이지 않다") */
function PanelTitle({ icon, title, source }: { readonly icon: 'truck' | 'user'; readonly title: string; readonly source: string }) {
  return (
    <span className="flex items-center gap-2" title={source}>
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon name={icon} className="h-4 w-4" />
      </span>
      {title}
    </span>
  );
}

/** 배송 미리보기 — 배송 수행 칸과 같은 조회 키(상세로 가도 다시 읽지 않는다). 배차는 상세에서 */
function DeliveryPreview({ deliveryId }: { readonly deliveryId: string }) {
  const api = useApi();
  const q = useQuery({
    queryKey: ['deliveries', deliveryId, 'execution'],
    queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}', { params: { path: { deliveryId } } })),
  });
  const riders = useRiderLabels([q.data?.riderId]);
  return (
    <QueryState state={toUiState(q)} onRetry={() => void q.refetch()}>
      {(d) => (
        <div className="space-y-4" data-testid="delivery-preview">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={executionTone(d.state)}>{d.state ? <CodeLabel code={d.state} names={m.deliveries.executionState} /> : m.none}</StatusBadge>
            <KindChip tone={TYPE_TONE[d.type ?? ''] ?? 'ghost'} icon={d.type === 'FORWARD' ? 'truck' : 'return'}>
              {label(m.deliveries.typeName, d.type)}
            </KindChip>
          </div>
          <PreviewFacts
            rows={[
              [m.deliveries.order, d.orderId ? <DisplayNumber key="o" number={d.orderNumber} systemId={d.orderId} /> : m.none],
              [m.deliveries.rider, d.riderId ? <RiderLabel key="r" rider={riders.get(d.riderId)} riderId={d.riderId} failed={riders.failed} /> : m.deliveries.noAssignment],
              [m.deliveries.mfc, text(d.mfcId)],
              [m.deliveries.assignedAt, when(d.assignedAt)],
              [m.deliveries.completedAt, when(d.completedAt)],
            ]}
          />
          {(d.history?.length ?? 0) > 0 && (
            <Timeline items={(d.history ?? []).slice(-3).reverse().map((h, n) => ({ key: `${h.state}-${n}`, tone: 'info', title: label(m.deliveries.executionState, h.state), meta: when(h.occurredAt) }))} />
          )}
        </div>
      )}
    </QueryState>
  );
}

function ExecutionPanel({ deliveryId }: { readonly deliveryId: string }) {
  const api = useApi();
  const admin = useIsAdmin();
  const query = useQuery({
    queryKey: ['deliveries', deliveryId, 'execution'],
    queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}', { params: { path: { deliveryId } } })),
  });
  const riders = useRiderLabels([query.data?.riderId]);
  return (
    <Section title={<PanelTitle icon="truck" title={m.deliveries.execution} source="delivery-execution" />} testId="execution-panel">
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(d) => (
          <div className="space-y-5">
            {/* 지금 상태 — 크게 */}
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={executionTone(d.state)} testId="execution-state">
                {d.state ? <CodeLabel code={d.state} names={m.deliveries.executionState} /> : m.none}
              </StatusBadge>
              <KindChip tone={TYPE_TONE[d.type ?? ''] ?? 'ghost'} icon={d.type === 'FORWARD' ? 'truck' : 'return'}>
                {label(m.deliveries.typeName, d.type)}
              </KindChip>
            </div>
            <FieldList
              rows={[
                // 화면 번호(ADR-0070): 라이더 "가린 이름 · 번호", 주문 8자리 — 시스템 ID 는 링크와 머리의 "시스템 번호"에만
                [m.deliveries.rider, d.riderId ? <Link key="r" className="hover:text-primary hover:underline" to={`/riders/${encodeURIComponent(d.riderId)}`}><RiderLabel rider={riders.get(d.riderId)} riderId={d.riderId} failed={riders.failed} /></Link> : m.deliveries.noAssignment],
                [m.deliveries.order, d.orderId ? <Link key="o" className="text-primary hover:underline" to={`/orders/${encodeURIComponent(d.orderId)}`}><DisplayNumber number={d.orderNumber} systemId={d.orderId} /></Link> : m.none],
                [m.deliveries.mfc, text(d.mfcId)],
                [m.deliveries.assignedAt, when(d.assignedAt)],
                [m.deliveries.completedAt, when(d.completedAt)],
              ]}
            />
            {d.failure && (
              <div className="space-y-3 rounded-box border border-error/30 bg-error/5 p-4">
                <h3 className="flex items-center gap-2 text-sm font-bold text-error">
                  <Icon name="alert" className="h-4 w-4" />
                  {m.deliveries.failure}
                </h3>
                <FieldList
                  testId="delivery-failure"
                  rows={[
                    [m.deliveries.failureReason, d.failure.reason ? <CodeLabel key="r" code={d.failure.reason} names={m.deliveries.deliveryFailureReasonName} /> : m.none],
                    [m.deliveries.goodsLocation, d.failure.goodsLocation ? <CodeLabel key="g" code={d.failure.goodsLocation} names={m.deliveries.goodsLocationName} /> : m.none],
                    [m.deliveries.contactAttempts, text(d.failure.contactAttempts)],
                    [m.deliveries.reportedAt, when(d.failure.reportedAt)],
                    [m.deliveries.decided, d.failure.decision ? `${label(m.deliveries.decisionName, d.failure.decision)} · ${when(d.failure.decidedAt)}` : m.none],
                    [m.deliveries.failureDetail, <p key="d" className="whitespace-pre-wrap font-normal">{text(d.failure.detail)}</p>],
                  ]}
                />
              </div>
            )}
            {admin && (
              <StickyWhen show={d.state === 'FAILURE_REPORTED'}>
                <FailureDecisionForm delivery={d} />
              </StickyWhen>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-3">
                <h3 className="text-sm font-bold">{m.deliveries.history}</h3>
                {(d.history ?? []).length === 0 ? (
                  <p className="text-sm text-base-content/60">{m.none}</p>
                ) : (
                  <Timeline
                    items={(d.history ?? []).map((h, n) => ({
                      key: `${h.state ?? ''}-${n}`,
                      tone: executionTone(h.state),
                      title: h.state ? <CodeLabel code={h.state} names={m.deliveries.executionState} /> : m.none,
                      meta: (
                        <>
                          {`${when(h.occurredAt)} · `}
                          {h.actor ? <CodeLabel code={h.actor} names={m.deliveries.actorName} /> : m.none}
                        </>
                      ),
                    }))}
                  />
                )}
              </div>
              <div className="space-y-3">
                <h3 className="text-sm font-bold">{m.deliveries.incidents}</h3>
                {(d.incidents ?? []).length === 0 ? (
                  <p className="text-sm text-base-content/60">{m.deliveries.noIncidents}</p>
                ) : (
                  <Timeline items={(d.incidents ?? []).map((i, n) => ({ key: i.incidentId ?? `incident-${n}`, tone: 'warning', title: i.category ? <CodeLabel code={i.category} names={m.deliveries.helpCategoryName} /> : m.none, meta: when(i.raisedAt) }))} />
                )}
              </div>
            </div>
          </div>
        )}
      </QueryState>
    </Section>
  );
}

function DispatchPanel({ deliveryId }: { readonly deliveryId: string }) {
  const api = useApi();
  const admin = useIsAdmin();
  const query = useQuery({
    queryKey: ['deliveries', deliveryId, 'dispatch'],
    queryFn: () => request('GET', api.dispatch.GET('/deliveries/{deliveryId}/dispatch', { params: { path: { deliveryId } } })),
  });
  const dispatchRiders = useRiderLabels([query.data?.assignment?.riderId]);
  return (
    <Section title={<PanelTitle icon="user" title={m.deliveries.dispatch} source="delivery-dispatch" />} testId="dispatch-panel">
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(d) => (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={dispatchTone(d.state)} testId="dispatch-state">
                {d.state ? <CodeLabel code={d.state} names={m.deliveries.dispatchState} /> : m.none}
              </StatusBadge>
            </div>
            <FieldList
              rows={[
                [m.deliveries.rider, d.assignment?.riderId ? <Link key="r" className="hover:text-primary hover:underline" to={`/riders/${encodeURIComponent(d.assignment.riderId)}`}><RiderLabel rider={dispatchRiders.get(d.assignment.riderId)} riderId={d.assignment.riderId} failed={dispatchRiders.failed} /></Link> : m.deliveries.noAssignment],
                [m.deliveries.assignedAt, when(d.assignment?.assignedAt)],
                [m.deliveries.pickedUpAt, when(d.assignment?.pickedUpAt)],
                [m.deliveries.mfc, text(d.mfcId)],
              ]}
            />
            {admin && (
              <StickyWhen show={d.state === 'ASSIGNED'}>
                <CancellationForm dispatch={d} />
              </StickyWhen>
            )}
            <div className="space-y-3">
              <h3 className="text-sm font-bold">{m.deliveries.attempts}</h3>
              {(d.attempts ?? []).length === 0 ? (
                <p className="text-sm text-base-content/60">{m.deliveries.noAttempts}</p>
              ) : (
                <Timeline
                  items={(d.attempts ?? []).map((a, n) => ({
                    key: a.attemptId ?? `attempt-${n}`,
                    tone: a.failureReason ? 'error' : 'info',
                    title: (
                      <>
                        {a.state ? <CodeLabel code={a.state} names={m.deliveries.attemptStateName} /> : m.none}
                        {a.failureReason && (
                          <>
                            {' · '}
                            <CodeLabel code={a.failureReason} names={m.deliveries.failureReasonName} />
                          </>
                        )}
                      </>
                    ),
                    meta: when(a.startedAt),
                  }))}
                />
              )}
            </div>
          </div>
        )}
      </QueryState>
    </Section>
  );
}

const useIsAdmin = () => useSession().session?.roles.includes('OPERATOR_ADMIN') ?? false;

/**
 * 관리자 아닌 직원(상담원·라이더 운영 등)의 배송 상세 — 처리는 라이더 백오피스(지원센터)에서(2026-11-19 사용자 "라이더 백오피스만").
 * 이 배송의 열린 접수 건(case `GET /cases?subjectRef=<배송>`)을 보여 그 처리 상태(지원센터·관리자 팀, 맡음)로 잇는다.
 * 못 읽으면 "확인 못 함"(없음으로 바꾸지 않음). 접수 건이 없으면 안내만.
 */
function RiderOpsHandoff({ deliveryId, failureReported }: { readonly deliveryId: string; readonly failureReported: boolean }) {
  const api = useApi();
  const h = m.deliveries.riderOps;
  const cases = useQuery({
    queryKey: ['cases', 'of-delivery', deliveryId],
    enabled: deliveryId !== '',
    queryFn: () => request('GET', api.cases.GET('/cases', { params: { query: { subjectRef: deliveryId } } })),
  });
  const items = cases.data?.items ?? [];
  return (
    <div className="space-y-2 rounded-box border border-info/30 bg-info/5 p-4" role="note" data-testid="rider-ops-handoff">
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <Icon name="truck" className="h-4 w-4 text-info" />
        {h.title}
      </h2>
      <p className="text-sm text-base-content/70">{failureReported ? h.bodyFailure : h.body}</p>
      {cases.isPending ? (
        <p className="text-xs text-base-content/50">…</p>
      ) : cases.isError ? (
        <p className="text-xs text-warning" data-testid="rider-ops-cases-failed">
          {h.casesFailed}
        </p>
      ) : items.length === 0 ? (
        <p className="text-xs text-base-content/60" data-testid="rider-ops-no-case">
          {h.noCase}
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((c) => (
            <li key={c.caseId}>
              <Link className="inline-flex flex-wrap items-center gap-2 text-sm hover:text-primary hover:underline" to={`/cases/${encodeURIComponent(c.caseId ?? '')}`} data-testid="rider-ops-case">
                <span className="font-mono">{c.caseNumber ?? m.displayNumber.missing}</span>
                <span>{label(m.cases.kindName, c.kind)}</span>
                <StatusBadge tone={c.assigneeGroup === 'ORDER_OPS' ? 'warning' : 'info'}>{h.team(label(m.cases.groupName, c.assigneeGroup))}</StatusBadge>
                <span className="text-xs text-base-content/55">{c.assigneeId ? h.assigned : h.unassigned}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DeliveryDetailPage() {
  const { deliveryId = '' } = useParams();
  const api = useApi();
  // 제목·다음 할 일용 — 배송 수행 칸(ExecutionPanel)과 같은 쿼리 키·요청이라 한 번만 읽는다(새 요청 없음)
  const execution = useQuery({
    queryKey: ['deliveries', deliveryId, 'execution'],
    queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}', { params: { path: { deliveryId } } })),
  });
  const d = execution.data;
  const admin = useIsAdmin();
  const headRiders = useRiderLabels([d?.riderId]);
  const rl = headRiders.get(d?.riderId);
  // 상세(2026-11-18): 상세 머리(종류·수행 상태가 먼저, 번호는 옆에 작게 + 컴플레인 기록) → 다음 할 일 → 원천 두 칸(배송 수행 | 배차) — 상태는 원천마다 따로, 합치지 않는다
  // 최근 본 항목(2026-11-18) — 서버 응답을 받은 뒤에만 남긴다
  useRecordRecent('delivery', deliveryId, d ? (d.deliveryNumber ?? m.displayNumber.missing) : null); // 번호 없으면 ID 대신 "번호 없음"(2026-11-19)
  return (
    <section className="max-w-7xl space-y-4">
      <DetailHeader
        back={{ to: '/deliveries', label: m.deliveries.back }}
        title={
          <>
            {d?.type && d.state ? m.deliveries.titleOf(label(m.deliveries.typeName, d.type), label(m.deliveries.executionState, d.state)) : m.deliveries.deliveryId}
            <span className="ml-2 text-sm font-normal text-base-content/50">
              <DisplayNumber number={d?.deliveryNumber} systemId={deliveryId} />
            </span>
            {/* 복사(2026-11-18): 화면 번호가 있으면 그 번호, 없으면 시스템 ID */}
            <CopyButton value={d?.deliveryNumber ?? deliveryId} />
          </>
        }
        summary={d ? m.deliveries.summaryOf(d.orderNumber ?? m.none, d.riderId ? (rl?.riderNumber ? `${rl.nameMasked ?? ''} · ${rl.riderNumber}` : m.none) : m.deliveries.noAssignment, text(d.mfcId)) : undefined}
        actions={<DeliveryStartActions deliveryId={deliveryId} />}
      />
      {/* 보던 목록 순서대로 이전·다음(2026-11-19) */}
      <QueueNav kind="delivery" id={deliveryId} />
      <SystemNumbers ids={[{ label: m.displayNumber.system.deliveryId, id: deliveryId }, { label: m.displayNumber.system.orderId, id: d?.orderId }, { label: m.displayNumber.system.riderId, id: d?.riderId }]} />
      {/* 다음 할 일 — 서버 수행 상태가 전달 실패 등록(FAILURE_REPORTED)일 때만: 확정·반려 칸으로 */}
      {admin && d?.state === 'FAILURE_REPORTED' && (
        <NextAction tone="warning" title={m.deliveries.nextStep.failureTitle}>
          <a className="btn btn-sm btn-warning" href="#failure-decision">
            {m.deliveries.nextStep.failureGo}
          </a>
        </NextAction>
      )}
      {!admin && <RiderOpsHandoff deliveryId={deliveryId} failureReported={d?.state === 'FAILURE_REPORTED'} />}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <ExecutionPanel deliveryId={deliveryId} />
        <DispatchPanel deliveryId={deliveryId} />
      </div>
      {/* 배정 라이더 카드(2026-11-18 Refine 참고) — 배송 수행의 riderId 가 있을 때만. 미배정은 배차 칸이 말한다 */}
      {d?.riderId && <RiderCard riderId={d.riderId} />}
    </section>
  );
}
