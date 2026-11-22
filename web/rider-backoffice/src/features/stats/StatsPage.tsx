// 운영 통계(2026-11-23 — 사용자 "필요한 기능 정리 … 부족한 게 있겠다 싶으면 참고해서 추가로 만들어. 특히 2번이랑 4번").
// 원천: execution `GET /delivery-metrics`(0.38.0 — 배정일 × 센터 × 라이더 묶음, 사고 = 도움요청 종류별),
//       dispatch `GET /metrics/dispatch`(0.16.0 — 생성일 × 센터 배차 효율, 실패 사유), `GET /metrics/on-time-deliveries`(정시 배송률, 관리자가 아니면 센터 필수).
// 센터는 머리줄 센터 고르기(RS-7). 평균은 서버가 준 건수(*Count·assigned)로 가중해 다시 낸다. 직원 수동 배차는 없다(배정 출처 = AI 추천·배달리스트·반납).
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { useCenterQuery } from '../../app/CenterScope';
import { isOperatorAdmin } from '../../app/nav';
import { useSession } from '../../app/SessionContext';
import { DataTable, Notice, PageHeader, Section, StatCard, StatStrip } from '../../shared/admin';
import { RiderName, useRiderSummaries } from '../../shared/displayNumbers';
import { messages } from '../../shared/messages';
import { label } from '../../shared/opsUi';
import { DAY, dur, seoulDate } from '../dashboard/analysisData';

type ExecRow = {
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
};
type Incident = { readonly category: string; readonly count: number; readonly resolved: number; readonly resolveSeconds?: number | null };
type DispRow = {
  readonly date: string;
  readonly mfcId: string;
  readonly created: number;
  readonly assigned: number;
  readonly avgAssignSeconds?: number | null;
  readonly reassigned: number;
  readonly failedRounds: number;
  readonly autoCancelled: number;
  readonly offersSent: number;
  readonly offersAccepted: number;
  readonly offersRejected: number;
  readonly offersExpired: number;
  readonly assignedByAi: number;
  readonly assignedByList: number;
  readonly assignedByFailedReturn: number;
};

const n = messages.names;

export const statsMessages = {
  title: '운영 통계',
  intro: '배송 품질·효율, 배차 효율, 센터·라이더별 성과, 사고를 한 화면에서 봐요. 머리줄에서 센터를 고르면 그 센터만 보여요.',
  range: { today: '오늘', d7: '최근 7일', d30: '최근 30일' } as const,
  rangeLabel: '기간',
  quality: '배송 품질',
  efficiency: '배송 효율',
  dispatch: '배차 효율',
  daily: '날짜별',
  byMfc: '센터별 비교',
  byRider: '라이더별 성과',
  incidents: '사고(도움요청) 통계',
  tile: {
    completion: '완료율',
    late: '지연율',
    failure: '전달 실패율',
    onTime: '정시 배송률',
    assign: '평균 배차 소요',
    pickupWait: '평균 픽업 대기',
    delivery: '평균 배송 소요',
    assignRate: '배정 성공률',
    reassign: '재배차 비율',
    accept: '제안 수락률',
    autoCancel: '배차 불가 자동 취소',
  },
  hint: {
    completion: (c: number, f: number) => `완료 ${c} · 실패 ${f}`,
    late: (l: number, j: number) => `늦음 ${l} / 판정 ${j}`,
    failure: (f: number, a: number) => `실패 ${f} / 배정 ${a}`,
    onTime: (o: number, d: number) => `정시 ${o} / ${d}`,
    onTimeNeedsCenter: '센터를 고르면 보여요',
    count: (k: number) => `${k}건 평균`,
    assignRate: (a: number, c: number) => `배정 ${a} / 요청 ${c}`,
    reassign: (r: number, c: number) => `${r} / ${c}`,
    accept: (a: number, s: number) => `수락 ${a} / 보냄 ${s}`,
  },
  source: (ai: number, list: number, ret: number) => `배정 출처 — AI 추천 ${ai} · 배달리스트 ${list} · 실패 반납 ${ret} (직원 수동 배차는 없어요)`,
  failureReasons: '배차 실패 사유(회차)',
  reason: { NO_RIDER: '라이더 없음', EXPIRED: '제안 만료', REPEATED_REJECTION: '거절 반복', SYSTEM_FAILURE: '시스템 오류' } as Readonly<Record<string, string>>,
  col: {
    date: '날짜',
    mfc: '센터',
    rider: '라이더',
    deliveries: '배송',
    completed: '완료',
    failed: '실패',
    completion: '완료율',
    late: '지연율',
    delivery: '평균 배송 소요',
    pickupWait: '평균 픽업 대기',
    riders: '가동 라이더',
    requests: '배차 요청',
    assign: '평균 배차 소요',
    category: '종류',
    count: '건수',
    resolved: '끝남',
    resolve: '평균 처리 시간',
  },
  empty: '이 기간에 배정된 배송이 없어요.',
  noIncidents: '이 기간에 도움요청이 없어요.',
  dispatchFailed: '배차 통계를 불러오지 못했어요 — 잠시 뒤 다시 열어 주세요.',
  definitions:
    '정의 — 날짜는 배정일(배차 효율은 배송이 생긴 날). 지연 = 약속 시각 뒤 전달(고객 수령 확인·자동 완료는 판정에서 빼요). 픽업 대기 = 가게 도착 → 픽업, 배송 소요 = 픽업 → 전달. 배차 소요 = 첫 배차 시도 → 라이더 배정.',
} as const;
const s = statsMessages;

type Range = 'today' | 'd7' | 'd30';
const DAYS: Record<Range, number> = { today: 1, d7: 7, d30: 30 };

const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 1000) / 10}%` : '—');
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

interface Agg {
  readonly assigned: number;
  readonly completed: number;
  readonly failed: number;
  readonly late: number;
  readonly judged: number;
  readonly delivery: number | null;
  readonly pickupWait: number | null;
  readonly riders: number;
}
function agg(rows: readonly ExecRow[]): Agg {
  return {
    assigned: total(rows, (r) => r.assigned),
    completed: total(rows, (r) => r.completed),
    failed: total(rows, (r) => r.failed),
    late: total(rows, (r) => r.late),
    judged: total(rows, (r) => r.judged),
    delivery: wavg(rows, (r) => r.deliverySeconds, (r) => r.deliveryCount),
    pickupWait: wavg(rows, (r) => r.pickupWaitSeconds, (r) => r.pickupWaitCount),
    riders: new Set(rows.map((r) => r.riderId)).size,
  };
}
function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

export function StatsPage() {
  const api = useApi();
  const { session } = useSession();
  const cq = useCenterQuery();
  const [range, setRange] = useState<Range>('d7');
  // 화면을 연 때를 기준으로(렌더마다 바뀌지 않게)
  const [now] = useState(() => Date.now());
  const to = seoulDate(now);
  const from = seoulDate(now - (DAYS[range] - 1) * DAY);
  const q = { from, to, ...cq };
  const exec = useQuery({
    queryKey: ['stats', 'delivery-metrics', from, to, cq.mfcId ?? ''],
    queryFn: () => request('GET', api.execution.GET('/delivery-metrics', { params: { query: q } })),
  });
  const disp = useQuery({
    queryKey: ['stats', 'dispatch-metrics', from, to, cq.mfcId ?? ''],
    queryFn: () => request('GET', api.dispatch.GET('/metrics/dispatch', { params: { query: q } })),
  });
  // 정시 배송률 — 관리자가 아니면 센터를 골라야 서버가 준다
  const canAll = !!session && isOperatorAdmin(session.roles);
  const onTime = useQuery({
    queryKey: ['stats', 'on-time', from, to, cq.mfcId ?? ''],
    enabled: canAll || !!cq.mfcId,
    queryFn: () => request('GET', api.dispatch.GET('/metrics/on-time-deliveries', { params: { query: q } })),
  });
  const centers = useQuery({
    queryKey: ['centers', 'MFC'],
    queryFn: () => request('GET', api.center.GET('/centers', { params: { query: { type: 'MFC' } } })),
    staleTime: 5 * 60_000,
  });
  const centerName = (id: string) => (centers.data?.items ?? []).find((c) => c.centerId === id)?.name ?? id;

  const rows: readonly ExecRow[] = exec.data?.rows ?? [];
  const incidents: readonly Incident[] = exec.data?.incidents ?? [];
  const drows: readonly DispRow[] = disp.data?.rows ?? [];
  const riderSummaries = useRiderSummaries(rows.map((r) => r.riderId));

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

  const loading = exec.isPending || disp.isPending;
  const failed = exec.isError && disp.isError;
  return (
    <section className="space-y-4">
      <PageHeader
        title={s.title}
        description={s.intro}
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
      {loading ? (
        <QueryState state={{ kind: 'loading' }}>{() => null}</QueryState>
      ) : failed ? (
        <QueryState state={toUiState(exec)} onRetry={() => { void exec.refetch(); void disp.refetch(); }}>{() => null}</QueryState>
      ) : (
        <>
          <StatStrip label={s.quality} testId="stats-quality">
            <StatCard layout="row" label={s.tile.completion} value={pct(a.completed, a.completed + a.failed)} hint={s.hint.completion(a.completed, a.failed)} testId="tile-completion" />
            <StatCard layout="row" label={s.tile.late} value={pct(a.late, a.judged)} hint={s.hint.late(a.late, a.judged)} tone={a.judged > 0 && a.late / a.judged > 0.1 ? 'warning' : undefined} testId="tile-late" />
            <StatCard layout="row" label={s.tile.failure} value={pct(a.failed, a.assigned)} hint={s.hint.failure(a.failed, a.assigned)} testId="tile-failure" />
            <StatCard layout="row" label={s.tile.onTime} value={onTime.data ? pct(otOn, otDue) : '—'} hint={onTime.data ? s.hint.onTime(otOn, otDue) : s.hint.onTimeNeedsCenter} testId="tile-on-time" />
          </StatStrip>
          <StatStrip label={s.efficiency} testId="stats-efficiency">
            <StatCard layout="row" label={s.tile.assign} value={dur(dAvgAssign)} hint={s.hint.count(dAssigned)} testId="tile-assign" />
            <StatCard layout="row" label={s.tile.pickupWait} value={dur(a.pickupWait)} hint={s.hint.count(total(rows, (r) => r.pickupWaitCount))} testId="tile-pickup-wait" />
            <StatCard layout="row" label={s.tile.delivery} value={dur(a.delivery)} hint={s.hint.count(total(rows, (r) => r.deliveryCount))} testId="tile-delivery" />
          </StatStrip>
          {disp.isError ? (
            <Notice tone="warning">{s.dispatchFailed}</Notice>
          ) : (
            <Section title={s.dispatch} testId="stats-dispatch">
              <StatStrip label={s.dispatch}>
                <StatCard layout="row" label={s.tile.assignRate} value={pct(dAssigned, dCreated)} hint={s.hint.assignRate(dAssigned, dCreated)} testId="tile-assign-rate" />
                <StatCard layout="row" label={s.tile.reassign} value={pct(dReassigned, dCreated)} hint={s.hint.reassign(dReassigned, dCreated)} testId="tile-reassign" />
                <StatCard layout="row" label={s.tile.accept} value={pct(dAccepted, dSent)} hint={s.hint.accept(dAccepted, dSent)} testId="tile-accept" />
                <StatCard layout="row" label={s.tile.autoCancel} value={`${total(drows, (r) => r.autoCancelled)}건`} testId="tile-auto-cancel" />
              </StatStrip>
              <p className="mt-2 text-xs text-base-content/60" data-testid="stats-source">
                {s.source(total(drows, (r) => r.assignedByAi), total(drows, (r) => r.assignedByList), total(drows, (r) => r.assignedByFailedReturn))}
              </p>
              {(disp.data?.failureReasons ?? []).length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-sm font-medium">{s.failureReasons}</p>
                  <ul className="flex flex-wrap gap-2 text-sm" data-testid="stats-failure-reasons">
                    {(disp.data?.failureReasons ?? []).map((x) => (
                      <li key={x.reason} className="badge badge-ghost">
                        {s.reason[x.reason] ?? x.reason} {x.rounds}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          )}
          {rows.length === 0 ? (
            <p className="text-sm text-base-content/60" data-testid="stats-empty">{s.empty}</p>
          ) : (
            <>
              <Section title={s.daily} testId="stats-daily">
                <DataTable testId="stats-daily-table">
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
                          <td>{total(dd, (r) => r.created)}</td>
                          <td>{dur(wavg(dd, (r) => r.avgAssignSeconds, (r) => r.assigned))}</td>
                          <td>{x.assigned}</td>
                          <td>{x.completed}</td>
                          <td>{x.failed}</td>
                          <td>{pct(x.late, x.judged)}</td>
                          <td>{dur(x.delivery)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </DataTable>
              </Section>
              <Section title={s.byMfc} testId="stats-mfc">
                <DataTable testId="stats-mfc-table">
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
                          <td>{centerName(mfc)}</td>
                          <td>{x.assigned}</td>
                          <td>{x.riders}</td>
                          <td>{pct(x.completed, x.completed + x.failed)}</td>
                          <td>{pct(x.late, x.judged)}</td>
                          <td>{dur(x.pickupWait)}</td>
                          <td>{dur(x.delivery)}</td>
                          <td>{dur(wavg(dd, (r) => r.avgAssignSeconds, (r) => r.assigned))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </DataTable>
              </Section>
              <Section title={s.byRider} testId="stats-riders">
                <DataTable testId="stats-rider-table">
                  <thead>
                    <tr>
                      <th>{s.col.rider}</th>
                      <th>{s.col.deliveries}</th>
                      <th>{s.col.completed}</th>
                      <th>{s.col.failed}</th>
                      <th>{s.col.completion}</th>
                      <th>{s.col.late}</th>
                      <th>{s.col.delivery}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byRider.map(([rider, rs]) => {
                      const x = agg(rs);
                      const sum = riderSummaries.get(rider);
                      return (
                        <tr key={rider} data-testid="stats-rider-row">
                          <td>
                            <Link className="link link-hover" to={`/riders/${encodeURIComponent(rider)}`}>
                              <RiderName riderId={rider} nameMasked={sum?.nameMasked} riderNumber={sum?.riderNumber} />
                            </Link>
                          </td>
                          <td>{x.assigned}</td>
                          <td>{x.completed}</td>
                          <td>{x.failed}</td>
                          <td>{pct(x.completed, x.completed + x.failed)}</td>
                          <td>{pct(x.late, x.judged)}</td>
                          <td>{dur(x.delivery)}</td>
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
              <DataTable testId="stats-incident-table">
                <thead>
                  <tr>
                    <th>{s.col.category}</th>
                    <th>{s.col.count}</th>
                    <th>{s.col.resolved}</th>
                    <th>{s.col.resolve}</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((x) => (
                    <tr key={x.category} data-testid="stats-incident-row">
                      <td>{label(n.helpCategory, x.category)}</td>
                      <td>{x.count}</td>
                      <td>{x.resolved}</td>
                      <td>{dur(x.resolveSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </Section>
          <p className="text-xs text-base-content/50">{s.definitions}</p>
        </>
      )}
    </section>
  );
}
