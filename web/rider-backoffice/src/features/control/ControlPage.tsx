// 라이더 관제(2026-11-17, PC 5 — ADR-0068): tracking `GET /rider-locations?mfcId=` — 운행 중 라이더의 지금 위치·끊김·진행 중 배송.
// RIDER_OPS·OPERATOR_ADMIN 만(서버 403), 10초마다 다시 불러오기, 이동 이력 없음. 지도는 VITE_KAKAO_JS_KEY 가 있을 때만(없으면 안내 + 표).
// 거르기(전체·배송 중·위치 끊김)는 주소 쿼리 filter.
// 2026-11-18: 관리자 화면 모양 — 머리말, 조건 상자(센터 + 보기 칩), 요약 카드(누르면 그 거르기), 지도 구역, 표(위치 상태 꼬리표).
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/delivery-tracking';
import { useApi } from '../../app/ApiContext';
import { ChipGroup, PageHeader, StatusBadge } from '../../shared/admin';
import { RiderName } from '../../shared/displayNumbers';
import { isSimRider } from '../../shared/sim';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { CenterPicker, label, none, when } from '../../shared/opsUi';
import { ActiveDeliverySummary, ControlRiderPanel } from './ControlRiderPanel';
import { ControlSearch } from './ControlSearch';
import { RecentDeliveries } from './RecentDeliveries';
import { useDropLocations } from './dropLocation';
import { CONTROL_REFRESH_MS } from './refresh';
import { KakaoRiderMap, type MapRider, type MapRoute } from './KakaoRiderMap';

const c = ops.control;
const n = messages.names;
export { CONTROL_REFRESH_MS };

/** 이 화면에서만 쓰는 문구 */
const cx = {
  view: '보기',
  onDuty: '운행 중',
  delivering: '배송 중',
  waiting: '대기',
  staleOrNone: '위치 끊김·없음',
  people: (k: number) => `${k}명`,
  map: '위치 지도',
  list: '라이더 목록',
  receiving: '수신 중',
  legend: { ok: '대기', delivering: '배송 중', stale: '끊김' },
  refresh: '10초마다 새로 불러와요',
} as const;

type Filter = 'all' | 'delivering' | 'stale' | 'sim';
type Rider = components['schemas']['ControlRider'];

// 거르기·지도 색은 서버 값으로만: stale(서버 3분 기준) 또는 위치 없음 = 끊김, 진행 중 배송 있음 = 배송 중.
const isStale = (r: Rider) => r.stale || !r.location;
const isDelivering = (r: Rider) => r.activeDeliveries.length > 0;

function LocationBadge({ r }: { readonly r: Rider }) {
  if (!r.location) return <StatusBadge tone="error">{c.noLocation}</StatusBadge>;
  if (r.stale) return <StatusBadge tone="error">{c.stale}</StatusBadge>;
  return <StatusBadge tone="success">{cx.receiving}</StatusBadge>;
}

export function ControlPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const mfcId = params.get('mfcId') ?? '';
  const rawFilter = params.get('filter');
  const filter: Filter = rawFilter === 'delivering' || rawFilter === 'stale' || rawFilter === 'sim' ? rawFilter : 'all';
  const setFilter = (f: Filter) => {
    const p = new URLSearchParams(params);
    if (f === 'all') p.delete('filter');
    else p.set('filter', f);
    setParams(p);
  };
  const filterLink = (f: Filter) => `/control?mfcId=${encodeURIComponent(mfcId)}${f === 'all' ? '' : `&filter=${f}`}`;
  const board = useQuery({
    queryKey: ['rider-locations', mfcId],
    enabled: mfcId !== '',
    refetchInterval: CONTROL_REFRESH_MS,
    queryFn: () => request('GET', api.tracking.GET('/rider-locations', { params: { query: { mfcId } } })),
  });
  // 센터 좌표(지도 가운데) — CenterPicker 와 같은 목록 캐시
  const centers = useQuery({
    queryKey: ['centers', 'MFC'],
    queryFn: () => request('GET', api.center.GET('/centers', { params: { query: { type: 'MFC' } } })),
  });
  // 센터를 아직 안 골랐으면 첫 센터로 연다(빈 화면에서 드롭다운을 찾아야 하지 않게 — 2026-11-18 사용자). 고른 뒤 바꾸는 건 그대로.
  const firstCenter = centers.data?.items?.[0]?.centerId;
  useEffect(() => {
    if (!mfcId && firstCenter) {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set('mfcId', firstCenter);
          return p;
        },
        { replace: true },
      );
    }
  }, [mfcId, firstCenter, setParams]);
  const center = (centers.data?.items ?? []).find((x) => x.centerId === mfcId);
  const coords = center?.coordinates;
  const centerPoint = coords?.lat != null && coords.lng != null ? { lat: coords.lat, lng: coords.lng } : null;
  // 고른 라이더(오른쪽 "라이더 한눈에") — URL ?rider= (주문번호로 찾았으면 ?delivery= 도) 로 둬서 새로 고침·공유해도 그대로
  const selectedId = params.get('rider') ?? '';
  const focusDeliveryId = params.get('delivery') ?? '';
  const select = useCallback(
    (riderId: string) =>
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        if (riderId) p.set('rider', riderId);
        else p.delete('rider');
        p.delete('delivery');
        return p;
      }),
    [setParams],
  );
  const found = useCallback(
    (hit: { readonly riderId: string; readonly mfcId?: string | null; readonly deliveryId?: string }) =>
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        if (hit.mfcId) p.set('mfcId', hit.mfcId);
        p.set('rider', hit.riderId);
        if (hit.deliveryId) p.set('delivery', hit.deliveryId);
        else p.delete('delivery');
        p.delete('filter');
        return p;
      }),
    [setParams],
  );
  // 고른 라이더 배송의 전달지 — 상세 칸과 같은 캐시(배송마다 한 번, 열람 기록)
  const selectedRider = (board.data?.items ?? []).find((r) => r.riderId === selectedId);
  const routeIds = selectedRider?.activeDeliveries.length ? selectedRider.activeDeliveries.map((d) => d.deliveryId) : focusDeliveryId && selectedId ? [focusDeliveryId] : [];
  const drops = useDropLocations(routeIds);
  const routes: MapRoute[] = drops.flatMap((q, i) => (q.data?.lat != null && q.data.lng != null ? [{ deliveryId: routeIds[i] ?? '', drop: { lat: q.data.lat, lng: q.data.lng } }] : []));
  return (
    <section className="space-y-4">
      {/* 머리말 + 조건(한 줄): 찾기 · 센터 — 보기 거르기는 아래 라이더 목록 머리로 */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title={c.title} description={c.intro} />
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3" aria-label="관제 조건" role="group">
          <ControlSearch onFound={found} />
          <CenterPicker value={mfcId} onChange={(v) => setParams(v ? { mfcId: v } : {})} />
        </div>
      </div>
      {mfcId === '' ? (
        <p role="note" className="rounded-box bg-base-300/50 px-4 py-3 text-sm text-base-content/75">
          {c.pickCenter}
        </p>
      ) : (
        <QueryState state={toUiState(board, (b) => (b.items ?? []).length === 0)} onRetry={() => void board.refetch()} emptyText={c.empty}>
          {(b) => {
            const all = b.items ?? [];
            const staleFlag = all.filter((r) => r.stale).length;
            const staleOrNone = all.filter(isStale).length;
            const delivering = all.filter(isDelivering).length;
            const items = all.filter((r) => (filter === 'delivering' ? isDelivering(r) : filter === 'stale' ? isStale(r) : filter === 'sim' ? isSimRider(r.riderId) : true));
            const mapRiders: MapRider[] = items.flatMap((r) =>
              r.location?.lat != null && r.location.lng != null
                ? [{ riderId: r.riderId, lat: r.location.lat, lng: r.location.lng, tone: isStale(r) ? 'stale' : isDelivering(r) ? 'delivering' : 'ok', label: [r.nameMasked, r.riderNumber ?? r.riderId.slice(-8)].filter(Boolean).join(' ') }]
                : [],
            );
            return (
              <div className="space-y-4">
                {/* 핵심 수 — 누르면 그 거르기(목록·지도가 함께 바뀐다) */}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <KpiTile label={cx.onDuty} value={cx.people(all.length)} to={filterLink('all')} active={filter === 'all'} hint={ops.dashboard.asOf(when(b.asOf))} testId="control-stat-all" />
                  <KpiTile label={cx.delivering} value={cx.people(delivering)} to={filterLink('delivering')} active={filter === 'delivering'} dot="bg-info" testId="control-stat-delivering" />
                  <KpiTile label={cx.waiting} value={cx.people(all.filter((r) => !isDelivering(r) && !isStale(r)).length)} to={filterLink('all')} dot="bg-success" />
                  <KpiTile label={cx.staleOrNone} value={cx.people(staleOrNone)} to={filterLink('stale')} active={filter === 'stale'} dot="bg-error" alert={staleOrNone > 0} testId="control-stat-stale" />
                </div>

                {/* 작업 화면(배민 주문접수처럼): 왼쪽 라이더 목록 · 가운데 지도 · 오른쪽 고른 라이더 상세 — 한 화면에서 스크롤 없이 */}
                <div className="grid gap-4 xl:h-[calc(100vh-17rem)] xl:min-h-[560px] xl:grid-cols-[20rem_minmax(0,1fr)_24rem]">
                  <div className="flex min-h-0 flex-col overflow-hidden rounded-box border border-base-300 bg-base-100">
                    <div className="space-y-2 border-b border-base-300 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <h2 className="font-bold">{cx.list}</h2>
                        <p className="flex items-center gap-2 text-sm">
                          <span>
                            <span className="font-semibold text-primary">{items.length}</span>명
                          </span>
                          {staleFlag > 0 && <StatusBadge tone="error">{c.staleCount(staleFlag)}</StatusBadge>}
                        </p>
                      </div>
                      <ChipGroup
                        label={cx.view}
                        value={filter}
                        options={(['all', 'delivering', 'stale', 'sim'] as const).map((f) => ({ value: f, label: c.filter[f] }))}
                        onChange={setFilter}
                      />
                    </div>
                    {items.length === 0 ? (
                      <p data-state="empty" className="p-6 text-center text-sm text-base-content/60">
                        {c.emptyFiltered}
                      </p>
                    ) : (
                      <ul className="min-h-0 flex-1 divide-y divide-base-200 overflow-y-auto" aria-label={cx.list}>
                        {items.map((r) => (
                          <li
                            key={r.riderId}
                            id={`control-${r.riderId}`}
                            data-testid="control-row"
                            aria-selected={r.riderId === selectedId}
                            className={`cursor-pointer border-l-[3px] px-4 py-3 text-sm ${r.riderId === selectedId ? 'border-primary bg-primary/10' : isStale(r) ? 'border-error bg-error/5 hover:bg-error/10' : 'border-transparent hover:bg-base-200/60'}`}
                            onClick={() => select(r.riderId)}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="flex min-w-0 flex-wrap items-center gap-1">
                                {/* 화면 번호(ADR-0070): "이* · 482913" */}
                                <RiderName riderId={r.riderId} nameMasked={r.nameMasked} riderNumber={r.riderNumber} />
                                {r.restriction && r.restriction !== 'NORMAL' && <StatusBadge tone="warning">{label(n.restriction, r.restriction)}</StatusBadge>}
                              </span>
                              <LocationBadge r={r} />
                            </div>
                            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-base-content/60">
                              <span>{label(n.vehicle, r.vehicleType)}</span>
                              <span>·</span>
                              <span>{r.newDispatchEnabled ? `${c.col.dispatch} ${c.on}` : `${c.col.dispatch} ${c.off}`}</span>
                              <span>·</span>
                              <span>{r.staleSinceSeconds === null || r.staleSinceSeconds === undefined ? none : c.seconds(r.staleSinceSeconds)}</span>
                            </p>
                            {r.location && <p className="mt-0.5 font-mono text-[11px] text-base-content/45">{`${Number(r.location.lat).toFixed(5)}, ${Number(r.location.lng).toFixed(5)}`}</p>}
                            {r.activeDeliveries.length > 0 && (
                              <ul className="mt-1.5 space-y-0.5 rounded-md bg-info/10 px-2 py-1.5">
                                {r.activeDeliveries.map((x) => (
                                  <li key={x.deliveryId}>
                                    <ActiveDeliverySummary active={x} />
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="border-t border-base-300 px-4 py-2 text-right text-xs text-base-content/50">{cx.refresh}</p>
                  </div>

                  <div className="relative flex min-h-[420px] flex-col">
                    <KakaoRiderMap center={centerPoint} riders={mapRiders} onSelect={select} selectedId={selectedId} routes={routes} heightClass="h-full min-h-[420px]" />
                    <span className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-1">
                      <StatusBadge tone="success">{cx.legend.ok}</StatusBadge>
                      <StatusBadge tone="info">{cx.legend.delivering}</StatusBadge>
                      <StatusBadge tone="warning">{cx.legend.stale}</StatusBadge>
                    </span>
                  </div>

                  <div className="min-h-0 overflow-y-auto">
                    <ControlRiderPanel rider={all.find((r) => r.riderId === selectedId)} selectedId={selectedId} focusDeliveryId={focusDeliveryId} onClose={() => select('')} asOf={b.asOf} />
                  </div>
                </div>

                {/* 최근 배송(끝난 것까지) — 짧은 배송도 놓치지 않게. 줄을 누르면 위 상세로 */}
                <RecentDeliveries mfcId={mfcId} selectedDeliveryId={focusDeliveryId} onPick={(hit) => found({ ...hit, mfcId })} />
              </div>
            );
          }}
        </QueryState>
      )}
    </section>
  );
}

/** 관제 핵심 수 — 누르면 그 거르기. 고른 거르기는 테두리, 문제가 있으면 빨강 */
function KpiTile({ label: text, value, to, active = false, dot, alert = false, hint, testId }: { readonly label: string; readonly value: string; readonly to: string; readonly active?: boolean; readonly dot?: string; readonly alert?: boolean; readonly hint?: string; readonly testId?: string }) {
  return (
    <Link
      to={to}
      className={`flex items-center justify-between gap-3 rounded-box border bg-base-100 px-5 py-3 ${active ? 'border-primary ring-1 ring-primary' : 'border-base-300 hover:border-primary'}`}
      data-testid={testId}
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm text-base-content/65">
          {dot && <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />}
          {text}
        </span>
        {hint && <span className="block text-[11px] text-base-content/45">{hint}</span>}
      </span>
      <span className={`text-2xl font-bold ${alert ? 'text-error' : ''}`}>{value}</span>
    </Link>
  );
}
