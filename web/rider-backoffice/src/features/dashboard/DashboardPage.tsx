// 대시보드(2026-11-17, PC 5 — 사용자 "대시보드에 필요한 것만"): rider `GET /riders/stats` + execution `GET /delivery-stats`.
// 두 원천을 따로 불러 한쪽이 실패해도 다른 쪽은 보인다(0 으로 바꾸지 않는다).
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { CenterPicker, label, when } from '../../shared/opsUi';

const d = ops.dashboard;
const n = messages.names;

function Stat({ title, value, to, testId }: { readonly title: string; readonly value: number; readonly to?: string; readonly testId?: string }) {
  const body = (
    <div className="stat rounded-box bg-base-100" {...(testId ? { 'data-testid': testId } : {})}>
      <div className="stat-title">{title}</div>
      <div className="stat-value text-2xl">{value.toLocaleString('ko-KR')}</div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

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
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{d.title}</h1>
      <p className="text-sm opacity-70">{d.intro}</p>
      <CenterPicker value={mfcId} allowAll onChange={(v) => setParams(v ? { mfcId: v } : {})} />
      <h2 className="font-bold">{d.riders}</h2>
      <QueryState state={toUiState(riders)} onRetry={() => void riders.refetch()}>
        {(r) => (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-3">
              <Stat title={d.total} value={r.total} to="/riders" testId="stat-riders-total" />
              <Stat title={d.onDuty} value={r.onDuty} to="/control" testId="stat-on-duty" />
              <Stat title={d.accepting} value={r.onDutyAcceptingNew} />
              <Stat title={d.joinedToday} value={r.joinedToday} to="/signups" />
            </div>
            <p className="text-sm">
              {d.restricted}:{' '}
              {(['DISPATCH_RESTRICTED', 'SUSPENDED', 'TERMINATED'] as const)
                .map((k) => `${label(n.restriction, k)} ${r.byRestriction[k]}`)
                .join(' · ')}
            </p>
            <p className="text-xs opacity-60">{d.asOf(when(r.asOf))}</p>
          </div>
        )}
      </QueryState>
      <h2 className="font-bold">{d.deliveries}</h2>
      <QueryState state={toUiState(deliveries)} onRetry={() => void deliveries.refetch()}>
        {(s) => {
          const open = Object.values(s.inProgress ?? {}).reduce((a, b) => a + b, 0);
          return (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3">
                <Stat title={d.inProgress} value={open} to="/deliveries" testId="stat-in-progress" />
                <Stat title={d.completedToday} value={s.completedToday} />
                <Stat title={d.failedToday} value={s.failedToday} />
              </div>
              <p className="text-sm" data-testid="stat-by-state">
                {Object.entries(s.inProgress ?? {})
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => `${label(n.executionState, k)} ${v}`)
                  .join(' · ') || messages.none}
              </p>
              <h2 className="font-bold">{d.work}</h2>
              <div className="flex flex-wrap gap-3">
                <Stat title={d.openHelp} value={s.openHelpRequests} to="/help-requests" testId="stat-open-help" />
                <Stat title={d.adjustmentPending} value={s.adjustmentPending} to="/adjustments" testId="stat-adjustments" />
                <Stat title={d.surchargeRequested} value={s.surchargeRequested} to="/surcharges" testId="stat-surcharges" />
              </div>
            </div>
          );
        }}
      </QueryState>
    </section>
  );
}
