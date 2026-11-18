// 직원 목록(GET /hr/employees?status&affiliationCode&q&size&cursor). 필터는 URL 쿼리에 둔다.
// 조회 실패를 빈 목록으로 보이지 않는다(QueryState). 권한이 없으면 서버 403 → "이용할 수 없는 화면".
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, uiStateFromError, type UiState } from '@pmart/web-ui';
import { EMPLOYMENT_STATUSES, type Employee, type EmploymentStatus } from '../../api/models';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { messages as m } from '../../shared/messages';
import { affiliationText } from './labels';
import { DataTable, PageHeader, ResultBar, SearchPanel, SearchRow, StatusBadge, useRowLink } from '../../shared/admin';
import { provisioningTone, statusTone } from './labels';

const PAGE_SIZE = 50;

const isStatus = (v: string | null): v is EmploymentStatus => EMPLOYMENT_STATUSES.some((s) => s === v);

export function EmployeeListPage() {
  const api = useApi();
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const affiliationCode = params.get('affiliationCode') ?? '';
  const q = params.get('q') ?? '';
  // 입력 중인 값(조회를 눌러야 URL·요청에 반영된다)
  const [draft, setDraft] = useState({ status: status ?? '', affiliationCode, q });

  const query = useInfiniteQuery({
    queryKey: ['hr', 'employees', session?.subject, status ?? '', affiliationCode, q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request(
        'GET',
        api.hr.GET('/hr/employees', {
          params: {
            query: {
              ...(status ? { status } : {}),
              ...(affiliationCode ? { affiliationCode } : {}),
              ...(q ? { q } : {}),
              size: PAGE_SIZE,
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor || undefined,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const rowLink = useRowLink();
  const state: UiState<readonly Employee[]> = query.isPending
    ? { kind: 'loading' }
    : query.isError && !query.data
      ? uiStateFromError(query.error)
      : items.length === 0
        ? { kind: 'empty' }
        : { kind: 'ready', data: items };

  return (
    <section className="space-y-4">
      <PageHeader
        title={m.list.title}
        description={m.list.intro}
        actions={
          <Link to="/employees/new" className="btn btn-primary btn-sm">
            {m.list.register}
          </Link>
        }
      />
      {/* 관리자 형식(2026-11-18): 검색 조건 상자 — 줄마다 왼쪽 항목명 */}
      <SearchPanel
        submitLabel={m.search}
        resetLabel={m.list.reset}
        onReset={() => setDraft({ status: '', affiliationCode: '', q: '' })}
        onSubmit={(e) => {
          e.preventDefault();
          const next = new URLSearchParams();
          if (draft.status) next.set('status', draft.status);
          if (draft.affiliationCode.trim()) next.set('affiliationCode', draft.affiliationCode.trim());
          if (draft.q.trim()) next.set('q', draft.q.trim());
          setParams(next);
        }}
      >
        <SearchRow label={m.list.q}>
          <input
            aria-label={m.list.q}
            className="input input-sm w-64"
            maxLength={60}
            placeholder={m.list.qHint}
            value={draft.q}
            onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
          />
        </SearchRow>
        <SearchRow label={m.fields.status}>
          <select aria-label={m.fields.status} className="select select-sm w-40" value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>
            <option value="">{m.list.allStatuses}</option>
            {EMPLOYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {m.employmentStatus[s]}
              </option>
            ))}
          </select>
        </SearchRow>
        <SearchRow label={m.fields.affiliationCode}>
          <input
            aria-label={m.fields.affiliationCode}
            className="input input-sm w-48"
            maxLength={64}
            placeholder={m.list.affiliationCodeHint}
            value={draft.affiliationCode}
            onChange={(e) => setDraft((d) => ({ ...d, affiliationCode: e.target.value }))}
          />
        </SearchRow>
      </SearchPanel>

      <QueryState state={state} onRetry={() => void query.refetch()} emptyText={m.list.empty}>
        {(rows) => (
          <div className="space-y-3">
            {/* 목록(2026-11-18 백오피스와 같은 모양): 검색 → 건수 줄 → 표가 한 카드, 첫 칸은 이름(머리글자) + 사번 작게, 상태는 색 꼬리표, 줄 전체를 누르면 상세 */}
            <div>
            <ResultBar count={rows.length} more={query.hasNextPage} unit="명" />
            <DataTable>
                <thead>
                  <tr>
                    <th>{m.list.person}</th>
                    <th>{m.fields.mailAddress}</th>
                    <th>{m.fields.employmentType}</th>
                    <th>{m.fields.affiliation}</th>
                    <th>{m.fields.status}</th>
                    <th>{m.fields.provisioning}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.operatorId} data-testid="employee-row" {...rowLink(`/employees/${encodeURIComponent(e.operatorId)}`)}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary" aria-hidden="true">
                            {e.name.slice(0, 1)}
                          </span>
                          <div className="min-w-0">
                            <p className="font-semibold">{e.name}</p>
                            <Link className="font-mono text-xs font-normal text-base-content/55 hover:text-primary hover:underline" to={`/employees/${encodeURIComponent(e.operatorId)}`}>
                              {e.employeeNo}
                            </Link>
                          </div>
                        </div>
                      </td>
                      <td className="text-sm">{e.mailAddress}</td>
                      <td className="text-sm">{m.employmentType[e.employmentType]}</td>
                      <td className="text-sm">{affiliationText(e.affiliation)}</td>
                      <td>
                        <StatusBadge tone={statusTone(e.status)}>{m.employmentStatus[e.status]}</StatusBadge>
                      </td>
                      <td>
                        <StatusBadge tone={provisioningTone(e.provisioning.step)}>{m.provisioningStep[e.provisioning.step]}</StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
            </DataTable>
            </div>
            <div className="flex items-center gap-3 text-sm">
              {query.hasNextPage && (
                <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                  {m.more}
                </button>
              )}
            </div>
            {/* 다음 쪽만 실패한 경우: 이미 받은 행은 두고 실패를 알린다 */}
            {query.isFetchNextPageError && (
              <p role="alert" className="alert alert-error text-sm">
                {m.errorTitle}
              </p>
            )}
          </div>
        )}
      </QueryState>
    </section>
  );
}
