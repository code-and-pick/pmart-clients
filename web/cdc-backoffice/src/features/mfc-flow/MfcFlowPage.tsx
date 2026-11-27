// MFC 재고 이동 — DC 에서 MFC 로 가는 물건이 지금 어디 있는지(사용자 2026-11-26 "mfc로의 실시간 재고이동을 바로 볼 수 있는 거").
// 다시 그림(사용자 2026-11-26 "UI가 하나도 직관적이지 않아. 복잡해"): 숫자 카드 5개·설명 문단·단계 × MFC 표 대신
//   ① 흐름 그림 한 줄(DC에서 준비 중 → 실을 준비 끝 → 차 타고 가는 중 → MFC), ② MFC 마다 한 줄 막대(어느 단계에 몇 건), ③ 최근 출발을 문장으로.
// 새 API 없이 기존 직원 조회만, 15초마다 다시 읽는다:
//   `GET /cdcs/{cdcId}/transfers?size=200`(TRF 단계·MFC) · `GET /cdcs/{cdcId}/departures?size=30`(출발 검증) · `GET /cdcs/{cdcId}/stock-snapshot`(transit = 출발했지만 MFC 가 아직 안 받은 수량).
// (2026-11-27 사용자 "mfc랑 재고 연동되는 거 실시간으로") 넷째 걸음 "MFC 도착·인계" — 운행 정차(transport-execution trips, 오늘·어제 출고일)의 도착·인계 대조.
//   TRF 마다 실린 정차를 찾아 "가는 중·도착 예정 / MFC 도착 / 인계 끝·박스 받은/보낸" 을 붙인다. MFC 재고 반영(수령 확정)은 DC 가 볼 조회가 없어 인계까지(요청 MF-1).
// 단계는 TRF 상태(서버 값)로 나눈다. 못 읽으면 그 칸은 실패로(0 으로 꾸미지 않는다).
import { useQuery } from '@tanstack/react-query';
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/cdc-outbound';
import { todaySeoul } from '../transport/TransportPage';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { MfcName } from '../../shared/MfcName';
import { shortRef } from '../../shared/shortRef';
import { SkuName } from '../../shared/SkuName';
import { trfWavePath } from '../trf-wave/TrfWavePages';
import { mfcSideOf, useTripStops, type StopOfTrf, type TripStops } from './tripStops';

const t = messages.mfcFlow;
type TransferSummary = components['schemas']['TransferSummary'];
type Stage = 'WAIT' | 'PICK' | 'READY' | 'DEPARTED';
/** 화면에 보이는 세 걸음 — 확보·대기와 Wave·피킹은 "DC에서 준비 중" 하나로 */
const STEPS = ['PREP', 'READY', 'GOING', 'DONE'] as const;
type Step = (typeof STEPS)[number];
const stepOf = (st: Stage, at: StopOfTrf | undefined): Step =>
  st === 'WAIT' || st === 'PICK' ? 'PREP' : st === 'READY' ? 'READY' : at && mfcSideOf(at.stop) === 'HANDED_OVER' ? 'DONE' : 'GOING';
const STEP_COLOR: Record<Step, string> = { PREP: 'bg-base-content/30', READY: 'bg-secondary', GOING: 'bg-info', DONE: 'bg-success' };
const REFRESH = 15_000;

/** TRF 상태 → 단계(취소는 빼고) */
export function stageOf(state: string): Stage | null {
  if (state === 'CANCELLED') return null;
  if (state === 'IN_WAVE' || state === 'PICKING') return 'PICK';
  if (state === 'PICKED' || state === 'SORTED' || state === 'INSPECTED' || state === 'LOADED' || state === 'MISMATCHED') return 'READY';
  if (state === 'DEPARTED') return 'DEPARTED';
  return 'WAIT';
}

type Count = { n: number; qty: number };
const zero = (): Record<Step, Count> => ({ PREP: { n: 0, qty: 0 }, READY: { n: 0, qty: 0 }, GOING: { n: 0, qty: 0 }, DONE: { n: 0, qty: 0 } });

/** `/c/:cdcId/mfc-flow` */
export function MfcFlowMenu({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const transfers = useQuery({
    queryKey: ['cdc', cdcId, 'transfers', 'flow'],
    refetchInterval: REFRESH,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/transfers', { params: { path: { cdcId }, query: { size: 200 } } })),
  });
  const stock = useQuery({
    queryKey: ['cdc', cdcId, 'stock', '', 'flow'],
    refetchInterval: REFRESH,
    queryFn: () => request('GET', api.inventory.GET('/cdcs/{cdcId}/stock-snapshot', { params: { path: { cdcId } } })),
  });
  const stops = useTripStops(cdcId, REFRESH);
  const transit = stock.data ? (stock.data.items ?? []).reduce((a, s) => a + (s.transit ?? 0), 0) : null;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1>{messages.menus.mfcFlow}</h1>
          <p className="text-sm text-base-content/60">{t.lead}</p>
        </div>
        {transfers.dataUpdatedAt > 0 && <span className="text-xs text-base-content/55">{t.asOf(formatSeoul(new Date(transfers.dataUpdatedAt).toISOString()))}</span>}
      </div>
      <QueryState state={toUiState(transfers, (d) => d.items.length === 0)} onRetry={() => void transfers.refetch()} emptyText={t.noTrf}>
        {(data) => <FlowBody cdcId={cdcId} trfs={data.items} partial={data.hasNext} transit={transit} transitFailed={stock.isError} stops={stops} />}
      </QueryState>
      <RecentDepartures cdcId={cdcId} trfs={transfers.data?.items ?? []} stops={stops} />
      <p role="note" className="text-xs text-base-content/55">
        {t.receiptNote}
      </p>
    </section>
  );
}

function FlowBody({
  cdcId,
  trfs,
  partial,
  transit,
  transitFailed,
  stops,
}: {
  readonly cdcId: string;
  readonly trfs: readonly TransferSummary[];
  readonly partial: boolean;
  readonly transit: number | null;
  readonly transitFailed: boolean;
  readonly stops: TripStops;
}) {
  // MFC → 걸음별 TRF 수·수량(준비 중 = 승인 수량, 실을 준비·가는 중 = 피킹 수량)
  const rows = useMemo(() => {
    const m = new Map<string, Record<Step, Count>>();
    for (const x of trfs) {
      const st = stageOf(x.state);
      if (!st) continue;
      const step = stepOf(st, stops.byTrf.get(x.trfId));
      const row = m.get(x.mfcId) ?? zero();
      row[step].n += 1;
      row[step].qty += step === 'PREP' ? x.approvedQty : x.pickedQty;
      m.set(x.mfcId, row);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [trfs, stops.byTrf]);
  // 넷째 걸음 — 오늘·어제 출고일 운행에서 MFC 가 인계받은 정차(박스 받은/보낸)
  const today = todaySeoul();
  const seoulDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(iso));
  const handed = stops.trips.flatMap((tr) => tr.stops.filter((sp) => mfcSideOf(sp) === 'HANDED_OVER' && !!sp.handedOverAt && seoulDay(sp.handedOverAt) === today));
  const recvBoxes = handed.reduce((a, sp) => a + (sp.handover?.receivedBoxes ?? 0), 0);
  const sentBoxes = handed.reduce((a, sp) => a + (sp.handover?.shippedBoxes ?? 0), 0);
  const arrivedNotHanded = stops.trips.flatMap((tr) => tr.stops.filter((sp) => mfcSideOf(sp) === 'ARRIVED')).length;
  const total = (s: Step) => rows.reduce((a, [, r]) => ({ n: a.n + r[s].n, qty: a.qty + r[s].qty }), { n: 0, qty: 0 });
  return (
    <div className="space-y-5">
      {/* ① 흐름 그림 — 왼쪽에서 오른쪽으로 */}
      <ol className="flex flex-col items-stretch gap-2 md:flex-row md:items-center" data-testid="flow-stages">
        {STEPS.map((s) => {
          const c = total(s);
          const big =
            s === 'GOING'
              ? transit === null
                ? transitFailed
                  ? messages.loadFailed
                  : '…'
                : t.units(transit)
              : s === 'DONE'
                ? stops.failed
                  ? messages.loadFailed
                  : stops.loading
                    ? '…'
                    : t.stopsDone(handed.length)
                : t.trfs(c.n);
          const small = s === 'GOING' ? t.goingSub(c.n) : s === 'DONE' ? t.doneSub(recvBoxes, sentBoxes, arrivedNotHanded) : t.units(c.qty);
          const live = c.n > 0 || (s === 'GOING' && (transit ?? 0) > 0) || (s === 'DONE' && handed.length > 0);
          return (
            <Fragment key={s}>
              <li className={`flex-1 rounded-box border p-4 ${live ? 'border-base-300 bg-base-100' : 'border-dashed border-base-300'}`} data-testid={`flow-step-${s}`}>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span aria-hidden className={`inline-block size-2.5 rounded-full ${STEP_COLOR[s]}`} />
                  {t.steps[s]}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{big}</p>
                <p className="text-xs text-base-content/60">{small}</p>
              </li>
              {s !== 'DONE' && (
                <li aria-hidden className="hidden text-2xl text-base-content/30 md:block">
                  →
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
      <p className="text-xs text-base-content/60" data-testid="flow-stock-line">
        {t.stockLine}
      </p>
      {partial && (
        <p role="note" className="text-xs text-warning">
          {t.partial}
        </p>
      )}

      {/* ② MFC 마다 한 줄 */}
      <div className="space-y-2">
        <h2 className="text-base font-semibold">{t.byMfc}</h2>
        <ul className="divide-y divide-base-300 rounded-box border border-base-300 bg-base-100" data-testid="flow-table">
          {rows.map(([mfcId, r]) => {
            const all = STEPS.reduce((a, s) => a + r[s].n, 0);
            return (
              <li key={mfcId} data-testid="flow-row">
                <Link className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-base-200" to={`${centerPath(cdcId, 'trf-wave')}?mfcId=${encodeURIComponent(mfcId)}`} title={t.rowLinkTitle}>
                <span className="w-36 shrink-0 font-semibold">
                  <MfcName id={mfcId} />
                </span>
                <div className="flex h-3 min-w-40 flex-1 overflow-hidden rounded-full bg-base-200" aria-hidden>
                  {STEPS.map((s) => (r[s].n > 0 ? <span key={s} className={STEP_COLOR[s]} style={{ width: `${(r[s].n / all) * 100}%` }} /> : null))}
                </div>
                <p className="text-sm text-base-content/80" data-testid="flow-row-text">
                  {t.rowText(all, r.PREP.n, r.READY.n, r.GOING.n, r.DONE.n)}
                  <span aria-hidden className="ml-2 text-base-content/40">
                    ›
                  </span>
                </p>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** ③ 최근 출발 — "언제 · 어느 MFC 로 · 몇 개 · 차량 · 맞았는지" 한 문장 */
function RecentDepartures({ cdcId, trfs, stops }: { readonly cdcId: string; readonly trfs: readonly TransferSummary[]; readonly stops: TripStops }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'departures', 'flow'],
    refetchInterval: REFRESH,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/departures', { params: { path: { cdcId }, query: { size: 30 } } })),
  });
  const byTrf = useMemo(() => new Map(trfs.map((x) => [x.trfId, x])), [trfs]);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{t.recent}</h2>
      <p className="text-xs text-base-content/55">{t.recentHint}</p>
      <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={t.recentEmpty}>
        {(d) => (
          <ol className="divide-y divide-base-300 rounded-box border border-base-300 bg-base-100" data-testid="flow-recent">
            {d.items.map((dep) => (
              <Fragment key={dep.departureId}>
                {(dep.transfers ?? []).map((x) => (
                  <DepartureRow
                    key={`${dep.departureId}-${x.trfId}`}
                    cdcId={cdcId}
                    dep={dep}
                    x={x}
                    trf={x.trfId ? byTrf.get(x.trfId) : undefined}
                    stops={stops}
                    open={open === `${dep.departureId}-${x.trfId}`}
                    onToggle={() => setOpen(open === `${dep.departureId}-${x.trfId}` ? null : `${dep.departureId}-${x.trfId}`)}
                  />
                ))}
              </Fragment>
            ))}
          </ol>
        )}
      </QueryState>
    </section>
  );
}

type Departure = components['schemas']['DepartureValidation'];
type DepTrf = NonNullable<Departure['transfers']>[number];

/**
 * 최근 출발 한 줄(사용자 2026-11-27 "이거 목록 클릭하게 해") — 누르면 그 출발의 DC → MFC 과정을 펼친다:
 * DC 출발 → (도착 예정) → MFC 도착 → MFC 인계(받은 사람·박스·빠진 LPN), 그리고 TRF·출발 검증·운행으로 가는 길.
 * 운행은 오늘·어제 출고일 목록에서 TRF 로 찾고, 없으면 출발의 tripId 로 운행 하나를 읽는다(그 밖의 출고일 운행).
 */
function DepartureRow({
  cdcId,
  dep,
  x,
  trf,
  stops,
  open,
  onToggle,
}: {
  readonly cdcId: string;
  readonly dep: Departure;
  readonly x: DepTrf;
  readonly trf: TransferSummary | undefined;
  readonly stops: TripStops;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const api = useApi();
  const listed = x.trfId ? stops.byTrf.get(x.trfId) : undefined;
  const tripId = dep.tripId ?? '';
  const one = useQuery({
    queryKey: ['cdc', cdcId, 'trip', tripId],
    enabled: !listed && !stops.loading && !!tripId,
    refetchInterval: REFRESH,
    queryFn: () => request('GET', api.transportExecution.GET('/trips/{tripId}', { params: { path: { tripId } } })),
  });
  const at: StopOfTrf | undefined =
    listed ??
    (one.data
      ? (() => {
          const stop = one.data.stops.find((sp) => (sp.trfIds ?? []).includes(x.trfId ?? ''));
          return stop ? { trip: one.data, stop } : undefined;
        })()
      : undefined);
  const ok = x.result === 'MATCHED';
  const trfLabel = x.trfNumber ?? trf?.trfNumber ?? shortRef(x.trfId);
  return (
    <li data-testid="flow-recent-row">
      <button type="button" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm hover:bg-base-200" onClick={onToggle} aria-expanded={open}>
        <span aria-hidden className="w-3 text-base-content/50">
          {open ? '▾' : '▸'}
        </span>
        <span className="shrink-0 whitespace-nowrap text-base-content/60">{dep.validatedAt ? formatSeoul(dep.validatedAt) : messages.none}</span>
        <span className="font-semibold">
          <DepartureMfc cdcId={cdcId} trfId={x.trfId ?? ''} known={trf?.mfcId ?? at?.stop.mfcId} />
        </span>
        <span>{t.sentLine(x.departedQty ?? 0)}</span>
        <span className={ok ? 'text-success' : 'text-error'}>{ok ? t.okLoad : t.badLoad}</span>
        <MfcSideChip at={at} loading={stops.loading || one.isFetching} failed={stops.failed && one.isError} />
        <span className="ml-auto flex items-center gap-3 text-xs text-base-content/55">
          {dep.vehicleId && <span>{`${messages.shipping.vehicle} ${dep.vehicleId}`}</span>}
          <span className="font-mono" title={x.trfId}>
            {trfLabel}
          </span>
        </span>
      </button>
      {open && <DepartureDetail cdcId={cdcId} dep={dep} x={x} at={at} trfLabel={trfLabel} />}
    </li>
  );
}

/** 이 TRF 로 보낸 상품(상품명·SKU·보낸 수량 = 피킹 수량·부족) — TRF 상세(cdc-outbound) 줄 */
function SentLines({ cdcId, trfId }: { readonly cdcId: string; readonly trfId: string }) {
  const api = useApi();
  const q = useQuery({
    queryKey: ['cdc', cdcId, 'transfer', trfId],
    staleTime: 60_000,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/transfers/{trfId}', { params: { path: { cdcId, trfId } } })),
  });
  return (
    <QueryState state={toUiState(q, (d) => d.lines.length === 0)} onRetry={() => void q.refetch()} emptyText={t.detail.noLines}>
      {(d) => (
        <table className="table table-sm rounded-box bg-base-100" data-testid="flow-recent-lines">
          <thead>
            <tr>
              <th>{t.detail.product}</th>
              <th className="text-right">{t.detail.sentQty}</th>
              <th className="text-right">{t.detail.shortQty}</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.sku}>
                <td>
                  <SkuName sku={l.sku} />
                </td>
                <td className="text-right tabular-nums">{messages.qty(l.pickedQty)}</td>
                <td className={`text-right tabular-nums ${l.shortQty > 0 ? 'text-error' : ''}`}>{messages.qty(l.shortQty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </QueryState>
  );
}

/** 펼친 출발 — 시각 줄(DC 출발·도착 예정·MFC 도착·MFC 인계)과 인계 대조, 가는 길 */
function DepartureDetail({ cdcId, dep, x, at, trfLabel }: { readonly cdcId: string; readonly dep: Departure; readonly x: DepTrf; readonly at: StopOfTrf | undefined; readonly trfLabel: string }) {
  const d = t.detail;
  const stop = at?.stop;
  const h = stop?.handover;
  const hm = (iso: string | null | undefined) => (iso ? formatSeoul(iso) : null);
  const points: { key: string; label: string; time: string | null; done: boolean }[] = [
    { key: 'dep', label: d.departed, time: hm(at?.trip.departedAt ?? dep.validatedAt), done: true },
    { key: 'eta', label: d.eta, time: hm(stop?.estimatedArrivalAt ?? stop?.plannedArrivalAt), done: !!stop?.arrivedAt },
    { key: 'arr', label: d.arrived, time: hm(stop?.arrivedAt), done: !!stop?.arrivedAt },
    { key: 'ho', label: d.handed, time: hm(stop?.handedOverAt), done: !!stop && mfcSideOf(stop) === 'HANDED_OVER' },
  ];
  const missing = [...(h?.missingLpns ?? []), ...(h?.damagedLpns ?? [])];
  const shipDate = at?.trip.shipDate ?? todaySeoul();
  return (
    <div className="space-y-3 border-t border-base-300 bg-base-200/40 px-4 py-3 text-sm" data-testid="flow-recent-detail">
      <ol className="flex flex-wrap items-start gap-x-2 gap-y-2">
        {points.map((pt, i) => (
          <li key={pt.key} className="flex items-center gap-2">
            <span className={`flex flex-col rounded-box px-3 py-1.5 ${pt.done ? 'bg-success/15' : 'bg-base-100'}`}>
              <span className={`text-xs ${pt.done ? 'text-success' : 'text-base-content/60'}`}>
                {pt.done ? '✓ ' : ''}
                {pt.label}
              </span>
              <span className="font-medium tabular-nums">{pt.time ?? messages.none}</span>
            </span>
            {i < points.length - 1 && <span className="text-base-content/30">→</span>}
          </li>
        ))}
      </ol>
      {!at ? (
        <p className="text-xs text-base-content/60">{d.noTrip}</p>
      ) : (
        <p data-testid="flow-recent-story">
          {d.story(at.trip.plateNo ?? at.trip.vehicleId ?? dep.vehicleId ?? messages.none, at.trip.driverName ?? null, stop?.seq ?? null, at.trip.stops.length)}
          {h && ` ${d.handover(h.receiverName ?? null, h.receivedBoxes ?? 0, h.shippedBoxes ?? 0)}`}
          {stop?.delayed && <span className="text-error">{` ${d.late}`}</span>}
        </p>
      )}
      {x.trfId && <SentLines cdcId={cdcId} trfId={x.trfId} />}
      {missing.length > 0 && (
        <p className="text-xs text-warning" data-testid="flow-recent-missing">
          {d.missing(h?.missingLpns ?? [], h?.damagedLpns ?? [])}
        </p>
      )}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <Link className="link" to={trfWavePath(cdcId, `trf/${encodeURIComponent(x.trfId ?? '')}`)}>
          {d.toTrf(trfLabel)}
        </Link>
        <Link className="link" to={centerPath(cdcId, 'shipping')}>
          {d.toDeparture(dep.departureNumber ?? shortRef(dep.departureId))}
        </Link>
        {at && (
          <Link className="link" to={`${centerPath(cdcId, 'transport')}?date=${shipDate}`}>
            {d.toTrip(at.trip.tripId)}
          </Link>
        )}
      </p>
    </div>
  );
}

/** 받는 MFC — 오늘 TRF 목록에 없는(지난 날) TRF 는 TRF 상세에서 찾는다(출발 검증 응답에는 MFC 가 없다) */
function DepartureMfc({ cdcId, trfId, known }: { readonly cdcId: string; readonly trfId: string; readonly known: string | undefined }) {
  const api = useApi();
  const q = useQuery({
    queryKey: ['cdc', cdcId, 'transfer', trfId],
    enabled: !known && !!trfId,
    staleTime: 5 * 60_000,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/transfers/{trfId}', { params: { path: { cdcId, trfId } } })),
  });
  const id = known ?? q.data?.mfcId;
  return id ? (
    <>
      <MfcName id={id} />
      {t.toward}
    </>
  ) : (
    <span className="text-base-content/50">{q.isError ? t.unknownMfc : messages.none}</span>
  );
}

/** 출발한 TRF 의 MFC 쪽 — 가는 중(도착 예정) / MFC 도착(인계 전) / 인계 끝(박스 받은/보낸, 빠진·파손) */
function MfcSideChip({ at, loading, failed }: { readonly at: StopOfTrf | undefined; readonly loading: boolean; readonly failed: boolean }) {
  if (!at) return <span className="text-xs text-base-content/50">{loading ? '…' : failed ? t.side.failed : t.side.noTrip}</span>;
  const { stop } = at;
  const side = mfcSideOf(stop);
  const hm = (iso: string | null | undefined) => (iso ? formatSeoul(iso) : messages.none);
  if (side === 'HANDED_OVER') {
    const h = stop.handover;
    const bad = h?.result === 'MISMATCHED';
    return (
      <span className={`badge badge-sm ${bad ? 'badge-warning' : 'badge-success'}`} data-testid="mfc-side" title={h?.receiverName ?? undefined}>
        {t.side.handed(hm(stop.handedOverAt), h?.receivedBoxes ?? null, h?.shippedBoxes ?? null)}
        {bad && ` · ${t.side.short((h?.missingLpns?.length ?? 0) + (h?.damagedLpns?.length ?? 0))}`}
      </span>
    );
  }
  if (side === 'ARRIVED')
    return (
      <span className="badge badge-sm badge-info" data-testid="mfc-side">
        {t.side.arrived(hm(stop.arrivedAt))}
      </span>
    );
  const eta = stop.estimatedArrivalAt ?? stop.plannedArrivalAt;
  return (
    <span className={`badge badge-sm badge-outline ${stop.delayed ? 'text-error' : ''}`} data-testid="mfc-side">
      {t.side.onWay(hm(eta), Boolean(stop.delayed))}
    </span>
  );
}
