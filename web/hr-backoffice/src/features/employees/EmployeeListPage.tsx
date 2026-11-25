// 직원 목록(GET /hr/employees?status&affiliationCode&q&size&cursor). 필터는 URL 쿼리에 둔다.
// 조회 실패를 빈 목록으로 보이지 않는다(QueryState). 권한이 없으면 서버 403 → "이용할 수 없는 화면".
import { useRememberQueue } from '../../shared/workQueue';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState, uiStateFromError, type UiState } from '@pmart/web-ui';
import { EMPLOYMENT_STATUSES, type Employee, type EmploymentStatus } from '../../api/models';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { messages as m } from '../../shared/messages';
import { affiliationText } from './labels';
import { DataTable, PageHeader, ResultBar, SearchPanel, SearchRow, StatusBadge } from '../../shared/admin';
import { PreviewDrawer, PreviewFacts, usePreview } from '../../shared/Preview';
import { SavedViews } from '../../shared/SavedViews';
import { affiliationIcon, employmentIcon, provisioningTone, statusTone } from './labels';
import { KindChip } from '../../shared/KindChip';

const PAGE_SIZE = 50;

const isStatus = (v: string | null): v is EmploymentStatus => EMPLOYMENT_STATUSES.some((s) => s === v);

/** hr 0.9.0 거르기(H-D1) — 첫 화면 숫자 칸에서 넘어올 때 쓴다. 모르는 값은 버린다(서버는 400) */
const STEPS = ['REQUESTED', 'MAILBOX_CREATED', 'IAM_CREATED', 'INVITE_SENT', 'DONE', 'FAILED', 'COMPENSATED'] as const;
const GRANT_STATES = ['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
const isDay = (v: string | null): v is string => v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v);
function extraFilters(params: URLSearchParams) {
  const steps = (params.get('provisioningStep') ?? '').split(',').filter((x): x is (typeof STEPS)[number] => (STEPS as readonly string[]).includes(x));
  const grant = GRANT_STATES.find((g) => g === params.get('grantSubmission'));
  const endFrom = params.get('endDateFrom');
  const endTo = params.get('endDateTo');
  const sort = params.get('sort') === 'END_DATE_ASC' ? ('END_DATE_ASC' as const) : undefined;
  return {
    ...(steps.length > 0 ? { provisioningStep: steps.join(',') } : {}),
    ...(grant ? { grantSubmission: grant } : {}),
    ...(isDay(endFrom) ? { endDateFrom: endFrom } : {}),
    ...(isDay(endTo) ? { endDateTo: endTo } : {}),
    ...(sort ? { sort } : {}),
  };
}

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
  const apply = (d: { readonly status: string; readonly affiliationCode: string; readonly q: string }) => {
    setDraft({ ...d });
    const next = new URLSearchParams();
    if (d.status) next.set('status', d.status);
    if (d.affiliationCode.trim()) next.set('affiliationCode', d.affiliationCode.trim());
    if (d.q.trim()) next.set('q', d.q.trim());
    setParams(next);
  };
  const extra = extraFilters(params);
  const extraKey = JSON.stringify(extra);

  const query = useInfiniteQuery({
    queryKey: ['hr', 'employees', session?.subject, status ?? '', affiliationCode, q, extraKey],
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
              ...extra,
              size: PAGE_SIZE,
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor || undefined,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  // 상세에서 이전·다음으로 넘기도록 지금 목록 순서를 기억(2026-11-19) — 찾기 말(q)은 기억하지 않는다
  useRememberQueue(query.data ? items.map((e) => e.operatorId) : undefined, `/employees?${params.toString()}`);
  // 미리보기 칸(2026-11-19 — 백오피스 목록과 같음): 줄을 누르면 목록을 떠나지 않고 오른쪽에 요약, 사번 링크는 그대로 상세로
  const pv = usePreview();
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
          <>
            {/* 내 보기(2026-11-19 — 백오피스와 같음): 상태·소속 조건만 이 브라우저에 저장(검색어 = 이름은 저장하지 않는다). 2026-11-25 쪽 머리 오른쪽으로 */}
            <SavedViews listKey="employees" />
            <Link to="/employees/new" className="btn btn-primary btn-sm">
              {m.list.register}
            </Link>
          </>
        }
      />
      {/* 첫 화면 숫자 칸에서 넘어온 조건(2026-11-19 H-D1) — 무엇으로 걸렀는지 보이고 지울 수 있다 */}
      {Object.keys(extra).length > 0 && (
        <p className="flex flex-wrap items-center gap-2 rounded-box border border-primary/30 bg-primary/5 px-3 py-2 text-sm" data-testid="extra-filter">
          <span className="font-semibold">{m.list.extraFilter}</span>
          {extra.provisioningStep && <span className="badge badge-sm">{m.list.extraName.provisioning}</span>}
          {extra.grantSubmission && <span className="badge badge-sm">{m.list.extraName.grant(m.grantSubmission[extra.grantSubmission])}</span>}
          {(extra.endDateFrom || extra.endDateTo) && <span className="badge badge-sm">{m.list.extraName.endDate(extra.endDateFrom ?? '', extra.endDateTo ?? '')}</span>}
          {extra.sort && <span className="badge badge-sm">{m.list.extraName.sortEnd}</span>}
          <Link className="link ml-auto text-xs" to={status ? `/employees?status=${status}` : '/employees'}>
            {m.list.clearExtra}
          </Link>
        </p>
      )}
      <SearchPanel
        submitLabel={m.search}
        resetLabel={m.list.reset}
        onReset={() => setDraft({ status: '', affiliationCode: '', q: '' })}
        onSubmit={(e) => {
          e.preventDefault();
          apply(draft);
        }}
        // 걸린 조건 칩(2026-11-25 — 상태·소속은 필터 팝업 안이라 칩으로 보이고 ✕ 로 푼다. 찾기 칸 글자는 칸에 보이니 칩 아님)
        summary={[
          [m.fields.status, status ? m.employmentStatus[status] : '', () => apply({ ...draft, status: '' })],
          [m.fields.affiliationCode, affiliationCode, () => apply({ ...draft, affiliationCode: '' })],
        ]}
        search={
          <input
            type="search"
            aria-label={m.list.q}
            className="input input-sm w-72"
            maxLength={60}
            placeholder={m.list.qHint}
            value={draft.q}
            onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
          />
        }
      >
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
                    <tr key={e.operatorId} data-testid="employee-row" {...pv.row(e.operatorId)}>
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
                      <td>
                        <KindChip icon={employmentIcon(e.employmentType)}>{m.employmentType[e.employmentType]}</KindChip>
                      </td>
                      <td>
                        <KindChip icon={affiliationIcon(e.affiliation)}>{affiliationText(e.affiliation)}</KindChip>
                      </td>
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
            {pv.id && (
              <PreviewDrawer
                id={pv.id}
                ids={rows.map((e) => e.operatorId)}
                onMove={pv.open}
                onClose={pv.close}
                title={rows.find((e) => e.operatorId === pv.id)?.name ?? pv.id}
                detailTo={`/employees/${encodeURIComponent(pv.id)}`}
              >
                <EmployeePreview operatorId={pv.id} />
              </PreviewDrawer>
            )}
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

/** 직원 미리보기 — 상세와 같은 조회 키(['hr','employee',id], 상세로 가도 다시 읽지 않는다). 인사 처리·발급 다시 시도는 상세에서 */
function EmployeePreview({ operatorId }: { readonly operatorId: string }) {
  const api = useApi();
  const q = useQuery({
    queryKey: ['hr', 'employee', operatorId],
    queryFn: () => request('GET', api.hr.GET('/hr/employees/{operatorId}', { params: { path: { operatorId } } })),
  });
  return (
    <QueryState state={toUiState(q)} onRetry={() => void q.refetch()}>
      {(e) => (
        <div className="space-y-4" data-testid="employee-preview">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={statusTone(e.status)}>{m.employmentStatus[e.status]}</StatusBadge>
            <StatusBadge tone={provisioningTone(e.provisioning.step)}>{m.provisioningStep[e.provisioning.step]}</StatusBadge>
            <span className="font-mono text-xs text-base-content/55">{e.employeeNo}</span>
          </div>
          <PreviewFacts
            rows={[
              [m.fields.mailAddress, e.mailAddress],
              [m.fields.employmentType, m.employmentType[e.employmentType]],
              [m.fields.affiliation, affiliationText(e.affiliation)],
              [m.fields.startDate, e.startDate],
              [m.fields.endDate, e.endDate ?? m.none],
            ]}
          />
        </div>
      )}
    </QueryState>
  );
}
