// 실시간 배송 현황 — bff 0.3.0 `GET /backoffice/views/live-delivery?mfcId=&state=&size=&cursor=`
// (백엔드 요청 backoffice/2026-11-16-request-live-delivery, PR #25, 배송 원문 §10.1).
// - OPERATOR_ADMIN·CS_AGENT·RIDER_OPS(서버 판정, 셋 다 모든 센터). 센터·상태·쪽은 URL 쿼리.
// - 상태를 비우면 끝나지 않은 배송 전부를 오래된 순 50건까지(쪽 넘김 없음, 넘으면 truncated). 상태를 주면 page.nextCursor 로 다음 쪽.
// - 수행 상태·배차 상태·열린 사건을 원천마다 따로 — 배차 원천 실패면 "모름", 사건 원천 실패(openCases null)면 "조회 실패"(0건과 구분).
// - "약속 지남"은 서버 promisedAt 이 서버 composedAt 보다 앞일 때 표시만(화면 시계를 쓰지 않음).
// - 자동 새로 고침 1분(요청서: 서버 부담 — 30초 이상 권장). 화면이 숨겨지면 멈춘다(TanStack Query 기본).
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/backoffice-bff';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { label, when } from '../../shared/ops';
import { SourceStamps } from '../../shared/SourceStamps';
import { DataTable, PageHeader } from '../../shared/admin';

const m = messages.live;
const d = messages.deliveries;

/** 진행 중 상태(요청서 §1 — 비우면 서버가 이 상태들을 모은다). 고르기는 하나씩. */
const ACTIVE_STATES = [
  'UNASSIGNED',
  'ASSIGNED',
  'ARRIVED_AT_STORE',
  'PICKED_UP',
  'ARRIVED_AT_CUSTOMER',
  'FAILURE_REPORTED',
  'SUSPENDED',
  'RETURN_IN_PROGRESS',
  'RETURN_PICKED_UP',
] as const;
const PAGE_SIZE = 50;
const REFRESH_MS = 60_000;

type StampedState = components['schemas']['StampedState'];
interface OpenCase {
  readonly caseId?: string;
  readonly kind?: string;
  readonly priority?: string | null;
  readonly overdue?: boolean | null;
}
interface LiveItem {
  readonly deliveryId?: string;
  readonly orderId?: string;
  readonly mfcId?: string | null;
  readonly type?: string | null;
  readonly delivery?: StampedState;
  readonly dispatch?: StampedState;
  readonly riderId?: string | null;
  readonly arrivalWindow?: Record<string, unknown> | null;
  readonly promisedAt?: string | null;
  readonly openCases?: readonly OpenCase[] | null;
  /** bff 0.7.0 — tracking 고객 도착 예정(AVAILABLE 일 때만 값) */
  readonly latestEta?: string | null;
  readonly etaStatus?: string | null;
  readonly delayedBySeconds?: number | null;
  readonly etaSource?: { readonly confidence?: string } | null;
}

/**
 * 도착 예정(bff 0.7.0 — 백엔드 요청 backoffice/2026-11-17-request-live-delivery-eta). 숫자를 지어내지 않는다:
 * AVAILABLE + 값 → "도착 예정 HH:mm"(늦으면 "N분 늦음"), LOCATING·ETA_PENDING → "확인 중", tracking 장애 → "확인 불가", 그 밖(null·FINAL) → "—".
 */
function EtaLine({ it }: { readonly it: LiveItem }) {
  if (it.etaSource?.confidence === 'UNKNOWN')
    return (
      <div className="text-xs text-warning" data-testid="live-eta">
        {m.etaUnknown}
      </div>
    );
  if (it.etaStatus === 'AVAILABLE' && it.latestEta) {
    const late = (it.delayedBySeconds ?? 0) > 0 ? Math.ceil((it.delayedBySeconds ?? 0) / 60) : 0;
    return (
      <div className="text-xs" data-testid="live-eta">
        {m.eta(when(it.latestEta))}
        {late > 0 && <span className="ml-1 font-bold text-error">{m.etaLate(late)}</span>}
      </div>
    );
  }
  return (
    <div className="text-xs text-base-content/60" data-testid="live-eta">
      {it.etaStatus === 'LOCATING' || it.etaStatus === 'ETA_PENDING' ? m.etaChecking : m.etaNone}
    </div>
  );
}

/** arrivalWindow(date·start·end, 한국 시각 그대로) — 받은 값을 이어 붙이기만 */
function windowText(w: Record<string, unknown> | null | undefined): string {
  if (!w) return messages.none;
  const s = (k: string) => (typeof w[k] === 'string' ? w[k] : '');
  const range = [s('start'), s('end')].filter(Boolean).join('~');
  return [s('date'), range].filter(Boolean).join(' ') || messages.none;
}

export function LiveDeliveryPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const mfcId = params.get('mfcId') ?? '';
  const state = params.get('state') ?? '';
  const cursor = state ? (params.get('cursor') ?? '') : '';
  const set = (next: { mfcId?: string; state?: string; cursor?: string }) => {
    const merged = { mfcId, state, cursor: '', ...next };
    const out: Record<string, string> = {};
    if (merged.mfcId) out.mfcId = merged.mfcId;
    if (merged.state) out.state = merged.state;
    if (merged.state && merged.cursor) out.cursor = merged.cursor;
    setParams(out);
  };

  const centers = useQuery({
    queryKey: ['centers', 'MFC'],
    queryFn: async () => (await request('GET', api.center.GET('/centers', { params: { query: { type: 'MFC' } } }))).items ?? [],
  });
  const query = useQuery({
    queryKey: ['bff', 'live-delivery', mfcId, state, cursor],
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      request(
        'GET',
        api.bff.GET('/views/live-delivery', {
          params: { query: { size: PAGE_SIZE, ...(mfcId ? { mfcId } : {}), ...(state ? { state } : {}), ...(cursor ? { cursor } : {}) } },
        }),
      ),
  });

  return (
    <section className="space-y-4">
      <PageHeader title={m.title} description={m.intro} />
      <div className="flex flex-wrap items-end gap-2 rounded-box border border-base-300 bg-base-100 p-3 text-sm" role="group" aria-label={m.filters}>
        <label className="flex flex-col gap-1">
          {m.center}
          <select className="select select-sm w-48" value={mfcId} onChange={(e) => set({ mfcId: e.target.value })}>
            <option value="">{m.allCenters}</option>
            {(centers.data ?? []).map((c) => (
              <option key={c.centerId} value={c.centerId}>
                {c.name ? `${c.name} (${c.centerId})` : c.centerId}
              </option>
            ))}
            {mfcId && !centers.data?.some((c) => c.centerId === mfcId) && <option value={mfcId}>{mfcId}</option>}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {m.state}
          <select className="select select-sm w-40" value={state} onChange={(e) => set({ state: e.target.value })}>
            <option value="">{m.activeStates}</option>
            {ACTIVE_STATES.map((s) => (
              <option key={s} value={s}>
                {label(d.executionState, s)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
          {m.refresh}
        </button>
        <span className="text-xs text-base-content/60">{m.autoRefreshNote}</span>
        {centers.isError && (
          <p role="alert" className="w-full text-xs text-warning">
            {m.centersFailed}
          </p>
        )}
      </div>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(view) => {
          const items = (view.items ?? []) as readonly LiveItem[];
          const nextCursor = view.page?.nextCursor ?? null;
          return (
            <div className="space-y-3">
              <SourceStamps sources={view.sources} unavailableSources={view.unavailableSources} />
              {view.casesTruncated && (
                <p role="status" className="alert alert-warning text-sm" data-state="cases-truncated">
                  {m.casesTruncated}
                </p>
              )}
              {view.truncated && (
                <p role="status" className="alert alert-info text-sm" data-state="truncated">
                  {m.truncated}
                </p>
              )}
              {items.length === 0 ? (
                <p data-state="empty" className="p-4 text-base-content/60">
                  {m.empty}
                </p>
              ) : (
                <LiveTable items={items} composedAt={view.composedAt} casesTruncated={view.casesTruncated ?? false} />
              )}
              {state && (cursor || nextCursor) && (
                <div className="flex gap-2">
                  {cursor && (
                    <button type="button" className="btn btn-sm" onClick={() => set({ cursor: '' })}>
                      {m.first}
                    </button>
                  )}
                  {nextCursor && (
                    <button type="button" className="btn btn-sm" onClick={() => set({ cursor: nextCursor })}>
                      {m.next}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        }}
      </QueryState>
    </section>
  );
}

function LiveTable({ items, composedAt, casesTruncated = false }: { readonly items: readonly LiveItem[]; readonly composedAt: string | undefined; readonly casesTruncated?: boolean }) {
  // "약속 지남" 기준은 서버가 조립한 시각(composedAt) — 화면 시계로 판정하지 않는다
  const now = composedAt ? Date.parse(composedAt) : Number.NaN; // 없으면 표시하지 않음
  return (
    <div className="overflow-x-auto">
      <DataTable>
        <thead>
          <tr>
            <th>{m.col.delivery}</th>
            <th>{m.col.order}</th>
            <th>{m.col.center}</th>
            <th>{m.col.type}</th>
            <th>{m.col.execution}</th>
            <th>{m.col.dispatch}</th>
            <th>{m.col.rider}</th>
            <th>{m.col.window}</th>
            <th>{m.col.cases}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const late = !!it.promisedAt && Date.parse(it.promisedAt) < now;
            const dispatchState = it.dispatch?.state ?? null;
            return (
              <tr key={it.deliveryId} data-testid="live-row">
                <td className="font-mono">
                  {it.deliveryId ? <Link className="link" to={`/deliveries/${encodeURIComponent(it.deliveryId)}`}>{it.deliveryId}</Link> : messages.none}
                </td>
                <td className="font-mono">
                  {it.orderId ? <Link className="link" to={`/orders/${encodeURIComponent(it.orderId)}`}>{it.orderId}</Link> : messages.none}
                </td>
                <td>{it.mfcId ?? messages.none}</td>
                <td>{label(d.typeName, it.type)}</td>
                <td>{it.delivery?.state ? label(d.executionState, it.delivery.state) : m.unknown}</td>
                <td data-testid="dispatch-state">{dispatchState ? label(d.dispatchState, dispatchState) : <span className="text-warning">{m.unknown}</span>}</td>
                <td>{it.riderId ?? <span className="opacity-70">{m.noRider}</span>}</td>
                <td>
                  {windowText(it.arrivalWindow)}
                  {late && <span className="badge badge-error badge-sm ml-1">{m.late}</span>}
                  {it.promisedAt && <div className="text-xs text-base-content/60">{when(it.promisedAt)}</div>}
                  <EtaLine it={it} />
                </td>
                <td data-testid="open-cases">
                  {it.openCases === null || it.openCases === undefined ? (
                    // bff 0.9.2: 열린 사건을 1,000건까지만 읽었으면(casesTruncated) null = 모름 — 실패가 아니라 확인 불가
                    <span className="text-warning">{casesTruncated ? m.casesUnknown : m.casesFailed}</span>
                  ) : it.openCases.length === 0 ? (
                    <span className="opacity-70">{messages.none}</span>
                  ) : (
                    <ul className="space-y-1">
                      {it.openCases.map((c) => (
                        <li key={c.caseId}>
                          <Link className={`link ${c.overdue ? 'text-error' : ''}`} to={`/cases/${encodeURIComponent(c.caseId ?? '')}`}>
                            {`${label(messages.cases.kindName, c.kind)}${c.priority ? ` ${c.priority}` : ''}`}
                          </Link>
                          {c.overdue && <span className="badge badge-error badge-sm ml-1">{m.overdue}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
    </div>
  );
}
