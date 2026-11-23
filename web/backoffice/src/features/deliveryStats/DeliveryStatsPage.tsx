// 배송 운영 통계(2026-11-23 — 라이더 백엔드 요청 "라이더 백오피스에 넣은 배송·라이더 기능을 통합 백오피스 화면에도", 참고 rider-backoffice StatsPage #400).
// 원천: execution 0.38.0 `GET /delivery-metrics`(배정일 × 센터 × 라이더 묶음, 사고 = 도움요청 종류별),
//       dispatch 0.16.0 `GET /metrics/dispatch`(생성일 × 센터 배차 효율·실패 사유), `GET /metrics/on-time-deliveries`(정시 배송률 — 관리자가 아니면 센터 필수).
// 관리자·라이더 운영·상담원은 모든 센터(그 밖은 센터 필수 — 이 메뉴는 그 셋에게만). 센터는 머리줄 센터 고르기. 최대 31일.
// 평균은 서버가 준 건수(*Count·assigned)로 가중해 다시 낸다(표시만). 직원 수동 배차는 없다(배정 출처 = AI 추천·배달리스트·실패 반납).
// 조회 실패를 0 으로 보이지 않는다 — 배송 통계 실패면 숫자 대신 오류, 배차 통계만 실패면 그 칸에만 안내.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { DataTable, Notice, PageHeader, Section, StatCard, StatStrip } from '../../shared/admin';
import { useCenterName, useCenterScope, useScopeCenters } from '../../shared/centerScope';
import { RiderLabel } from '../../shared/displayNumber';
import { messages } from '../../shared/messages';
import { useRiderLabels } from '../../shared/numberLookups';
import { addSeoulDays, label, seoulToday } from '../../shared/ops';

const s = messages.deliveryStats;

type Range = 'today' | 'd7' | 'd30';
const DAYS: Record<Range, number> = { today: 1, d7: 7, d30: 30 };

export interface ExecRow {
  readonly date: string;
  readonly mfcId: string;
  readonly riderId: string;
  readonly assigned: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly late: number;
  readonly judged: number;
  readonly pickupWaitSeconds?: number | null;
  readonly pickupWaitCount: number;
  readonly deliverySeconds?: number | null;
  readonly deliveryCount: number;
}
interface DispRow {
  readonly date: string;
  readonly mfcId: string;
  readonly created: number;
  readonly assigned: number;
  readonly avgAssignSeconds?: number | null;
  readonly reassigned: number;
  readonly autoCancelled: number;
  readonly offersSent: number;
  readonly offersAccepted: number;
  readonly assignedByAi: number;
  readonly assignedByList: number;
  readonly assignedByFailedReturn: number;
}

/** 초 → "N초·N분·N시간 N분", 값 없으면 — */
export function dur(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  const x = Math.max(0, Math.round(sec));
  if (x < 60) return `${x}초`;
  const mi = Math.round(x / 60);
  if (mi < 60) return `${mi}분`;
  const h = Math.floor(mi / 60);
  return mi % 60 ? `${h}시간 ${mi % 60}분` : `${h}시간`;
}
export const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 1000) / 10}%` : '—');
/** 가중 평균(초) — 값이 없는 묶음은 건너뛴다 */
function wavg<T>(rows: readonly T[], value: (r: T) => number | null | undefined, weight: (r: T) => number): number | null {
  let sum = 0;
  let w = 0;
  for (const r of rows) {
    const v = value(r);
    const k = weight(r);
    if (v === null || v === undefined || k <= 0) continue;
    sum += v * k;
    w += k;
  }
  return w > 0 ? sum / w : null;
}
const total = <T,>(rows: readonly T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0);

export interface Agg {
  readonly assigned: number;
  readonly completed: number;
  readonly failed: number;
  readonly late: number;
  readonly judged: number;
  readonly delivery: number | null;
  readonly pickupWait: number | null;
  readonly riders: number;
  readonly deliveryCount: number;
  readonly pickupWaitCount: number;
}
export function agg(rows: readonly ExecRow[]): Agg {
  return {
    assigned: total(rows, (r) => r.assigned),
    completed: total(rows, (r) => r.completed),
    failed: total(rows, (r) => r.failed),
    late: total(rows, (r) => r.late),
    judged: total(rows, (r) => r.judged),
    delivery: wavg(rows, (r) => r.deliverySeconds, (r) => r.deliveryCount),
    pickupWait: wavg(rows, (r) => r.pickupWaitSeconds, (r) => r.pickupWaitCount),
    riders: new Set(rows.map((r) => r.riderId)).size,
    deliveryCount: total(rows, (r) => r.deliveryCount),
    pickupWaitCount: total(rows, (r) => r.pickupWaitCount),
  };
}
function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

export function DeliveryStatsPage() {
  const api = useApi();
  const { session } = useSession();
  const centerId = useCenterScope();
  const centerName = useCenterName(centerId);
  const centers = useScopeCenters();
  const nameOf = (id: string) => centers.data?.find((c) => c.centerId === id)?.name ?? id;
  const [range, setRange] = useState<Range>('d7');
  // 화면을 연 날 기준(렌더마다 바뀌지 않게)
  const [today] = useState(() => seoulToday());
  const to = today;
  const from = addSeoulDays(today, -(DAYS[range] - 1));
  const query = { from, to, ...(centerId ? { mfcId: centerId } : {}) };
  const exec = useQuery({
    queryKey: ['delivery-stats', 'delivery-metrics', from, to, centerId],
    queryFn: () => request('GET', api.execution.GET('/delivery-metrics', { params: { query } })),
  });
  const disp = useQuery({
    queryKey: ['delivery-stats', 'dispatch-metrics', from, to, centerId],
    queryFn: () => request('GET', api.dispatch.GET('/metrics/dispatch', { params: { query } })),
  });
  // 정시 배송률 — 관리자가 아니면 센터를 골라야 서버가 준다(부르지 않고 "센터를 고르면")
  const admin = session?.roles.includes('OPERATOR_ADMIN') ?? false;
  const onTime = useQuery({
    queryKey: ['delivery-stats', 'on-time', from, to, centerId],
    enabled: admin || !!centerId,
    queryFn: () => request('GET', api.dispatch.GET('/metrics/on-time-deliveries', { params: { query } })),
  });

  const rows: readonly ExecRow[] = exec.data?.rows ?? [];
  const incidents = exec.data?.incidents ?? [];
  const drows: readonly DispRow[] = disp.data?.rows ?? [];
  const riders = useRiderLabels(rows.map((r) => r.riderId));

  const a = agg(rows);
  const ot = onTime.data?.items ?? [];
  const otOn = total(ot, (x) => x.onTime ?? 0);
  const otDue = total(ot, (x) => x.due ?? 0);
  const dCreated = total(drows, (r) => r.created);
  const dAssigned = total(drows, (r) => r.assigned);
  const dAvgAssign = wavg(drows, (r) => r.avgAssignSeconds, (r) => r.assigned);
  const dReassigned = total(drows, (r) => r.reassigned);
  const dSent = total(drows, (r) => r.offersSent);
  const dAccepted = total(drows, (r) => r.offersAccepted);

  const daily = [...groupBy(rows, (r) => r.date).entries()].sort(([x], [y]) => y.localeCompare(x));
  const dispByDay = groupBy(drows, (r) => r.date);
  const byMfc = [...groupBy(rows, (r) => r.mfcId).entries()].sort(([, x], [, y]) => total(y, (r) => r.assigned) - total(x, (r) => r.assigned));
  const dispByMfc = groupBy(drows, (r) => r.mfcId);
  const byRider = [...groupBy(rows, (r) => r.riderId).entries()].sort(([, x], [, y]) => total(y, (r) => r.assigned) - total(x, (r) => r.assigned));

  return (
    <section className="space-y-4" data-testid="delivery-stats">
      <PageHeader
        title={s.title}
        description={centerId ? s.introCenter(centerName) : s.intro}
        actions={
          <div className="join" role="group" aria-label={s.rangeLabel} data-testid="stats-range">
            {(Object.keys(DAYS) as Range[]).map((k) => (
              <button key={k} type="button" className={`btn btn-sm join-item ${range === k ? 'btn-primary' : 'border-base-300 bg-base-100'}`} aria-pressed={range === k} onClick={() => setRange(k)}>
                {s.range[k]}
              </button>
            ))}
          </div>
        }
      />
      {exec.isPending ? (
        <QueryState state={{ kind: 'loading' }}>{() => null}</QueryState>
      ) : exec.isError ? (
        <QueryState state={toUiState(exec)} onRetry={() => void exec.refetch()}>
          {() => null}
        </QueryState>
      ) : (
        <>
          <StatStrip label={s.quality} testId="stats-quality">
            <StatCard layout="row" label={s.tile.completion} value={pct(a.completed, a.completed + a.failed)} hint={s.hint.completion(a.completed, a.failed)} testId="tile-completion" />
            <StatCard layout="row" label={s.tile.late} value={pct(a.late, a.judged)} hint={s.hint.late(a.late, a.judged)} tone={a.judged > 0 && a.late / a.judged > 0.1 ? 'warning' : undefined} testId="tile-late" />
            <StatCard layout="row" label={s.tile.failure} value={pct(a.failed, a.assigned)} hint={s.hint.failure(a.failed, a.assigned)} testId="tile-failure" />
            <StatCard
              layout="row"
              label={s.tile.onTime}
              value={onTime.data ? pct(otOn, otDue) : onTime.isError ? '?' : '—'}
              hint={onTime.data ? s.hint.onTime(otOn, otDue) : onTime.isError ? s.hint.failed : !admin && !centerId ? s.hint.onTimeNeedsCenter : '…'}
              testId="tile-on-time"
            />
          </StatStrip>
          <StatStrip label={s.efficiency} testId="stats-efficiency">
            <StatCard layout="row" label={s.tile.assign} value={disp.data ? dur(dAvgAssign) : disp.isError ? '?' : '…'} hint={disp.data ? s.hint.count(dAssigned) : disp.isError ? s.hint.failed : undefined} testId="tile-assign" />
            <StatCard layout="row" label={s.tile.pickupWait} value={dur(a.pickupWait)} hint={s.hint.count(a.pickupWaitCount)} testId="tile-pickup-wait" />
            <StatCard layout="row" label={s.tile.delivery} value={dur(a.delivery)} hint={s.hint.count(a.deliveryCount)} testId="tile-delivery" />
          </StatStrip>
          {disp.isError ? (
            <Notice tone="warning">
              <span data-testid="stats-dispatch-failed">{s.dispatchFailed}</span>
            </Notice>
          ) : disp.data ? (
            <Section title={s.dispatch} testId="stats-dispatch">
              <StatStrip label={s.dispatch}>
                <StatCard layout="row" label={s.tile.assignRate} value={pct(dAssigned, dCreated)} hint={s.hint.assignRate(dAssigned, dCreated)} testId="tile-assign-rate" />
                <StatCard layout="row" label={s.tile.reassign} value={pct(dReassigned, dCreated)} hint={s.hint.reassign(dReassigned, dCreated)} testId="tile-reassign" />
                <StatCard layout="row" label={s.tile.accept} value={pct(dAccepted, dSent)} hint={s.hint.accept(dAccepted, dSent)} testId="tile-accept" />
                <StatCard layout="row" label={s.tile.autoCancel} value={s.countText(total(drows, (r) => r.autoCancelled))} testId="tile-auto-cancel" />
              </StatStrip>
              <p className="mt-2 text-xs text-base-content/60" data-testid="stats-source">
                {s.source(total(drows, (r) => r.assignedByAi), total(drows, (r) => r.assignedByList), total(drows, (r) => r.assignedByFailedReturn))}
              </p>
              {(disp.data.failureReasons ?? []).length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-sm font-medium">{s.failureReasons}</p>
                  <ul className="flex flex-wrap gap-2 text-sm" data-testid="stats-failure-reasons">
                    {(disp.data.failureReasons ?? []).map((x) => (
                      <li key={x.reason} className="badge badge-ghost">
                        {label(s.reason, x.reason)} {x.rounds}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          ) : null}
          {rows.length === 0 ? (
            <p className="text-sm text-base-content/60" data-testid="stats-empty">
              {s.empty}
            </p>
          ) : (
            <>
              <Section title={s.daily} testId="stats-daily">
                <DataTable>
                  <thead>
                    <tr>
                      <th>{s.col.date}</th>
                      <th className="text-right">{s.col.requests}</th>
                      <th className="text-right">{s.col.assign}</th>
                      <th className="text-right">{s.col.deliveries}</th>
                      <th className="text-right">{s.col.completed}</th>
                      <th className="text-right">{s.col.failed}</th>
                      <th className="text-right">{s.col.late}</th>
                      <th className="text-right">{s.col.delivery}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.map(([day, rs]) => {
                      const x = agg(rs);
                      const dd = dispByDay.get(day) ?? [];
                      return (
                        <tr key={day} data-testid="stats-day-row">
                          <td className="whitespace-nowrap">{day}</td>
                          {/* 배차 통계를 못 읽었으면 그 칸은 "?"(0 아님) */}
                          <td className="text-right tabular-nums">{disp.data ? total(dd, (r) => r.created) : '?'}</td>
                          <td className="text-right tabular-nums">{disp.data ? dur(wavg(dd, (r) => r.avgAssignSeconds, (r) => r.assigned)) : '?'}</td>
                          <td className="text-right tabular-nums">{x.assigned}</td>
                          <td className="text-right tabular-nums">{x.completed}</td>
                          <td className="text-right tabular-nums">{x.failed}</td>
                          <td className="text-right tabular-nums">{pct(x.late, x.judged)}</td>
                          <td className="text-right tabular-nums">{dur(x.delivery)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </DataTable>
              </Section>
              <Section title={s.byMfc} testId="stats-mfc">
                <DataTable>
                  <thead>
                    <tr>
                      <th>{s.col.mfc}</th>
                      <th className="text-right">{s.col.deliveries}</th>
                      <th className="text-right">{s.col.riders}</th>
                      <th className="text-right">{s.col.completion}</th>
                      <th className="text-right">{s.col.late}</th>
                      <th className="text-right">{s.col.pickupWait}</th>
                      <th className="text-right">{s.col.delivery}</th>
                      <th className="text-right">{s.col.assign}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byMfc.map(([mfc, rs]) => {
                      const x = agg(rs);
                      const dd = dispByMfc.get(mfc) ?? [];
                      return (
                        <tr key={mfc} data-testid="stats-mfc-row">
                          <td>{nameOf(mfc)}</td>
                          <td className="text-right tabular-nums">{x.assigned}</td>
                          <td className="text-right tabular-nums">{x.riders}</td>
                          <td className="text-right tabular-nums">{pct(x.completed, x.completed + x.failed)}</td>
                          <td className="text-right tabular-nums">{pct(x.late, x.judged)}</td>
                          <td className="text-right tabular-nums">{dur(x.pickupWait)}</td>
                          <td className="text-right tabular-nums">{dur(x.delivery)}</td>
                          <td className="text-right tabular-nums">{disp.data ? dur(wavg(dd, (r) => r.avgAssignSeconds, (r) => r.assigned)) : '?'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </DataTable>
              </Section>
              <Section title={s.byRider} testId="stats-riders">
                <DataTable>
                  <thead>
                    <tr>
                      <th>{s.col.rider}</th>
                      <th className="text-right">{s.col.deliveries}</th>
                      <th className="text-right">{s.col.completed}</th>
                      <th className="text-right">{s.col.failed}</th>
                      <th className="text-right">{s.col.completion}</th>
                      <th className="text-right">{s.col.late}</th>
                      <th className="text-right">{s.col.delivery}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byRider.map(([rider, rs]) => {
                      const x = agg(rs);
                      return (
                        <tr key={rider} data-testid="stats-rider-row">
                          <td>
                            <Link className="link link-hover" to={`/riders/${encodeURIComponent(rider)}`}>
                              <RiderLabel rider={riders.get(rider)} riderId={rider} failed={riders.failed} withName />
                            </Link>
                          </td>
                          <td className="text-right tabular-nums">{x.assigned}</td>
                          <td className="text-right tabular-nums">{x.completed}</td>
                          <td className="text-right tabular-nums">{x.failed}</td>
                          <td className="text-right tabular-nums">{pct(x.completed, x.completed + x.failed)}</td>
                          <td className="text-right tabular-nums">{pct(x.late, x.judged)}</td>
                          <td className="text-right tabular-nums">{dur(x.delivery)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </DataTable>
              </Section>
            </>
          )}
          <Section title={s.incidents} testId="stats-incidents">
            {incidents.length === 0 ? (
              <p className="text-sm text-base-content/60">{s.noIncidents}</p>
            ) : (
              <DataTable>
                <thead>
                  <tr>
                    <th>{s.col.category}</th>
                    <th className="text-right">{s.col.count}</th>
                    <th className="text-right">{s.col.resolved}</th>
                    <th className="text-right">{s.col.resolve}</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((x) => (
                    <tr key={x.category} data-testid="stats-incident-row">
                      <td>{label(messages.deliveries.helpCategoryName, x.category)}</td>
                      <td className="text-right tabular-nums">{x.count}</td>
                      <td className="text-right tabular-nums">{x.resolved}</td>
                      <td className="text-right tabular-nums">{dur(x.resolveSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </Section>
          <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-base-content/50" data-testid="stats-definitions">
            <span className="font-semibold">{s.definitionsTitle}</span>
            {s.definitions.map((d) => (
              <span key={d} className="whitespace-nowrap">
                {d}
              </span>
            ))}
          </p>
        </>
      )}
    </section>
  );
}

/** 라이더 상세 "최근 30일 성과" — 같은 `/delivery-metrics?riderId=`(모든 센터) */
export function RiderPerformance({ riderId }: { readonly riderId: string }) {
  const api = useApi();
  const [today] = useState(() => seoulToday());
  const from = addSeoulDays(today, -29);
  const q = useQuery({
    queryKey: ['delivery-stats', 'rider', riderId, from, today],
    queryFn: () => request('GET', api.execution.GET('/delivery-metrics', { params: { query: { from, to: today, riderId } } })),
  });
  return (
    <Section title={s.riderTitle} aside={<span className="text-xs text-base-content/55">{s.riderRange(from, today)}</span>} testId="rider-performance">
      <QueryState state={toUiState(q)} onRetry={() => void q.refetch()}>
        {(r) => {
          const rows: readonly ExecRow[] = r.rows ?? [];
          if (rows.length === 0)
            return (
              <p className="text-sm text-base-content/60" data-testid="rider-performance-empty">
                {s.riderEmpty}
              </p>
            );
          const x = agg(rows);
          const inc = total(r.incidents ?? [], (i) => i.count);
          return (
            <StatStrip label={s.riderTitle}>
              <StatCard label={s.col.deliveries} value={x.assigned} testId="rider-perf-assigned" />
              <StatCard label={s.tile.completion} value={pct(x.completed, x.completed + x.failed)} hint={s.hint.completion(x.completed, x.failed)} testId="rider-perf-completion" />
              <StatCard label={s.tile.late} value={pct(x.late, x.judged)} hint={s.hint.late(x.late, x.judged)} testId="rider-perf-late" />
              <StatCard label={s.tile.pickupWait} value={dur(x.pickupWait)} hint={s.hint.count(x.pickupWaitCount)} testId="rider-perf-pickup" />
              <StatCard label={s.tile.delivery} value={dur(x.delivery)} hint={s.hint.count(x.deliveryCount)} testId="rider-perf-delivery" />
              <StatCard label={s.incidentsShort} value={s.countText(inc)} testId="rider-perf-incidents" />
            </StatStrip>
          );
        }}
      </QueryState>
    </Section>
  );
}
