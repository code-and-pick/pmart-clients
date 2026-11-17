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
import { DataTable, PageHeader } from '../../shared/admin';

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
  const state: UiState<readonly Employee[]> = query.isPending
    ? { kind: 'loading' }
    : query.isError && !query.data
      ? uiStateFromError(query.error)
      : items.length === 0
        ? { kind: 'empty' }
        : { kind: 'ready', data: items };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <PageHeader title={m.list.title} />
        <Link to="/employees/new" className="btn btn-primary btn-sm">
          {m.list.register}
        </Link>
      </div>
      <form
        className="flex flex-wrap items-end gap-3 rounded-box border border-base-300 bg-base-100 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const next = new URLSearchParams();
          if (draft.status) next.set('status', draft.status);
          if (draft.affiliationCode.trim()) next.set('affiliationCode', draft.affiliationCode.trim());
          if (draft.q.trim()) next.set('q', draft.q.trim());
          setParams(next);
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          {m.list.q}
          <input
            className="input input-sm w-56"
            maxLength={60}
            placeholder={m.list.qHint}
            value={draft.q}
            onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {m.fields.status}
          <select className="select select-sm" value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>
            <option value="">{m.list.allStatuses}</option>
            {EMPLOYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {m.employmentStatus[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {m.fields.affiliationCode}
          <input
            className="input input-sm w-44"
            maxLength={64}
            placeholder={m.list.affiliationCodeHint}
            value={draft.affiliationCode}
            onChange={(e) => setDraft((d) => ({ ...d, affiliationCode: e.target.value }))}
          />
        </label>
        <button type="submit" className="btn btn-sm">
          {m.search}
        </button>
      </form>

      <QueryState state={state} onRetry={() => void query.refetch()} emptyText={m.list.empty}>
        {(rows) => (
          <div className="space-y-3">
            <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <DataTable>
                <thead>
                  <tr>
                    <th>{m.fields.employeeNo}</th>
                    <th>{m.fields.name}</th>
                    <th>{m.fields.mailAddress}</th>
                    <th>{m.fields.employmentType}</th>
                    <th>{m.fields.affiliation}</th>
                    <th>{m.fields.status}</th>
                    <th>{m.fields.provisioning}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.operatorId}>
                      <td>
                        <Link className="link" to={`/employees/${encodeURIComponent(e.operatorId)}`}>
                          {e.employeeNo}
                        </Link>
                      </td>
                      <td>{e.name}</td>
                      <td>{e.mailAddress}</td>
                      <td>{m.employmentType[e.employmentType]}</td>
                      <td>{affiliationText(e.affiliation)}</td>
                      <td>{m.employmentStatus[e.status]}</td>
                      <td>{m.provisioningStep[e.provisioning.step]}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="opacity-70">{m.list.count(rows.length)}</span>
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
