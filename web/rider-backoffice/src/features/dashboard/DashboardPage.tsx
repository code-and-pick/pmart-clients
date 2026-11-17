// 대시보드(2026-11-17, PC 5 — 사용자 "대시보드에 필요한 것만"): rider `GET /riders/stats` + execution `GET /delivery-stats`.
// 두 원천을 따로 불러 한쪽이 실패해도 다른 쪽은 보인다(0 으로 바꾸지 않는다).
// 2026-11-18: 관리자 화면 모양 — 머리말(센터 고르기) + 구역 상자(라이더 / 배송 / 처리할 일)마다 같은 크기 카드 줄. 목록이 있는 수는 그 목록으로 간다.
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { PageHeader, Section, StatCard, StatusBadge } from '../../shared/admin';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { CenterPicker, label, when } from '../../shared/opsUi';

const d = ops.dashboard;
const n = messages.names;
const num = (v: number) => v.toLocaleString('ko-KR');
/** 처리할 것이 있을 때만 색(서버 수 그대로, 색만 바꾼다) */
const warnIf = (on: boolean, tone: 'warning' | 'error') => (on ? { tone } : {});

/** 카드 줄 — 넓은 화면 4칸(처리할 일처럼 3장이면 3칸으로 고르게) */
function CardGrid({ cols = 4, children }: { readonly cols?: 3 | 4; readonly children: ReactNode }) {
  return <div className={`grid gap-3 sm:grid-cols-2 ${cols === 3 ? 'lg:grid-cols-3' : 'xl:grid-cols-4'}`}>{children}</div>;
}

const asOf = (iso: string | null | undefined) => <span className="text-xs text-base-content/50">{d.asOf(when(iso))}</span>;

export function DashboardPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const mfcId = params.get('mfcId') ?? '';
  const q = mfcId ? { mfcId } : {};
  const riders = useQuery({
    queryKey: ['rider-stats', mfcId],
    queryFn: () => request('GET', api.riders.GET('/riders/stats', { params: { query: q } })),
  });
  const deliveries = useQuery({
    queryKey: ['delivery-stats', mfcId],
    queryFn: () => request('GET', api.execution.GET('/delivery-stats', { params: { query: q } })),
  });
  const controlLink = mfcId ? `/control?mfcId=${encodeURIComponent(mfcId)}` : '/control';
  return (
    <section className="max-w-6xl space-y-4">
      <PageHeader title={d.title} description={d.intro} actions={<CenterPicker value={mfcId} allowAll onChange={(v) => setParams(v ? { mfcId: v } : {})} />} />

      <Section title={d.riders} aside={riders.data && asOf(riders.data.asOf)}>
        <QueryState state={toUiState(riders)} onRetry={() => void riders.refetch()}>
          {(r) => (
            <div className="space-y-3">
              <CardGrid>
                <StatCard label={d.total} value={num(r.total)} to="/riders" testId="stat-riders-total" />
                <StatCard label={d.onDuty} value={num(r.onDuty)} to={controlLink} testId="stat-on-duty" />
                <StatCard label={d.accepting} value={num(r.onDutyAcceptingNew)} />
                <StatCard label={d.joinedToday} value={num(r.joinedToday)} to="/signups" />
              </CardGrid>
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

      <Section title={d.deliveries} aside={deliveries.data && asOf(deliveries.data.asOf)}>
        <QueryState state={toUiState(deliveries)} onRetry={() => void deliveries.refetch()}>
          {(s) => {
            const byState = Object.entries(s.inProgress ?? {}).filter(([, v]) => v > 0);
            const open = Object.values(s.inProgress ?? {}).reduce((x, y) => x + y, 0);
            return (
              <CardGrid>
                <StatCard label={d.inProgress} value={num(open)} to="/deliveries" testId="stat-in-progress" />
                <StatCard label={d.completedToday} value={num(s.completedToday)} />
                <StatCard label={d.failedToday} value={num(s.failedToday)} {...warnIf(s.failedToday > 0, 'error')} />
                <div className="rounded-box border border-base-300 bg-base-100 px-5 py-4">
                  <p className="text-sm text-base-content/60">진행 중 상태별</p>
                  {byState.length === 0 ? (
                    <p className="mt-2 text-sm text-base-content/50" data-testid="stat-by-state">
                      {messages.none}
                    </p>
                  ) : (
                    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm" data-testid="stat-by-state">
                      {byState.map(([k, v]) => (
                        <li key={k}>
                          <Link className="hover:underline" to={`/deliveries?state=${encodeURIComponent(k)}`}>
                            {label(n.executionState, k)} <span className="font-semibold">{num(v)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardGrid>
            );
          }}
        </QueryState>
      </Section>

      <Section title={d.work}>
        <QueryState state={toUiState(deliveries)} onRetry={() => void deliveries.refetch()}>
          {(s) => (
            <CardGrid cols={3}>
              <StatCard label={d.openHelp} value={num(s.openHelpRequests)} to="/help-requests" {...warnIf(s.openHelpRequests > 0, 'warning')} testId="stat-open-help" />
              <StatCard label={d.adjustmentPending} value={num(s.adjustmentPending)} to="/adjustments" {...warnIf(s.adjustmentPending > 0, 'warning')} testId="stat-adjustments" />
              <StatCard label={d.surchargeRequested} value={num(s.surchargeRequested)} to="/surcharges" {...warnIf(s.surchargeRequested > 0, 'warning')} testId="stat-surcharges" />
            </CardGrid>
          )}
        </QueryState>
      </Section>
    </section>
  );
}
