// 접수 건 현황 건수(case 0.18.0 `GET /cases/metrics` — 백엔드 요청 backoffice/2026-11-17-request-case-metrics, 사용자 "우리 데이터 건수부터", BO-28 1단계).
// 관리자만. 건수만 — 비율·목표·SLA 달성률은 승인된 정의가 없어 만들지 않는다("N건 중 M건"). 직원 개인별로 나누지 않는다.
// 0건인 종류·팀은 응답에 줄이 없다 → 0 으로 그린다(조회 실패는 0 이 아니라 오류). asOf 표시, 새로고침 버튼(자동은 1분).
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { label, when } from '../../shared/ops';
import { DataTable, PageHeader } from '../../shared/admin';

const m = messages.caseMetrics;
type Kind = components['schemas']['CaseKind'];
/** 사건함(/cases)에서 거를 수 있는 종류 — 그 밖(문의 사건 등)은 링크 없이 숫자만 */
const LISTABLE: readonly Kind[] = ['RIDER_HELP', 'DELIVERY_INCIDENT', 'RIDER_LOCATION_STALE', 'MISDELIVERY', 'DISPATCH_FAILED', 'RECONCILIATION', 'PAYMENT_UNKNOWN'];
const REFRESH_MS = 60_000;

function Count({ n, to, danger = false, testId }: { readonly n: number; readonly to?: string | undefined; readonly danger?: boolean; readonly testId?: string }) {
  const cls = danger && n > 0 ? 'font-bold text-error' : 'font-bold';
  return to && n > 0 ? (
    <Link className={`link ${cls}`} to={to} data-testid={testId}>
      {n}
    </Link>
  ) : (
    <span className={cls} data-testid={testId}>
      {n}
    </span>
  );
}

export function CaseMetricsPage() {
  const api = useApi();
  const query = useQuery({
    queryKey: ['cases', 'metrics'],
    refetchInterval: REFRESH_MS,
    queryFn: () => request('GET', api.cases.GET('/cases/metrics', {})),
  });
  return (
    <section className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PageHeader title={m.title} />
        <button type="button" className="btn btn-ghost btn-sm" disabled={query.isFetching} onClick={() => void query.refetch()}>
          {m.refresh}
        </button>
      </div>
      <p className="text-sm text-base-content/60">{m.intro}</p>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(r) => {
          const total = r.cases.reduce((s, c) => s + c.open, 0);
          return (
            <div className="space-y-4">
              <p className="text-xs text-base-content/60" data-testid="metrics-as-of">
                {m.asOf(when(r.asOf))}
              </p>

              <h2 className="font-bold">{m.cases}</h2>
              {r.cases.length === 0 ? (
                <p className="text-sm text-base-content/60">{m.noOpenCases}</p>
              ) : (
                <DataTable>
                  <thead>
                    <tr>
                      <th>{m.kind}</th>
                      <th>{m.open}</th>
                      <th>{m.unassigned}</th>
                      <th>{m.overdue}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.cases.map((c) => {
                      const listable = LISTABLE.includes(c.kind);
                      const to = (tab: string) => (listable ? `/cases?${new URLSearchParams({ tab, kind: c.kind }).toString()}` : undefined);
                      return (
                        <tr key={c.kind} data-testid="metrics-case" data-kind={c.kind}>
                          <td>{label(messages.cases.kindName, c.kind)}</td>
                          <td>
                            <Count n={c.open} />
                          </td>
                          <td>{m.ofOpen(c.unassigned, c.open)}</td>
                          <td>
                            <Count n={c.overdue} danger to={to('overdue')} testId="metrics-overdue" />
                            <span className="opacity-60">{` / ${c.open}`}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{m.total}</td>
                      <td>{total}</td>
                      <td />
                      <td />
                    </tr>
                  </tfoot>
                </DataTable>
              )}

              <h2 className="font-bold">{m.obligations}</h2>
              {r.obligations.length === 0 ? (
                <p className="text-sm text-base-content/60">{m.noObligations}</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {r.obligations.map((o) => (
                    <li key={o.owner} className="rounded-box border border-base-300 bg-base-100 shadow-sm p-2" data-testid="metrics-obligation">
                      {`${label(messages.cases.groupName, o.owner)} · ${m.open} `}
                      <Count n={o.open} />
                      {` · ${m.overdue} `}
                      <Count n={o.overdue} danger />
                      <span className="opacity-60">{` / ${o.open}`}</span>
                    </li>
                  ))}
                </ul>
              )}

              <h2 className="font-bold">{m.handoversTitle}</h2>
              <p className="rounded-box border border-base-300 bg-base-100 shadow-sm p-2 text-sm" data-testid="metrics-handovers">
                {m.pendingHandovers}{' '}
                <Count n={r.pendingHandovers} to="/cases/handovers?tab=unreceived" />
              </p>

              <h2 className="font-bold">{m.inquiries}</h2>
              <ul className="space-y-1 text-sm">
                {(['CUSTOMER', 'RIDER'] as const).map((t) => {
                  const row = r.inquiries.find((i) => i.requesterType === t);
                  const n = row?.awaitingAnswer ?? 0;
                  return (
                    <li key={t} className="rounded-box border border-base-300 bg-base-100 shadow-sm p-2" data-testid="metrics-inquiry" data-type={t}>
                      {`${m.inquiryName[t]} · ${m.awaiting} `}
                      <Count n={n} to={`${t === 'RIDER' ? '/rider-inquiries' : '/inquiries'}?status=RECEIVED`} />
                      {row?.oldestReceivedAt && <span className="opacity-70">{` · ${m.oldest(when(row.oldestReceivedAt))}`}</span>}
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-base-content/60">{m.noRates}</p>
            </div>
          );
        }}
      </QueryState>
    </section>
  );
}
