import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { useApi } from '../../app/ApiContext';
import { request } from '@pmart/web-core';
import { messages as m } from '../../shared/messages';
import { QueryState, uiStateFromError, type UiState } from '@pmart/web-ui';
import { SourceStamps } from '../../shared/SourceStamps';
import type { ApprovalInboxView } from '../../api/views';
import { CodeLabel, DataTable, PageHeader, StatusBadge, type Tone, useRowLink } from '../../shared/admin';
import { KindChip, ListFoot, When } from '../lookup/parts';

const REVIEW_TONE: Readonly<Record<string, Tone>> = {
  REVIEW_PENDING: 'warning',
  EVIDENCE_REQUIRED: 'warning',
  APPROVED: 'success',
  PARTIALLY_APPROVED: 'info',
  REJECTED: 'error',
};
const EXEC_TONE: Readonly<Record<string, Tone>> = { VALIDATING: 'info', ACCEPTED: 'info', IN_PROGRESS: 'info', PARTIAL: 'warning', APPLIED: 'success', REJECTED: 'error', UNKNOWN_RESULT: 'warning' };
const TYPE_TONE: Readonly<Record<string, Tone>> = { PRODUCT: 'info', DISPLAY: 'accent', PRICE: 'warning', GRANT: 'neutral' };
const reviewName = m.approvals.reviewState as Readonly<Record<string, string>>;
const execName = m.approvals.executionState as Readonly<Record<string, string>>;
const TYPE_NAME: Readonly<Record<string, string>> = { ...m.approvals.typeName, ...m.approvals.otherTypeName };

/** 승인함(BO-10). 명령 버튼은 C3 에서 bff 명령 프록시로 붙인다. */
export function ApprovalInboxPage() {
  const api = useApi();
  const rowLink = useRowLink();
  const query = useQuery({
    queryKey: ['bff', 'approval-inbox'],
    queryFn: () => request('GET', api.bff.GET('/views/approval-inbox', {})),
  });

  const state: UiState<ApprovalInboxView> = query.isPending
    ? { kind: 'loading' }
    : query.isError
      ? uiStateFromError(query.error)
      : (query.data.unavailableSources?.length ?? 0) > 0
        ? { kind: 'partial', data: query.data, missing: query.data.unavailableSources ?? [] }
        : (query.data.items?.length ?? 0) === 0
          ? { kind: 'empty' }
          : { kind: 'ready', data: query.data };

  // 화면(2026-11-18 승인함 목록과 같은 짜임): 원천 표시 → 한 카드(첫 칸 건 번호 굵게, 유형 색 꼬리표, 심사·반영 점 꼬리표, "N일 전") → 건수
  return (
    <section className="space-y-4">
      <PageHeader title={m.approvals.title} description={m.approvals.intro} />
      <QueryState state={state} onRetry={() => void query.refetch()} emptyText={m.approvals.empty}>
        {(view) => {
          const items = view.items ?? [];
          return (
            <div className="space-y-3">
              <SourceStamps sources={view.sources} unavailableSources={view.unavailableSources} />
              <div>
                <DataTable>
                  <thead>
                    <tr>
                      <th>{m.approvals.dossier}</th>
                      <th>{m.approvals.type}</th>
                      <th>{m.approvals.review}</th>
                      <th>{m.approvals.execution}</th>
                      <th className="text-right">{m.approvals.submittedAt}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={item.dossierId ?? `row-${i}`} {...((item.approvalId ?? item.dossierId) ? rowLink(`/approvals/${encodeURIComponent(item.approvalId ?? item.dossierId ?? "")}`) : {})}>
                        <td>
                          {/* 승인·반려는 승인 상세에서 한다. BR-40 회신: dossierId = approval-service 승인 ID(approvalId 로도 온다). */}
                          {(item.approvalId ?? item.dossierId) ? (
                            <Link className="font-mono font-semibold text-base-content hover:text-primary hover:underline" to={`/approvals/${encodeURIComponent(item.approvalId ?? item.dossierId ?? '')}`}>
                              {item.dossierId ?? item.approvalId}
                            </Link>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td>{item.approvalType ? <KindChip tone={TYPE_TONE[item.approvalType] ?? 'ghost'}><CodeLabel code={item.approvalType} names={TYPE_NAME} /></KindChip> : '-'}</td>
                        <td>{item.reviewState ? <StatusBadge tone={REVIEW_TONE[item.reviewState] ?? 'ghost'}><CodeLabel code={item.reviewState} names={reviewName} /></StatusBadge> : '-'}</td>
                        <td>{item.executionState ? <StatusBadge tone={EXEC_TONE[item.executionState] ?? 'ghost'}><CodeLabel code={item.executionState} names={execName} /></StatusBadge> : '-'}</td>
                        <td>
                          <When iso={item.submittedAt} align="right" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
                <ListFoot>
                  <span className="text-base-content/55">{m.approvals.shown(items.length, false)}</span>
                </ListFoot>
              </div>
            </div>
          );
        }}
      </QueryState>
    </section>
  );
}
