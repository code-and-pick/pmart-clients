// 첫 화면 대시보드(2026-11-18 사용자 — ChatGPT 추천 참고 화면 "Shopify·Medusa 관리자의 메인 화면처럼"; 왼쪽 메뉴는 어두운 그대로).
// 숫자는 이미 있는 서버 조회에서만 — 매출처럼 서버에 없는 값은 만들지 않는다. 역할로 보이는 메뉴의 칸만 그린다(판정은 서버, 403 이면 "?").
// - 숫자 카드: 오늘 주문(주문 조회 오늘 하루, 100 넘으면 "100+"), 처리 대기·기한 지난 접수 건·답변 대기 문의·심사 대기 승인(메뉴 알림과 같은 조회·캐시).
// - 최근 7일 주문 막대: 하루씩 따로 묻는다(7일을 한 번에 묻고 나누면 100 건 넘는 날이 작게 보인다). 날마다 100 넘으면 "100+", 못 읽은 날은 "?"(0 으로 그리지 않는다).
// - 처리 기한 지킴(관리자): bff CASE_SLA 최근 7일 — "N건 중 M건"·비율(분모 0 "—"), 지금 기한 지난 처리 중 건(못 읽으면 "불러오지 못했어요").
// - 최근 주문: 주문 조회 최근 7일 첫 5건(서버 순서 그대로).
// 개인정보: 주문 목록은 서버가 가린 값만(연락처 열은 보이지 않는다).
import { useQueries, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { useApi } from './ApiContext';
import { ALERT_SIZE, useAlertCount, type AlertKey } from './MenuAlerts';
import { visibleGroups } from './nav';
import { useSession } from './SessionContext';
import { slaText } from '../features/cases/CaseSlaPage';
import { statusTone } from '../features/orders/OrderLookupPages';
import { messages } from '../shared/messages';
import { addSeoulDays, label, seoulDayEnd, seoulDayStart, seoulToday, when, won } from '../shared/ops';
import { DataTable, Section, StatusBadge } from '../shared/admin';

const m = messages.dashboard;
const ORDER_SIZE = 100;
const DAYS = 7;

type Count = { readonly text: string; readonly n: number | null; readonly failed: boolean };
const countText = (n: number, more: boolean, size: number) => (more ? `${size}+` : String(n));

/** 숫자 카드 하나(누르면 그 화면) */
function Kpi({ title, value, hint, to, tone, testId }: { readonly title: string; readonly value: Count; readonly hint: string; readonly to: string; readonly tone?: 'error' | 'warning'; readonly testId: string }) {
  const color = value.failed ? 'text-base-content/40' : tone === 'error' && (value.n ?? 0) > 0 ? 'text-error' : tone === 'warning' && (value.n ?? 0) > 0 ? 'text-warning' : 'text-base-content';
  return (
    <Link to={to} className="group block rounded-box border border-base-300 bg-base-100 px-5 py-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md" data-testid={testId}>
      <p className="text-[13px] text-base-content/60">{title}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${color}`} title={value.failed ? m.failed : undefined}>
        {value.text}
      </p>
      <p className="mt-1 text-xs text-base-content/45 group-hover:text-primary">{hint} →</p>
    </Link>
  );
}

function AlertKpi({ alert, title, hint, to, tone }: { readonly alert: AlertKey; readonly title: string; readonly hint: string; readonly to: string; readonly tone?: 'error' | 'warning' }) {
  const q = useAlertCount(alert);
  const value: Count = q.data ? { text: countText(q.data.n, q.data.more, ALERT_SIZE), n: q.data.n, failed: false } : q.isError ? { text: '?', n: null, failed: true } : { text: '…', n: null, failed: false };
  return <Kpi title={title} value={value} hint={hint} to={to} {...(tone ? { tone } : {})} testId={`dash-kpi-${alert}`} />;
}

/** 하루 주문 수(오늘 카드·7일 막대가 같은 queryKey) */
function dayQuery(api: ReturnType<typeof useApi>, day: string) {
  return {
    queryKey: ['dashboard', 'orders-day', day],
    refetchInterval: 60_000,
    queryFn: async () => {
      const r = await request('GET', api.orders.GET('/orders/lookups', { params: { query: { createdFrom: seoulDayStart(day), createdTo: seoulDayEnd(day), page: 0, size: ORDER_SIZE } } }));
      return { n: r.items.length, more: r.page.hasNext };
    },
  };
}

function OrdersWeek({ days }: { readonly days: readonly string[] }) {
  const api = useApi();
  const qs = useQueries({ queries: days.map((d) => dayQuery(api, d)) });
  const max = Math.max(1, ...qs.map((q) => q.data?.n ?? 0));
  return (
    <Section title={m.ordersWeek} aside={<span className="text-xs text-base-content/50">{m.ordersWeekHint}</span>} testId="dash-orders-week">
      <div className="flex h-44 items-end gap-3">
        {days.map((d, i) => {
          const q = qs[i]!;
          const v = q.data ? countText(q.data.n, q.data.more, ORDER_SIZE) : q.isError ? '?' : '…';
          const h = q.data ? Math.max(4, Math.round((q.data.n / max) * 100)) : 4;
          const today = i === days.length - 1;
          return (
            <div key={d} className="flex h-full flex-1 flex-col items-center justify-end gap-1" data-testid="dash-day">
              <span className={`text-xs tabular-nums ${q.isError ? 'text-base-content/40' : 'text-base-content/70'}`} title={q.isError ? m.failed : undefined}>
                {v}
              </span>
              <div
                className={`w-full max-w-10 rounded-t-md ${q.isError ? 'border border-dashed border-base-300 bg-transparent' : today ? 'bg-primary' : 'bg-primary/35'}`}
                style={{ height: `${h}%` }}
                aria-hidden="true"
              />
              <span className={`text-[11px] ${today ? 'font-semibold text-base-content' : 'text-base-content/50'}`}>{today ? m.today : d.slice(5).replace('-', '.')}</span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function SlaCard({ from, to }: { readonly from: string; readonly to: string }) {
  const api = useApi();
  const q = useQuery({
    queryKey: ['dashboard', 'sla', from, to],
    queryFn: () => request('GET', api.bff.GET('/views/metrics', { params: { query: { metric: 'CASE_SLA', from, to, granularity: 'DAY' } } })),
  });
  let body: ReactNode;
  if (q.isPending) body = <p className="text-sm text-base-content/50">…</p>;
  else if (q.isError) body = <p className="text-sm text-warning" data-testid="dash-sla-failed">{m.slaFailed}</p>;
  else {
    let numerator = 0;
    let denominator = 0;
    for (const t of q.data.totals ?? []) {
      numerator += t.numerator;
      denominator += t.denominator;
    }
    const t = slaText({ numerator, denominator });
    const overdue = q.data.currentOverdue ? q.data.currentOverdue.reduce((n, o) => n + o.overdue, 0) : null;
    body = (
      <div className="space-y-3">
        <div>
          <p className="text-3xl font-bold tabular-nums" data-testid="dash-sla-ratio">{t.ratio}</p>
          <p className="text-xs text-base-content/55">{t.count}</p>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-base-200">
          <div className="h-full rounded-full bg-accent" style={{ width: denominator === 0 ? '0%' : `${Math.round((numerator / denominator) * 100)}%` }} />
        </div>
        <p className="text-sm">
          {m.overdueNow}{' '}
          <span className={`font-semibold ${overdue && overdue > 0 ? 'text-error' : ''}`} data-testid="dash-sla-overdue">
            {overdue === null ? m.unknown : `${overdue}건`}
          </span>
        </p>
      </div>
    );
  }
  return (
    <Section title={m.sla} aside={<Link className="link text-xs" to="/case-sla">{m.more}</Link>} testId="dash-sla">
      {body}
    </Section>
  );
}

function RecentOrders({ from, to }: { readonly from: string; readonly to: string }) {
  const api = useApi();
  const q = useQuery({
    queryKey: ['dashboard', 'recent-orders', from, to],
    queryFn: () => request('GET', api.orders.GET('/orders/lookups', { params: { query: { createdFrom: seoulDayStart(from), createdTo: seoulDayEnd(to), page: 0, size: 5 } } })),
  });
  return (
    <Section title={m.recentOrders} aside={<Link className="link text-xs" to="/orders">{m.more}</Link>} testId="dash-recent-orders">
      {q.isPending ? (
        <p className="text-sm text-base-content/50">…</p>
      ) : q.isError ? (
        <p className="text-sm text-warning">{m.ordersFailed}</p>
      ) : q.data.items.length === 0 ? (
        <p className="text-sm text-base-content/55">{m.noOrders}</p>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>{messages.orders.orderId}</th>
              <th>{messages.orders.status}</th>
              <th>{messages.orders.confirmedAt}</th>
              <th>{messages.orders.mfcId}</th>
              <th className="text-right">{messages.orders.approvedAmount}</th>
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((o) => (
              <tr key={o.orderId} data-testid="dash-order-row">
                <td>
                  <Link className="link font-mono text-xs" to={`/orders/${encodeURIComponent(o.orderId)}`}>
                    {o.orderId}
                  </Link>
                </td>
                <td>
                  <StatusBadge tone={statusTone(o.status)}>{label(messages.orders.statusName, o.status)}</StatusBadge>
                </td>
                <td>{when(o.confirmedAt)}</td>
                <td>{o.mfcId}</td>
                <td className="text-right tabular-nums">{won(o.approvedAmount)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Section>
  );
}

function TodayOrdersKpi({ today }: { readonly today: string }) {
  const api = useApi();
  const q = useQuery(dayQuery(api, today));
  const value: Count = q.data ? { text: countText(q.data.n, q.data.more, ORDER_SIZE), n: q.data.n, failed: false } : q.isError ? { text: '?', n: null, failed: true } : { text: '…', n: null, failed: false };
  return <Kpi title={m.todayOrders} value={value} hint={m.toOrders} to="/orders" testId="dash-kpi-orders" />;
}

export function DashboardPage() {
  const { session } = useSession();
  const roles = session?.roles ?? [];
  const paths = new Set(visibleGroups(roles).flatMap((g) => g.items.map((i) => i.to)));
  const can = (p: string) => paths.has(p);
  const claimsCases = roles.includes('RIDER_OPS') || roles.includes('OPERATOR_ADMIN');
  const today = seoulToday();
  const days = Array.from({ length: DAYS }, (_, i) => addSeoulDays(today, i - (DAYS - 1)));
  const weekFrom = days[0]!;

  const kpis: ReactNode[] = [];
  if (can('/orders')) kpis.push(<TodayOrdersKpi key="orders" today={today} />);
  if (can('/pending')) kpis.push(<AlertKpi key="pending" alert="pending" title={m.pending} hint={m.toPending} to="/pending" tone="warning" />);
  if (can('/cases') && claimsCases) kpis.push(<AlertKpi key="overdue" alert="casesOverdue" title={m.casesOverdue} hint={m.toCases} to="/cases?tab=overdue" tone="error" />);
  if (can('/inquiries')) kpis.push(<AlertKpi key="inq" alert="inquiries" title={m.inquiries} hint={m.toInquiries} to="/inquiries" />);
  if (can('/rider-inquiries')) kpis.push(<AlertKpi key="rinq" alert="riderInquiries" title={m.riderInquiries} hint={m.toRiderInquiries} to="/rider-inquiries" />);
  if (can('/approvals')) kpis.push(<AlertKpi key="apv" alert="approvals" title={m.approvals} hint={m.toApprovals} to="/approvals" />);

  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  return (
    <section className="space-y-5" data-testid="dashboard">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{m.hello(hour)}</h1>
          <p className="text-sm text-base-content/60">{m.intro(today)}</p>
        </div>
      </header>

      {kpis.length > 0 && <div className="grid grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))] gap-3">{kpis}</div>}

      {(can('/orders') || can('/case-sla')) && (
        <div className="grid gap-4 lg:grid-cols-3">
          {can('/orders') && (
            <div className="lg:col-span-2">
              <OrdersWeek days={days} />
            </div>
          )}
          {can('/case-sla') && <SlaCard from={weekFrom} to={today} />}
        </div>
      )}

      {can('/orders') && <RecentOrders from={weekFrom} to={today} />}

      {kpis.length === 0 && !can('/orders') && <p className="text-sm text-base-content/60">{m.nothing}</p>}
    </section>
  );
}
