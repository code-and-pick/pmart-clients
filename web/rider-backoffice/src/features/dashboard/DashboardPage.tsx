// 대시보드(2026-11-17, PC 5 — 사용자 "대시보드에 필요한 것만"): rider `GET /riders/stats` + execution `GET /delivery-stats`.
// 원천마다 따로 불러 한쪽이 실패해도 다른 쪽은 보인다(0 으로 바꾸지 않는다).
// 2026-11-19 개편(카페24 관리자 홈 참고 — 사용자 "상용 서비스 수준"): 맨 위 "오늘의 할 일" 줄(처리할 목록 건수, 누르면 그 목록),
// 그 아래 핵심 수(KPI) 카드, 라이더·배송 상태를 두 칸으로. 처리할 일 건수는 그 목록 API 의 결과 수(쪽 크기보다 많으면 "N+").
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { useCenterScope } from '../../app/CenterScope';
import { PageHeader, Section, StatCard, StatStrip, StatusBadge } from '../../shared/admin';
import { LIVE } from '../../shared/liveRefresh';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { label, when } from '../../shared/opsUi';
import { AnalysisSection } from './AnalysisSection';

const d = ops.dashboard;
const n = messages.names;
const num = (v: number) => v.toLocaleString('ko-KR');
/** 처리할 것이 있을 때만 색(서버 수 그대로, 색만 바꾼다) */
const warnIf = (on: boolean, tone: 'warning' | 'error') => (on ? { tone } : {});

const todo = {
  title: '오늘의 할 일',
  hint: '처리를 기다리는 건수예요. 누르면 그 목록으로 가요.',
  failed: '불러오지 못함',
  inquiries: '라이더 문의',
  reviews: '제한 검토',
  appeals: '소명·이의',
} as const;

/** "오늘의 할 일" 한 칸 — 건수(못 읽으면 "불러오지 못함", 0 으로 지어내지 않음) */
function TodoCell({ label: text, to, count, more, failed, testId }: { readonly label: string; readonly to: string; readonly count: number | undefined; readonly more?: boolean; readonly failed: boolean; readonly testId?: string }) {
  const busy = count !== undefined && count > 0;
  return (
    // 2026-11-20 공용 콘솔 모양(통합 백오피스 내 할 일과 같음): 베이지 바탕 대신 흰 칸, 일이 있으면 이름 앞 노란 점·숫자는 글자색, 0 은 흐리게
    <Link to={to} className="flex min-w-0 flex-col justify-between gap-2 px-5 py-4 transition-colors hover:bg-base-200/50" data-testid={testId}>
      <span className="flex items-center gap-1.5 truncate text-sm text-base-content/70">
        {busy && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />}
        {text}
      </span>
      {failed ? (
        <span className="text-sm text-error">{todo.failed}</span>
      ) : count === undefined ? (
        <span className="loading loading-dots loading-sm text-base-content/40" />
      ) : (
        <span className={`text-[26px] font-semibold leading-tight tracking-tight ${busy ? '' : 'text-base-content/45'}`}>
          {num(count)}
          {more ? '+' : ''}
        </span>
      )}
    </Link>
  );
}

function listCount<T extends { readonly items?: readonly unknown[] | null }>(q: UseQueryResult<T>) {
  return { count: q.data ? (q.data.items ?? []).length : undefined, failed: q.isError };
}

export function DashboardPage() {
  const api = useApi();
  const [params] = useSearchParams();
  // 센터 = 주소의 mfcId(관제 등에서 넘어올 때) 또는 머리줄 센터 고르기(RS-7, 2026-11-23 — 화면 안 고르기는 머리줄로 옮김)
  const scope = useCenterScope();
  const mfcId = params.get('mfcId') ?? scope.mfcId;
  const q = mfcId ? { mfcId } : {};
  // 30초마다 다시(탭이 안 보이면 멈춤)
  const riders = useQuery({
    queryKey: ['rider-stats', mfcId],
    refetchInterval: LIVE.dashboard,
    queryFn: () => request('GET', api.riders.GET('/riders/stats', { params: { query: q } })),
  });
  const deliveries = useQuery({
    queryKey: ['delivery-stats', mfcId],
    refetchInterval: LIVE.dashboard,
    queryFn: () => request('GET', api.execution.GET('/delivery-stats', { params: { query: q } })),
  });
  // 오늘의 할 일 — 처리 목록 API 의 대기 건수(센터와 상관없는 전체)
  const inquiries = useQuery({
    queryKey: ['dashboard-inquiries'],
    refetchInterval: LIVE.dashboard,
    queryFn: () => request('GET', api.cases.GET('/inquiries', { params: { query: { requesterType: 'RIDER', status: 'RECEIVED', size: 50 } } })),
  });
  const reviews = useQuery({
    queryKey: ['dashboard-reviews'],
    refetchInterval: LIVE.dashboard,
    queryFn: () => request('GET', api.riders.GET('/riders/restriction-reviews', { params: { query: { state: 'OPEN' } } })),
  });
  const appeals = useQuery({
    queryKey: ['dashboard-appeals'],
    refetchInterval: LIVE.dashboard,
    queryFn: () => request('GET', api.riders.GET('/rider-appeals', { params: { query: { state: 'OPEN' } } })),
  });
  const s = deliveries.data;
  const controlLink = mfcId ? `/control?mfcId=${encodeURIComponent(mfcId)}` : '/control';
  const inq = listCount(inquiries);
  return (
    <section className="space-y-4">
      <PageHeader title={d.title} description={d.intro} />

      {/* 오늘의 할 일 — 카페24 홈처럼 한 줄 */}
      <section className="overflow-hidden rounded-box border border-base-300 bg-base-100" data-testid="todo-strip" aria-label={todo.title}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-base-300 px-5 py-3">
          <h2 className="font-bold">{todo.title}</h2>
          <span className="text-xs text-base-content/50">{todo.hint}</span>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-base-200 md:grid-cols-3 xl:grid-cols-6 xl:divide-y-0">
          <TodoCell label={d.openHelp} to="/help-requests" count={s?.openHelpRequests} failed={deliveries.isError} testId="stat-open-help" />
          <TodoCell label={todo.inquiries} to="/inquiries" count={inq.count} more={!!inquiries.data?.page?.nextCursor} failed={inq.failed} testId="todo-inquiries" />
          <TodoCell label={todo.reviews} to="/restriction-reviews" {...listCount(reviews)} testId="todo-reviews" />
          <TodoCell label={todo.appeals} to="/appeals" {...listCount(appeals)} testId="todo-appeals" />
          <TodoCell label={d.adjustmentPending} to="/adjustments" count={s?.adjustmentPending} failed={deliveries.isError} testId="stat-adjustments" />
          <TodoCell label={d.surchargeRequested} to="/surcharges" count={s?.surchargeRequested} failed={deliveries.isError} testId="stat-surcharges" />
        </div>
      </section>

      {/* 핵심 수 — 공용 숫자 띠(한 상자, 칸 사이 선 — 통합 백오피스와 같음) */}
      <StatStrip label={d.coreLabel}>
        <QueryState state={toUiState(riders)} onRetry={() => void riders.refetch()}>
          {(r) => (
            <>
              <StatCard label={d.onDuty} value={num(r.onDuty)} to={controlLink} hint={`${d.onDutyHint} · ${d.asOf(when(r.asOf))}`} testId="stat-on-duty" />
              <StatCard label={d.accepting} value={num(r.onDutyAcceptingNew)} to={controlLink} hint={d.acceptingHint} testId="stat-accepting" />
              <StatCard label={d.total} value={num(r.total)} to="/riders" testId="stat-riders-total" />
            </>
          )}
        </QueryState>
        <QueryState state={toUiState(deliveries)} onRetry={() => void deliveries.refetch()}>
          {(x) => (
            <>
              <StatCard label={d.inProgress} value={num(Object.values(x.inProgress ?? {}).reduce((a, b) => a + b, 0))} to="/deliveries" hint={d.asOf(when(x.asOf))} testId="stat-in-progress" />
              <StatCard label={d.completedToday} value={num(x.completedToday)} />
              <StatCard label={d.failedToday} value={num(x.failedToday)} {...warnIf(x.failedToday > 0, 'error')} />
            </>
          )}
        </QueryState>
      </StatStrip>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title={d.riders} aside={riders.data && <span className="text-xs text-base-content/50">{d.asOf(when(riders.data.asOf))}</span>}>
          <QueryState state={toUiState(riders)} onRetry={() => void riders.refetch()}>
            {(r) => (
              <div className="space-y-4">
                <Bars
                  total={Math.max(r.total, 1)}
                  rows={[
                    { label: d.onDuty, value: r.onDuty, to: controlLink, tone: 'bg-[var(--pm-chart-1)]' },
                    { label: d.accepting, value: r.onDutyAcceptingNew, to: controlLink, tone: 'bg-[var(--pm-chart-1)]', sub: true },
                    { label: d.joinedToday, value: r.joinedToday, to: '/signups', tone: 'bg-[var(--pm-chart-1)]' },
                  ]}
                />
                <div className="flex flex-wrap items-center gap-2 rounded-box bg-base-200/60 px-4 py-2.5 text-sm" data-testid="stat-restrictions">
                  <span className="mr-1 text-base-content/60">{d.restricted}</span>
                  {(['DISPATCH_RESTRICTED', 'SUSPENDED', 'TERMINATED'] as const).map((k) => (
                    <StatusBadge key={k} tone={r.byRestriction[k] > 0 ? 'warning' : 'ghost'}>
                      {`${label(n.restriction, k)} ${num(r.byRestriction[k])}`}
                    </StatusBadge>
                  ))}
                </div>
              </div>
            )}
          </QueryState>
        </Section>

        <Section title="진행 중 배송 상태별" aside={deliveries.data && <span className="text-xs text-base-content/50">{d.asOf(when(deliveries.data.asOf))}</span>}>
          <QueryState state={toUiState(deliveries)} onRetry={() => void deliveries.refetch()}>
            {(x) => {
              const byState = Object.entries(x.inProgress ?? {}).filter(([, v]) => v > 0);
              const open = byState.reduce((a, [, v]) => a + v, 0);
              return byState.length === 0 ? (
                <p className="text-sm text-base-content/50" data-testid="stat-by-state">
                  {messages.none}
                </p>
              ) : (
                <div data-testid="stat-by-state">
                  <Bars total={Math.max(open, 1)} rows={byState.map(([k, v]) => ({ label: label(n.executionState, k), value: v, to: `/deliveries?state=${encodeURIComponent(k)}`, tone: k.includes('FAIL') ? 'bg-error' : 'bg-[var(--pm-chart-1)]' }))} />
                </div>
              );
            }}
          </QueryState>
        </Section>
      </div>

      {/* 분석(2026-11-21 사용자 "라이더 시뮬레이션 분석 탭 같으면") — 위 내용은 그대로 두고 아래에 더한다 */}
      <AnalysisSection mfcId={mfcId} />
    </section>
  );
}

/** 가로 막대 줄(이름 · 막대 · 수) — 누르면 그 목록 */
/** [sub] 줄은 바로 위 줄의 일부(들여 쓰고 └ — "운행 중 (전체)" 안의 "새 배달 받는 중") */
function Bars({ rows, total }: { readonly rows: ReadonlyArray<{ readonly label: string; readonly value: number; readonly to: string; readonly tone: string; readonly sub?: boolean }>; readonly total: number }) {
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <Link to={r.to} aria-label={`${r.label} ${num(r.value)}`} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3 text-sm hover:opacity-80">
            <span className={`truncate text-base-content/70 ${r.sub ? 'pl-3' : ''}`}>
              {r.sub && <span aria-hidden="true" className="mr-1 text-base-content/40">└</span>}
              {r.label}
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-base-200">
              <span className={`pm-bar-fill block h-full rounded-full ${r.tone}`} style={{ width: `${Math.min(100, Math.round((r.value / total) * 100))}%` }} />
            </span>
            <span className="text-right font-semibold">{num(r.value)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
