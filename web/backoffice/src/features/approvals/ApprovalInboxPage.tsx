import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { useApi } from '../../app/ApiContext';
import { request } from '@pmart/web-core';
import { formatSeoul } from '@pmart/web-ui';
import { messages as m } from '../../shared/messages';
import { QueryState, uiStateFromError, type UiState } from '@pmart/web-ui';
import { SourceStamps } from '../../shared/SourceStamps';
import type { ApprovalInboxView } from '../../api/views';
import { DataTable, PageHeader } from '../../shared/admin';

/** 승인함(BO-10). 명령 버튼은 C3 에서 bff 명령 프록시로 붙인다. */
export function ApprovalInboxPage() {
  const api = useApi();
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

  return (
    <section className="space-y-4">
      <PageHeader title={m.approvals.title} />
      <QueryState state={state} onRetry={() => void query.refetch()} emptyText={m.approvals.empty}>
        {(view) => (
          <>
            <SourceStamps sources={view.sources} unavailableSources={view.unavailableSources} />
            <DataTable>
              <thead>
                <tr>
                  <th>{m.approvals.dossier}</th>
                  <th>{m.approvals.type}</th>
                  <th>{m.approvals.review}</th>
                  <th>{m.approvals.execution}</th>
                  <th>{m.approvals.submittedAt}</th>
                </tr>
              </thead>
              <tbody>
                {(view.items ?? []).map((item, i) => (
                  <tr key={item.dossierId ?? `row-${i}`}>
                    <td>
                      {/* 승인·반려는 승인 상세에서 한다. BR-40 회신: dossierId = approval-service 승인 ID(approvalId 로도 온다). */}
                      {(item.approvalId ?? item.dossierId) ? (
                        <Link className="link" to={`/approvals/${encodeURIComponent(item.approvalId ?? item.dossierId ?? '')}`}>
                          {item.dossierId ?? item.approvalId}
                        </Link>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>{item.approvalType ?? '-'}</td>
                    <td>{item.reviewState ?? '-'}</td>
                    <td>{item.executionState ?? '-'}</td>
                    <td>{item.submittedAt ? formatSeoul(item.submittedAt) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </>
        )}
      </QueryState>
    </section>
  );
}
