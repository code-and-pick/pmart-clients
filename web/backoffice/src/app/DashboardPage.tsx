// 첫 화면 대시보드. 숫자는 이미 있는 서버 조회에서만 — 매출처럼 서버에 없는 값은 만들지 않는다(백엔드 요청 2026-11-18-backend-dashboard-metrics).
// 역할로 보이는 메뉴의 칸만 그린다(판정은 서버, 403 이면 "?").
// 2판(2026-11-18 사용자 "대시보드가 아직 약하다 — Eum·추천 사이트 조합"): 짜임
//   머리(인사·자동 갱신) → 한눈에 숫자 카드 넷(가로) → [7일 주문 막대 | 오늘 주문 상태 도넛] → [내 할 일 | 최근 활동]
//   → 운영 위험 → [지금 배송 | 심사 대기 유형별] → 최근 주문 → 처리 기한 지킴 날짜별. (통계를 위로 — 사용자 2026-11-18)
// 개인정보: 주문 목록은 서버가 가린 값만(연락처 열은 보이지 않는다).
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { ProblemFailure, request } from '@pmart/web-core';
import { useApi } from './ApiContext';
import { ALERT_SIZE, useAlertCount, type AlertKey } from './MenuAlerts';
import { ApprovalTypes, LiveSummary, RiskPanel, SlaTrend } from './DashboardSections';
import { RecentViews } from './RecentViews';
import { ActivityFeed, LiveStat, MetricsPanel, OrdersWeekChart, SalesPanel, WorkCountsPanel, useWorkCounts, workText, type WorkSum, RefreshBar, RiskStat, SlaStat, StatusDonut, TodayOrdersStat, slaQuery } from './DashboardWidgets';
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
function TaskRow({ alert, title, to, tone, group, exact }: { readonly alert: AlertKey; readonly title: string; readonly to: string; readonly tone: 'error' | 'warning' | 'info'; readonly group: string; readonly exact?: { readonly sum: WorkSum | null | undefined } }) {
  const alertQ = useAlertCount(alert);
  // exact 가 있으면(관리자) bff work-counts 의 정확한 지금 건수 — 쪽 상한에 걸리면 "N건 이상", 원천 실패 "?".
  // 없으면 메뉴 알림과 같은 첫 쪽 셈(50 넘으면 "50+").
  const sum = exact?.sum;
  const n = exact ? (sum ? sum.value : null) : (alertQ.data?.n ?? null);
  const failed = exact ? sum === null : alertQ.isError;
  const has = n !== null && n > 0;
  const text = exact ? (sum ? workText(sum) : sum === null ? '?' : '…') : alertQ.data ? countText(alertQ.data.n, alertQ.data.more, ALERT_SIZE) : alertQ.isError ? '?' : '…';
  const q = { isError: failed };
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
  else if (q.isError)
    // 503 은 "원천에 닿지 않음"(0건 아님) — 백엔드 알림 2026-11-18 notice-metrics-case-sla §2
    body = (
      <p className="text-sm text-warning" data-testid="dash-sla-failed">
        {q.error instanceof ProblemFailure && q.error.problem.status === 503 ? m.slaUnreachable : m.slaFailed}
      </p>
    );
  else {
    let numerator = 0;
    let denominator = 0;
    let unjudged = 0;
    for (const t of q.data.totals ?? []) {
      numerator += t.numerator;
      denominator += t.denominator;
      unjudged += t.unjudged ?? 0;
    }
    const t = slaText({ numerator, denominator });
    const overdue = q.data.currentOverdue ? q.data.currentOverdue.reduce((n, o) => n + o.overdue, 0) : null;
    // 종류별(기한이 종류마다 달라 한 숫자로만 보이지 않는다 — 같은 알림 §2). 서버 분자·분모를 종류로 묶어 더한 값, 분모 큰 순 4개.
    const byKind = new Map<string, { n: number; d: number }>();
    for (const p of q.data.points ?? []) {
      const k = p.segment?.kind ?? '';
      const cur = byKind.get(k) ?? { n: 0, d: 0 };
      byKind.set(k, { n: cur.n + p.numerator, d: cur.d + p.denominator });
    }
    const kinds = [...byKind.entries()].sort((a, b) => b[1].d - a[1].d).slice(0, 4);
    body = (
      <div className="space-y-4">
        <div className="grid items-end gap-5 sm:grid-cols-[auto_1fr]">
          <div className="space-y-2">
            <div>
              <p className="text-3xl font-bold tabular-nums" data-testid="dash-sla-ratio">{t.ratio}</p>
              <p className="text-xs text-base-content/55">{t.count}</p>
              {unjudged > 0 && <p className="text-xs text-base-content/55" data-testid="dash-sla-unjudged">{m.slaUnjudged(unjudged)}</p>}
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
        {kinds.length > 0 && (
          <div className="space-y-1.5" data-testid="dash-sla-kinds">
            <p className="text-xs font-medium text-base-content/55">{m.slaByKind}</p>
            {kinds.map(([k, v]) => {
              const kt = slaText({ numerator: v.n, denominator: v.d });
              const pct = v.d === 0 ? null : Math.round((v.n / v.d) * 100);
              return (
                <div key={k} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm">
                  <span className="truncate" title={k}>
                    {label(messages.cases.kindName, k || null)}
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-base-200" aria-hidden="true">
                    {pct !== null && <span className={`block h-full rounded-full ${pct >= 90 ? 'bg-success' : pct >= 70 ? 'bg-warning' : 'bg-error'}`} style={{ width: `${pct}%` }} />}
                  </span>
                  <span className="whitespace-nowrap text-xs tabular-nums text-base-content/65">{`${kt.ratio} · ${kt.count}`}</span>
                </div>
              );
            })}
          </div>
        )}
        {import.meta.env.VITE_PMART_ENV !== 'mock' && <p className="text-[11px] text-base-content/45">{m.slaLanNote}</p>}
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
  // 지금 일 건수(bff 0.15.0 work-counts) — 관리자만(그 밖 403이라 부르지 않는다)
  const admin = roles.includes('OPERATOR_ADMIN');
  const wc = useWorkCounts(admin);
  const exact = (sum: WorkSum | null | undefined) => (admin ? { sum } : undefined);
  const today = seoulToday();
  const days = Array.from({ length: DAYS }, (_, i) => addSeoulDays(today, i - (DAYS - 1)));
  const weekFrom = days[0]!;

  // 내 할 일 — 급한 것부터(기한 넘김 → 아무도 안 맡음 → 처리 대기 → 답변 대기 → 심사 대기). 역할로 보이는 메뉴만.
  const tasks: ReactNode[] = [];
  if (can('/cases') && claimsCases) tasks.push(<TaskRow key="overdue" alert="casesOverdue" title={m.casesOverdue} to="/cases?tab=overdue" tone="error" group="support" {...(exact(wc.sum('CASES', 'OVERDUE')) ? { exact: exact(wc.sum('CASES', 'OVERDUE'))! } : {})} />);
  if (can('/cases') && claimsCases) tasks.push(<TaskRow key="unassigned" alert="casesUnassigned" title={m.casesUnassigned} to="/cases?tab=unassigned" tone="warning" group="support" {...(exact(wc.sum('CASES', 'UNASSIGNED')) ? { exact: exact(wc.sum('CASES', 'UNASSIGNED'))! } : {})} />);
  if (can('/pending')) tasks.push(<TaskRow key="pending" alert="pending" title={m.pending} to="/pending" tone="warning" group="pending" {...(exact(wc.sum('PENDING_WORK', 'COUNT')) ? { exact: exact(wc.sum('PENDING_WORK', 'COUNT'))! } : {})} />);
  if (can('/inquiries')) tasks.push(<TaskRow key="inq" alert="inquiries" title={m.inquiries} to="/inquiries?status=RECEIVED" tone="info" group="cs" {...(exact(wc.sum('INQUIRIES', 'AWAITING_ANSWER', 'CUSTOMER')) ? { exact: exact(wc.sum('INQUIRIES', 'AWAITING_ANSWER', 'CUSTOMER'))! } : {})} />);
  if (can('/rider-inquiries')) tasks.push(<TaskRow key="rinq" alert="riderInquiries" title={m.riderInquiries} to="/rider-inquiries?status=RECEIVED" tone="info" group="support" {...(exact(wc.sum('INQUIRIES', 'AWAITING_ANSWER', 'RIDER')) ? { exact: exact(wc.sum('INQUIRIES', 'AWAITING_ANSWER', 'RIDER'))! } : {})} />);
  if (can('/approvals')) tasks.push(<TaskRow key="apv" alert="approvals" title={m.approvals} to="/approvals?reviewState=REVIEW_PENDING" tone="info" group="approval" {...(exact(wc.sum('APPROVALS', 'DECIDABLE_BY_ME')) ? { exact: exact(wc.sum('APPROVALS', 'DECIDABLE_BY_ME'))! } : {})} />);

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

      {/* 1줄: 한눈에 숫자 카드(가로) — 통계는 위로(2026-11-18 사용자 "그래프 같은 통계를 위쪽으로") */}
      {stats.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={m.glance} data-testid="dash-glance">
          {stats}
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

      {/* 매출·환불·상품별 판매(관리자, D2·D3 — 최근 7일) */}
      {admin && <SalesPanel from={weekFrom} to={today} />}

      {/* 지금 일 전체(관리자) — 진행 중 배송 상태별·후속 처리·교대 인계 등 서버가 센 지금 건수 */}
      {admin && <WorkCountsPanel />}

      {/* 최근 본 항목(2026-11-18) — 이 브라우저·이 직원 것, 없으면 안 보임 */}
      <RecentViews />

      {/* 3줄: 내 할 일 | 최근 활동 */}
      {(tasks.length > 0 || hasActivity) && (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          {tasks.length > 0 && (
            <section aria-labelledby="dash-my-work" className={`overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm ${hasActivity ? 'lg:col-span-2' : 'lg:col-span-3'}`} data-testid="dash-my-work">
              <div className="flex items-baseline justify-between gap-2 border-b border-base-300 px-5 py-3">
                <h2 id="dash-my-work" className="text-lg font-bold">
                  {m.myWork}
                </h2>
                <span className="text-xs text-base-content/50">{m.myWorkHint}</span>
              </div>
              <div className="divide-y divide-base-300">{tasks}</div>
            </section>
          )}
          {hasActivity && (
            <div className={tasks.length > 0 ? '' : 'lg:col-span-3'}>
              <ActivityFeed {...activity} />
            </div>
          )}
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

      {/* 최근 주문 */}
      {can('/orders') && <RecentOrders from={weekFrom} to={today} />}

      {can('/case-sla') && <SlaCard from={weekFrom} to={today} days={days} />}

      {/* 지표 — 결품률·정시 배송률(501 이면 준비 중)·매출·상품별 판매·품절(원천 작업 중) — 백엔드 회신 2026-11-18 */}
      {can('/case-sla') && <MetricsPanel from={weekFrom} to={today} />}

      {tasks.length === 0 && stats.length === 0 && !can('/orders') && <p className="text-sm text-base-content/60">{m.nothing}</p>}
    </section>
  );
}
