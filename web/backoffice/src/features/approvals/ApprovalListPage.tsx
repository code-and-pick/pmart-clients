// 승인함(approval-service GET /approvals). 필터는 URL 쿼리에 둔다. "더 보기"는 다음 쪽(page.nextCursor)을 이어 붙인다(받은 줄은 그대로).
// 화면(2026-11-18 사용자 "아이콘만 붙였지 똑같이 밋밋하다 — 참고 사이트처럼"): Shopify·Medusa 목록처럼 한 카드 안에
// 심사 상태 탭 → 유형 칩 → 표(요약 굵게·ID 작게, 유형 색 배지, 상태 점 배지, "N일 전") → 아래 건수·더 보기.
// 예전에는 더 보기가 커서를 URL 에 넣자마자 필터 함수가 지워 버려 아무 일도 없었다(2026-11-17 사용자 신고).
import { useRememberQueue } from '../../shared/workQueue';
import { SeenMark } from '../../shared/SeenMark';
import { useSeenIds } from '../../shared/recentViews';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { APPROVAL_TYPES, REVIEW_STATES, type ApprovalType, type ReviewState } from '../../api/models';
import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { formatSeoul } from '@pmart/web-ui';
import { SavedViews } from '../../shared/SavedViews';
import { hideIds } from '../../shared/hideIds';
import { messages as m } from '../../shared/messages';
import { QueryState } from '@pmart/web-ui';
import { toUiState } from '@pmart/web-ui';
import { CodeLabel, PageHeader, StatCard, StatStrip, StatusBadge, countCell, type Tone, AllDone } from '../../shared/admin';
import { PreviewDrawer, PreviewFacts, usePreview } from '../../shared/Preview';
import { useApprovalTypeCounts } from '../../app/listCounts';
import { Person } from '../lookup/parts';

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | undefined =>
  allowed.find((a) => a === value);

export function ApprovalListPage() {
  const api = useApi();
  // 오른쪽 미리보기(2026-11-19 관제 형식 — 줄을 누르면 목록을 떠나지 않고 옆에서, 번호 링크는 상세로)
  const pv = usePreview((id) => `/approvals/${encodeURIComponent(id)}`);
  const seen = useSeenIds('approval'); // 최근 열어 본 승인(2026-11-19)
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

  const rows = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  // 상세에서 이전·다음으로 넘기도록 지금 목록 순서를 기억(2026-11-19)
  useRememberQueue('approval', query.data ? rows.flatMap((a) => (a.approvalId ? [a.approvalId] : [])) : undefined, `/approvals?${params.toString()}`);

  return (
    <section className="space-y-4">
      <PageHeader title={m.approvals.title} />
      {/* 숫자 띠(2026-11-19 관제 형식) — 심사 대기 유형별, 대시보드와 같은 조회. 누르면 그 유형의 심사 대기 */}
      <ApprovalStrip type={type} reviewState={reviewState} />
      {/* 내 보기(2026-11-18 Saleor 참고) — 지금 주소 조건을 이름 붙여 저장 */}
      <SavedViews listKey="approvals" />
      <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm" data-testid="approval-list-card">
        {/* 심사 상태 탭(밑줄) — URL 의 reviewState 그대로 */}
        <div role="tablist" aria-label={m.approvals.review} className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-base-300 px-3">
          {[undefined, ...REVIEW_STATES].map((st) => {
            const on = reviewState === st;
            return (
              <button
                key={st ?? 'all'}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setFilter('reviewState', st ?? '')}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${on ? 'border-primary font-semibold text-base-content' : 'border-transparent text-base-content/55 hover:text-base-content'}`}
              >
                {st ? m.approvals.reviewState[st] : m.approvals.filterAll}
              </button>
            );
          })}
        </div>
        {/* 유형 칩 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-base-300 bg-base-200/40 px-4 py-2.5" role="group" aria-label={m.approvals.type}>
          <span className="mr-1 text-xs font-medium text-base-content/55">{m.approvals.type}</span>
          {[undefined, ...APPROVAL_TYPES].map((t) => {
            const on = type === t;
            return (
              <button
                key={t ?? 'all'}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter('type', t ?? '')}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${on ? 'border-base-content bg-base-content text-base-100' : 'border-base-300 bg-base-100 hover:border-base-content/40'}`}
              >
                {t ? m.approvals.typeName[t] : m.approvals.filterAll}
              </button>
            );
          })}
        </div>

        {/* 심사 대기가 서버 0건이면 "다 심사했어요"(2026-11-19) */}
        {query.isSuccess && rows.length === 0 && reviewState === 'REVIEW_PENDING' && (
          <div className="p-4">
            <AllDone title={m.allDone.approvals} body={m.allDone.approvalsBody} testId="approvals-all-done" />
          </div>
        )}
        {!(query.isSuccess && rows.length === 0 && reviewState === 'REVIEW_PENDING') && (
        <QueryState
          // 다음 쪽 실패는 이미 받은 줄을 가리지 않는다 — 첫 쪽이 있으면 그 데이터로(경고는 아래 줄)
          state={query.data ? (rows.length === 0 ? { kind: 'empty' } : { kind: 'ready', data: query.data }) : toUiState(query)}
          onRetry={() => void query.refetch()}
          emptyText={m.approvals.empty}
        >
          {() => (
            <>
              <div className="overflow-x-auto">
                <table className="table [&_tbody_tr:hover]:bg-base-200/60 [&_tbody_tr]:border-base-300/70 [&_thead_th]:text-xs [&_thead_th]:font-medium [&_thead_th]:text-base-content/50">
                  <thead>
                    <tr>
                      <th>{m.approvals.request}</th>
                      <th>{m.approvals.type}</th>
                      <th>{m.approvals.requester}</th>
                      <th>{m.approvals.review}</th>
                      <th>{m.approvals.execution}</th>
                      <th className="text-right">{m.approvals.submittedAt}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a, i) => (
                      <tr key={a.approvalId ?? `row-${i}`} data-testid="approval-row" {...pv.row(a.approvalId)}>
                        <td className="max-w-xl">
                          <p className="truncate font-medium" title={hideIds(a.summary) || undefined}>
                            {hideIds(a.summary) || m.none}
                          </p>
                          {/* 승인은 번호 없이 종류 · 요청자 · 시각(ADR-0070 덧붙임) — 요청자·시각은 옆 칸, 여기는 종류만 */}
                          <span className="text-xs text-base-content/50">
                            {a.type ? (m.approvals.typeName[a.type] ?? a.type) : m.none}
                            <SeenMark seen={!!a.approvalId && seen.has(a.approvalId)} />
                          </span>
                        </td>
                        <td>{a.type ? <TypeBadge type={a.type} /> : m.none}</td>
                        <td>{a.requesterId ? <Requester id={a.requesterId} /> : m.none}</td>
                        <td>{a.reviewState ? <StatusBadge tone={REVIEW_TONE[a.reviewState] ?? 'ghost'}>{m.approvals.reviewState[a.reviewState]}</StatusBadge> : m.none}</td>
                        <td>{a.executionState ? <StatusBadge tone={EXEC_TONE[a.executionState] ?? 'ghost'}>{m.approvals.executionState[a.executionState]}</StatusBadge> : m.none}</td>
                        <td className="whitespace-nowrap text-right">
                          {a.submittedAt ? (
                            <>
                              <p className="text-sm">{ago(a.submittedAt)}</p>
                              <p className="text-xs text-base-content/45">{formatSeoul(a.submittedAt)}</p>
                            </>
                          ) : (
                            m.none
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pv.id &&
                (() => {
                  const a = rows.find((r) => r.approvalId === pv.id);
                  return (
                    <PreviewDrawer id={pv.id} ids={rows.flatMap((r) => (r.approvalId ? [r.approvalId] : []))} onMove={pv.open} onClose={pv.close} title={a?.summary ?? pv.id} detailTo={`/approvals/${encodeURIComponent(pv.id)}`}>
                      {a ? (
                        <div className="space-y-4" data-testid="approval-preview">
                          <PreviewFacts
                            rows={[
                              [m.approvals.type, a.type ? <TypeBadge type={a.type} /> : m.none],
                              [m.approvals.requester, a.requesterId ? <Requester id={a.requesterId} /> : m.none],
                              [m.approvals.review, a.reviewState ? <StatusBadge tone={REVIEW_TONE[a.reviewState] ?? 'ghost'}>{m.approvals.reviewState[a.reviewState]}</StatusBadge> : m.none],
                              [m.approvals.execution, a.executionState ? <StatusBadge tone={EXEC_TONE[a.executionState] ?? 'ghost'}>{m.approvals.executionState[a.executionState]}</StatusBadge> : m.none],
                              [m.approvals.submittedAt, a.submittedAt ? `${formatSeoul(a.submittedAt)} (${ago(a.submittedAt)})` : m.none],
                            ]}
                          />
                        </div>
                      ) : null}
                    </PreviewDrawer>
                  );
                })()}
              {/* 아래: 받은 건수 · 더 보기. 다음 쪽을 못 읽으면 받은 줄은 두고 경고만(0건·끝으로 보이지 않게) */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-base-300 px-4 py-3 text-sm">
                <span className="text-base-content/55">{m.approvals.shown(rows.length, query.hasNextPage)}</span>
                {query.isFetchNextPageError && <span className="text-error">{m.approvals.moreFailed}</span>}
                {query.hasNextPage && (
                  <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                    {m.more}
                  </button>
                )}
              </div>
            </>
          )}
        </QueryState>
        )}
      </div>
    </section>
  );
}

const TYPE_STYLE: Readonly<Record<string, string>> = {
  PRODUCT: 'bg-info/10 text-info',
  DISPLAY: 'bg-accent/15 text-accent',
  PRICE: 'bg-warning/15 text-warning',
  GRANT: 'bg-secondary/10 text-secondary',
};
const TYPE_ICON: Readonly<Record<string, string>> = {
  PRODUCT: 'M4 8l8-4 8 4-8 4-8-4Zm0 0v8l8 4 8-4V8',
  DISPLAY: 'M4 5h16v11H4zM9 20h6',
  PRICE: 'M4 12l8-8h8v8l-8 8-8-8Zm11-4h.01',
  GRANT: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
};

function TypeBadge({ type }: { readonly type: string }) {
  const icon = TYPE_ICON[type];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ${TYPE_STYLE[type] ?? 'bg-base-200'}`}>
      {icon && (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d={icon} />
        </svg>
      )}
      <CodeLabel code={type} names={TYPE_NAME} />
    </span>
  );
}

/** 요청자 — 직원 표시(이름 · 사번, ADR-0070 덧붙임) */
function Requester({ id }: { readonly id: string }) {
  return <Person id={id} />;
}

const REVIEW_TONE: Readonly<Record<string, Tone>> = {
  REVIEW_PENDING: 'warning',
  EVIDENCE_REQUIRED: 'warning',
  APPROVED: 'success',
  PARTIALLY_APPROVED: 'info',
  REJECTED: 'error',
  EXPIRED: 'ghost',
  SUPERSEDED: 'ghost',
};
const EXEC_TONE: Readonly<Record<string, Tone>> = {
  NOT_REQUESTED: 'ghost',
  VALIDATING: 'info',
  ACCEPTED: 'info',
  IN_PROGRESS: 'info',
  PARTIAL: 'warning',
  APPLIED: 'success',
  REJECTED: 'error',
  UNKNOWN_RESULT: 'warning',
};

/** 상신 시각을 "방금·N분 전·N시간 전·N일 전"으로(보기용 — 정확한 시각은 아래 줄) */
function ago(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(min) || min < 1) return m.approvals.ago.now;
  if (min < 60) return m.approvals.ago.min(min);
  if (min < 60 * 24) return m.approvals.ago.hour(Math.floor(min / 60));
  return m.approvals.ago.day(Math.floor(min / (60 * 24)));
}

/** 승인 유형 이름 — 거르기 칩 유형 + 그 밖 유형(표시만, 2026-11-18 "직관적이지 않다") */
const TYPE_NAME: Readonly<Record<string, string>> = { ...m.approvals.typeName, ...m.approvals.otherTypeName };

function ApprovalStrip({ type, reviewState }: { readonly type: ApprovalType | undefined; readonly reviewState: ReviewState | undefined }) {
  const counts = useApprovalTypeCounts();
  return (
    <StatStrip label={m.listStrip.approvals} testId="approval-strip">
      {counts.map(({ type: t, q }) => (
        <StatCard
          key={t}
          label={m.approvals.typeName[t] ?? t}
          value={countCell(q)}
          hint={m.listStrip.reviewPending}
          tone={(q.data?.n ?? 0) > 0 ? 'info' : undefined}
          to={`/approvals?reviewState=REVIEW_PENDING&type=${t}`}
          active={reviewState === 'REVIEW_PENDING' && type === t}
          testId={`approval-strip-${t}`}
        />
      ))}
    </StatStrip>
  );
}
