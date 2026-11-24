// 라이더 관제(2026-11-17, PC 5 — ADR-0068): tracking `GET /rider-locations?mfcId=` — 운행 중 라이더의 지금 위치·끊김·진행 중 배송.
// RIDER_OPS·OPERATOR_ADMIN 만(서버 403), 10초마다 다시 불러오기, 이동 이력 없음. 지도는 VITE_KAKAO_JS_KEY 가 있을 때만(없으면 안내 + 표).
// 거르기(전체·배송 중·위치 끊김)는 주소 쿼리 filter.
// 2026-11-18: 관리자 화면 모양 — 머리말, 조건 상자(센터 + 보기 칩), 요약 카드(누르면 그 거르기), 지도 구역, 표(위치 상태 꼬리표).
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/delivery-tracking';
import { useApi } from '../../app/ApiContext';
import { useCenterScope } from '../../app/CenterScope';
import { AllDone, ChipGroup, PageHeader, StatusBadge } from '../../shared/admin';
import { RiderName } from '../../shared/displayNumbers';
import { isSimRider } from '../../shared/sim';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { CenterPicker, label, none, when } from '../../shared/opsUi';
import { ActiveDeliverySummary, ControlRiderPanel } from './ControlRiderPanel';
import { ControlSearch } from './ControlSearch';
import { RecentDeliveries } from './RecentDeliveries';
import { AutoCancelList, useBlockedAutoCancels } from '../stats/AutoCancelList';
import { useDropLocations } from './dropLocation';
import { CONTROL_REFRESH_MS } from './refresh';
import { KakaoRiderMap, type MapArea, type MapRider, type MapRoute } from './KakaoRiderMap';

const c = ops.control;
const n = messages.names;
export { CONTROL_REFRESH_MS };

/** 관제를 처음 열 때 고르는 센터 이름(띄어쓰기 무시) — 사용자 결정 2026-11-24 */
const DEFAULT_CENTER_NAME = '부산진구';

/** 이 화면에서만 쓰는 문구 */
const cx = {
  view: '보기',
  onDuty: '운행 중',
  delivering: '배송 중',
  waiting: '대기',
  staleOrNone: '위치 미확인',
  people: (k: number) => `${k}명`,
  map: '위치 지도',
  list: '라이더 목록',
  receiving: '수신 중',
  legend: { ok: '대기', delivering: '배송 중', stale: '끊김' },
  refresh: '10초마다 새로 불러와요',
  // 두 줄 카드(2026-11-19 통합 백오피스 실시간 배송 LiveBoards 처럼 — 위는 먼저 확인할 것, 아래는 진행 단계)
  firstTitle: '먼저 확인해 주세요',
  flowTitle: '진행 단계',
  dispatchOff: '신규배차 꺼짐',
  allClear: '지금 먼저 볼 라이더가 없어요',
  allClearBody: (k: number) => `운행 중 ${k}명 모두 위치가 들어오고 있고 신규배차를 받고 있어요.`,
  deliveries: (k: number) => `${k}건`,
  blocked: '자동 취소 막힘',
  blockedHint: '라이더가 없어 취소를 요청했지만 거절돼 아직 대기 중',
  late: '지연 배송',
  // 2026-11-24 사용자 "지연배송도 회색으로 20분 이상 이라고만" (서버 기준: 약속 + 20분을 넘겼거나 넘길 것으로 봄)
  lateHint: '20분 이상',
  lateTitle: (k: number) => `지연 배송 ${k}건 — 많이 늦은 순`,
  lateNone: '지금 지연 배송이 없어요.',
  lateOver: (m: number) => (m > 0 ? `약속보다 ${m}분 지남` : '곧 늦을 예정'),
  lateNoPromise: '약속 시각 모름',
  latePromised: (t: string) => `약속 ${t}`,
  basis: (riders: number, deliveries: number) => `이 센터 운행 중 라이더 ${riders}명·진행 중 배송 ${deliveries}건 기준(서버가 준 위치 목록). 배송 중 카드를 누르면 그 라이더만 보여요.`,
} as const;

const FLOW_STAGES = ['TO_STORE', 'AT_STORE', 'TO_CUSTOMER', 'AT_CUSTOMER'] as const;

type Filter = 'all' | 'delivering' | 'late' | 'stale' | 'dispatchOff' | 'sim';
type Rider = components['schemas']['ControlRider'];
type Active = Rider['activeDeliveries'][number];

// 거르기·지도 색은 서버 값으로만: stale(서버 3분 기준) 또는 위치 없음 = 끊김, 진행 중 배송 있음 = 배송 중.
const isStale = (r: Rider) => r.stale || !r.location;
const isDelivering = (r: Rider) => r.activeDeliveries.length > 0;
// 지연 = tracking delayed(예상 도착 또는 지금이 약속 + 20분을 넘음 — 2026-11-23 tracking 0.14.0)
const isLate = (r: Rider) => r.activeDeliveries.some((d) => d.delayed);

/** 지연 배송 한 줄 — 라이더와 배송, 약속에서 지난 분(서버 기준 시각 asOf 로 센다). 많이 늦은 것부터. */
type LateRow = { readonly rider: Rider; readonly active: Active; readonly overMinutes: number | null };

export function lateRows(all: readonly Rider[], asOf: string | undefined): LateRow[] {
  const now = asOf ? Date.parse(asOf) : Number.NaN;
  const rows = all.flatMap((rider) =>
    rider.activeDeliveries
      .filter((d) => d.delayed)
      .map((active) => {
        const promised = active.promisedAt ? Date.parse(active.promisedAt) : Number.NaN;
        const overMinutes = Number.isNaN(now) || Number.isNaN(promised) ? null : Math.floor((now - promised) / 60_000);
        return { rider, active, overMinutes };
      }),
  );
  return rows.sort((a, b) => (b.overMinutes ?? -Infinity) - (a.overMinutes ?? -Infinity));
}

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
  const filter: Filter = rawFilter === 'delivering' || rawFilter === 'late' || rawFilter === 'stale' || rawFilter === 'dispatchOff' || rawFilter === 'sim' ? rawFilter : 'all';
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
  // RS-7(2026-11-23): 머리줄에서 센터를 골랐으면 그 센터부터
  const scope = useCenterScope();
  // 2026-11-24 사용자 "왜 라이더 관제에 기본이 부산 남구야? … 기본은 부산 진구로 해" — 목록 첫 센터(부산 남구)가 아니라
  // 이름에 "부산진구"가 든 센터부터. 없으면(다른 환경) 전처럼 첫 센터.
  const centerItems = centers.data?.items ?? [];
  const firstCenter = scope.mfcId || (centerItems.find((c) => (c.name ?? '').replace(/\s/g, '').includes(DEFAULT_CENTER_NAME)) ?? centerItems[0])?.centerId;
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
  const boardRef = useRef<HTMLDivElement>(null);
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
  // 자동 취소 막힘(dispatch BLOCKED_OPEN, 1분마다) — 카드를 누르면 아래에 목록
  const blocked = useBlockedAutoCancels(mfcId);
  const [showBlocked, setShowBlocked] = useState(false);
  // 지연 목록에서 고르기 — 지연 거르기는 그대로 두고 그 라이더·배송을 연다
  const pickLate = useCallback(
    (riderId: string, deliveryId: string) =>
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set('rider', riderId);
        p.set('delivery', deliveryId);
        return p;
      }),
    [setParams],
  );
  // 고른 라이더 배송의 전달지 — 상세 칸과 같은 캐시(배송마다 한 번, 열람 기록)
  const selectedRider = (board.data?.items ?? []).find((r) => r.riderId === selectedId);
  const routeIds = selectedRider?.activeDeliveries.length ? selectedRider.activeDeliveries.map((d) => d.deliveryId) : focusDeliveryId && selectedId ? [focusDeliveryId] : [];
  const drops = useDropLocations(routeIds);
  // 대략 배송지(tracking dropArea, 2026-11-23 — 열람 기록 없음). 고른 라이더 배송은 정확한 전달지 핀이 있으니 원은 빼지 않고 함께(지연 색 보임)
  const areas: MapArea[] = (board.data?.items ?? []).flatMap((r) =>
    r.activeDeliveries.flatMap((d) => (d.dropArea?.lat != null && d.dropArea.lng != null ? [{ deliveryId: d.deliveryId, lat: d.dropArea.lat, lng: d.dropArea.lng, delayed: !!d.delayed }] : [])),
  );
  const routes: MapRoute[] = drops.flatMap((q, i) => (q.data?.lat != null && q.data.lng != null ? [{ deliveryId: routeIds[i] ?? '', drop: { lat: q.data.lat, lng: q.data.lng } }] : []));
  return (
    <section className="space-y-4">
      {/* 머리말 + 조건(한 줄): 찾기 · 센터 — 보기 거르기는 아래 라이더 목록 머리로 */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title={c.title} description={c.intro} />
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3" aria-label="관제 조건" role="group">
          <ControlSearch onFound={found} />
          <CenterPicker
            value={mfcId}
            onChange={(v) => {
              if (v) scope.setMfcId(v); // 머리줄 센터 고르기와 맞춘다(RS-7)
              setParams(v ? { mfcId: v } : {});
            }}
          />
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
            const items = all.filter((r) => (filter === 'delivering' ? isDelivering(r) : filter === 'late' ? isLate(r) : filter === 'stale' ? isStale(r) : filter === 'dispatchOff' ? r.newDispatchEnabled === false : filter === 'sim' ? isSimRider(r.riderId) : true));
            const late = lateRows(all, b.asOf);
            const mapRiders: MapRider[] = items.flatMap((r) =>
              r.location?.lat != null && r.location.lng != null
                ? [{ riderId: r.riderId, lat: r.location.lat, lng: r.location.lng, tone: isStale(r) ? 'stale' : isDelivering(r) ? 'delivering' : 'ok', label: r.riderNumber ?? [r.nameMasked, r.riderId.slice(-8)].filter(Boolean).join(' ') }]
                : [],
            );
            return (
              <div className="space-y-4">
                {/* 두 줄 카드 — 위: 먼저 확인(문제, 빨강·주황) / 아래: 진행 단계(› 화살표). 누르면 그 거르기(목록·지도가 함께 바뀐다) */}
                <ControlBoards
                  all={all}
                  filter={filter}
                  filterLink={filterLink}
                  asOf={b.asOf}
                  staleOrNone={staleOrNone}
                  delivering={delivering}
                  lateCount={late.length}
                  blockedCount={blocked.data ? blocked.data.items.length : null}
                  showBlocked={showBlocked}
                  onToggleBlocked={() => setShowBlocked((v) => !v)}
                />

                {/* 자동 취소 막힘(2026-11-24) — 카드를 누르면 건별 */}
                {showBlocked && <AutoCancelList mfcId={mfcId} open />}

                {/* 지연 거르기 — 지연 배송을 많이 늦은 순으로(2026-11-24 사용자 "지연 배송을 바로 볼 수 있는 기능"). 줄을 누르면 그 라이더·배송 */}
                {filter === 'late' && <LateDeliveries rows={late} selectedDeliveryId={focusDeliveryId} onPick={pickLate} />}

                {/* 작업 화면(배민 주문접수처럼): 왼쪽 라이더 목록 · 가운데 지도 · 오른쪽 고른 라이더 상세 — 한 화면에서 스크롤 없이 */}
                <div ref={boardRef} className="scroll-mt-4 grid gap-4 xl:h-[calc(100vh-17rem)] xl:min-h-[560px] xl:grid-cols-[20rem_minmax(0,1fr)_24rem]">
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
                      {/* 2026-11-24 사용자 "선택탭 2줄 되지 않게" — 작은 칩·짧은 이름으로 한 줄(넘치면 옆으로 밀기, 줄바꿈 없음) */}
                      <div className="overflow-x-auto [&_[role=radiogroup]]:flex-nowrap [&_[role=radio]]:whitespace-nowrap [&_[role=radio]]:px-2 [&_[role=radio]]:text-xs" data-testid="control-filter">
                        <ChipGroup
                          label={cx.view}
                          value={filter}
                          options={(['all', 'delivering', 'late', 'stale', 'dispatchOff', 'sim'] as const).map((f) => ({ value: f, label: c.filter[f] }))}
                          onChange={setFilter}
                        />
                      </div>
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
                            className={`cursor-pointer border-l-[3px] px-4 py-3 text-sm ${r.riderId === selectedId ? 'border-primary bg-primary/10' : isStale(r) ? 'border-error hover:bg-base-200/60' : 'border-transparent hover:bg-base-200/60'}`}
                            onClick={() => select(r.riderId)}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="flex min-w-0 flex-wrap items-center gap-1">
                                {/* 화면 번호(ADR-0070): "R4829"(가린 이름은 title, ADR-0085) */}
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
                    <KakaoRiderMap center={centerPoint} riders={mapRiders} onSelect={select} selectedId={selectedId} routes={routes} areas={areas} heightClass="h-full min-h-[420px]" />
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
                <RecentDeliveries
                  mfcId={mfcId}
                  selectedDeliveryId={focusDeliveryId}
                  onPick={(hit) => {
                    found({ ...hit, mfcId });
                    // 아래 목록에서 고르면 위(목록·지도·상세 칸)로 올려 바로 보이게(2026-11-21 사용자)
                    requestAnimationFrame(() => boardRef.current?.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
                  }}
                />
              </div>
            );
          }}
        </QueryState>
      )}
    </section>
  );
}

/**
 * 두 줄 카드(2026-11-19 — 통합 백오피스 LiveBoards·지침 §2 "라이더 관제에 바로 맞는 모양").
 * 수는 모두 이 센터 위치 목록(서버 GET /rider-locations)에서 센다 — 끊김은 서버 stale·위치 없음, 단계는 서버 stage.
 * 먼저 확인할 것이 모두 0 일 때만 "먼저 볼 라이더가 없어요"(읽는 중·실패면 이 칸을 그리지 않는다 — 부르는 쪽이 성공일 때만).
 */
function ControlBoards({
  all,
  filter,
  filterLink,
  asOf,
  staleOrNone,
  delivering,
  lateCount,
  blockedCount,
  showBlocked,
  onToggleBlocked,
}: {
  readonly all: readonly Rider[];
  readonly filter: Filter;
  readonly filterLink: (f: Filter) => string;
  readonly asOf: string | undefined;
  readonly staleOrNone: number;
  readonly delivering: number;
  readonly lateCount: number;
  readonly blockedCount: number | null;
  readonly showBlocked: boolean;
  readonly onToggleBlocked: () => void;
}) {
  const dispatchOff = all.filter((r) => r.newDispatchEnabled === false).length;
  const actives = all.flatMap((r) => r.activeDeliveries);
  const byStage = (st: string) => actives.filter((x) => x.stage === st).length;
  const waiting = all.filter((r) => !isDelivering(r) && !isStale(r)).length;
  const allClear = staleOrNone === 0 && dispatchOff === 0 && lateCount === 0 && !blockedCount;
  const flowCell = (key: string, text: string, value: string, to: string | null, active: boolean, last: boolean) => {
    const inner = (
      <>
        <span className="block text-sm font-semibold">{text}</span>
        {/* 0 은 흐리게(2026-11-21 라이더 시뮬레이터 모양 시범) — 값이 있는 단계만 눈에 띄게 */}
        <span className={`mt-1 block text-2xl font-bold tabular-nums ${/^0(\D|$)/.test(value) ? 'text-base-content/40' : ''}`}>{value}</span>
      </>
    );
    const cls = `block w-full rounded-box border px-4 py-3.5 text-left ${active ? 'border-primary bg-primary/5' : 'border-base-300 bg-base-100'}`;
    return (
      <li key={key} className="relative">
        {to ? (
          <Link to={to} aria-current={active ? 'true' : undefined} data-testid={`control-flow-${key}`} className={`${cls} transition hover:-translate-y-0.5`}>
            {inner}
          </Link>
        ) : (
          <div data-testid={`control-flow-${key}`} className={cls}>
            {inner}
          </div>
        )}
        {!last && (
          <span className="pointer-events-none absolute -right-2.5 top-1/2 z-10 hidden -translate-y-1/2 text-base-content/30 md:block" aria-hidden="true">
            ›
          </span>
        )}
      </li>
    );
  };
  return (
    <div className="space-y-4" data-testid="control-boards">
      <section aria-label={cx.firstTitle} className="space-y-2">
        <h2 className="text-sm font-bold">{cx.firstTitle}</h2>
        {allClear && all.length > 0 ? (
          <AllDone title={cx.allClear} body={cx.allClearBody(all.length)} testId="control-all-clear" />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label={cx.late} value={cx.deliveries(lateCount)} hint={cx.lateHint} to={filterLink('late')} active={filter === 'late'} dot="bg-error" alert={lateCount > 0} testId="control-stat-late" />
            {/* 2026-11-24 — 자동 취소가 거절돼 아직 배차 대기(dispatch BLOCKED_OPEN). 못 읽으면 칸을 그리지 않는다 */}
            {blockedCount !== null && <KpiTile label={cx.blocked} value={cx.deliveries(blockedCount)} hint={cx.blockedHint} onClick={onToggleBlocked} active={showBlocked} dot="bg-error" alert={blockedCount > 0} testId="control-stat-auto-cancel-blocked" />}
            <KpiTile label={cx.staleOrNone} value={cx.people(staleOrNone)} to={filterLink('stale')} active={filter === 'stale'} dot="bg-error" alert={staleOrNone > 0} testId="control-stat-stale" />
            {/* 2026-11-24 사용자 "신규배차 꺼짐은 왜 선택이 안 돼?" — 누르면 그 라이더들만(목록 거르기 "배차 꺼짐") */}
            <KpiTile label={cx.dispatchOff} value={cx.people(dispatchOff)} to={filterLink('dispatchOff')} active={filter === 'dispatchOff'} dot="bg-warning" warn={dispatchOff > 0} testId="control-stat-dispatch-off" />
          </div>
        )}
      </section>
      <section aria-label={cx.flowTitle} className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold">{cx.flowTitle}</h2>
          <Link to={filterLink('all')} className={`text-xs ${filter === 'all' ? 'font-semibold text-primary' : 'text-base-content/60 hover:text-base-content'}`} data-testid="control-stat-all">
            {cx.onDuty} {cx.people(all.length)} · {ops.dashboard.asOf(when(asOf))}
          </Link>
        </div>
        <ol className="grid grid-cols-2 gap-3 md:grid-cols-6" data-testid="control-flow">
          {flowCell('waiting', cx.waiting, cx.people(waiting), null, false, false)}
          {flowCell('delivering', cx.delivering, cx.people(delivering), filterLink('delivering'), filter === 'delivering', false)}
          {FLOW_STAGES.map((st, i) => flowCell(st, label(n.stage, st), cx.deliveries(byStage(st)), null, false, i === FLOW_STAGES.length - 1))}
        </ol>
        <p className="text-xs text-base-content/50">{cx.basis(all.length, actives.length)}</p>
      </section>
    </div>
  );
}

/** 관제 핵심 수 — 누르면 그 거르기. 고른 거르기는 테두리, 문제가 있으면 빨강 */
function KpiTile({ label: text, value, to, onClick, active = false, dot, alert = false, warn = false, hint, testId }: { readonly label: string; readonly value: string; readonly to?: string; readonly onClick?: () => void; readonly active?: boolean; readonly dot?: string; readonly alert?: boolean; readonly warn?: boolean; readonly hint?: string; readonly testId?: string }) {
  const cls = `flex items-center justify-between gap-3 rounded-box border px-5 py-3 ${active ? 'border-primary bg-primary/5' : 'border-base-300 bg-base-100'} ${to || onClick ? 'hover:border-primary' : ''}`;
  const body = (
    <>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm text-base-content/65">
          {dot && <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />}
          {text}
        </span>
        {hint && <span className="block text-[11px] text-base-content/45">{hint}</span>}
      </span>
      <span className={`shrink-0 whitespace-nowrap text-2xl font-bold tabular-nums ${alert ? 'text-error' : warn ? 'text-warning' : ''}`}>{value}</span>
    </>
  );
  return to ? (
    <Link to={to} className={cls} data-testid={testId} aria-current={active ? 'true' : undefined}>
      {body}
    </Link>
  ) : onClick ? (
    <button type="button" className={`${cls} w-full text-left`} data-testid={testId} aria-pressed={active} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls} data-testid={testId}>
      {body}
    </div>
  );
}

/** 지연 배송 목록(2026-11-24) — 이 센터 진행 중 배송 중 tracking delayed 인 것, 많이 늦은 순. 줄을 누르면 그 라이더·배송을 연다. */
function LateDeliveries({ rows, selectedDeliveryId, onPick }: { readonly rows: readonly LateRow[]; readonly selectedDeliveryId: string; readonly onPick: (riderId: string, deliveryId: string) => void }) {
  return (
    <section aria-label={cx.late} className="rounded-box border border-error/40 bg-base-100" data-testid="control-late">
      <h2 className="border-b border-base-300 px-4 py-3 font-bold">{cx.lateTitle(rows.length)}</h2>
      {rows.length === 0 ? (
        <p data-state="empty" className="p-4 text-sm text-base-content/60">
          {cx.lateNone}
        </p>
      ) : (
        <ul className="max-h-72 divide-y divide-base-200 overflow-y-auto">
          {rows.map(({ rider, active, overMinutes }) => (
            <li
              key={active.deliveryId}
              data-testid="control-late-row"
              aria-selected={active.deliveryId === selectedDeliveryId}
              className={`flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 border-l-[3px] px-4 py-2 text-sm ${active.deliveryId === selectedDeliveryId ? 'border-primary bg-primary/10' : 'border-error hover:bg-base-200/60'}`}
              onClick={() => onPick(rider.riderId, active.deliveryId)}
              // 키보드로도 고르기(PR #476 검토) — 줄 안에 배송 링크가 있어 button 으로 감싸지 않는다. 링크에서 누른 키는 링크 몫
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                e.preventDefault();
                onPick(rider.riderId, active.deliveryId);
              }}
            >
              <span className={`w-32 shrink-0 font-semibold tabular-nums ${overMinutes !== null && overMinutes > 0 ? 'text-error' : 'text-warning'}`}>{overMinutes === null ? cx.lateNoPromise : cx.lateOver(overMinutes)}</span>
              <RiderName riderId={rider.riderId} nameMasked={rider.nameMasked} riderNumber={rider.riderNumber} />
              <ActiveDeliverySummary active={active} />
              {active.promisedAt && <span className="text-xs text-base-content/55">{cx.latePromised(when(active.promisedAt))}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
