// 대시보드 2판(2026-11-18 사용자 "대시보드가 아직 약하다 — Eum·추천 사이트를 더 참고해 잘 조합"):
// - Eum: 아이콘 색 타일 숫자 카드·자동 갱신 표시·주문 상태 분포·판매 막대.  Shopify·Medusa 홈: 어제 대비 증감·7일 미니 추세선·최근 활동 피드.
// - 숫자는 모두 이미 있는 서버 조회에서만(새 API·새 라이브러리 없음, 그림은 CSS·SVG). 못 읽으면 "?"(0 아님), 쪽 상한(100)은 "100+"·"앞 100건 기준"으로 밝힌다.
// - 금액은 더하지 않는다(서버 집계 요청 docs/handoff/backoffice/2026-11-18-backend-dashboard-metrics.md D2).
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { ProblemFailure, request } from '@pmart/web-core';
import { useApi } from './ApiContext';
import { liveQuery } from './DashboardSections';
import { slaText } from '../features/cases/CaseSlaPage';
import { messages } from '../shared/messages';
import { label, seoulDayEnd, seoulDayStart } from '../shared/ops';
import { Section } from '../shared/admin';

const m = messages.dashboard;
export const ORDER_SIZE = 100;
const REFRESH_MS = 60_000;

type Api = ReturnType<typeof useApi>;

/** 하루 주문(확정 시각 기준) — 건수·다음 쪽 여부·앞 100건의 상태별 개수. 오늘 카드·7일 막대·상태 도넛이 같은 queryKey */
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
export function slaQuery(api: Api, from: string, to: string) {
  return {
    queryKey: ['dashboard', 'sla', from, to],
    queryFn: () => request('GET', api.bff.GET('/views/metrics', { params: { query: { metric: 'CASE_SLA', from, to, granularity: 'DAY' } } })),
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

const ICONS: Record<string, string> = {
  cart: 'M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2M9 20h.01M17 20h.01',
  truck: 'M3 6h11v9H3zM14 9h4l3 3v3h-7M7 18a1.5 1.5 0 1 0 0-.01M17 18a1.5 1.5 0 1 0 0-.01',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  alert: 'M12 9v4m0 3h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
};
const tileTone = { primary: 'bg-primary/10 text-primary', info: 'bg-info/10 text-info', success: 'bg-success/10 text-success', warning: 'bg-warning/15 text-warning', error: 'bg-error/10 text-error' } as const;

function StatCard({ icon, tone, label: title, value, sub, to, testId, children, failed }: { readonly icon: string; readonly tone: keyof typeof tileTone; readonly label: string; readonly value: ReactNode; readonly sub?: ReactNode; readonly to: string; readonly testId: string; readonly children?: ReactNode; readonly failed?: boolean }) {
  return (
    <Link to={to} data-testid={testId} className="group flex items-start gap-4 rounded-box border border-base-300 bg-base-100 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tileTone[tone]}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d={ICONS[icon]} />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-base-content/55">{title}</span>
        <span className={`block text-[28px] font-extrabold leading-tight tabular-nums ${failed ? 'text-base-content/35' : ''}`} title={failed ? m.failed : undefined}>
          {value}
        </span>
        {sub && <span className="block text-xs text-base-content/55">{sub}</span>}
      </span>
      {children}
    </Link>
  );
}

/** 7일 미니 추세선(SVG) — 못 읽은 날이 있으면 그리지 않는다(빈 값을 0 으로 잇지 않는다) */
function Sparkline({ values }: { readonly values: ReadonlyArray<number | null> }) {
  if (values.some((v) => v === null) || values.length < 2) return null;
  const vs = values as number[];
  const max = Math.max(1, ...vs);
  const pts = vs.map((v, i) => `${(i / (vs.length - 1)) * 100},${28 - (v / max) * 24}`).join(' ');
  return (
    <svg viewBox="0 0 100 30" className="h-10 w-24 shrink-0 self-center text-primary" preserveAspectRatio="none" aria-hidden="true" data-testid="dash-sparkline">
      <polyline points={`0,30 ${pts} 100,30`} className="fill-primary/10 stroke-none" />
      <polyline points={pts} className="fill-none stroke-current" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
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
export function SlaStat({ from, to }: { readonly from: string; readonly to: string }) {
  const api = useApi();
  const q = useQuery(slaQuery(api, from, to));
  let numerator = 0;
  let denominator = 0;
  for (const t of q.data?.totals ?? []) {
    numerator += t.numerator;
    denominator += t.denominator;
  }
  const t = slaText({ numerator, denominator });
  const ratio = denominator === 0 ? null : numerator / denominator;
  return (
    <StatCard
      icon="clock"
      tone={ratio === null ? 'info' : ratio >= 0.9 ? 'success' : ratio >= 0.7 ? 'warning' : 'error'}
      label={m.slaShort}
      value={q.data ? t.ratio : q.isError ? '?' : '…'}
      sub={q.data ? t.count : undefined}
      to="/case-sla"
      testId="dash-stat-sla"
      failed={q.isError}
    />
  );
}

/** 운영 위험 합계 — 처리 대기 전체(결제 결과 불명 따로 표시) */
export function RiskStat() {
  const api = useApi();
  const q = useQuery({ queryKey: ['bff', 'pending-work'], refetchInterval: REFRESH_MS, queryFn: () => request('GET', api.bff.GET('/views/pending-work', {})) });
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

export function OrdersWeekChart({ days }: { readonly days: readonly string[] }) {
  const api = useApi();
  const qs = useQueries({ queries: days.map((d) => dayQuery(api, d)) });
  const max = Math.max(1, ...qs.map((q) => q.data?.n ?? 0));
  const top = Math.max(4, Math.ceil(max / 4) * 4);
  const grid = [top, (top * 3) / 4, top / 2, top / 4, 0];
  return (
    <Section title={m.ordersWeek} aside={<span className="text-xs text-base-content/50">{m.ordersWeekHint}</span>} testId="dash-orders-week">
      <div className="relative h-56 pl-8">
        {/* 눈금 */}
        <div className="pointer-events-none absolute inset-0 bottom-6 flex flex-col justify-between" aria-hidden="true">
          {grid.map((g) => (
            <div key={g} className="flex items-center gap-2">
              <span className="w-6 text-right text-[10px] tabular-nums text-base-content/40">{g}</span>
              <span className="h-px flex-1 border-t border-dashed border-base-300" />
            </div>
          ))}
        </div>
        <div className="relative flex h-full items-end gap-3 pb-6">
          {days.map((d, i) => {
            const q = qs[i]!;
            const v = q.data ? countText(q.data.n, q.data.more, ORDER_SIZE) : q.isError ? '?' : '…';
            const h = q.data ? Math.max(2, Math.round((q.data.n / top) * 100)) : 2;
            const today = i === days.length - 1;
            return (
              <div key={d} className="group relative flex h-full flex-1 flex-col items-center justify-end" data-testid="dash-day" title={`${d} · ${v}건`}>
                <span className={`mb-1 text-xs font-semibold tabular-nums ${q.isError ? 'text-base-content/40' : today ? 'text-primary' : 'text-base-content/60'}`} title={q.isError ? m.failed : undefined}>
                  {v}
                </span>
                <div
                  className={`w-full max-w-12 rounded-t-lg transition-all group-hover:opacity-80 ${q.isError ? 'border border-dashed border-base-300 bg-transparent' : today ? 'bg-gradient-to-t from-primary to-primary/70 shadow-sm' : 'bg-primary/25'}`}
                  style={{ height: `${h}%` }}
                  aria-hidden="true"
                />
                <span className={`absolute -bottom-0 translate-y-full pt-1 text-[11px] ${today ? 'font-semibold text-base-content' : 'text-base-content/50'}`}>{today ? m.today : d.slice(5).replace('-', '.')}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

// ───────────────────────── 오늘 주문 상태 도넛 ─────────────────────────

const STATUS_COLOR: Record<string, string> = {
  success: 'var(--color-success)',
  info: 'var(--color-info)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)',
  accent: 'var(--color-accent)',
  neutral: 'var(--color-neutral)',
  ghost: 'color-mix(in oklab, var(--color-base-content) 25%, transparent)',
};

/** 도넛 칸 색(테마 색만) */
const PALETTE = ['var(--color-primary)', 'var(--color-accent)', 'var(--color-success)', 'var(--color-warning)', 'var(--color-info)', 'var(--color-secondary)', 'var(--color-neutral)'];

/** 오늘 주문 상태 분포 — 오늘 주문 조회 앞 100건을 상태별로 센 값(더 있으면 그렇게 밝힌다) */
export function StatusDonut({ today, toneOf }: { readonly today: string; readonly toneOf: (s: string) => string }) {
  const api = useApi();
  const q = useQuery(dayQuery(api, today));
  const rows = q.data ? Object.entries(q.data.byStatus).sort((a, b) => b[1] - a[1]) : [];
  const total = q.data?.n ?? 0;
  // 칸마다 다른 색(상태 의미 색은 여럿이 같은 파랑이라 도넛에서 구분이 안 된다 — 2026-11-18 화면 확인). 취소·만료처럼 나쁜 상태만 빨강 계열 유지.
  const colorOf = (s: string, i: number) => (toneOf(s) === 'error' ? STATUS_COLOR['error']! : PALETTE[i % PALETTE.length]!);
  // 누적 각도(앞 칸들의 합) — 바깥 변수를 바꾸지 않고 계산
  const stops = rows.map(([s, n], i) => {
    const before = rows.slice(0, i).reduce((sum, [, k]) => sum + k, 0);
    const from = (before / Math.max(1, total)) * 360;
    const to = ((before + n) / Math.max(1, total)) * 360;
    return `${colorOf(s, i)} ${from}deg ${to}deg`;
  });
  return (
    <Section title={m.statusToday} aside={q.data?.more ? <span className="text-xs text-warning">{m.first100}</span> : undefined} testId="dash-status-donut">
      {q.isPending ? (
        <p className="text-sm text-base-content/50">…</p>
      ) : q.isError ? (
        <p className="text-sm text-warning">{m.ordersFailed}</p>
      ) : total === 0 ? (
        <p className="py-8 text-center text-sm text-base-content/55">{m.noOrdersToday}</p>
      ) : (
        <div className="flex items-center gap-5">
          <div className="relative h-32 w-32 shrink-0 rounded-full" style={{ background: `conic-gradient(${stops.join(', ')})` }} aria-hidden="true">
            <div className="absolute inset-[18%] flex flex-col items-center justify-center rounded-full bg-base-100">
              <span className="text-2xl font-extrabold tabular-nums">{countText(total, q.data.more, ORDER_SIZE)}</span>
              <span className="text-[10px] text-base-content/50">{m.ordersUnit}</span>
            </div>
          </div>
          <ul className="min-w-0 flex-1 space-y-1.5 text-sm" data-testid="dash-status-legend">
            {rows.map(([s, n]) => (
              <li key={s} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorOf(s, rows.findIndex(([k]) => k === s)) }} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate" title={s}>
                  {label(messages.orders.statusName, s)}
                </span>
                <span className="font-semibold tabular-nums">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

// ───────────────────────── 최근 활동 ─────────────────────────

type Activity = { readonly at: string; readonly kind: 'approval' | 'case' | 'inquiry'; readonly title: string; readonly to: string; readonly meta: string };
const ACT_ICON: Record<Activity['kind'], { readonly d: string; readonly cls: string }> = {
  approval: { d: 'm5 12 4 4 10-10', cls: 'bg-info/15 text-info' },
  case: { d: 'M12 9v4m0 3h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', cls: 'bg-warning/15 text-warning' },
  inquiry: { d: 'M4 5h16v11H8l-4 4V5Z', cls: 'bg-primary/10 text-primary' },
};

function ago(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  const a = messages.approvals.ago;
  if (!Number.isFinite(min) || min < 1) return a.now;
  if (min < 60) return a.min(min);
  if (min < 60 * 24) return a.hour(Math.floor(min / 60));
  return a.day(Math.floor(min / (60 * 24)));
}

/** 최근 활동 — 승인 요청·접수 건·고객 문의 첫 쪽 5건씩을 시각순으로(보이는 메뉴만, 못 읽은 원천은 아래에 밝힘) */
export function ActivityFeed({ approvals, cases, inquiries }: { readonly approvals: boolean; readonly cases: boolean; readonly inquiries: boolean }) {
  const api = useApi();
  const a = useQuery({
    queryKey: ['dashboard', 'activity', 'approvals'],
    enabled: approvals,
    refetchInterval: REFRESH_MS,
    queryFn: () => request('GET', api.approval.GET('/approvals', { params: { query: { size: 5 } } })),
  });
  const c = useQuery({
    queryKey: ['dashboard', 'activity', 'cases'],
    enabled: cases,
    refetchInterval: REFRESH_MS,
    queryFn: () => request('GET', api.cases.GET('/cases', { params: { query: { size: 5 } } })),
  });
  const q = useQuery({
    queryKey: ['dashboard', 'activity', 'inquiries'],
    enabled: inquiries,
    refetchInterval: REFRESH_MS,
    queryFn: () => request('GET', api.cases.GET('/inquiries', { params: { query: { requesterType: 'CUSTOMER', size: 5 } } })),
  });
  const list: Activity[] = [];
  for (const x of a.data?.items ?? [])
    if (x.submittedAt && x.approvalId) list.push({ at: x.submittedAt, kind: 'approval', title: x.summary ?? x.approvalId, to: `/approvals/${encodeURIComponent(x.approvalId)}`, meta: m.act.approval(messages.approvals.typeName[x.type ?? ''] ?? x.type ?? '') });
  for (const x of c.data?.items ?? [])
    if (x.openedAt && x.caseId) list.push({ at: x.openedAt, kind: 'case', title: x.summary ?? label(messages.cases.kindName, x.kind ?? null), to: `/cases/${encodeURIComponent(x.caseId)}`, meta: m.act.case(label(messages.cases.kindName, x.kind ?? null)) });
  for (const x of q.data?.items ?? [])
    list.push({ at: x.createdAt, kind: 'inquiry', title: x.title ?? messages.inquiries.untitled, to: `/inquiries/${encodeURIComponent(x.inquiryId)}`, meta: m.act.inquiry(label(messages.inquiries.categoryName, x.category)) });
  list.sort((p, n) => n.at.localeCompare(p.at));
  const failed = [approvals && a.isError && m.act.sourceApproval, cases && c.isError && m.act.sourceCase, inquiries && q.isError && m.act.sourceInquiry].filter(Boolean) as string[];
  const loading = (approvals && a.isPending) || (cases && c.isPending) || (inquiries && q.isPending);
  return (
    <Section title={m.act.title} testId="dash-activity">
      {list.length === 0 ? (
        <p className="py-6 text-center text-sm text-base-content/55">{loading ? '…' : failed.length > 0 ? m.act.allFailed : m.act.none}</p>
      ) : (
        <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-base-300">
          {list.slice(0, 8).map((x) => (
            <li key={`${x.kind}-${x.to}`} className="relative flex gap-3" data-testid="dash-activity-item">
              <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-base-100 ${ACT_ICON[x.kind].cls}`} aria-hidden="true">
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d={ACT_ICON[x.kind].d} />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <Link to={x.to} className="block truncate text-sm font-medium hover:text-primary hover:underline" title={x.title}>
                  {x.title}
                </Link>
                <p className="text-xs text-base-content/50">{`${x.meta} · ${ago(x.at)}`}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {failed.length > 0 && list.length > 0 && <p className="mt-3 text-xs text-warning" data-testid="dash-activity-failed">{m.act.failed(failed.join(', '))}</p>}
    </Section>
  );
}


// ───────────────────────── 지표(준비 중 포함) ─────────────────────────
// 백엔드 회신 2026-11-18(reply-dashboard-approval·notice-metrics-case-sla):
// - 결품률(SHORTAGE_RATE)·정시 배송률(ON_TIME_DELIVERY)은 bff 지표 조회에 있지만 아직 501 — 물어서 501 이면 "준비 중", 구현되면 저절로 숫자.
// - 매출(결제 승인 금액 — 환불은 따로 나란히)·상품별 판매 상위(주문 확정 기준)·센터별 품절 SKU 는 원천 API 작업 중(O-8·CL-3·IV-5) — 부를 곳이 없어 자리만.

type MetricCell = { readonly key: string; readonly label: string; readonly note: string };

function isNotImplemented(e: unknown): boolean {
  return e instanceof ProblemFailure && (e.problem.status === 501 || e.problem.code === 'NOT_IMPLEMENTED');
}

export function MetricsPanel({ from, to }: { readonly from: string; readonly to: string }) {
  const api = useApi();
  const live: MetricCell[] = [
    { key: 'SHORTAGE_RATE', label: m.metrics.shortage, note: m.metrics.shortageNote },
    { key: 'ON_TIME_DELIVERY', label: m.metrics.onTime, note: m.metrics.onTimeNote },
  ];
  const qs = useQueries({
    queries: live.map((c) => ({
      queryKey: ['dashboard', 'metric', c.key, from, to],
      retry: false,
      queryFn: () => request('GET', api.bff.GET('/views/metrics', { params: { query: { metric: c.key as 'SHORTAGE_RATE' | 'ON_TIME_DELIVERY', from, to, granularity: 'DAY' } } })),
    })),
  });
  const planned: MetricCell[] = [
    { key: 'soldOut', label: m.metrics.soldOut, note: m.metrics.soldOutNote },
  ];
  return (
    <Section title={m.metrics.title} aside={<span className="text-xs text-base-content/50">{m.metrics.hint}</span>} testId="dash-metrics">
      {/* 칸 수는 이 상자 폭으로(2026-11-18 — 매출·통계 탭에서 최근 주문 옆 좁은 칸에 들어간다) */}
      <div className="@container">
      <div className="grid gap-3 @md:grid-cols-2 @4xl:grid-cols-5">
        {live.map((c, i) => {
          const q = qs[i]!;
          let value: ReactNode = '…';
          let sub: ReactNode = c.note;
          let ready = false;
          if (q.data) {
            let n = 0;
            let d = 0;
            for (const t of q.data.totals ?? []) {
              n += t.numerator;
              d += t.denominator;
            }
            const t = slaText({ numerator: n, denominator: d });
            value = t.ratio;
            sub = t.count;
            ready = true;
          } else if (q.isError) {
            value = isNotImplemented(q.error) ? m.metrics.soon : '?';
            if (!isNotImplemented(q.error)) sub = m.failed;
          }
          return (
            <div key={c.key} className={`rounded-lg border px-4 py-3 ${ready ? 'border-base-300' : 'border-dashed border-base-300 bg-base-200/30'}`} data-testid={`dash-metric-${c.key}`}>
              <p className="text-xs text-base-content/60">{c.label}</p>
              <p className={`mt-0.5 text-xl font-bold ${ready ? '' : 'text-base-content/40'}`}>{value}</p>
              <p className="text-[11px] text-base-content/45">{sub}</p>
            </div>
          );
        })}
        {planned.map((c) => (
          <div key={c.key} className="rounded-lg border border-dashed border-base-300 bg-base-200/30 px-4 py-3" data-testid={`dash-metric-${c.key}`}>
            <p className="text-xs text-base-content/60">{c.label}</p>
            <p className="mt-0.5 text-xl font-bold text-base-content/40">{m.metrics.soon}</p>
            <p className="text-[11px] text-base-content/45">{c.note}</p>
          </div>
        ))}
      </div>
      </div>
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
}

export function workCountsQuery(api: Api) {
  return {
    queryKey: ['dashboard', 'work-counts'],
    refetchInterval: REFRESH_MS,
    retry: false,
    queryFn: () => request('GET', api.bff.GET('/views/work-counts', {})),
  };
}

/** 관리자만 부른다(그 밖 403). 반환: 묶음·셈(·나눔)의 합 — 읽는 중 undefined, 원천 실패 null */
export function useWorkCounts(enabled: boolean) {
  const api = useApi();
  const q = useQuery({ ...workCountsQuery(api), enabled });
  const sum = (group: WorkGroup, key: string, segment?: string): WorkSum | null | undefined => {
    if (!enabled || q.isPending) return undefined;
    if (q.isError) return null;
    const missing = q.data.unavailableSources ?? [];
    if (GROUP_SOURCES[group].some((s) => missing.includes(s)) && !q.data.counts.some((c) => c.group === group)) return null;
    const rows = q.data.counts.filter((c) => c.group === group && c.key === key && (segment === undefined || c.segment === segment));
    return { value: rows.reduce((n, c) => n + c.value, 0), complete: rows.every((c) => c.complete) };
  };
  const segments = (group: WorkGroup, key: string) => (q.data ? q.data.counts.filter((c) => c.group === group && c.key === key) : []);
  return { q, sum, segments };
}

export const workText = (s: WorkSum) => (s.complete ? String(s.value) : m.work.atLeast(s.value));

function WorkTile({ label: title, sum, to, tone, testId }: { readonly label: string; readonly sum: WorkSum | null | undefined; readonly to: string; readonly tone: 'error' | 'warning' | 'info'; readonly testId: string }) {
  const has = !!sum && sum.value > 0;
  const color = { error: 'text-error border-l-error', warning: 'text-warning border-l-warning', info: 'text-info border-l-info' }[tone];
  return (
    <Link to={to} data-testid={testId} className={`block rounded-lg border border-l-4 border-base-300 px-4 py-3 transition hover:bg-base-200/60 ${has ? color.split(' ')[1] : 'border-l-base-300'}`}>
      <p className="text-xs text-base-content/60">{title}</p>
      <p className={`mt-0.5 text-2xl font-bold tabular-nums ${sum === null ? 'text-base-content/40' : has ? color.split(' ')[0] : 'text-base-content/70'}`} title={sum === null ? m.failed : undefined}>
        {sum === undefined ? '…' : sum === null ? m.work.unknown : workText(sum)}
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
                  <span className="h-3 overflow-hidden rounded bg-base-200" aria-hidden="true">
                    <span className={`block h-full rounded ${d.segment === 'FAILURE_REPORTED' ? 'bg-error/70' : d.segment === 'UNASSIGNED' ? 'bg-warning/70' : 'bg-primary/60'}`} style={{ width: `${Math.max(4, Math.round((d.value / max) * 100))}%` }} />
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
        <div className="grid grid-cols-2 gap-3">
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

const krw = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const REFUND_NAME: Readonly<Record<string, string>> = { CANCEL: '취소', SHORTAGE: '결품', RETURN: '반품', RETURN_FEE: '회수비', OTHER: '기타' };

function MoneyCard({ title, amount, sub, testId, failed, children }: { readonly title: string; readonly amount: number | undefined; readonly sub: ReactNode; readonly testId: string; readonly failed: boolean; readonly children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-base-300 px-4 py-3" data-testid={testId}>
      <p className="text-xs text-base-content/60">{title}</p>
      <p className={`mt-0.5 text-2xl font-extrabold tabular-nums ${failed ? 'text-base-content/40' : ''}`} title={failed ? m.failed : undefined}>
        {amount === undefined ? (failed ? '?' : '…') : krw(amount)}
      </p>
      <p className="text-xs text-base-content/55">{sub}</p>
      {children}
    </div>
  );
}

export function SalesPanel({ from, to }: { readonly from: string; readonly to: string }) {
  const api = useApi();
  const summary = useQuery({ queryKey: ['dashboard', 'sales', 'summary', from, to], refetchInterval: REFRESH_MS, retry: false, queryFn: () => request('GET', api.orders.GET('/orders/metrics/summary', { params: { query: { from, to } } })) });
  const refunds = useQuery({ queryKey: ['dashboard', 'sales', 'refunds', from, to], refetchInterval: REFRESH_MS, retry: false, queryFn: () => request('GET', api.claims.GET('/claims/metrics/refunds', { params: { query: { from, to } } })) });
  const top = useQuery({ queryKey: ['dashboard', 'sales', 'top', from, to], refetchInterval: REFRESH_MS, retry: false, queryFn: () => request('GET', api.orders.GET('/orders/metrics/top-products', { params: { query: { from, to, limit: 5 } } })) });
  // 상품 이름 — 상품 상세와 같은 조회(queryKey 공유)
  const ids = [...new Set((top.data?.items ?? []).map((i) => i.productId).filter((x): x is string => Boolean(x)))];
  const names = useQueries({ queries: ids.map((id) => ({ queryKey: ['product', 'detail', id], queryFn: () => request('GET', api.product.GET('/products/{productId}', { params: { path: { productId: id } } })) })) });
  const nameOf = (id: string | null | undefined) => (id ? names[ids.indexOf(id)]?.data?.internalName : undefined);
  const maxQty = Math.max(1, ...(top.data?.items ?? []).map((i) => i.qty));
  return (
    <Section title={m.sales.title} aside={<span className="text-xs text-base-content/50">{m.sales.hint(from, to)}</span>} testId="dash-sales">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3">
          <MoneyCard title={m.sales.approved} amount={summary.data?.approvedAmount} failed={summary.isError} testId="dash-sales-approved" sub={summary.data ? m.sales.approvedSub(summary.data.approvedOrderCount) : m.sales.approvedBasis} />
          <MoneyCard title={m.sales.refunded} amount={refunds.data?.totalAmount} failed={refunds.isError} testId="dash-sales-refunded" sub={refunds.data ? m.sales.refundedSub(refunds.data.totalCount) : m.sales.refundedBasis}>
            {refunds.data && (
              <ul className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                {refunds.data.byReason
                  .filter((r) => r.count > 0)
                  .map((r) => (
                    <li key={r.reason} className="rounded-full bg-base-200 px-2 py-0.5" title={r.reason}>
                      {`${REFUND_NAME[r.reason] ?? r.reason} ${krw(r.amount)} · ${r.count}건`}
                    </li>
                  ))}
              </ul>
            )}
          </MoneyCard>
          <p className="text-[11px] text-base-content/45">{m.sales.noNet}</p>
        </div>
        <div className="lg:col-span-2">
          <p className="mb-2 flex items-baseline justify-between text-sm font-semibold">
            {m.sales.top}
            <span className="text-xs font-normal text-base-content/50">{m.sales.topBasis}</span>
          </p>
          {top.isPending ? (
            <p className="text-sm text-base-content/50">…</p>
          ) : top.isError ? (
            <p className="text-sm text-warning">{m.sales.topFailed}</p>
          ) : top.data.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-base-content/55">{m.sales.topNone}</p>
          ) : (
            <ol className="space-y-2" data-testid="dash-sales-top">
              {top.data.items.map((it, i) => (
                <li key={it.sku} className="grid grid-cols-[1.5rem_minmax(0,12rem)_1fr_auto] items-center gap-3 text-sm" data-testid="dash-sales-top-row">
                  <span className="text-center text-xs font-bold text-base-content/45">{i + 1}</span>
                  <span className="min-w-0">
                    {it.productId ? (
                      <Link to={`/products/${encodeURIComponent(it.productId)}`} className="block truncate font-medium hover:text-primary hover:underline">
                        {nameOf(it.productId) ?? it.sku}
                      </Link>
                    ) : (
                      <span className="block truncate font-medium">{it.sku}</span>
                    )}
                    <span className="block font-mono text-[11px] text-base-content/45">{it.sku}</span>
                  </span>
                  <span className="h-2 overflow-hidden rounded-full bg-base-200" aria-hidden="true">
                    <span className="block h-full rounded-full bg-primary/60" style={{ width: `${Math.max(4, Math.round((it.qty / maxQty) * 100))}%` }} />
                  </span>
                  <span className="whitespace-nowrap text-right tabular-nums">
                    <span className="font-semibold">{m.sales.qty(it.qty)}</span>
                    <span className="ml-2 text-xs text-base-content/55">{krw(it.amount)}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Section>
  );
}
