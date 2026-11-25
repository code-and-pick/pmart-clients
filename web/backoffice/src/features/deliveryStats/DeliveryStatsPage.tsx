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
import { BigRate, DailyChart, dur, HeroCard, Legend, pct, RateBar, RateCell, ReasonBars, Ring, SourceBar, StackBar, TimeFlow } from './statsCharts';

export { dur, pct };
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
  const riderMax = Math.max(1, ...byRider.map(([, rs]) => total(rs, (r) => r.assigned)));
  const incidentMax = Math.max(1, ...incidents.map((x) => x.count));

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
          {/* 2026-11-25 라이더 운영 통계 모양 — 품질(큰 원 + 비율 막대)·걸린 시간(이어진 한 줄)·배차(비율 막대) 세 카드 */}
          <div className="grid gap-4 xl:grid-cols-3">
            <HeroCard title={s.quality} sub={s.qualitySub} testId="stats-quality">
              <div className="flex items-center gap-6">
                <Ring num={a.completed} den={a.completed + a.failed} label={s.tile.completion} hint={s.hint.completion(a.completed, a.failed)} testId="tile-completion" />
                <div className="min-w-0 flex-1 space-y-4">
                  <RateBar
                    label={s.tile.onTime}
                    num={otOn}
                    den={otDue}
                    hint={onTime.data ? s.hint.onTime(otOn, otDue) : onTime.isError ? s.hint.failed : !admin && !centerId ? s.hint.onTimeNeedsCenter : '…'}
                    unavailable={!onTime.data}
                    tone="good"
                    testId="tile-on-time"
                  />
                  <RateBar label={s.tile.late} num={a.late} den={a.judged} hint={s.hint.late(a.late, a.judged)} tone="warn" testId="tile-late" />
                  <RateBar label={s.tile.failure} num={a.failed} den={a.assigned} hint={s.hint.failure(a.failed, a.assigned)} tone="bad" testId="tile-failure" />
                </div>
              </div>
            </HeroCard>
            <HeroCard title={s.efficiency} sub={s.efficiencySub} testId="stats-efficiency">
              <TimeFlow
                legs={[
                  // 배차 통계를 못 읽었으면 그 구간은 "—"·"불러오지 못했어요"(0 아님)
                  { key: 'assign', label: s.tile.assign, sec: disp.data ? dAvgAssign : null, n: disp.data ? dAssigned : null, color: '#3b6ef6', testId: 'tile-assign' },
                  { key: 'wait', label: s.tile.pickupWait, sec: a.pickupWait, n: a.pickupWaitCount, color: '#0891b2', testId: 'tile-pickup-wait' },
                  { key: 'delivery', label: s.tile.delivery, sec: a.delivery, n: a.deliveryCount, color: '#d97706', testId: 'tile-delivery' },
                ]}
              />
            </HeroCard>
            <HeroCard title={s.dispatch} sub={s.dispatchSub} testId="stats-dispatch">
              {disp.isError ? (
                <Notice tone="warning">
                  <span data-testid="stats-dispatch-failed">{s.dispatchFailed}</span>
                </Notice>
              ) : (
                <div className="space-y-4">
                  <RateBar label={s.tile.assignRate} num={dAssigned} den={dCreated} hint={s.hint.assignRate(dAssigned, dCreated)} tone="good" testId="tile-assign-rate" />
                  <RateBar label={s.tile.accept} num={dAccepted} den={dSent} hint={s.hint.accept(dAccepted, dSent)} tone="neutral" testId="tile-accept" />
                  <RateBar label={s.tile.reassign} num={dReassigned} den={dCreated} hint={s.hint.reassign(dReassigned, dCreated)} tone="warn" testId="tile-reassign" />
                  <p className="flex items-baseline justify-between text-sm" data-testid="tile-auto-cancel">
                    <span className="text-base-content/70">{s.tile.autoCancel}</span>
                    <b className="tabular-nums">{s.countText(total(drows, (r) => r.autoCancelled))}</b>
                  </p>
                </div>
              )}
            </HeroCard>
          </div>
          {disp.data && (
            <div className="grid gap-4 lg:grid-cols-2">
              <HeroCard title={s.sourceTitle} sub={s.sourceSub} testId="stats-source">
                <SourceBar
                  parts={[
                    { label: s.src.ai, n: total(drows, (r) => r.assignedByAi), color: '#3b6ef6' },
                    { label: s.src.list, n: total(drows, (r) => r.assignedByList), color: '#0891b2' },
                    { label: s.src.ret, n: total(drows, (r) => r.assignedByFailedReturn), color: '#d97706' },
                  ]}
                />
                <p className="mt-3 text-xs text-base-content/60">{s.noManual}</p>
              </HeroCard>
              <HeroCard title={s.failureReasons} sub={s.failureSub} testId="stats-failure-card">
                <ReasonBars items={(disp.data.failureReasons ?? []).map((x) => ({ label: label(s.reason, x.reason), n: x.rounds }))} />
                <Link to="/deliveries?state=UNASSIGNED" className="mt-3 inline-block text-sm text-primary hover:underline" data-testid="stats-unassigned-link">
                  {s.unassignedLink} ›
                </Link>
              </HeroCard>
            </div>
          )}
          {rows.length === 0 ? (
            <p className="text-sm text-base-content/60" data-testid="stats-empty">
              {s.empty}
            </p>
          ) : (
            <>
              <Section title={s.daily} testId="stats-daily">
                <DailyChart
                  points={[...daily].reverse().map(([d, rs]) => {
                    const x = agg(rs);
                    return { d, done: x.completed, failed: x.failed };
                  })}
                />
                <DataTable>
                  <thead>
                    <tr>
                      <th>{s.col.date}</th>
                      <th>{s.col.requests}</th>
                      <th>{s.col.assign}</th>
                      <th>{s.col.deliveries}</th>
                      <th>{s.col.completed}</th>
                      <th>{s.col.failed}</th>
                      <th>{s.col.late}</th>
                      <th>{s.col.delivery}</th>
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
                          <td className="tabular-nums">{disp.data ? total(dd, (r) => r.created) : '?'}</td>
                          <td className="tabular-nums">{disp.data ? dur(wavg(dd, (r) => r.avgAssignSeconds, (r) => r.assigned)) : '?'}</td>
                          <td className="tabular-nums">{x.assigned}</td>
                          <td className="tabular-nums">{x.completed}</td>
                          <td className="tabular-nums">{x.failed}</td>
                          <td>
                            <RateCell num={x.late} den={x.judged} kind="late" />
                          </td>
                          <td className="tabular-nums">{dur(x.delivery)}</td>
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
                      <th>{s.col.deliveries}</th>
                      <th>{s.col.riders}</th>
                      <th>{s.col.completion}</th>
                      <th>{s.col.late}</th>
                      <th>{s.col.pickupWait}</th>
                      <th>{s.col.delivery}</th>
                      <th>{s.col.assign}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byMfc.map(([mfc, rs]) => {
                      const x = agg(rs);
                      const dd = dispByMfc.get(mfc) ?? [];
                      return (
                        <tr key={mfc} data-testid="stats-mfc-row">
                          <td className="font-medium">{nameOf(mfc)}</td>
                          <td className="tabular-nums">{x.assigned}</td>
                          <td className="tabular-nums">{x.riders}</td>
                          <td>
                            <RateCell num={x.completed} den={x.completed + x.failed} kind="done" />
                          </td>
                          <td>
                            <RateCell num={x.late} den={x.judged} kind="late" />
                          </td>
                          <td className="tabular-nums">{dur(x.pickupWait)}</td>
                          <td className="tabular-nums">{dur(x.delivery)}</td>
                          <td className="tabular-nums">{disp.data ? dur(wavg(dd, (r) => r.avgAssignSeconds, (r) => r.assigned)) : '?'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </DataTable>
              </Section>
              <Section title={s.byRider} testId="stats-riders">
                <Legend parts={[[s.legendDone, 'bg-success'], [s.legendFailed, 'bg-error'], [s.legendOther, 'bg-base-content/20']]} />
                <DataTable>
                  <thead>
                    <tr>
                      <th>{s.col.rider}</th>
                      <th className="w-[38%]">{s.col.volume}</th>
                      <th>{s.col.completion}</th>
                      <th>{s.col.late}</th>
                      <th>{s.col.delivery}</th>
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
                          <td>
                            <StackBar
                              max={riderMax}
                              parts={[
                                [x.completed, 'bg-success'],
                                [x.failed, 'bg-error'],
                                [Math.max(0, x.assigned - x.completed - x.failed), 'bg-base-content/20'],
                              ]}
                              text={s.riderBarText(x.assigned, x.completed, x.failed)}
                            />
                          </td>
                          <td>
                            <BigRate num={x.completed} den={x.completed + x.failed} />
                          </td>
                          <td>
                            <RateCell num={x.late} den={x.judged} kind="late" />
                          </td>
                          <td className="tabular-nums">{dur(x.delivery)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </DataTable>
              </Section>
            </>
          )}
          <Section
            title={s.incidents}
            testId="stats-incidents"
            aside={
              <Link to="/cases" className="text-sm text-primary hover:underline" data-testid="stats-cases-link">
                {s.casesLink} ›
              </Link>
            }
          >
            {incidents.length === 0 ? (
              <p className="text-sm text-base-content/60">{s.noIncidents}</p>
            ) : (
              <>
                <Legend parts={[[s.legendResolved, 'bg-base-content/45'], [s.legendOpen, 'bg-warning']]} />
                <DataTable>
                  <thead>
                    <tr>
                      <th>{s.col.category}</th>
                      <th className="w-[45%]">{s.col.progress}</th>
                      <th>{s.col.resolve}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...incidents]
                      .sort((p, q) => q.count - p.count)
                      .map((x) => (
                        <tr key={x.category} data-testid="stats-incident-row">
                          <td className="font-medium">{label(messages.deliveries.helpCategoryName, x.category)}</td>
                          <td>
                            <StackBar
                              max={incidentMax}
                              parts={[
                                [x.resolved, 'bg-base-content/45'],
                                [Math.max(0, x.count - x.resolved), 'bg-warning'],
                              ]}
                              text={s.incidentBarText(x.count, x.resolved)}
                              warn={x.count > x.resolved}
                            />
                          </td>
                          <td className="tabular-nums">{dur(x.resolveSeconds)}</td>
                        </tr>
                      ))}
                  </tbody>
                </DataTable>
              </>
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
