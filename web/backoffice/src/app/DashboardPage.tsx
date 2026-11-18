// 첫 화면 대시보드. 숫자는 이미 있는 서버 조회에서만 — 매출처럼 서버에 없는 값은 만들지 않는다(백엔드 요청 2026-11-18-backend-dashboard-metrics).
// 역할로 보이는 메뉴의 칸만 그린다(판정은 서버, 403 이면 "?").
// 2판(2026-11-18 사용자 "대시보드가 아직 약하다 — Eum·추천 사이트 조합"): 짜임
//   머리(인사·자동 갱신) → [내 할 일 | 한눈에 숫자 카드(오늘 주문 증감·추세선, 진행 중 배송, 처리 기한 지킴, 처리 대기)]
//   → [7일 주문 막대 | 오늘 주문 상태 도넛] → 운영 위험 → [지금 배송 | 심사 대기 유형별] → [최근 주문 | 최근 활동] → 처리 기한 지킴 날짜별.
// 개인정보: 주문 목록은 서버가 가린 값만(연락처 열은 보이지 않는다).
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { useApi } from './ApiContext';
import { ALERT_SIZE, useAlertCount, type AlertKey } from './MenuAlerts';
import { ApprovalTypes, LiveSummary, RiskPanel, SlaTrend } from './DashboardSections';
import { ActivityFeed, LiveStat, OrdersWeekChart, RefreshBar, RiskStat, SlaStat, StatusDonut, TodayOrdersStat, slaQuery } from './DashboardWidgets';
import { GroupIcon } from './groupIcons';
import { visibleGroups } from './nav';
import { useSession } from './SessionContext';
import { slaText } from '../features/cases/CaseSlaPage';
import { statusTone } from '../features/orders/OrderLookupPages';
import { messages } from '../shared/messages';
import { addSeoulDays, label, seoulDayEnd, seoulDayStart, seoulToday, when, won } from '../shared/ops';
import { DataTable, Section, StatusBadge } from '../shared/admin';

const m = messages.dashboard;
const DAYS = 7;

const countText = (n: number, more: boolean, size: number) => (more ? `${size}+` : String(n));

/**
 * 내 할 일 한 줄(2026-11-18 사용자 작업 따라 해 보기 — "첫 화면에서 내가 할 일이 안 보인다", BO-28 "로그인·내 할 일").
 * 개수는 메뉴 알림과 같은 서버 조회(캐시 공유) — 0 이면 "없음", 못 읽으면 "?"(0 이 아님). 누르면 그 일만 걸러 둔 목록으로.
 */
function TaskRow({ alert, title, to, tone, group }: { readonly alert: AlertKey; readonly title: string; readonly to: string; readonly tone: 'error' | 'warning' | 'info'; readonly group: string }) {
  const q = useAlertCount(alert);
  const n = q.data?.n ?? null;
  const has = n !== null && n > 0;
  const text = q.data ? countText(q.data.n, q.data.more, ALERT_SIZE) : q.isError ? '?' : '…';
  const color = { error: 'bg-error text-error-content', warning: 'bg-warning text-warning-content', info: 'bg-info text-info-content' }[tone];
  return (
    <Link to={to} data-testid={`dash-kpi-${alert}`} className={`group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-base-200/60 ${has ? '' : 'opacity-70'}`}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${has ? 'bg-primary/10 text-primary' : 'bg-base-200 text-base-content/40'}`} aria-hidden="true">
        <GroupIcon id={group} className="h-5 w-5" />
      </span>
      <span className={`min-w-0 flex-1 ${has ? 'font-semibold' : 'text-base-content/60'}`}>{title}</span>
      {q.isError ? (
        <span className="text-sm text-base-content/50" title={m.failed}>
          {text}
        </span>
      ) : has ? (
        <span className={`min-w-8 rounded-full px-2.5 py-0.5 text-center text-sm font-bold tabular-nums ${color}`}>{text}</span>
      ) : n === 0 ? (
        <span className="text-sm text-base-content/45">
          <span className="sr-only">0</span>
          {m.noneLeft}
        </span>
      ) : (
        <span className="text-sm text-base-content/40">{text}</span>
      )}
      <span className={`w-24 whitespace-nowrap text-right text-sm ${has ? 'font-medium text-primary' : 'text-base-content/30'} group-hover:underline`} aria-hidden="true">
        {m.go} →
      </span>
    </Link>
  );
}

function SlaCard({ from, to, days }: { readonly from: string; readonly to: string; readonly days: readonly string[] }) {
  const api = useApi();
  const q = useQuery(slaQuery(api, from, to));
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
      <div className="grid items-end gap-5 sm:grid-cols-[auto_1fr]">
        <div className="space-y-2">
          <div>
            <p className="text-3xl font-bold tabular-nums" data-testid="dash-sla-ratio">{t.ratio}</p>
            <p className="text-xs text-base-content/55">{t.count}</p>
          </div>
          <p className="text-sm">
            {m.overdueNow}{' '}
            <span className={`font-semibold ${overdue && overdue > 0 ? 'text-error' : ''}`} data-testid="dash-sla-overdue">
              {overdue === null ? m.unknown : `${overdue}건`}
            </span>
          </p>
        </div>
        <SlaTrend days={days} totals={q.data.totals ?? []} />
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
    queryFn: () => request('GET', api.orders.GET('/orders/lookups', { params: { query: { createdFrom: seoulDayStart(from), createdTo: seoulDayEnd(to), page: 0, size: 6 } } })),
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

export function DashboardPage() {
  const { session } = useSession();
  const roles = session?.roles ?? [];
  const paths = new Set(visibleGroups(roles).flatMap((g) => g.items.map((i) => i.to)));
  const can = (p: string) => paths.has(p);
  const claimsCases = roles.includes('RIDER_OPS') || roles.includes('OPERATOR_ADMIN');
  const today = seoulToday();
  const days = Array.from({ length: DAYS }, (_, i) => addSeoulDays(today, i - (DAYS - 1)));
  const weekFrom = days[0]!;

  // 내 할 일 — 급한 것부터(기한 넘김 → 아무도 안 맡음 → 처리 대기 → 답변 대기 → 심사 대기). 역할로 보이는 메뉴만.
  const tasks: ReactNode[] = [];
  if (can('/cases') && claimsCases) tasks.push(<TaskRow key="overdue" alert="casesOverdue" title={m.casesOverdue} to="/cases?tab=overdue" tone="error" group="support" />);
  if (can('/cases') && claimsCases) tasks.push(<TaskRow key="unassigned" alert="casesUnassigned" title={m.casesUnassigned} to="/cases?tab=unassigned" tone="warning" group="support" />);
  if (can('/pending')) tasks.push(<TaskRow key="pending" alert="pending" title={m.pending} to="/pending" tone="warning" group="pending" />);
  if (can('/inquiries')) tasks.push(<TaskRow key="inq" alert="inquiries" title={m.inquiries} to="/inquiries?status=RECEIVED" tone="info" group="cs" />);
  if (can('/rider-inquiries')) tasks.push(<TaskRow key="rinq" alert="riderInquiries" title={m.riderInquiries} to="/rider-inquiries?status=RECEIVED" tone="info" group="support" />);
  if (can('/approvals')) tasks.push(<TaskRow key="apv" alert="approvals" title={m.approvals} to="/approvals?reviewState=REVIEW_PENDING" tone="info" group="approval" />);

  // 한눈에 숫자 카드(오른쪽 세로) — Eum 숫자 카드 + 오늘 주문은 어제 대비·7일 추세선
  const stats: ReactNode[] = [];
  if (can('/orders')) stats.push(<TodayOrdersStat key="orders" days={days} />);
  if (can('/live-delivery')) stats.push(<LiveStat key="live" />);
  if (can('/case-sla')) stats.push(<SlaStat key="sla" from={weekFrom} to={today} />);
  if (can('/pending')) stats.push(<RiskStat key="risk" />);

  const activity = { approvals: can('/approvals'), cases: can('/cases'), inquiries: can('/inquiries') };
  const hasActivity = activity.approvals || activity.cases || activity.inquiries;

  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  return (
    <section className="space-y-5" data-testid="dashboard">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{m.hello(hour)}</h1>
          <p className="text-sm text-base-content/60">{m.intro(today)}</p>
        </div>
        <RefreshBar />
      </header>

      {/* 1줄: 내 할 일 | 한눈에 */}
      {(tasks.length > 0 || stats.length > 0) && (
        <div className={`grid items-start gap-4 ${tasks.length > 0 && stats.length > 0 ? 'lg:grid-cols-3' : ''}`}>
          {tasks.length > 0 && (
            <section aria-labelledby="dash-my-work" className={`overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm ${stats.length > 0 ? 'lg:col-span-2' : ''}`} data-testid="dash-my-work">
              <div className="flex items-baseline justify-between gap-2 border-b border-base-300 px-5 py-3">
                <h2 id="dash-my-work" className="text-lg font-bold">
                  {m.myWork}
                </h2>
                <span className="text-xs text-base-content/50">{m.myWorkHint}</span>
              </div>
              <div className="divide-y divide-base-300">{tasks}</div>
            </section>
          )}
          {stats.length > 0 && (
            <div className={`grid gap-3 ${tasks.length > 0 ? '' : 'sm:grid-cols-2 xl:grid-cols-4'}`} aria-label={m.glance} data-testid="dash-glance">
              {stats}
            </div>
          )}
        </div>
      )}

      {/* 2줄: 7일 주문 | 오늘 주문 상태 */}
      {can('/orders') && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <OrdersWeekChart days={days} />
          </div>
          <StatusDonut today={today} toneOf={(s) => statusTone(s)} />
        </div>
      )}

      {/* 운영 위험 */}
      {can('/pending') && <RiskPanel />}

      {/* 지금 배송 | 심사 대기 유형별 */}
      {(can('/live-delivery') || can('/approvals')) && (
        <div className="grid gap-4 lg:grid-cols-3">
          {can('/live-delivery') && (
            <div className="lg:col-span-2">
              <LiveSummary />
            </div>
          )}
          {can('/approvals') && <ApprovalTypes />}
        </div>
      )}

      {/* 최근 주문 | 최근 활동 */}
      {(can('/orders') || hasActivity) && (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          {can('/orders') && (
            <div className={hasActivity ? 'lg:col-span-2' : 'lg:col-span-3'}>
              <RecentOrders from={weekFrom} to={today} />
            </div>
          )}
          {hasActivity && <ActivityFeed {...activity} />}
        </div>
      )}

      {can('/case-sla') && <SlaCard from={weekFrom} to={today} days={days} />}

      {tasks.length === 0 && stats.length === 0 && !can('/orders') && <p className="text-sm text-base-content/60">{m.nothing}</p>}
    </section>
  );
}
