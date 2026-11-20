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
import { DataTable, PageHeader, Section } from '../../shared/admin';
import { Insight, KpiCell, KpiStrip, Meter } from '../../app/Charts';

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
    <section className="space-y-4">
      <PageHeader
        title={m.title}
        actions={
          <button type="button" className="btn btn-sm border-base-300 bg-base-100" disabled={query.isFetching} onClick={() => void query.refetch()}>
            {m.refresh}
          </button>
        }
      />
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(r) => {
          const total = r.cases.reduce((s, c) => s + c.open, 0);
          const overdueTotal = r.cases.reduce((s, c) => s + c.overdue, 0);
          const awaitingTotal = r.inquiries.reduce((s, i) => s + (i.awaitingAnswer ?? 0), 0);
          // 서버 건수에서 바로 읽히는 것만: 처리 중이 가장 많은 종류, 기한 지남이 가장 많은 종류
          const worstKind = r.cases.length > 1 ? r.cases.reduce((w, c) => (c.open > w.open ? c : w)) : undefined;
          const topOverdue = r.cases.filter((c) => c.overdue > 0).reduce<(typeof r.cases)[number] | undefined>((w, c) => (!w || c.overdue > w.overdue ? c : w), undefined);
          return (
            <div className="space-y-4">
              <p className="text-xs text-base-content/60" data-testid="metrics-as-of">
                {m.asOf(when(r.asOf))}
              </p>
              {/* 위 숫자 카드(2026-11-18) — 서버 건수를 더한 것만 */}
              {/* 숫자 줄(2026-11-20 통계 개편) — 건수만(비율·목표 없음) */}
              <KpiStrip cols={4}>
                <KpiCell label={m.cardOpen} value={total} unit={m.unit} sub={worstKind ? m.mostOpen(label(messages.cases.kindName, worstKind.kind), worstKind.open) : undefined} />
                <KpiCell
                  label={m.cardOverdue}
                  value={overdueTotal}
                  unit={m.unit}
                  tone={overdueTotal > 0 ? 'danger' : 'muted'}
                  sub={overdueTotal > 0 ? <Link className="link" to="/cases?tab=overdue">{m.goOverdue}</Link> : m.noneOverdue}
                />
                <KpiCell label={m.pendingHandovers} value={r.pendingHandovers} unit={m.unit} tone={r.pendingHandovers > 0 ? 'warning' : 'muted'} />
                <KpiCell label={m.inquiries} value={awaitingTotal} unit={m.unit} tone={awaitingTotal > 0 ? undefined : 'muted'} />
              </KpiStrip>
              {topOverdue && <Insight>{m.mostOverdue(label(messages.cases.kindName, topOverdue.kind), topOverdue.overdue, topOverdue.open)}</Insight>}

              <div className="grid items-start gap-4 lg:grid-cols-3">
                <div className="min-w-0 lg:col-span-2">
                  <Section title={m.cases}>
                    {r.cases.length === 0 ? (
                      <p className="text-sm text-base-content/60">{m.noOpenCases}</p>
                    ) : (
                      <DataTable>
                        <thead>
                          <tr>
                            <th>{m.kind}</th>
                            <th className="text-right">{m.open}</th>
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
                                <td className="text-right">
                                  <Count n={c.open} />
                                </td>
                                <td>
                                  <span className="text-sm">{m.ofOpen(c.unassigned, c.open)}</span>
                                  <Meter value={c.open > 0 ? c.unassigned / c.open : null} className="w-full max-w-40" />
                                </td>
                                <td>
                                  <Count n={c.overdue} danger to={to('overdue')} testId="metrics-overdue" />
                                  <span className="opacity-60">{` / ${c.open}`}</span>
                                  <Meter value={c.open > 0 ? c.overdue / c.open : null} tone="danger" className="w-full max-w-40" />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td>{m.total}</td>
                            <td className="text-right">{total}</td>
                            <td />
                            <td />
                          </tr>
                        </tfoot>
                      </DataTable>
                    )}
                  </Section>
                </div>

                <div className="min-w-0 space-y-4">
                  <Section title={m.obligations}>
                    {r.obligations.length === 0 ? (
                      <p className="text-sm text-base-content/60">{m.noObligations}</p>
                    ) : (
                      <ul className="space-y-3 text-sm">
                        {r.obligations.map((o) => (
                          <li key={o.owner} data-testid="metrics-obligation">
                            {`${label(messages.cases.groupName, o.owner)} · ${m.open} `}
                            <Count n={o.open} />
                            {` · ${m.overdue} `}
                            <Count n={o.overdue} danger />
                            <span className="opacity-60">{` / ${o.open}`}</span>
                            <Meter value={o.open > 0 ? o.overdue / o.open : null} tone="danger" className="w-full max-w-40" />
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>

                  <Section title={m.handoversTitle}>
                    <p className="text-sm" data-testid="metrics-handovers">
                      {m.pendingHandovers} <Count n={r.pendingHandovers} to="/cases/handovers?tab=unreceived" />
                    </p>
                  </Section>

                  <Section title={m.inquiries}>
                    <ul className="divide-y divide-base-300/70 text-sm">
                      {(['CUSTOMER', 'RIDER'] as const).map((t) => {
                        const row = r.inquiries.find((i) => i.requesterType === t);
                        const n = row?.awaitingAnswer ?? 0;
                        return (
                          <li key={t} className="py-2 first:pt-0 last:pb-0" data-testid="metrics-inquiry" data-type={t}>
                            {`${m.inquiryName[t]} · ${m.awaiting} `}
                            <Count n={n} to={`${t === 'RIDER' ? '/rider-inquiries' : '/inquiries'}?status=RECEIVED`} />
                            {row?.oldestReceivedAt && <span className="block text-xs opacity-70">{` · ${m.oldest(when(row.oldestReceivedAt))}`}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </Section>
                </div>
              </div>
            </div>
          );
        }}
      </QueryState>
    </section>
  );
}

