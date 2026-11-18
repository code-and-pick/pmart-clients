// 승인함(approval-service GET /approvals). 필터는 URL 쿼리에 둔다. "더 보기"는 다음 쪽(page.nextCursor)을 이어 붙인다(받은 줄은 그대로).
// 예전에는 더 보기가 커서를 URL 에 넣자마자 필터 함수가 지워 버려 아무 일도 없었다(2026-11-17 사용자 신고).
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';

import { APPROVAL_TYPES, REVIEW_STATES, type ApprovalType, type ReviewState } from '../../api/models';
import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { formatSeoul } from '@pmart/web-ui';
import { messages as m } from '../../shared/messages';
import { QueryState } from '@pmart/web-ui';
import { toUiState } from '@pmart/web-ui';
import { DataTable, PageHeader, SearchRow } from '../../shared/admin';

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | undefined =>
  allowed.find((a) => a === value);

export function ApprovalListPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const type = pick<ApprovalType>(params.get('type'), APPROVAL_TYPES);
  const reviewState = pick<ReviewState>(params.get('reviewState'), REVIEW_STATES);
  const query = useInfiniteQuery({
    queryKey: ['approval', 'list', type, reviewState],
    queryFn: ({ pageParam: cursor }) =>
      request(
        'GET',
        api.approval.GET('/approvals', {
          params: {
            query: {
              ...(type ? { type } : {}),
              ...(reviewState ? { reviewState } : {}),
              ...(cursor ? { cursor } : {}),
              size: 50,
            },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  return (
    <section className="space-y-4">
      <PageHeader title={m.approvals.title} />
      {/* 관리자 형식(2026-11-18): 검색 조건 상자 — 줄마다 왼쪽 항목명 */}
      <div className="divide-y divide-base-300 overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
        <SearchRow label={m.approvals.type}>
        <select
          aria-label={m.approvals.type}
          className="select select-sm w-48"
          value={type ?? ''}
          onChange={(e) => setFilter('type', e.target.value)}
        >
          <option value="">{`${m.approvals.type}: ${m.approvals.filterAll}`}</option>
          {APPROVAL_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        </SearchRow>
        <SearchRow label={m.approvals.review}>
        <select
          aria-label={m.approvals.review}
          className="select select-sm w-56"
          value={reviewState ?? ''}
          onChange={(e) => setFilter('reviewState', e.target.value)}
        >
          <option value="">{`${m.approvals.review}: ${m.approvals.filterAll}`}</option>
          {REVIEW_STATES.map((s) => (
            <option key={s} value={s}>
              {m.approvals.reviewState[s]}
            </option>
          ))}
        </select>
        </SearchRow>
      </div>

      <QueryState
        // 다음 쪽 실패는 이미 받은 줄을 가리지 않는다 — 첫 쪽이 있으면 그 데이터로(경고는 아래 줄)
        state={
          query.data
            ? query.data.pages.every((p) => (p.items?.length ?? 0) === 0)
              ? { kind: 'empty' }
              : { kind: 'ready', data: query.data }
            : toUiState(query)
        }
        onRetry={() => void query.refetch()}
        emptyText={m.approvals.empty}
      >
        {(data) => (
          <>
            <DataTable>
              <thead>
                <tr>
                  <th>{m.approvals.dossier}</th>
                  <th>{m.approvals.type}</th>
                  <th>{m.approvals.summary}</th>
                  <th>{m.approvals.requester}</th>
                  <th>{m.approvals.review}</th>
                  <th>{m.approvals.execution}</th>
                  <th>{m.approvals.submittedAt}</th>
                </tr>
              </thead>
              <tbody>
                {data.pages.flatMap((p) => p.items ?? []).map((a, i) => (
                  <tr key={a.approvalId ?? `row-${i}`}>
                    <td>
                      {a.approvalId ? (
                        <Link className="link" to={`/approvals/${encodeURIComponent(a.approvalId)}`}>
                          {a.approvalId}
                        </Link>
                      ) : (
                        m.none
                      )}
                    </td>
                    <td>{a.type ?? m.none}</td>
                    <td>{a.summary ?? m.none}</td>
                    <td>{a.requesterId ?? m.none}</td>
                    <td>{a.reviewState ? m.approvals.reviewState[a.reviewState] : m.none}</td>
                    <td>{a.executionState ? m.approvals.executionState[a.executionState] : m.none}</td>
                    <td>{a.submittedAt ? formatSeoul(a.submittedAt) : m.none}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            {/* 다음 쪽을 못 읽으면 받은 줄은 두고 경고만(0건·끝으로 보이지 않게) */}
            {query.isFetchNextPageError && <p className="text-sm text-error">{m.approvals.moreFailed}</p>}
            {query.hasNextPage && (
              <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                {m.more}
              </button>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}
