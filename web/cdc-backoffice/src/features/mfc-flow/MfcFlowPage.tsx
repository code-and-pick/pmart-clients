// MFC 재고 이동 — DC 에서 MFC 로 가는 물건이 지금 어디 있는지(사용자 2026-11-26 "mfc로의 실시간 재고이동을 바로 볼 수 있는 거").
// 다시 그림(사용자 2026-11-26 "UI가 하나도 직관적이지 않아. 복잡해"): 숫자 카드 5개·설명 문단·단계 × MFC 표 대신
//   ① 흐름 그림 한 줄(DC에서 준비 중 → 실을 준비 끝 → 차 타고 가는 중 → MFC), ② MFC 마다 한 줄 막대(어느 단계에 몇 건), ③ 최근 출발을 문장으로.
// 새 API 없이 기존 직원 조회만, 15초마다 다시 읽는다:
//   `GET /cdcs/{cdcId}/transfers?size=200`(TRF 단계·MFC) · `GET /cdcs/{cdcId}/departures?size=30`(출발 검증) · `GET /cdcs/{cdcId}/stock-snapshot`(transit = 출발했지만 MFC 가 아직 안 받은 수량).
// 단계는 TRF 상태(서버 값)로 나눈다. 못 읽으면 그 칸은 실패로(0 으로 꾸미지 않는다).
import { useQuery } from '@tanstack/react-query';
import { Fragment, useMemo } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/cdc-outbound';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { MfcName } from '../../shared/MfcName';
import { shortRef } from '../../shared/shortRef';
import { trfWavePath } from '../trf-wave/TrfWavePages';

const t = messages.mfcFlow;
type TransferSummary = components['schemas']['TransferSummary'];
type Stage = 'WAIT' | 'PICK' | 'READY' | 'DEPARTED';
/** 화면에 보이는 세 걸음 — 확보·대기와 Wave·피킹은 "DC에서 준비 중" 하나로 */
const STEPS = ['PREP', 'READY', 'GOING'] as const;
type Step = (typeof STEPS)[number];
const stepOf = (st: Stage): Step => (st === 'WAIT' || st === 'PICK' ? 'PREP' : st === 'READY' ? 'READY' : 'GOING');
const STEP_COLOR: Record<Step, string> = { PREP: 'bg-base-content/30', READY: 'bg-info', GOING: 'bg-success' };
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
const zero = (): Record<Step, Count> => ({ PREP: { n: 0, qty: 0 }, READY: { n: 0, qty: 0 }, GOING: { n: 0, qty: 0 } });

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
        {(data) => <FlowBody cdcId={cdcId} trfs={data.items} partial={data.hasNext} transit={transit} transitFailed={stock.isError} />}
      </QueryState>
      <RecentDepartures cdcId={cdcId} trfs={transfers.data?.items ?? []} />
    </section>
  );
}

function FlowBody({
  cdcId,
  trfs,
  partial,
  transit,
  transitFailed,
}: {
  readonly cdcId: string;
  readonly trfs: readonly TransferSummary[];
  readonly partial: boolean;
  readonly transit: number | null;
  readonly transitFailed: boolean;
}) {
  // MFC → 걸음별 TRF 수·수량(준비 중 = 승인 수량, 실을 준비·가는 중 = 피킹 수량)
  const rows = useMemo(() => {
    const m = new Map<string, Record<Step, Count>>();
    for (const x of trfs) {
      const st = stageOf(x.state);
      if (!st) continue;
      const step = stepOf(st);
      const row = m.get(x.mfcId) ?? zero();
      row[step].n += 1;
      row[step].qty += step === 'PREP' ? x.approvedQty : x.pickedQty;
      m.set(x.mfcId, row);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [trfs]);
  const total = (s: Step) => rows.reduce((a, [, r]) => ({ n: a.n + r[s].n, qty: a.qty + r[s].qty }), { n: 0, qty: 0 });
  return (
    <div className="space-y-5">
      {/* ① 흐름 그림 — 왼쪽에서 오른쪽으로 */}
      <ol className="flex flex-col items-stretch gap-2 md:flex-row md:items-center" data-testid="flow-stages">
        {STEPS.map((s) => {
          const c = total(s);
          const big = s === 'GOING' ? (transit === null ? (transitFailed ? messages.loadFailed : '…') : t.units(transit)) : t.trfs(c.n);
          const small = s === 'GOING' ? t.goingSub(c.n) : t.units(c.qty);
          return (
            <Fragment key={s}>
              <li className={`flex-1 rounded-box border p-4 ${c.n > 0 || (s === 'GOING' && (transit ?? 0) > 0) ? 'border-base-300 bg-base-100' : 'border-dashed border-base-300'}`} data-testid={`flow-step-${s}`}>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span aria-hidden className={`inline-block size-2.5 rounded-full ${STEP_COLOR[s]}`} />
                  {t.steps[s]}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{big}</p>
                <p className="text-xs text-base-content/60">{small}</p>
              </li>
              <li aria-hidden className="hidden text-2xl text-base-content/30 md:block">
                →
              </li>
            </Fragment>
          );
        })}
        <li className="rounded-box border border-base-300 bg-base-200/60 px-5 py-4 text-center text-sm font-semibold md:self-stretch md:flex md:items-center">{t.arrive}</li>
      </ol>
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
              <li key={mfcId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-testid="flow-row">
                <Link className="link w-36 shrink-0 font-semibold" to={`${centerPath(cdcId, 'trf-wave')}?mfcId=${encodeURIComponent(mfcId)}`}>
                  <MfcName id={mfcId} />
                </Link>
                <div className="flex h-3 min-w-40 flex-1 overflow-hidden rounded-full bg-base-200" aria-hidden>
                  {STEPS.map((s) => (r[s].n > 0 ? <span key={s} className={STEP_COLOR[s]} style={{ width: `${(r[s].n / all) * 100}%` }} /> : null))}
                </div>
                <p className="text-sm text-base-content/80" data-testid="flow-row-text">
                  {t.rowText(all, r.PREP.n, r.READY.n, r.GOING.n)}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** ③ 최근 출발 — "언제 · 어느 MFC 로 · 몇 개 · 차량 · 맞았는지" 한 문장 */
function RecentDepartures({ cdcId, trfs }: { readonly cdcId: string; readonly trfs: readonly TransferSummary[] }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'departures', 'flow'],
    refetchInterval: REFRESH,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/departures', { params: { path: { cdcId }, query: { size: 30 } } })),
  });
  const byTrf = useMemo(() => new Map(trfs.map((x) => [x.trfId, x])), [trfs]);
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{t.recent}</h2>
      <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={t.recentEmpty}>
        {(d) => (
          <ol className="divide-y divide-base-300 rounded-box border border-base-300 bg-base-100" data-testid="flow-recent">
            {d.items.map((dep) => (
              <Fragment key={dep.departureId}>
                {(dep.transfers ?? []).map((x) => {
                  const trf = x.trfId ? byTrf.get(x.trfId) : undefined;
                  const ok = x.result === 'MATCHED';
                  return (
                    <li key={`${dep.departureId}-${x.trfId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm" data-testid="flow-recent-row">
                      <span className="shrink-0 whitespace-nowrap text-base-content/60">{dep.validatedAt ? formatSeoul(dep.validatedAt) : messages.none}</span>
                      <span className="font-semibold">
                        <DepartureMfc cdcId={cdcId} trfId={x.trfId ?? ''} known={trf?.mfcId} />
                      </span>
                      <span>{t.sentLine(x.departedQty ?? 0)}</span>
                      <span className={ok ? 'text-success' : 'text-error'}>{ok ? t.okLoad : t.badLoad}</span>
                      <span className="ml-auto flex items-center gap-3 text-xs text-base-content/55">
                        {dep.vehicleId && <span>{`${messages.shipping.vehicle} ${dep.vehicleId}`}</span>}
                        <Link className="link font-mono" to={trfWavePath(cdcId, `trf/${encodeURIComponent(x.trfId ?? '')}`)} title={x.trfId}>
                          {x.trfNumber ?? trf?.trfNumber ?? shortRef(x.trfId)}
                        </Link>
                      </span>
                    </li>
                  );
                })}
              </Fragment>
            ))}
          </ol>
        )}
      </QueryState>
    </section>
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
