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
import { DataTable, PageHeader, StatusBadge } from '../../shared/admin';
import { executionTone } from '../deliveries/DeliveryPages';
import { EmptyBox, Icon, IdLink, KindChip, Kpi, Person, UnderlineTabs } from '../lookup/parts';

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

  // 화면(2026-11-18 관제 화면처럼): 머리(새로 고침) → 숫자 카드(읽은 줄을 센 값) → 한 카드(수행 상태 탭 → 센터 → 표 → 쪽)
  const loaded = query.isSuccess ? query.data : null;
  return (
    <section className="space-y-4">
      <PageHeader
        title={m.title}
        description={m.intro}
        actions={
          <>
            <span className="flex items-center gap-1.5 text-xs text-base-content/55">
              <span className={`h-2 w-2 rounded-full ${query.isFetching ? 'animate-pulse bg-info' : 'bg-success'}`} aria-hidden="true" />
              {m.autoRefreshNote}
            </span>
            <button type="button" className="btn btn-sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
              {m.refresh}
            </button>
          </>
        }
      />
      {loaded && <LiveKpis items={(loaded.items ?? [])} composedAt={loaded.composedAt} />}
      <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
        <UnderlineTabs
          label={m.state}
          value={state}
          options={[{ value: '', label: m.activeStates }, ...ACTIVE_STATES.map((s) => ({ value: s, label: label(d.executionState, s) }))]}
          onChange={(v) => set({ state: v })}
        />
        <div className="flex flex-wrap items-center gap-3 border-b border-base-300 bg-base-200/40 px-4 py-2.5 text-sm" role="group" aria-label={m.filters}>
          <label className="flex items-center gap-2">
            <span className="text-xs font-medium text-base-content/55">{m.center}</span>
            <select className="select select-sm w-56" value={mfcId} onChange={(e) => set({ mfcId: e.target.value })}>
              <option value="">{m.allCenters}</option>
              {(centers.data ?? []).map((c) => (
                <option key={c.centerId} value={c.centerId}>
                  {c.name ? `${c.name} (${c.centerId})` : c.centerId}
                </option>
              ))}
              {mfcId && !centers.data?.some((c) => c.centerId === mfcId) && <option value={mfcId}>{mfcId}</option>}
            </select>
          </label>
          {centers.isError && (
            <p role="alert" className="text-xs text-warning">
              {m.centersFailed}
            </p>
          )}
        </div>
        <div className="space-y-3 p-3">
          <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
            {(view) => {
              const items = (view.items ?? []) as readonly LiveItem[];
              const nextCursor = view.page?.nextCursor ?? null;
              return (
                <div className="space-y-3">
                  <SourceStamps sources={view.sources} unavailableSources={view.unavailableSources} />
                  {view.casesTruncated && (
                    <p role="status" className="alert alert-warning alert-soft text-sm" data-state="cases-truncated">
                      {m.casesTruncated}
                    </p>
                  )}
                  {view.truncated && (
                    <p role="status" className="alert alert-info alert-soft text-sm" data-state="truncated">
                      {m.truncated}
                    </p>
                  )}
                  {items.length === 0 ? (
                    <div data-state="empty">
                      <EmptyBox icon="truck">{m.empty}</EmptyBox>
                    </div>
                  ) : (
                    <LiveTable items={items} composedAt={view.composedAt} casesTruncated={view.casesTruncated ?? false} />
                  )}
                  {state && (cursor || nextCursor) && (
                    <div className="flex justify-end gap-2">
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
        </div>
      </div>
    </section>
  );
}

/** "약속 지남" — 서버 promisedAt 이 서버 composedAt 보다 앞일 때만(화면 시계를 쓰지 않음) */
const isLate = (it: LiveItem, composedAt: string | undefined) => {
  const now = composedAt ? Date.parse(composedAt) : Number.NaN;
  return !!it.promisedAt && Date.parse(it.promisedAt) < now;
};

/** 숫자 카드 — 이 화면에 읽어 온 줄만 센다(전체 건수 아님). 접수 건을 못 읽은 줄은 0 으로 세지 않고 따로 알린다 */
function LiveKpis({ items, composedAt }: { readonly items: readonly LiveItem[]; readonly composedAt: string | undefined }) {
  const late = items.filter((it) => isLate(it, composedAt)).length;
  const noRider = items.filter((it) => !it.riderId).length;
  const casesKnown = items.filter((it) => it.openCases !== null && it.openCases !== undefined);
  const withCases = casesKnown.filter((it) => (it.openCases ?? []).length > 0).length;
  const casesUnknown = items.length - casesKnown.length;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="live-kpis">
      <Kpi icon="truck" label={m.kpi.shown} value={items.length} hint={m.kpi.shownHint} />
      <Kpi icon="clock" tone={late > 0 ? 'error' : undefined} label={m.kpi.late} value={composedAt ? late : messages.none} />
      <Kpi icon="user" tone={noRider > 0 ? 'warning' : undefined} label={m.kpi.noRider} value={noRider} />
      <Kpi icon="alert" tone={withCases > 0 ? 'warning' : undefined} label={m.kpi.withCases} value={withCases} hint={casesUnknown > 0 ? m.kpi.casesUnknown(casesUnknown) : undefined} />
    </div>
  );
}

function LiveTable({ items, composedAt, casesTruncated = false }: { readonly items: readonly LiveItem[]; readonly composedAt: string | undefined; readonly casesTruncated?: boolean }) {
  return (
    <DataTable>
      <thead>
        <tr>
          <th>{m.col.delivery}</th>
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
          const late = isLate(it, composedAt);
          const dispatchState = it.dispatch?.state ?? null;
          return (
            <tr key={it.deliveryId} data-testid="live-row" className={late ? 'bg-error/5' : undefined}>
              {/* 첫 칸: 배송 번호 굵게 + 주문 번호 작게 */}
              <td>
                {it.deliveryId ? (
                  <Link className="font-mono font-semibold text-base-content hover:text-primary hover:underline" to={`/deliveries/${encodeURIComponent(it.deliveryId)}`}>
                    {it.deliveryId}
                  </Link>
                ) : (
                  messages.none
                )}
                <span className="mt-0.5 block font-normal">
                  {it.orderId ? <IdLink id={it.orderId} to={`/orders/${encodeURIComponent(it.orderId)}`} /> : <IdLink id={null} />}
                </span>
              </td>
              <td>
                <span className="flex flex-col items-start gap-1">
                  {it.type ? <KindChip icon={it.type === 'FORWARD' ? 'truck' : 'return'}>{label(d.typeName, it.type)}</KindChip> : messages.none}
                  <span className="flex items-center gap-1 text-xs text-base-content/55">
                    <Icon name="store" className="h-3 w-3" />
                    {it.mfcId ?? messages.none}
                  </span>
                </span>
              </td>
              <td>{it.delivery?.state ? <StatusBadge tone={executionTone(it.delivery.state)}>{label(d.executionState, it.delivery.state)}</StatusBadge> : <span className="text-warning">{m.unknown}</span>}</td>
              <td data-testid="dispatch-state">{dispatchState ? <StatusBadge tone="neutral">{label(d.dispatchState, dispatchState)}</StatusBadge> : <span className="text-warning">{m.unknown}</span>}</td>
              <td>{it.riderId ? <Person id={it.riderId} /> : <StatusBadge tone="warning">{m.noRider}</StatusBadge>}</td>
              <td className="min-w-40">
                <span className="flex flex-wrap items-center gap-1">
                  {windowText(it.arrivalWindow)}
                  {late && <span className="badge badge-error badge-sm">{m.late}</span>}
                </span>
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
                      <li key={c.caseId} className="flex flex-wrap items-center gap-1">
                        <Link className={`text-sm hover:underline ${c.overdue ? 'font-semibold text-error' : 'text-primary'}`} to={`/cases/${encodeURIComponent(c.caseId ?? '')}`}>
                          {`${label(messages.cases.kindName, c.kind)}${c.priority ? ` ${c.priority}` : ''}`}
                        </Link>
                        {c.overdue && <span className="badge badge-error badge-sm">{m.overdue}</span>}
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
  );
}
