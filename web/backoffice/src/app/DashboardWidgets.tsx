// 대시보드 2판(2026-11-18 사용자 "대시보드가 아직 약하다 — Eum·추천 사이트를 더 참고해 잘 조합"):
// - Eum: 아이콘 색 타일 숫자 카드·자동 갱신 표시·주문 상태 분포·판매 막대.  Shopify·Medusa 홈: 어제 대비 증감·7일 미니 추세선·최근 활동 피드.
// - 숫자는 모두 이미 있는 서버 조회에서만(새 API·새 라이브러리 없음, 그림은 CSS·SVG). 못 읽으면 "?"(0 아님), 쪽 상한(100)은 "100+"·"앞 100건 기준"으로 밝힌다.
// - 금액은 더하지 않는다(서버 집계 요청 docs/handoff/backoffice/2026-11-18-backend-dashboard-metrics.md D2).
import { useStatChange } from '../shared/motion';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { ProblemFailure, request } from '@pmart/web-core';
import { AllCentersTag, useCenterScope, CenterName } from '../shared/centerScope';
import { useApi } from './ApiContext';
import { liveQuery } from './DashboardSections';
import { slaText } from '../features/cases/CaseSlaPage';
import { hideIds } from '../shared/hideIds';
import { messages } from '../shared/messages';
import { caseSummaryText } from '../shared/blockReason';
import { addSeoulDays, label, seoulDayEnd, seoulDayStart } from '../shared/ops';
import { Section } from '../shared/admin';
import { useStockStream } from '../shared/stockStream';
import { ColumnChart, Delta, Insight, Meter, SegmentBar, TrendLine, type Column } from './Charts';

const m = messages.dashboard;
/** 주문 찾기 한 번에 받는 최대 수 — 계약 `GET /orders/lookups` size 최대 50(2026-11-19: 100 으로 묻다가 실서버가 400 → 오늘 주문 "?"였다) */
export const ORDER_SIZE = 50;
const REFRESH_MS = 60_000;

type Api = ReturnType<typeof useApi>;

/** 하루 주문(확정 시각 기준) — 건수·다음 쪽 여부·앞 50건의 상태별 개수. 오늘 카드·7일 막대·상태 도넛이 같은 queryKey */
export function dayQuery(api: Api, day: string) {
  return {
    queryKey: ['dashboard', 'orders-day', day],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const r = await request('GET', api.orders.GET('/orders/lookups', { params: { query: { createdFrom: seoulDayStart(day), createdTo: seoulDayEnd(day), page: 0, size: ORDER_SIZE } } }));
      const byStatus: Record<string, number> = {};
      for (const o of r.items) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
      return { n: r.items.length, more: r.page.hasNext, byStatus };
    },
  };
}

/** CASE_SLA(처리 기한 지킴) 조회 — 숫자 카드·SLA 카드가 같은 queryKey */
/** center: 머리줄 센터 고르기(2026-11-23, bff metrics centerId) — '' 면 모든 센터 */
export function slaQuery(api: Api, from: string, to: string, center = '') {
  return {
    queryKey: ['dashboard', 'sla', from, to, center],
    queryFn: () => request('GET', api.bff.GET('/views/metrics', { params: { query: { metric: 'CASE_SLA', from, to, granularity: 'DAY', ...(center ? { centerId: center } : {}) } } })),
  };
}

const countText = (n: number, more: boolean, size: number) => (more ? `${size}+` : String(n));

// ───────────────────────── 자동 갱신 표시 ─────────────────────────

/** "방금 갱신 · 1분마다" + 지금 새로 고침(Eum "30초마다 자동 갱신") */
export function RefreshBar() {
  const queryClient = useQueryClient();
  const [at, setAt] = useState(() => Date.now());
  const [now, setNow] = useState(at);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.max(0, Math.floor((now - at) / 60_000));
  return (
    <div className="flex items-center gap-2 text-xs text-base-content/55">
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      <span>{mins < 1 ? m.refreshedNow : m.refreshedAgo(mins)}</span>
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        onClick={() => {
          const t = Date.now();
          setAt(t);
          setNow(t);
          void queryClient.invalidateQueries();
        }}
      >
        {m.refresh}
      </button>
    </div>
  );
}

// ───────────────────────── 숫자 카드(오른쪽 세로) ─────────────────────────

// 숫자 카드 아이콘 타일은 2026-11-20 AWS 개편 때 뺐다(icon·tone 은 data- 속성으로만 남김)
type TileTone = 'primary' | 'info' | 'success' | 'warning' | 'error';

function StatCard({ icon, tone, label: title, value, sub, to, testId, children, failed }: { readonly icon: string; readonly tone: TileTone; readonly label: string; readonly value: ReactNode; readonly sub?: ReactNode; readonly to: string; readonly testId: string; readonly children?: ReactNode; readonly failed?: boolean }) {
  const ch = useStatChange(value); // 방금 바뀐 칸만 잠깐 빛남 + ▲▼(2026-11-19)
  return (
    // 2026-11-20 AWS 개편: 아이콘 타일·그림자 없이 흰 상자 + 회색 이름 + 큰 숫자(점선 밑줄 링크)
    // 2026-11-20 통계 개편: 카드가 아니라 숫자 띠의 한 칸(테두리는 띠가), 점선 밑줄 없이 칸 전체가 누르는 곳
    <Link to={to} data-testid={testId} data-icon={icon} data-tone={tone} className={`group flex flex-wrap items-end gap-x-4 gap-y-1 bg-base-100 px-5 py-4 transition-colors hover:bg-base-200/50 ${ch.cls}`}>
      {/* 글 칸은 8rem 아래로 줄지 않는다 — 칸이 좁으면 추세선이 아래 줄로(2026-11-21 "오늘 주문"이 "오…"로 잘리던 것) */}
      <span className="min-w-[8rem] flex-1 self-start">
        <span className="block truncate text-sm text-base-content/70">{title}</span>
        <span className={`inline-block text-[30px] font-semibold leading-tight tracking-tight group-hover:text-primary ${failed ? 'text-base-content/45' : ''}`} title={failed ? m.failed : undefined}>
          {value}
          {ch.badge}
        </span>
        {sub && <span className="block truncate text-xs text-base-content/55">{sub}</span>}
      </span>
      {children}
    </Link>
  );
}

/** 7일 미니 추세선(SVG) — 못 읽은 날이 있으면 그리지 않는다(빈 값을 0 으로 잇지 않는다) */
function Sparkline({ values }: { readonly values: ReadonlyArray<number | null> }) {
  if (values.some((v) => v === null) || values.length < 2) return null;
  return <TrendLine values={values} testId="dash-sparkline" className="mb-1 h-10 w-24" />;
}

/** 오늘 주문 — 어제 대비 증감 + 7일 추세선 */
export function TodayOrdersStat({ days }: { readonly days: readonly string[] }) {
  const api = useApi();
  const qs = useQueries({ queries: days.map((d) => dayQuery(api, d)) });
  const t = qs.at(-1)!;
  const y = qs.at(-2);
  const value = t.data ? countText(t.data.n, t.data.more, ORDER_SIZE) : t.isError ? '?' : '…';
  let sub: ReactNode = m.toOrders;
  if (t.data && y?.data && !t.data.more && !y.data.more) {
    const d = t.data.n - y.data.n;
    sub = <span className={d > 0 ? 'text-success' : d < 0 ? 'text-error' : ''}>{m.vsYesterday(d)}</span>;
  }
  return (
    <StatCard icon="cart" tone="primary" label={m.todayOrders} value={value} sub={sub} to="/orders" testId="dash-kpi-orders" failed={t.isError}>
      <Sparkline values={qs.map((q) => (q.data && !q.data.more ? q.data.n : null))} />
    </StatCard>
  );
}

/** 진행 중 배송 — 실시간 배송 첫 쪽(대시보드의 "지금 배송"과 같은 조회) */
export function LiveStat() {
  const api = useApi();
  const q = useQuery(liveQuery(api));
  const items = q.data?.items ?? [];
  const now = q.data?.composedAt ? Date.parse(q.data.composedAt) : Number.NaN;
  const late = items.filter((i) => !!i.promisedAt && Date.parse(i.promisedAt) < now).length;
  const more = Boolean(q.data?.page?.nextCursor);
  return (
    <StatCard
      icon="truck"
      tone={late > 0 ? 'error' : 'info'}
      label={m.liveNow}
      value={q.data ? `${items.length}${more ? '+' : ''}` : q.isError ? '?' : '…'}
      sub={q.data ? (late > 0 ? <span className="text-error">{m.lateCount(late)}</span> : m.noLate) : undefined}
      to="/live-delivery"
      testId="dash-stat-live"
      failed={q.isError}
    />
  );
}

/** 처리 기한 지킴(7일) — 서버 분자·분모 */
const ratioOf = (totals: ReadonlyArray<{ readonly numerator: number; readonly denominator: number }> | undefined) => {
  let numerator = 0;
  let denominator = 0;
  for (const t of totals ?? []) {
    numerator += t.numerator;
    denominator += t.denominator;
  }
  return { numerator, denominator, ratio: denominator === 0 ? null : numerator / denominator };
};

export function SlaStat({ from, to }: { readonly from: string; readonly to: string }) {
  const api = useApi();
  const center = useCenterScope(); // 머리줄 센터 고르기(2026-11-23)
  const q = useQuery(slaQuery(api, from, to, center));
  // 지난 7일과 비교(2026-11-18 사용자 "숫자만 보고 좋은지 나쁜지 알게") — 같은 서버 지표를 바로 앞 7일로 한 번 더 읽어 %p 차이만 보인다.
  // 목표치는 서버에 없어 만들지 않는다. 앞 기간을 못 읽었거나 판정된 건이 없으면 비교를 보이지 않는다(0 과 비교하지 않는다).
  const prev = useQuery(slaQuery(api, addSeoulDays(from, -7), addSeoulDays(from, -1), center));
  const { numerator, denominator, ratio } = ratioOf(q.data?.totals);
  const t = slaText({ numerator, denominator });
  const before = prev.data ? ratioOf(prev.data.totals).ratio : null;
  const diff = ratio !== null && before !== null ? Math.round((ratio - before) * 1000) / 10 : null;
  const sub = q.data ? (
    <>
      {t.count}
      {diff !== null && (
        <span className={`ml-1.5 ${diff > 0 ? 'text-success' : diff < 0 ? 'text-error' : ''}`} data-testid="dash-sla-vs-prev">
          {m.vsPrevWeek(diff)}
        </span>
      )}
    </>
  ) : undefined;
  return (
    <StatCard
      icon="clock"
      tone={ratio === null ? 'info' : ratio >= 0.9 ? 'success' : ratio >= 0.7 ? 'warning' : 'error'}
      label={m.slaShort}
      value={q.data ? t.ratio : q.isError ? '?' : '…'}
      sub={sub}
      to="/case-sla"
      testId="dash-stat-sla"
      failed={q.isError}
    />
  );
}

/** 운영 위험 합계 — 처리 대기 전체(결제 결과 불명 따로 표시) */
export function RiskStat() {
  const api = useApi();
  const center = useCenterScope(); // 머리줄 센터 고르기(2026-11-23)
  const q = useQuery({ queryKey: ['bff', 'pending-work', center], refetchInterval: REFRESH_MS, queryFn: () => request('GET', api.bff.GET('/views/pending-work', center ? { params: { query: { centerId: center } } } : {})) });
  const items = q.data?.items ?? [];
  const pay = items.filter((i) => i.kind === 'STUCK_SAGA' && i.reasonCode === 'PAYMENT_UNKNOWN').length;
  return (
    <StatCard
      icon="alert"
      tone={items.length > 0 ? 'warning' : 'success'}
      label={m.riskTotal}
      value={q.data ? `${items.length}${q.data.truncated ? '+' : ''}` : q.isError ? '?' : '…'}
      sub={q.data ? (pay > 0 ? <span className="text-error">{m.paymentUnknownCount(pay)}</span> : m.noPaymentUnknown) : undefined}
      to="/pending"
      testId="dash-stat-risk"
      failed={q.isError}
    />
  );
}

// ───────────────────────── 7일 주문 막대 ─────────────────────────
// 2026-11-20 그림 개편: 얇은 막대(24px)·실선 눈금·값은 오늘·최고만(나머지는 눈금·도움말). 관리자는 주문 요약(order 0.13.0)을 하루씩 불러
// 50건 상한 없이 정확한 건수와 결제 승인 금액을 본다(주문 수 | 결제 금액 바꿔 보기 — 두 축을 한 그림에 겹치지 않는다). 그 밖 역할은 주문 찾기 첫 쪽(50+ 로 밝힘).

/** 주문 요약(관리자만 — order `GET /orders/metrics/summary`). 매출 칸·7일 막대·오늘 상태가 같은 queryKey */
/** center: 머리줄 센터 고르기(2026-11-23, order metrics mfcId) — '' 면 모든 센터 */
export function summaryQuery(api: Api, from: string, to: string, center = '') {
  return {
    queryKey: ['dashboard', 'sales', 'summary', from, to, center],
    refetchInterval: REFRESH_MS,
    retry: false,
    queryFn: () => request('GET', api.orders.GET('/orders/metrics/summary', { params: { query: { from, to, ...(center ? { mfcId: center } : {}) } } })),
  };
}

const dayLabel = (d: string, today: boolean) => (today ? m.today : d.slice(5).replace('-', '.'));
const krwShort = (n: number) => (n >= 10_000 ? `${(n / 10_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만원` : `${n.toLocaleString('ko-KR')}원`);

export function OrdersWeekChart({ days, admin = false }: { readonly days: readonly string[]; readonly admin?: boolean }) {
  const api = useApi();
  const center = useCenterScope(); // 머리줄 센터 고르기(2026-11-23)
  const [measure, setMeasure] = useState<'count' | 'amount'>('count');
  const lookups = useQueries({ queries: days.map((d) => ({ ...dayQuery(api, d), enabled: !admin })) });
  const sums = useQueries({ queries: days.map((d) => ({ ...summaryQuery(api, d, d, center), enabled: admin })) });
  const amount = admin && measure === 'amount';
  const raw = days.map((_, i) => {
    if (admin) {
      const q = sums[i]!;
      return { failed: q.isError, loading: q.isPending, count: q.data?.orderCount ?? null, more: false, won: q.data?.approvedAmount ?? null };
    }
    const q = lookups[i]!;
    return { failed: q.isError, loading: q.isPending, count: q.data?.n ?? null, more: q.data?.more ?? false, won: null };
  });
  const vals = raw.map((r) => (amount ? r.won : r.count));
  const max = Math.max(...vals.map((v) => v ?? -1));
  const maxAt = vals.findIndex((v) => v === max && max > 0);
  const columns: Column[] = days.map((d, i) => {
    const r = raw[i]!;
    const today = i === days.length - 1;
    const v = vals[i] ?? null;
    const shown = r.failed ? '?' : r.loading ? '…' : amount ? krwShort(r.won ?? 0) : r.more ? `${ORDER_SIZE}+` : String(r.count ?? 0);
    const tip: Array<readonly [string, string]> = [[r.failed ? m.failed : r.more ? `${ORDER_SIZE}건 이상` : `${r.count ?? 0}건`, m.chart.orders]];
    if (admin) tip.push([r.failed ? m.failed : `${(r.won ?? 0).toLocaleString('ko-KR')}원`, m.chart.approved]);
    return {
      key: d,
      label: dayLabel(d, today),
      title: d,
      value: r.failed ? null : (v ?? 0),
      cap: r.failed || r.loading || today || i === maxAt ? shown : undefined,
      strong: today,
      loading: r.loading,
      tip,
    };
  });
  // 기간 합 — 모두 읽었고 상한에 걸리지 않았을 때만(하나라도 빠지면 합을 보이지 않는다)
  const exact = raw.every((r) => !r.failed && !r.loading && !r.more);
  const total = exact ? raw.reduce((s, r) => s + ((amount ? r.won : r.count) ?? 0), 0) : null;
  // 하루 평균(건수만 — 금액은 서버 합을 나누지 않는다) · 가장 많은 날
  const avgCount = !amount && total !== null ? total / days.length : null;
  const peak = maxAt >= 0 ? columns[maxAt] : undefined;
  return (
    <Section
      title={m.ordersWeek}
      testId="dash-orders-week"
      aside={
        admin ? (
          <div role="radiogroup" aria-label={m.chart.measure} className="inline-flex rounded-field border border-base-300 p-0.5 text-xs">
            {(['count', 'amount'] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={measure === k} className={`rounded px-2.5 py-1 ${measure === k ? 'bg-base-200 font-semibold text-base-content' : 'text-base-content/60 hover:text-base-content'}`} onClick={() => setMeasure(k)}>
                {k === 'count' ? m.chart.orders : m.chart.approved}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      <div className="-mt-2 mb-4 space-y-1" data-testid="dash-week-total">
        <Insight>
          {total === null ? m.chart.totalUnknown : amount ? m.chart.totalWon(total.toLocaleString('ko-KR')) : m.chart.totalCount(total)}
          {total !== null && peak && <span className="text-base-content/60">{` · ${m.chart.peak(peak.label, peak.cap ?? '')}`}</span>}
          {avgCount !== null && <span className="text-base-content/60">{` · ${m.chart.avg(avgCount)}`}</span>}
        </Insight>
        <p className="pl-6 text-xs text-base-content/45">{admin ? m.chart.basisSummary : m.chart.basisLookup}</p>
      </div>
      <ColumnChart columns={columns} big={amount} testIdCol="dash-day" label={m.ordersWeek} avg={avgCount !== null && avgCount > 0 ? { value: avgCount, text: m.chart.avgShort(avgCount) } : null} />
    </Section>
  );
}

// ───────────────────────── 오늘 주문 흐름 ─────────────────────────
// 2026-11-20 사용자 "줄다리기하냐, 목적에 맞게": 이 칸의 목적은 "오늘 주문이 어디까지 왔고 막힌 게 있나".
// 그래서 몫(%) 그림 대신 흐름 단계 칸(확정 → 상품 준비 → 배송 중 → 완료)에 건수, 그 아래 따로 봐야 할 것(결제 확인 중 등 앞 단계·취소·만료).
// 숫자를 누르면 그 상태·오늘로 거른 주문 조회. 일부 인계·일부 전달은 앞 단계 칸에 더하고 "일부 N 포함"으로 밝힌다.

const FLOW_STAGES: ReadonlyArray<{ readonly key: string; readonly statuses: readonly string[] }> = [
  { key: 'CONFIRMED', statuses: ['CONFIRMED'] },
  { key: 'PREPARING', statuses: ['PREPARING', 'PARTIALLY_HANDED_OVER'] },
  { key: 'IN_DELIVERY', statuses: ['IN_DELIVERY', 'PARTIALLY_DELIVERED'] },
  { key: 'COMPLETED', statuses: ['COMPLETED'] },
];
const FLOW_KNOWN = new Set(FLOW_STAGES.flatMap((s) => s.statuses));
const OFF = new Set(['CANCELLED', 'EXPIRED']);

/** 오늘 주문 흐름 — 관리자는 주문 요약(정확), 그 밖은 오늘 주문 찾기 앞 50건(더 있으면 그렇게 밝힌다) */
export function StatusDonut({ today, admin = false }: { readonly today: string; readonly admin?: boolean }) {
  const api = useApi();
  const center = useCenterScope(); // 머리줄 센터 고르기(2026-11-23)
  const look = useQuery({ ...dayQuery(api, today), enabled: !admin });
  const sum = useQuery({ ...summaryQuery(api, today, today, center), enabled: admin });
  const pending = admin ? sum.isPending : look.isPending;
  const failed = admin ? sum.isError : look.isError;
  const counts: Record<string, number> = admin ? Object.fromEntries((sum.data?.statusCounts ?? []).map((c) => [c.status, c.count])) : (look.data?.byStatus ?? {});
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const more = !admin && Boolean(look.data?.more);
  const to = (status: string) => `/orders?status=${encodeURIComponent(status)}&from=${today}&to=${today}`;
  const name = (s: string) => label(messages.orders.statusName, s);
  // 흐름 밖: 결제·자원 확인 등 앞 단계(주의), 취소·만료(회색)
  const side = Object.entries(counts).filter(([s, n]) => n > 0 && !FLOW_KNOWN.has(s));
  return (
    <Section title={m.statusToday} aside={more ? <span className="text-xs text-warning">{m.first100}</span> : undefined} testId="dash-status-donut">
      {pending ? (
        <p className="text-sm text-base-content/50">…</p>
      ) : failed ? (
        <p className="text-sm text-warning">{m.ordersFailed}</p>
      ) : total === 0 ? (
        <p className="py-8 text-center text-sm text-base-content/55">{m.noOrdersToday}</p>
      ) : (
        <div className="space-y-4">
          <p className="flex items-baseline gap-1 text-sm text-base-content/60">
            {m.flow.total}
            <span className="ml-1 text-2xl font-semibold text-base-content">{more ? `${ORDER_SIZE}+` : total}</span>
            <span>{m.ordersUnit}</span>
          </p>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="dash-status-flow" aria-label={m.flow.label}>
            {FLOW_STAGES.map((st, i) => {
              const n = st.statuses.reduce((a, s) => a + (counts[s] ?? 0), 0);
              const partial = st.statuses.slice(1).reduce((a, s) => a + (counts[s] ?? 0), 0);
              const last = i === FLOW_STAGES.length - 1;
              return (
                <li key={st.key} className="relative">
                  <Link
                    to={to(st.key)}
                    className={`flex h-full flex-col rounded-box border px-3 py-2.5 transition-colors hover:border-primary/60 ${n > 0 ? (last ? 'border-success/40 bg-success/5' : 'border-base-300 bg-base-100') : 'border-base-300 bg-base-200/40'}`}
                    data-testid="dash-flow-stage"
                  >
                    <span className="text-xs text-base-content/60">{name(st.key)}</span>
                    <span className={`text-2xl font-semibold leading-tight ${n > 0 ? '' : 'text-base-content/45'}`}>{n}</span>
                    {partial > 0 && <span className="text-[11px] text-base-content/50">{m.flow.partial(partial)}</span>}
                  </Link>
                  {!last && <span className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 text-base-content/45 sm:block" aria-hidden="true">›</span>}
                </li>
              );
            })}
          </ol>
          {/* 흐름 밖 — 따로 봐야 할 것. 없으면 "없음" 한 줄 */}
          <ul className="space-y-1 border-t border-base-300 pt-3 text-sm" data-testid="dash-status-legend">
            {side.length === 0 ? (
              <li className="text-xs text-base-content/50">{m.flow.noSide}</li>
            ) : (
              side.map(([s, n]) => (
                <li key={s} className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${OFF.has(s) ? 'bg-base-content/30' : 'bg-warning'}`} aria-hidden="true" />
                  <Link to={to(s)} className="min-w-0 flex-1 truncate hover:text-primary hover:underline" title={s}>
                    {name(s)}
                  </Link>
                  <span className={`font-semibold tabular-nums ${OFF.has(s) ? 'text-base-content/60' : 'text-warning'}`}>{n}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </Section>
  );
}

// ───────────────────────── 최근 활동 ─────────────────────────

// 2026-11-20 사용자 "최근 활동이 뭘 말하는 건지 모르겠다·글이 길어 끊긴다" — "새로 들어온 일" 한 줄 목록으로:
// [종류 꼬리표] 짧은 이름(접수 건 종류·문의 종류·승인 유형) …… 몇 시간 전. 긴 요약 문장은 줄에 마우스를 올리면(title) 보인다.
type Activity = { readonly at: string; readonly kind: 'approval' | 'case' | 'inquiry'; readonly what: string; readonly full: string; readonly to: string };
const ACT_CHIP: Record<Activity['kind'], { readonly label: string; readonly cls: string }> = {
  // 2026-11-20 AWS 색 줄이기: 색 칩 대신 회색 글자(무엇인지는 글자로)
  approval: { label: m.act.chip.approval, cls: 'text-base-content/60' },
  case: { label: m.act.chip.case, cls: 'text-base-content/60' },
  inquiry: { label: m.act.chip.inquiry, cls: 'text-base-content/60' },
};

function ago(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  const a = messages.approvals.ago;
  if (!Number.isFinite(min) || min < 1) return a.now;
  if (min < 60) return a.min(min);
  if (min < 60 * 24) return a.hour(Math.floor(min / 60));
  return a.day(Math.floor(min / (60 * 24)));
}

/** 새로 들어온 일 — 승인 요청·접수 건·고객 문의 첫 쪽 5건씩을 시각순으로(보이는 메뉴만, 못 읽은 원천은 아래에 밝힘) */
export function ActivityFeed({ approvals, cases, inquiries }: { readonly approvals: boolean; readonly cases: boolean; readonly inquiries: boolean }) {
  const api = useApi();
  const center = useCenterScope(); // 머리줄 센터 고르기(2026-11-23)
  const a = useQuery({
    queryKey: ['dashboard', 'activity', 'approvals'],
    enabled: approvals,
    refetchInterval: REFRESH_MS,
    queryFn: () => request('GET', api.approval.GET('/approvals', { params: { query: { size: 5 } } })),
  });
  const c = useQuery({
    queryKey: ['dashboard', 'activity', 'cases', center],
    enabled: cases,
    refetchInterval: REFRESH_MS,
    queryFn: () => request('GET', api.cases.GET('/cases', { params: { query: { size: 5, ...(center ? { centerId: center } : {}) } } })),
  });
  const q = useQuery({
    queryKey: ['dashboard', 'activity', 'inquiries'],
    enabled: inquiries,
    refetchInterval: REFRESH_MS,
    queryFn: () => request('GET', api.cases.GET('/inquiries', { params: { query: { requesterType: 'CUSTOMER', size: 5 } } })),
  });
  const list: Activity[] = [];
  for (const x of a.data?.items ?? [])
    if (x.submittedAt && x.approvalId) {
      const type = messages.approvals.typeName[x.type ?? ''] ?? x.type ?? '';
      list.push({ at: x.submittedAt, kind: 'approval', what: m.act.approvalWhat(type), full: hideIds(x.summary), to: `/approvals/${encodeURIComponent(x.approvalId)}` });
    }
  for (const x of c.data?.items ?? [])
    if (x.openedAt && x.caseId) list.push({ at: x.openedAt, kind: 'case', what: label(messages.cases.kindName, x.kind ?? null), full: caseSummaryText(x.summary), to: `/cases/${encodeURIComponent(x.caseId)}` });
  for (const x of q.data?.items ?? [])
    list.push({ at: x.createdAt, kind: 'inquiry', what: m.act.inquiryWhat(label(messages.inquiries.categoryName, x.category)), full: x.title ?? '', to: `/inquiries/${encodeURIComponent(x.inquiryId)}` });
  list.sort((p, n) => n.at.localeCompare(p.at));
  // 종류마다 최근 2건은 남긴다(2026-11-21 점검 — 접수 건이 많으면 문의·승인이 8칸에서 밀려 안 보였다). 나머지 칸은 시각순으로 채운다
  const shown = new Set<Activity>();
  for (const kind of ['case', 'inquiry', 'approval'] as const) for (const x of list.filter((y) => y.kind === kind).slice(0, 2)) shown.add(x);
  for (const x of list) if (shown.size < 8) shown.add(x);
  const feed = list.filter((x) => shown.has(x)).slice(0, 8);
  const failed = [approvals && a.isError && m.act.sourceApproval, cases && c.isError && m.act.sourceCase, inquiries && q.isError && m.act.sourceInquiry].filter(Boolean) as string[];
  const loading = (approvals && a.isPending) || (cases && c.isPending) || (inquiries && q.isPending);
  return (
    <Section title={m.act.title} testId="dash-activity">
      {list.length === 0 ? (
        <p className="py-6 text-center text-sm text-base-content/55">{loading ? '…' : failed.length > 0 ? m.act.allFailed : m.act.none}</p>
      ) : (
        <ul className="-mx-2 divide-y divide-base-200">
          {feed.map((x) => (
            <li key={`${x.kind}-${x.to}`} data-testid="dash-activity-item">
              <Link to={x.to} title={x.full || undefined} className="pm-row-link flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-base-200/60">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${ACT_CHIP[x.kind].cls}`}>{ACT_CHIP[x.kind].label}</span>
                <span className="pm-row-title min-w-0 flex-1 truncate font-medium">{x.what}</span>
                <span className="shrink-0 text-xs tabular-nums text-base-content/50">{ago(x.at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {failed.length > 0 && list.length > 0 && <p className="mt-3 text-xs text-warning" data-testid="dash-activity-failed">{m.act.failed(failed.join(', '))}</p>}
    </Section>
  );
}

// ───────────────────────── 지표(준비 중 포함) ─────────────────────────
// 백엔드 회신 2026-11-18(reply-dashboard-approval·notice-metrics-case-sla):
// - (bff 0.21.0, 2026-11-19) 정시 배송률 ON_TIME_DELIVERY: 분자 onTime·분모 due(늦음엔 전달 전·실패 포함). 약속 전(pending)·판단 밖(unjudged — 고객 수령 확인·자동 완료)은 분모 밖이라 옆에 따로 적는다.
// - 결품률(SHORTAGE_RATE)·정시 배송률(ON_TIME_DELIVERY)은 bff 지표 조회에 있지만 배포 전이면 501 — 물어서 501 이면 "준비 중", 구현되면 저절로 숫자.
// - 센터별 품절 SKU 는 원천 API 작업 중(IV-5) — 부를 곳이 없어 자리만.
// 2026-11-20 그림 개편: 점선 상자 대신 줄 목록 — 큰 비율 + 분자/분모 + 하루별 비율 추세선(분모 0 인 날은 끊는다). 준비 중은 한 줄로 작게.

type MetricCell = { readonly key: string; readonly label: string; readonly note: string };

function isNotImplemented(e: unknown): boolean {
  return e instanceof ProblemFailure && (e.problem.status === 501 || e.problem.code === 'NOT_IMPLEMENTED');
}

/**
 * 센터별 품절 상품 수(mfc-inventory 0.28.0 `GET /stock-summaries` — 지금 값, 기간과 무관). 취급 상품 중 가용 ≤ 0. 못 읽으면 "?"(0 아님)
 * 실시간(0.46.0 `/stock-stream`, 2026-11-24): 가용이 0 경계를 넘으면(summary-changed) 다시 읽는다 — 연결돼 있는 동안 60초 다시 읽기는 멈추고,
 * 끊기면 "실시간 끊김 — 마지막 HH:MM 기준" 과 함께 60초 다시 읽기로 돌아간다.
 */
function SoldOutRow() {
  const api = useApi();
  const center = useCenterScope(); // 머리줄 센터 고르기(2026-11-23)
  const qc = useQueryClient();
  const queryKey = ['dashboard', 'stock-summaries', center];
  const live = useStockStream(center ? [center] : [], () => void qc.invalidateQueries({ queryKey }));
  const q = useQuery({ queryKey, refetchInterval: live === 'live' ? false : REFRESH_MS, retry: false, queryFn: () => readStockSummaries(api, center) });
  const items = q.data?.items ?? [];
  const soldOut = items.reduce((s, i) => s + i.soldOutSkuCount, 0);
  const handled = items.reduce((s, i) => s + i.handledSkuCount, 0);
  return (
    <>
    <li className="flex items-center gap-4 py-3" data-testid="dash-metric-soldOut">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 whitespace-nowrap text-sm text-base-content/70">
          {m.metrics.soldOut}
          {live === 'live' && (
            <span className="inline-flex items-center gap-1 text-[11px] text-success" data-testid="dash-soldout-live">
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
              {m.metrics.soldOutLive}
            </span>
          )}
        </span>
        <span className={`block text-[28px] font-semibold leading-tight ${q.isError ? 'text-base-content/40' : soldOut > 0 ? 'text-error' : ''}`} title={q.isError ? m.failed : undefined}>
          {q.isPending ? '…' : q.isError ? '?' : `${soldOut.toLocaleString('ko-KR')}개`}
        </span>
        <span className="block truncate text-xs text-base-content/55">{q.isError ? m.failed : q.data ? m.metrics.soldOutOf(handled) : m.metrics.soldOutNote}</span>
        {live === 'down' && (
          <span className="block truncate text-xs text-warning" data-testid="dash-soldout-down">
            {m.metrics.soldOutDown(q.dataUpdatedAt ? new Date(q.dataUpdatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }) : null)}
          </span>
        )}
      </span>
      {/* 센터별 — 취급 중 품절 몫 막대(센터가 둘 이상일 때) */}
      {items.length > 1 && (
        <ul className="w-40 shrink-0 space-y-1.5 text-[11px]" data-testid="dash-soldout-centers">
          {items.map((i) => (
            <li key={i.mfcId}>
              <span className="flex justify-between gap-2">
                <span className="truncate text-base-content/60"><CenterName id={i.mfcId} /></span>
                <span className="font-semibold tabular-nums">{i.soldOutSkuCount}</span>
              </span>
              <Meter value={i.handledSkuCount > 0 ? i.soldOutSkuCount / i.handledSkuCount : null} tone={i.soldOutSkuCount > 0 ? 'danger' : 'neutral'} className="-mt-0.5 w-full" />
            </li>
          ))}
        </ul>
      )}
    </li>
    <LowStockRow pending={q.isPending} failed={q.isError} items={items} />
    </>
  );
}

type StockSummary = NonNullable<Awaited<ReturnType<typeof readStockSummaries>>>['items'][number];
type ApiOf = ReturnType<typeof useApi>;
const readStockSummaries = (api: ApiOf, center: string | null) => request('GET', api.mfcInventory.GET('/stock-summaries', center ? { params: { query: { mfcId: center } } } : {}));

/** 곧 품절 기준 한 줄 — 센터가 모두 같은 하루 판매량 기준이면 그 값, 다르면 "센터 정책", 기준을 못 받은 센터가 있으면 그렇다고 */
function lowStockBasisText(items: readonly StockSummary[]): string {
  const bases = items.map((i) => i.lowStockBasis ?? null);
  if (bases.length === 0 || bases.some((b) => b === null)) return m.metrics.lowStockNoBasis;
  const first = bases[0]!;
  const same = bases.every((b) => b!.uniform && b!.safetyDays === first.safetyDays && b!.averageWindowDays === first.averageWindowDays);
  return same && first.safetyDays != null && first.averageWindowDays != null ? m.metrics.lowStockBasis(first.safetyDays, first.averageWindowDays) : m.metrics.lowStockPolicy;
}

/**
 * 곧 품절 상품 수(mfc-inventory 0.47.0 `lowStockSkuCount` — 취급 ON 중 0 < 가용 ≤ 하루 판매량 × safetyDays, 품절과 겹치지 않음).
 * 품절 칸과 같은 조회·같은 실시간(SS 경계에서도 summary-changed). 기준을 몰라 못 센 상품은 0 으로 넣지 않고 따로 적는다.
 */
function LowStockRow({ pending, failed, items }: { readonly pending: boolean; readonly failed: boolean; readonly items: readonly StockSummary[] }) {
  // 0.47.0 전 서버면 칸이 없다 — 0 이 아니라 "?"
  const known = items.every((i) => typeof i.lowStockSkuCount === 'number' && typeof i.lowStockUnknownSkuCount === 'number');
  const low = items.reduce((s, i) => s + i.lowStockSkuCount, 0);
  const unknown = items.reduce((s, i) => s + i.lowStockUnknownSkuCount, 0);
  const bad = failed || !known;
  return (
    <li className="flex items-center gap-4 py-3" data-testid="dash-metric-lowStock">
      <span className="min-w-0 flex-1">
        <span className="block whitespace-nowrap text-sm text-base-content/70">{m.metrics.lowStock}</span>
        <span className={`block text-[28px] font-semibold leading-tight ${bad ? 'text-base-content/40' : low > 0 ? 'text-warning' : ''}`} title={bad ? m.failed : undefined}>
          {pending ? '…' : bad ? '?' : `${low.toLocaleString('ko-KR')}개`}
        </span>
        <span className="block truncate text-xs text-base-content/55" data-testid="dash-lowstock-basis">
          {bad ? m.failed : pending ? '' : lowStockBasisText(items)}
        </span>
        {!bad && !pending && unknown > 0 && (
          <span className="block truncate text-[11px] text-base-content/45" data-testid="dash-lowstock-unknown">
            {m.metrics.lowStockUnknown(unknown)}
          </span>
        )}
      </span>
      {!bad && items.length > 1 && (
        <ul className="w-40 shrink-0 space-y-1.5 text-[11px]" data-testid="dash-lowstock-centers">
          {items.map((i) => (
            <li key={i.mfcId}>
              <span className="flex justify-between gap-2">
                <span className="truncate text-base-content/60"><CenterName id={i.mfcId} /></span>
                <span className="font-semibold tabular-nums">{i.lowStockSkuCount}</span>
              </span>
              <Meter value={i.handledSkuCount > 0 ? i.lowStockSkuCount / i.handledSkuCount : null} tone={i.lowStockSkuCount > 0 ? 'warning' : 'neutral'} className="-mt-0.5 w-full" />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function MetricsPanel({ from, to }: { readonly from: string; readonly to: string }) {
  const api = useApi();
  const center = useCenterScope(); // 머리줄 센터 고르기(2026-11-23)
  const days: string[] = [];
  for (let d = from; d <= to && days.length < 31; d = addSeoulDays(d, 1)) days.push(d);
  const live: MetricCell[] = [
    { key: 'ON_TIME_DELIVERY', label: m.metrics.onTime, note: m.metrics.onTimeNote },
    { key: 'SHORTAGE_RATE', label: m.metrics.shortage, note: m.metrics.shortageNote },
  ];
  const qs = useQueries({
    queries: live.map((c) => ({
      queryKey: ['dashboard', 'metric', c.key, from, to, center],
      retry: false,
      queryFn: () => request('GET', api.bff.GET('/views/metrics', { params: { query: { metric: c.key as 'SHORTAGE_RATE' | 'ON_TIME_DELIVERY', from, to, granularity: 'DAY', ...(center ? { centerId: center } : {}) } } })),
    })),
  });
  return (
    <Section title={m.metrics.title} aside={<span className="text-xs text-base-content/50">{m.metrics.hint}</span>} testId="dash-metrics">
      <ul className="-my-2 divide-y divide-base-300/70">
        {live.map((c, i) => {
          const q = qs[i]!;
          if (!q.data) {
            const soon = q.isError && isNotImplemented(q.error);
            return (
              <li key={c.key} className="flex items-baseline justify-between gap-3 py-3" data-testid={`dash-metric-${c.key}`}>
                <span className="min-w-0">
                  <span className="block text-sm text-base-content/70">{c.label}</span>
                  <span className="block truncate text-[11px] text-base-content/45">{q.isError && !soon ? m.failed : c.note}</span>
                </span>
                <span className={`shrink-0 ${soon ? 'text-sm text-base-content/45' : 'text-xl font-semibold text-base-content/40'}`}>{q.isPending ? '…' : soon ? m.metrics.soon : '?'}</span>
              </li>
            );
          }
          let n = 0;
          let d = 0;
          // 분모 밖 칸 — 한 칸이라도 null(원천이 안 줌)이면 합하지 않고 적지 않는다(0 으로 바꾸지 않음)
          let pending: number | null = 0;
          let unjudged: number | null = 0;
          const byDay = new Map<string, number | null>();
          for (const t of q.data.totals ?? []) {
            n += t.numerator;
            d += t.denominator;
            byDay.set(t.bucket.slice(0, 10), t.denominator > 0 ? t.numerator / t.denominator : null);
            pending = pending === null || t.pending === undefined || t.pending === null ? null : pending + t.pending;
            unjudged = unjudged === null || t.unjudged === undefined || t.unjudged === null ? null : unjudged + t.unjudged;
          }
          const t = slaText({ numerator: n, denominator: d });
          // 결품률 사유별(같은 분모, 한 줄에 사유가 둘이면 둘 다 세서 합이 전체보다 클 수 있다 — 계약 그대로 줄 수만 보인다)
          const byReason = new Map<string, number>();
          if (c.key === 'SHORTAGE_RATE') for (const p of q.data.points ?? []) if (p.segment?.reason) byReason.set(p.segment.reason, (byReason.get(p.segment.reason) ?? 0) + p.numerator);
          const reasons = [...byReason.entries()].filter(([, k]) => k > 0).sort((a, b) => b[1] - a[1]);
          return (
            <li key={c.key} className="flex items-center gap-4 py-3" data-testid={`dash-metric-${c.key}`}>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-base-content/70">{c.label}</span>
                <span className="block text-[28px] font-semibold leading-tight">{t.ratio}</span>
                <span className="block truncate text-xs text-base-content/55">{t.count}</span>
                {reasons.length > 0 && (
                  <span className="block truncate text-[11px] text-base-content/55" data-testid="dash-shortage-reasons">
                    {reasons.map(([r, k]) => `${label(m.metrics.reasonName, r)} ${k}`).join(' · ')}
                  </span>
                )}
                {c.key === 'ON_TIME_DELIVERY' && ((pending !== null && pending > 0) || (unjudged !== null && unjudged > 0)) ? (
                  <span className="block truncate text-[11px] text-base-content/45" data-testid="dash-ontime-outside">
                    {m.metrics.onTimeOutside(pending, unjudged)}
                  </span>
                ) : null}
              </span>
              <TrendLine values={days.map((day) => byDay.get(day) ?? null)} {...(c.key === 'SHORTAGE_RATE' ? {} : { max: 1 })} className="h-12 w-32" />
            </li>
          );
        })}
        <SoldOutRow />
      </ul>
    </Section>
  );
}

// ───────────────────────── 지금 일 건수(bff 0.15.0 work-counts — 관리자만) ─────────────────────────
// 백엔드 알림 2026-11-18 notice-bff-work-counts: 원천에서 센 정확한 지금 건수. complete=false 면 "N건 이상".
// 0건 묶음은 줄이 없을 수 있다 — 원천이 unavailableSources 에 없으면 0, 있으면 "확인 못 함"(null).

type WorkGroup = 'CASES' | 'OBLIGATIONS' | 'SHIFT_HANDOVERS' | 'INQUIRIES' | 'PENDING_WORK' | 'APPROVALS' | 'DELIVERIES';
const GROUP_SOURCES: Record<WorkGroup, readonly string[]> = {
  CASES: ['case-service'],
  OBLIGATIONS: ['case-service'],
  SHIFT_HANDOVERS: ['case-service'],
  INQUIRIES: ['case-service'],
  PENDING_WORK: ['order-orchestration-service', 'order-service', 'mfc-fulfillment-service'],
  APPROVALS: ['approval-service'],
  DELIVERIES: ['delivery-execution-service'],
};

export interface WorkSum {
  readonly value: number;
  readonly complete: boolean;
  /** bff 0.24.0 — 센터를 골랐는데 이 묶음 원천을 센터로 못 걸렀다(모든 센터 값) */
  readonly allCenters?: boolean;
}

export function workCountsQuery(api: Api, center = '') {
  return {
    queryKey: ['dashboard', 'work-counts', center],
    refetchInterval: REFRESH_MS,
    retry: false,
    queryFn: () => request('GET', api.bff.GET('/views/work-counts', center ? { params: { query: { centerId: center } } } : {})),
  };
}

/** 관리자만 부른다(그 밖 403). 반환: 묶음·셈(·나눔)의 합 — 읽는 중 undefined, 원천 실패 null */
export function useWorkCounts(enabled: boolean) {
  const api = useApi();
  const center = useCenterScope(); // 머리줄 센터 고르기(2026-11-23, bff BF-4)
  const q = useQuery({ ...workCountsQuery(api, center), enabled });
  const sum = (group: WorkGroup, key: string, segment?: string): WorkSum | null | undefined => {
    if (!enabled || q.isPending) return undefined;
    if (q.isError) return null;
    const missing = q.data.unavailableSources ?? [];
    if (GROUP_SOURCES[group].some((s) => missing.includes(s)) && !q.data.counts.some((c) => c.group === group)) return null;
    const rows = q.data.counts.filter((c) => c.group === group && c.key === key && (segment === undefined || c.segment === segment));
    // 묶음의 원천이 모두 centerUnfilteredSources 에 있을 때만 "모든 센터"(처리 대기처럼 일부만 거른 묶음은 대시보드 위 안내 한 줄로)
    const unfiltered = q.data.centerUnfilteredSources ?? [];
    const allCenters = GROUP_SOURCES[group].every((s) => unfiltered.includes(s));
    return { value: rows.reduce((n, c) => n + c.value, 0), complete: rows.every((c) => c.complete), ...(allCenters ? { allCenters } : {}) };
  };
  const segments = (group: WorkGroup, key: string) => (q.data ? q.data.counts.filter((c) => c.group === group && c.key === key) : []);
  return { q, sum, segments };
}

export const workText = (s: WorkSum) => (s.complete ? String(s.value) : m.work.atLeast(s.value));

function WorkTile({ label: title, sum, to, tone, testId }: { readonly label: string; readonly sum: WorkSum | null | undefined; readonly to: string; readonly tone: 'error' | 'warning' | 'info'; readonly testId: string }) {
  const has = !!sum && sum.value > 0;
  // 2026-11-20 통계 개편: 숫자는 글자색(0 흐리게), 있을 때만 이름 앞 상태 점. 칸 사이는 머리카락 선
  const dot = { error: 'bg-error', warning: 'bg-warning', info: 'bg-base-content/30' }[tone];
  const ch = useStatChange(sum ? sum.value : undefined);
  return (
    <Link to={to} data-testid={testId} className={`block bg-base-100 px-4 py-3 transition-colors hover:bg-base-200/60 ${ch.cls}`}>
      <p className="flex items-center gap-1.5 truncate text-sm text-base-content/70">
        {has && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />}
        {title}
      </p>
      <p className={`mt-0.5 flex items-center text-[26px] font-semibold leading-tight tracking-tight ${sum === null ? 'text-base-content/40' : has ? (tone === 'error' ? 'text-error' : '') : 'text-base-content/45'}`} title={sum === null ? m.failed : undefined}>
        {sum === undefined ? '…' : sum === null ? m.work.unknown : workText(sum)}
        {ch.badge}
        {sum?.allCenters && <AllCentersTag />}
      </p>
    </Link>
  );
}

/** 지금 일 전체 — 진행 중 배송 상태별 막대 + 후속 처리·교대 인계·처리 중 접수 건·증빙 요청 */
// part 를 주면 그 칸만 — 대시보드 운영 탭이 왼쪽·오른쪽 기둥에 나눠 쌓는다(2026-11-18, 같은 조회 하나)
export function WorkCountsPanel({ part }: { readonly part?: 'deliveries' | 'tiles' } = {}) {
  const { q, sum, segments } = useWorkCounts(true);
  const deliveries = segments('DELIVERIES', 'ACTIVE').slice().sort((a, b) => b.value - a.value);
  const dSum = sum('DELIVERIES', 'ACTIVE');
  const max = Math.max(1, ...deliveries.map((d) => d.value));
  const deliveriesPart = (
        <Section title={m.work.deliveriesTitle} aside={<span className="text-xs text-base-content/50">{dSum ? m.work.deliveriesTotal(workText(dSum)) : ''}</span>} testId="dash-work-deliveries">
          {q.isPending ? (
            <p className="text-sm text-base-content/50">…</p>
          ) : dSum === null || q.isError ? (
            <p className="text-sm text-warning">{m.work.deliveriesFailed}</p>
          ) : deliveries.length === 0 ? (
            <p className="py-6 text-center text-sm text-base-content/55">{m.work.noDeliveries}</p>
          ) : (
            <ul className="space-y-2">
              {deliveries.map((d) => (
                <li key={d.segment ?? 'x'} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm" data-testid="dash-work-delivery-row">
                  <span className="truncate" title={d.segment ?? ''}>
                    {label(messages.deliveries.executionState, d.segment ?? null)}
                  </span>
                  {/* 한 계열이라 한 색 — 전달 실패(빨강)·미배정(노랑)만 상태 색 */}
                  <span className="h-2 overflow-hidden rounded-full bg-base-200" aria-hidden="true">
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(3, Math.round((d.value / max) * 100))}%`, background: d.segment === 'FAILURE_REPORTED' ? 'var(--color-error)' : d.segment === 'UNASSIGNED' ? 'var(--color-warning)' : 'var(--pm-chart-1)' }} />
                  </span>
                  <span className="whitespace-nowrap font-semibold tabular-nums">{workText(d)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
  );
  const tilesPart = (
      <Section title={m.work.title} aside={<span className="text-xs text-base-content/50">{m.work.exact}</span>} testId="dash-work-tiles">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-box border border-base-300 bg-base-300 [&>*:last-child:nth-child(odd)]:col-span-2">
          <WorkTile label={m.work.casesOpen} sum={sum('CASES', 'OPEN')} to="/cases" tone="info" testId="dash-work-cases-open" />
          <WorkTile label={m.work.handovers} sum={sum('SHIFT_HANDOVERS', 'PENDING')} to="/cases/handovers" tone="warning" testId="dash-work-handovers" />
          <WorkTile label={m.work.obligationsOpen} sum={sum('OBLIGATIONS', 'OPEN')} to="/cases" tone="info" testId="dash-work-obligations" />
          <WorkTile label={m.work.obligationsOverdue} sum={sum('OBLIGATIONS', 'OVERDUE')} to="/cases?tab=overdue" tone="error" testId="dash-work-obligations-overdue" />
          <WorkTile label={m.work.evidence} sum={sum('APPROVALS', 'EVIDENCE_REQUIRED')} to="/approvals?reviewState=EVIDENCE_REQUIRED" tone="warning" testId="dash-work-evidence" />
        </div>
      </Section>
  );
  if (part === 'deliveries') return deliveriesPart;
  if (part === 'tiles') return tilesPart;
  return (
    <div className="grid gap-4 lg:grid-cols-3" data-testid="dash-work">
      <div className="lg:col-span-2">{deliveriesPart}</div>
      {tilesPart}
    </div>
  );
}

// ───────────────────────── 매출·환불·상품별 판매(D2·D3 — 관리자) ─────────────────────────
// 백엔드 알림 2026-11-18(AP-3·O-8·CL-3 배포): order `/orders/metrics/summary`(주문 확정일 기준 상태별 건수·결제 승인 합),
// claim `/claims/metrics/refunds`(환불 완료일 기준 사유 묶음별 합), order `/orders/metrics/top-products`(주문 확정 기준).
// 사용자 결정: 승인 합과 환불 합은 나란히만 — 서로 빼서 순매출을 만들지 않는다(기준 날짜가 다르다). 금액은 서버 정수 KRW 그대로.
// 2026-11-20 그림 개편: 숫자 칸 셋을 한 상자에(머리카락 선으로 나눔) — 큰 숫자 + 지난 7일 대비(같은 서버 조회를 앞 7일로 한 번 더) + 하루별 추세선.

const krw = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const REFUND_NAME: Readonly<Record<string, string>> = { CANCEL: '취소', SHORTAGE: '결품', RETURN: '반품', RETURN_FEE: '회수비', OTHER: '기타' };
/** 환불 사유 색 — 사유마다 고정(순위·필터로 바뀌지 않는다) */
const REFUND_FILL: Readonly<Record<string, readonly [string, string]>> = {
  CANCEL: ['var(--pm-cat-1)', '#ffffff'],
  SHORTAGE: ['var(--pm-cat-2)', '#ffffff'],
  RETURN: ['var(--pm-cat-3)', '#ffffff'],
  RETURN_FEE: ['var(--pm-cat-4)', '#0b0b0b'],
  OTHER: ['var(--pm-cat-5)', '#ffffff'],
};

const daysBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 93; d = addSeoulDays(d, 1)) out.push(d);
  return out;
};

/** 앞 기간 대비 — 앞 값이 없거나 0 이면 비교하지 않는다(0 과 견주지 않음) */
function pctChange(cur: number | undefined, prev: number | undefined): { readonly text: string; readonly dir: -1 | 0 | 1 } | null {
  if (cur === undefined || prev === undefined || prev === 0) return null;
  const p = Math.round(((cur - prev) / prev) * 1000) / 10;
  return { text: m.sales.vsPrevPct(Math.abs(p)), dir: p > 0 ? 1 : p < 0 ? -1 : 0 };
}

function Kpi({ title, value, failed, sub, delta, trend, hero = false, testId, children }: { readonly title: string; readonly value: string | undefined; readonly failed: boolean; readonly sub: ReactNode; readonly delta?: ReactNode; readonly trend?: ReactNode; readonly hero?: boolean; readonly testId: string; readonly children?: ReactNode }) {
  return (
    <div className="min-w-0 px-5 py-4" data-testid={testId}>
      <p className="truncate text-sm text-base-content/70">{title}</p>
      <div className="mt-1 flex items-end justify-between gap-3">
        <p className={`min-w-0 truncate font-semibold leading-tight ${hero ? 'text-[34px]' : 'text-[28px]'} ${failed ? 'text-base-content/45' : ''}`} title={failed ? m.failed : undefined}>
          {value === undefined ? (failed ? '?' : '…') : value}
        </p>
        {trend}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-base-content/55">
        {delta}
        <span className="truncate">{sub}</span>
      </p>
      {children}
    </div>
  );
}

export function SalesPanel({ from, to }: { readonly from: string; readonly to: string }) {
  const api = useApi();
  const center = useCenterScope(); // 머리줄 센터 고르기(2026-11-23)
  const days = daysBetween(from, to);
  const summary = useQuery(summaryQuery(api, from, to, center));
  const prev = useQuery(summaryQuery(api, addSeoulDays(from, -days.length), addSeoulDays(from, -1), center));
  const daily = useQueries({ queries: days.map((d) => summaryQuery(api, d, d, center)) });
  const refunds = useQuery({ queryKey: ['dashboard', 'sales', 'refunds', from, to, center], refetchInterval: REFRESH_MS, retry: false, queryFn: () => request('GET', api.claims.GET('/claims/metrics/refunds', { params: { query: { from, to, ...(center ? { mfcId: center } : {}) } } })) });
  // 하루라도 못 읽었으면 그 자리는 끊는다(0 으로 잇지 않음)
  const wonByDay = daily.map((q) => (q.data ? q.data.approvedAmount : null));
  const cntByDay = daily.map((q) => (q.data ? q.data.orderCount : null));
  const dWon = pctChange(summary.data?.approvedAmount, prev.data?.approvedAmount);
  const dCnt = summary.data && prev.data ? summary.data.orderCount - prev.data.orderCount : null;
  const reasons = (refunds.data?.byReason ?? []).filter((r) => r.count > 0);
  return (
    <Section title={m.sales.title} aside={<span className="text-xs text-base-content/50">{m.sales.hint(from, to)}</span>} testId="dash-sales">
      <div className="-mx-5 grid divide-y divide-base-300 border-y border-base-300 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        <Kpi
          hero
          title={m.sales.approved}
          value={summary.data ? krw(summary.data.approvedAmount) : undefined}
          failed={summary.isError}
          testId="dash-sales-approved"
          sub={summary.data ? m.sales.approvedSub(summary.data.approvedOrderCount) : m.sales.approvedBasis}
          delta={dWon && <Delta text={dWon.text} dir={dWon.dir} testId="dash-sales-approved-delta" />}
          trend={<TrendLine values={wonByDay} testId="dash-sales-approved-trend" />}
        />
        <Kpi
          title={m.sales.orders}
          value={summary.data ? m.sales.ordersValue(summary.data.orderCount) : undefined}
          failed={summary.isError}
          testId="dash-sales-orders"
          sub={m.sales.approvedBasis}
          delta={dCnt !== null && <Delta text={m.sales.vsPrevCount(Math.abs(dCnt))} dir={dCnt > 0 ? 1 : dCnt < 0 ? -1 : 0} />}
          trend={<TrendLine values={cntByDay} />}
        />
        <Kpi
          title={m.sales.refunded}
          value={refunds.data ? krw(refunds.data.totalAmount) : undefined}
          failed={refunds.isError}
          testId="dash-sales-refunded"
          sub={refunds.data ? m.sales.refundedSub(refunds.data.totalCount) : m.sales.refundedBasis}
        >
          {reasons.length > 0 && (
            <div className="mt-3 space-y-2">
              <SegmentBar thin label={m.sales.refundByReason} parts={reasons.map((r) => ({ key: r.reason, label: REFUND_NAME[r.reason] ?? r.reason, value: r.amount, fill: (REFUND_FILL[r.reason] ?? REFUND_FILL['OTHER']!)[0], ink: (REFUND_FILL[r.reason] ?? REFUND_FILL['OTHER']!)[1] }))} />
              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-base-content/70">
                {reasons.map((r) => (
                  <li key={r.reason} className="inline-flex items-center gap-1.5" title={r.reason}>
                    <span className="h-2 w-2 rounded-full" style={{ background: (REFUND_FILL[r.reason] ?? REFUND_FILL['OTHER']!)[0] }} aria-hidden="true" />
                    {`${REFUND_NAME[r.reason] ?? r.reason} ${krw(r.amount)} · ${r.count}건`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Kpi>
      </div>
      <p className="mt-3 text-[11px] text-base-content/45">{m.sales.noNet}</p>
    </Section>
  );
}

// ───────────────────────── 결품 많은 상품(bff 0.23.0 shortage-by-sku, BR-73 SK-2) ─────────────────────────
// 원천 mfc-fulfillment by-sku 를 직원 토큰으로 — 세는 법은 결품률과 같다. 비율은 싣지 않아 화면이 결품 줄 ÷ 피킹 줄(분모를 같이 적는다).
// 결품률 순은 원천이 정한 최소 피킹 줄(minPickedLines) 이상만 — 응답 값을 그대로 적는다. 장애는 503 → "확인 못 함"(0건 아님).
type ShortSort = 'shortLines' | 'shortRate';
const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—');

export function ShortageTop({ from, to }: { readonly from: string; readonly to: string }) {
  const api = useApi();
  const center = useCenterScope(); // 머리줄 센터 고르기(2026-11-23)
  const t = m.shortageTop;
  const [sort, setSort] = useState<ShortSort>('shortLines');
  const q = useQuery({
    queryKey: ['dashboard', 'shortage-by-sku', from, to, sort, center],
    refetchInterval: REFRESH_MS,
    retry: false,
    queryFn: () => request('GET', api.bff.GET('/views/metrics/shortage-by-sku', { params: { query: { from, to, sort, limit: 5, ...(center ? { centerId: center } : {}) } } })),
  });
  const items = q.data?.items ?? [];
  const maxLines = Math.max(1, ...items.map((i) => i.shortLines));
  return (
    <Section
      title={t.title}
      aside={
        <span className="flex items-center gap-2">
          <span className="text-xs text-base-content/50">{t.hint}</span>
          {/* 고른 쪽이 또렷하게 — 같은 대시보드 "주문 수·승인 금액" 고르기와 같은 모양(2026-11-21 점검) */}
          <span role="radiogroup" aria-label={t.sortLabel} className="inline-flex rounded-field border border-base-300 p-0.5 text-xs">
            {(['shortLines', 'shortRate'] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={sort === s} className={`rounded px-2.5 py-1 ${sort === s ? 'bg-base-200 font-semibold text-base-content' : 'text-base-content/60 hover:text-base-content'}`} onClick={() => setSort(s)}>
                {s === 'shortLines' ? t.sortLines : t.sortRate}
              </button>
            ))}
          </span>
        </span>
      }
      testId="dash-shortage-top-panel"
    >
      {q.isPending ? (
        <p className="text-sm text-base-content/50">…</p>
      ) : q.isError ? (
        <p className="text-sm text-warning" data-testid="dash-shortage-top-failed">
          {t.failed}
        </p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-base-content/55">{t.none}</p>
      ) : (
        <>
          <ol className="divide-y divide-base-300/70" data-testid="dash-shortage-top">
            {items.map((it, i) => {
              const reasons = Object.entries(it.shortLinesByReason ?? {})
                .filter(([, k]) => k > 0)
                .sort((a, b) => b[1] - a[1]);
              const share = sort === 'shortRate' ? (it.pickedLines > 0 ? it.shortLines / it.pickedLines : 0) : it.shortLines / maxLines;
              return (
                <li key={it.sku} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 text-sm" data-testid="dash-shortage-top-row">
                  <span className="row-span-3 self-start pt-0.5 text-center text-xs font-semibold text-base-content/45">{i + 1}</span>
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{it.productName ?? it.sku}</span>
                    {it.productName && <span className="ml-2 font-mono text-[11px] text-base-content/45">{it.sku}</span>}
                  </span>
                  <span className="whitespace-nowrap text-right">
                    <span className="font-semibold tabular-nums">{pct(it.shortLines, it.pickedLines)}</span>
                    <span className="ml-2 text-xs tabular-nums text-base-content/55">{t.lines(it.shortLines, it.pickedLines)}</span>
                  </span>
                  <span className="col-span-2 truncate text-[11px] text-base-content/55">{reasons.map(([r, k]) => `${label(m.metrics.reasonName, r)} ${k}`).join(' · ')}</span>
                  <span className="col-span-2 h-2 overflow-hidden rounded-full bg-base-200" aria-hidden="true">
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(3, Math.round(share * 100))}%`, background: 'var(--pm-chart-1)' }} />
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-[11px] text-base-content/45" data-testid="dash-shortage-top-note">
            {q.data.minPickedLines ? `${t.minPicked(q.data.minPickedLines)} ` : ''}
            {t.overlap}
          </p>
        </>
      )}
    </Section>
  );
}

/** 상품별 판매 상위 5 — 한 계열(수량)이라 막대는 한 색, 값은 끝에 */
export function TopProducts({ from, to }: { readonly from: string; readonly to: string }) {
  const api = useApi();
  const center = useCenterScope(); // 머리줄 센터 고르기(2026-11-23)
  const top = useQuery({ queryKey: ['dashboard', 'sales', 'top', from, to, center], refetchInterval: REFRESH_MS, retry: false, queryFn: () => request('GET', api.orders.GET('/orders/metrics/top-products', { params: { query: { from, to, limit: 5, ...(center ? { mfcId: center } : {}) } } })) });
  // 상품 이름 — 상품 상세와 같은 조회(queryKey 공유)
  const ids = [...new Set((top.data?.items ?? []).map((i) => i.productId).filter((x): x is string => Boolean(x)))];
  const names = useQueries({ queries: ids.map((id) => ({ queryKey: ['product', 'detail', id], queryFn: () => request('GET', api.product.GET('/products/{productId}', { params: { path: { productId: id } } })) })) });
  const nameOf = (id: string | null | undefined) => (id ? names[ids.indexOf(id)]?.data?.internalName : undefined);
  const maxQty = Math.max(1, ...(top.data?.items ?? []).map((i) => i.qty));
  return (
    <Section title={m.sales.top} aside={<span className="text-xs text-base-content/50">{m.sales.topBasis}</span>} testId="dash-sales-top-panel">
      {top.isPending ? (
        <p className="text-sm text-base-content/50">…</p>
      ) : top.isError ? (
        <p className="text-sm text-warning">{m.sales.topFailed}</p>
      ) : top.data.items.length === 0 ? (
        <p className="py-6 text-center text-sm text-base-content/55">{m.sales.topNone}</p>
      ) : (
        <ol className="divide-y divide-base-300/70" data-testid="dash-sales-top">
          {top.data.items.map((it, i) => (
            <li key={it.sku} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2.5 text-sm" data-testid="dash-sales-top-row">
              <span className="row-span-2 self-start pt-0.5 text-center text-xs font-semibold text-base-content/45">{i + 1}</span>
              <span className="min-w-0">
                {it.productId ? (
                  <Link to={`/products/${encodeURIComponent(it.productId)}`} className="truncate font-medium hover:text-primary hover:underline">
                    {nameOf(it.productId) ?? it.sku}
                  </Link>
                ) : (
                  <span className="truncate font-medium">{it.sku}</span>
                )}
                <span className="ml-2 font-mono text-[11px] text-base-content/45">{it.sku}</span>
              </span>
              <span className="whitespace-nowrap text-right">
                <span className="font-semibold tabular-nums">{m.sales.qty(it.qty)}</span>
                <span className="ml-2 text-xs tabular-nums text-base-content/55">{krw(it.amount)}</span>
              </span>
              <span className="col-span-2 h-2 overflow-hidden rounded-full bg-base-200" aria-hidden="true">
                <span className="block h-full rounded-full" style={{ width: `${Math.max(3, Math.round((it.qty / maxQty) * 100))}%`, background: 'var(--pm-chart-1)' }} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
