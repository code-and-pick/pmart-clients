// 대시보드 2판(2026-11-18 사용자 "대시보드가 아직 약하다 — Eum·추천 사이트를 더 참고해 잘 조합"):
// - Eum: 아이콘 색 타일 숫자 카드·자동 갱신 표시·주문 상태 분포·판매 막대.  Shopify·Medusa 홈: 어제 대비 증감·7일 미니 추세선·최근 활동 피드.
// - 숫자는 모두 이미 있는 서버 조회에서만(새 API·새 라이브러리 없음, 그림은 CSS·SVG). 못 읽으면 "?"(0 아님), 쪽 상한(100)은 "100+"·"앞 100건 기준"으로 밝힌다.
// - 금액은 더하지 않는다(서버 집계 요청 docs/handoff/backoffice/2026-11-18-backend-dashboard-metrics.md D2).
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
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

