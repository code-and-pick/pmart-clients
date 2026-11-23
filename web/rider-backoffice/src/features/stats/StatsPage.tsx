// 운영 통계(2026-11-23 — 사용자 "필요한 기능 정리 … 부족한 게 있겠다 싶으면 참고해서 추가로 만들어. 특히 2번이랑 4번").
// 원천: execution `GET /delivery-metrics`(0.38.0 — 배정일 × 센터 × 라이더 묶음, 사고 = 도움요청 종류별),
//       dispatch `GET /metrics/dispatch`(0.16.0 — 생성일 × 센터 배차 효율, 실패 사유), `GET /metrics/on-time-deliveries`(정시 배송률, 관리자가 아니면 센터 필수).
// 센터는 머리줄 센터 고르기(RS-7). 평균은 서버가 준 건수(*Count·assigned)로 가중해 다시 낸다. 직원 수동 배차는 없다(배정 출처 = AI 추천·배달리스트·반납).
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { useCenterQuery, useCenterScope } from '../../app/CenterScope';
import { isOperatorAdmin } from '../../app/nav';
import { useSession } from '../../app/SessionContext';
import { DataTable, Notice, PageHeader, Section } from '../../shared/admin';
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
  qualitySub: '끝난 배송이 얼마나 잘 갔나',
  efficiency: '걸린 시간',
  efficiencySub: '한 건 평균 — 배차 → 픽업 대기 → 배송',
  dispatch: '배차 효율',
  dispatchSub: '라이더를 얼마나 잘 찾았나',
  sourceTitle: '배정 출처',
  sourceSub: '누가 배송을 가져갔나',
  src: { ai: 'AI 추천', list: '배달리스트', ret: '실패 반납' },
  noManual: '직원 수동 배차는 없어요.',
  failureSub: '라이더를 못 찾은 회차의 까닭',
  noFailures: '이 기간에 배차 실패가 없어요.',
  // 2026-11-23 사용자 "운영 통계 클릭하니까 아무데도 연결이 안 되는데" — 목록이 있는 수는 그 목록으로
  unassignedLink: '지금 배정 전 배송 보기',
  centerOnly: '이 센터만 보기',
  consultsLink: '상담 관리에서 보기',
  // 구간마다 평균을 낸 건수가 달라(배차 77·픽업 56 …) 정확한 한 건 평균은 아니다 — 그렇다고 밝힌다
  total: '세 구간 평균을 더한 값',
  daily: '날짜별',
  dailyChart: (n: number) => `날짜별 배송 ${n}일 — 완료·실패`,
  legendDone: '완료',
  legendFailed: '실패',
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
    noJudged: '판정한 배송이 없어요',
    failed: '불러오지 못했어요',
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
  // 센터별 비교에서 센터를 누르면 그 센터만 본다(머리줄 센터 고르기와 같은 값)
  const scope = useCenterScope();
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

  // 배송 통계(execution)를 못 읽으면 숫자 0 대신 오류 안내 — 조회 실패 ≠ 0(PR 리뷰 2026-11-23). 배차 통계만 실패하면 그 칸에만 안내.
  const loading = exec.isPending || disp.isPending;
  const failed = exec.isError;
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
          {/* 2026-11-23 사용자 "운영통계 이게 최선이니?" — 같은 크기 숫자 칸 11개를 품질·속도·배차 세 카드로 묶고 그림으로.
              품질: 완료율 큰 원 + 나머지 비율 막대 / 속도: 배차 → 픽업 대기 → 배송 이어진 한 줄 / 배차: 비율 막대·배정 출처 쌓은 막대·실패 사유 가로 막대 */}
          <div className="grid gap-4 xl:grid-cols-3">
            <HeroCard title={s.quality} sub={s.qualitySub} testId="stats-quality">
              <div className="flex items-center gap-6">
                <Ring num={a.completed} den={a.completed + a.failed} label={s.tile.completion} hint={s.hint.completion(a.completed, a.failed)} testId="tile-completion" />
                <div className="min-w-0 flex-1 space-y-4">
                  <RateBar
                    label={s.tile.onTime}
                    num={otOn}
                    den={otDue}
                    hint={onTime.data ? s.hint.onTime(otOn, otDue) : onTime.isError ? s.hint.failed : s.hint.onTimeNeedsCenter}
                    unavailable={!onTime.data}
                    tone="good"
                    testId="tile-on-time"
                  />
                  <RateBar label={s.tile.late} num={a.late} den={a.judged} hint={a.judged > 0 ? s.hint.late(a.late, a.judged) : s.hint.noJudged} tone="warn" testId="tile-late" />
                  <RateBar label={s.tile.failure} num={a.failed} den={a.assigned} hint={s.hint.failure(a.failed, a.assigned)} tone="bad" to="/deliveries?state=FAILED" testId="tile-failure" />
                </div>
              </div>
            </HeroCard>
            <HeroCard title={s.efficiency} sub={s.efficiencySub} testId="stats-efficiency">
              <TimeFlow
                legs={[
                  { key: 'assign', label: s.tile.assign, sec: dAvgAssign, n: dAssigned, color: '#3b6ef6', testId: 'tile-assign' },
                  { key: 'wait', label: s.tile.pickupWait, sec: a.pickupWait, n: total(rows, (r) => r.pickupWaitCount), color: '#0891b2', testId: 'tile-pickup-wait' },
                  { key: 'delivery', label: s.tile.delivery, sec: a.delivery, n: total(rows, (r) => r.deliveryCount), color: '#d97706', testId: 'tile-delivery' },
                ]}
              />
            </HeroCard>
            <HeroCard title={s.dispatch} sub={s.dispatchSub} testId="stats-dispatch">
              {disp.isError ? (
                <Notice tone="warning">{s.dispatchFailed}</Notice>
              ) : (
                <div className="space-y-4">
                  <RateBar label={s.tile.assignRate} num={dAssigned} den={dCreated} hint={s.hint.assignRate(dAssigned, dCreated)} tone="good" testId="tile-assign-rate" />
                  <RateBar label={s.tile.accept} num={dAccepted} den={dSent} hint={s.hint.accept(dAccepted, dSent)} tone="neutral" testId="tile-accept" />
                  <RateBar label={s.tile.reassign} num={dReassigned} den={dCreated} hint={s.hint.reassign(dReassigned, dCreated)} tone="warn" testId="tile-reassign" />
                  <p className="flex items-baseline justify-between text-sm" data-testid="tile-auto-cancel">
                    <span className="text-base-content/70">{s.tile.autoCancel}</span>
                    <b className="tabular-nums">{total(drows, (r) => r.autoCancelled)}건</b>
                  </p>
                </div>
              )}
            </HeroCard>
          </div>
          {!disp.isError && (
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
              <HeroCard title={s.failureReasons} sub={s.failureSub} testId="stats-failure-reasons">
                <ReasonBars items={(disp.data?.failureReasons ?? []).map((x) => ({ label: s.reason[x.reason] ?? x.reason, n: x.rounds }))} />
                <Link to="/deliveries?state=UNASSIGNED" className="mt-3 inline-block text-sm text-primary hover:underline" data-testid="stats-unassigned-link">
                  {s.unassignedLink} ›
                </Link>
              </HeroCard>
            </div>
          )}
          {rows.length === 0 ? (
            <p className="text-sm text-base-content/60" data-testid="stats-empty">{s.empty}</p>
          ) : (
            <>
              <Section title={s.daily} testId="stats-daily">
                <DailyChart days={daily} />
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
                          <td><RateCell num={x.late} den={x.judged} kind="late" /></td>
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
                          <td>
                            <button type="button" className="link link-hover font-medium" title={s.centerOnly} onClick={() => scope.setMfcId(mfc)} data-testid="stats-mfc-pick">
                              {centerName(mfc)}
                            </button>
                          </td>
                          <td>{x.assigned}</td>
                          <td>{x.riders}</td>
                          <td><RateCell num={x.completed} den={x.completed + x.failed} kind="done" /></td>
                          <td><RateCell num={x.late} den={x.judged} kind="late" /></td>
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
                          <td><RateCell num={x.completed} den={x.completed + x.failed} kind="done" /></td>
                          <td><RateCell num={x.late} den={x.judged} kind="late" /></td>
                          <td>{dur(x.delivery)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </DataTable>
              </Section>
            </>
          )}
          <Section title={s.incidents} testId="stats-incidents" aside={<Link to="/consults" className="text-sm text-primary hover:underline" data-testid="stats-consults-link">{s.consultsLink} ›</Link>}>
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

/**
 * 비율 칸(2026-11-23 사용자 "운영통계 탭 눈에 안 들어온다") — 숫자 옆 작은 막대. 완료율은 초록, 지연율은 주황.
 * 분모가 0 이면 "—"(0% 로 보이지 않는다). 좋고 나쁨의 기준선은 정책에 없어 색 세기를 바꾸지 않는다.
 */
function RateCell({ num, den, kind }: { readonly num: number; readonly den: number; readonly kind: 'done' | 'late' }) {
  if (den <= 0) return <span className="text-base-content/40">—</span>;
  const w = Math.min(100, Math.round((num / den) * 100));
  return (
    <span className="inline-flex min-w-28 items-center gap-2" data-testid={`rate-${kind}`}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-base-200" aria-hidden="true">
        <span className={`block h-full rounded-full ${kind === 'done' ? 'bg-success' : 'bg-warning'}`} style={{ width: `${w}%` }} />
      </span>
      <span className="tabular-nums">{pct(num, den)}</span>
    </span>
  );
}

/** 날짜별 완료·실패 막대(왼쪽이 오래된 날). 높이는 그 기간에서 가장 많은 날 기준. 날이 많으면 날짜 글자는 5일마다. */
function DailyChart({ days }: { readonly days: ReadonlyArray<readonly [string, readonly ExecRow[]]> }) {
  const pts = [...days].reverse().map(([d, rs]) => {
    const x = agg(rs);
    return { d, done: x.completed, failed: x.failed };
  });
  const max = Math.max(1, ...pts.map((p) => p.done + p.failed));
  const sparse = pts.length > 10;
  return (
    <div className="mb-4" data-testid="stats-daily-chart">
      <div className="mb-2 flex items-center gap-3 text-xs text-base-content/70">
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-success" aria-hidden="true" />
          {s.legendDone}
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-error" aria-hidden="true" />
          {s.legendFailed}
        </span>
      </div>
      <div className="flex h-36 items-end gap-1.5" role="img" aria-label={`${s.dailyChart(pts.length)}: ${pts.map((p) => `${p.d} 완료 ${p.done} 실패 ${p.failed}`).join(', ')}`}>
        {pts.map((p, i) => {
          const sum = p.done + p.failed;
          return (
            <div key={p.d} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="text-xs font-semibold tabular-nums">{sum}</span>
              <div className="flex w-full max-w-10 flex-col overflow-hidden rounded-t" style={{ height: `${(sum / max) * 100}%`, minHeight: sum > 0 ? 3 : 0 }}>
                <div className="bg-error/85" style={{ flexGrow: p.failed }} />
                <div className="bg-success/85" style={{ flexGrow: p.done }} />
              </div>
              <span className="h-4 text-[11px] text-base-content/60">{!sparse || i % 5 === 0 || i === pts.length - 1 ? p.d.slice(5) : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 카드 — 제목 + 한 줄 설명 */
function HeroCard({ title, sub, testId, children }: { readonly title: string; readonly sub: string; readonly testId: string; readonly children: ReactNode }) {
  return (
    <section className="st-card rounded-box border border-base-300 bg-base-100 p-5" aria-label={title} data-testid={testId}>
      <h2 className="text-base font-bold">{title}</h2>
      <p className="mb-4 text-xs text-base-content/60">{sub}</p>
      {children}
    </section>
  );
}

/** 큰 원(한 가지 대표 비율). 분모 0 이면 원은 비우고 "—" */
function Ring({ num, den, label, hint, testId }: { readonly num: number; readonly den: number; readonly label: string; readonly hint: string; readonly testId: string }) {
  const p = den > 0 ? num / den : 0;
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex shrink-0 flex-col items-center" data-testid={testId}>
      <div className="relative h-28 w-28">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-base-200)" strokeWidth="10" />
          {den > 0 && <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-success)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} />}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-2xl font-extrabold tabular-nums">{pct(num, den)}</span>
      </div>
      <span className="mt-1 text-sm font-semibold">{label}</span>
      <span className="text-xs text-base-content/60">{hint}</span>
    </div>
  );
}

const TONE: Record<'good' | 'warn' | 'bad' | 'neutral', string> = { good: 'bg-success', warn: 'bg-warning', bad: 'bg-error', neutral: 'bg-info' };

/** 비율 한 줄 — 이름 · 값(오른쪽) · 막대 · 건수. 분모 0·못 읽음은 막대 없이 사유 */
function RateBar({ label, num, den, hint, tone, unavailable = false, to, testId }: { readonly label: string; readonly num: number; readonly den: number; readonly hint: string; readonly tone: keyof typeof TONE; readonly unavailable?: boolean; readonly to?: string; readonly testId: string }) {
  const empty = unavailable || den <= 0;
  return (
    <div data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        {to ? (
          <Link to={to} className="text-sm text-base-content/80 underline decoration-dotted underline-offset-4 hover:text-primary" data-testid={`${testId}-link`}>
            {label} ›
          </Link>
        ) : (
          <span className="text-sm text-base-content/80">{label}</span>
        )}
        <span className="text-lg font-bold tabular-nums">{empty ? '—' : pct(num, den)}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-base-200" aria-hidden="true">
        {!empty && <div className={`h-full rounded-full ${TONE[tone]}`} style={{ width: `${Math.min(100, (num / den) * 100)}%` }} />}
      </div>
      <span className="text-xs text-base-content/60">{hint}</span>
    </div>
  );
}

/** 걸린 시간 — 세 구간을 이은 한 줄(길이 = 평균 시간 비율) + 구간별 값. 값이 없는 구간은 줄에서 빼고 "—" */
function TimeFlow({ legs }: { readonly legs: ReadonlyArray<{ readonly key: string; readonly label: string; readonly sec: number | null; readonly n: number; readonly color: string; readonly testId: string }> }) {
  const known = legs.filter((l) => l.sec !== null && l.sec > 0);
  const sum = known.reduce((x, l) => x + (l.sec ?? 0), 0);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-base-content/70">{s.total}</span>
        <span className="text-3xl font-extrabold tabular-nums" data-testid="tile-total-time">{sum > 0 ? dur(sum) : '—'}</span>
      </div>
      <div className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full bg-base-200" role="img" aria-label={legs.map((l) => `${l.label} ${dur(l.sec)}`).join(', ')}>
        {known.map((l) => (
          <span key={l.key} style={{ flexGrow: l.sec ?? 0, backgroundColor: l.color }} />
        ))}
      </div>
      <ol className="mt-4 space-y-2.5">
        {legs.map((l) => (
          <li key={l.key} className="flex items-center gap-2 text-sm" data-testid={l.testId}>
            <i className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: l.color }} aria-hidden="true" />
            <span className="flex-1 text-base-content/80">{l.label}</span>
            <span className="text-xs text-base-content/50">{s.hint.count(l.n)}</span>
            <b className="w-14 text-right tabular-nums">{dur(l.sec)}</b>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 배정 출처 — 한 줄 쌓은 막대 + 범례(이름·건수·비율) */
function SourceBar({ parts }: { readonly parts: ReadonlyArray<{ readonly label: string; readonly n: number; readonly color: string }> }) {
  const sum = parts.reduce((x, p) => x + p.n, 0);
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-base-200" role="img" aria-label={parts.map((p) => `${p.label} ${p.n}건`).join(', ')}>
        {sum > 0 && parts.filter((p) => p.n > 0).map((p) => <span key={p.label} style={{ flexGrow: p.n, backgroundColor: p.color }} />)}
      </div>
      <ul className="mt-3 grid grid-cols-3 gap-2 text-sm">
        {parts.map((p) => (
          <li key={p.label}>
            <span className="flex items-center gap-1.5 text-base-content/70">
              <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: p.color }} aria-hidden="true" />
              {p.label}
            </span>
            <b className="text-lg tabular-nums">{p.n}</b>
            <span className="ml-1 text-xs text-base-content/50">{pct(p.n, sum)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 배차 실패 사유 — 많은 순 가로 막대(길이 = 가장 많은 사유 기준) */
function ReasonBars({ items }: { readonly items: ReadonlyArray<{ readonly label: string; readonly n: number }> }) {
  if (items.length === 0) return <p className="text-sm text-base-content/60">{s.noFailures}</p>;
  const sorted = [...items].sort((x, y) => y.n - x.n);
  const max = Math.max(1, ...sorted.map((x) => x.n));
  return (
    <ul className="space-y-2.5">
      {sorted.map((x) => (
        <li key={x.label} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3 text-sm">
          <span className="truncate text-base-content/80">{x.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-base-200" aria-hidden="true">
            <span className="block h-full rounded-full bg-base-content/45" style={{ width: `${(x.n / max) * 100}%` }} />
          </span>
          <b className="text-right tabular-nums">{x.n}</b>
        </li>
      ))}
    </ul>
  );
}
