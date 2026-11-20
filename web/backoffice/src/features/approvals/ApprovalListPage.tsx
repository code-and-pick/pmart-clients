// 승인함(approval-service GET /approvals). 조건은 URL 쿼리(view·type·state)에 둔다. "더 보기"는 다음 쪽(page.nextCursor)을 이어 붙인다.
// 2026-11-20 다시 짬 — 사용자 "상태랑 유형으로 나눠 놨는데 뭐가 뭔지 모르겠고, 뭘 승인하는 건지도 모르겠다":
//   ① 맨 위는 "내 일" 기준 세 갈래 — 내가 심사할 것(decidableByMe, 서버가 결정 API 와 같은 검사) · 내가 올린 것(requesterId = 나) · 모두
//   ② 유형은 "무엇을 승인하는지" 말로(상품 등록·고객 화면 게시·홈 진열 편성·가격 변경·직원 권한·검색 동의어) — 칩 하나 줄
//   ③ 심사 상태 8개 탭·숫자 카드·반영 칸은 없앰 → 줄마다 "지금" 한 칸(심사 기다림·승인됨·반영 완료·반려됨…), 상태 거르기는 "내가 올린 것·모두"에서만 고르기 상자
//   ④ 내가 결정할 수 있는 줄은 오른쪽 "심사하기", 내 요청은 "내 요청"
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import { APPROVAL_TYPES, REVIEW_STATES, type ApprovalType, type ReviewState } from '../../api/models';
import type { components } from '../../api/generated/approval';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { AllDone, ListHeader, PropertyFilter, StatusText, type FilterProp, type Tone } from '../../shared/admin';
import { useHelp } from '../../shared/HelpPanel';
import { hideIds } from '../../shared/hideIds';
import { messages as m } from '../../shared/messages';
import { usePreview } from '../../shared/Preview';
import { useSeenIds } from '../../shared/recentViews';
import { SeenMark } from '../../shared/SeenMark';
import { useRememberQueue } from '../../shared/workQueue';
import { Person } from '../lookup/parts';
import { approvalPlace } from './ApprovalProgress';

type Summary = components['schemas']['ApprovalSummary'];
const t = m.approvals.inbox;
const VIEWS = ['todo', 'mine', 'all'] as const;
type View = (typeof VIEWS)[number];

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | undefined => allowed.find((a) => a === value);

/** 무엇을 승인하는지 — 종류 + 정본(전시는 홈 편성과 상품 화면 게시가 같은 DISPLAY) */
export function approvalWhat(a: Pick<Summary, 'type' | 'targetService'>): string {
  if (a.type === 'DISPLAY' && a.targetService === 'storefront-service') return t.what.HOME_LAYOUT;
  return (a.type && (m.approvals.typeName[a.type] ?? m.approvals.otherTypeName[a.type])) || a.type || m.none;
}

/** 지금 어디인지 한 마디 — 심사·반영 두 축을 하나로(진행 단계 표시와 같은 판단) */
export function approvalNow(a: Pick<Summary, 'requestState' | 'reviewState' | 'executionState'>): { readonly text: string; readonly tone: Tone } {
  const { place, ended } = approvalPlace(a);
  if (ended) return { text: ended, tone: a.reviewState === 'REJECTED' ? 'error' : 'ghost' };
  if (!place) return { text: m.none, tone: 'ghost' };
  if (place.step === 0) return { text: t.now.draft, tone: 'ghost' };
  if (place.step === 1) return place.note ? { text: place.note, tone: 'warning' } : { text: t.now.waiting, tone: 'warning' };
  if (place.done) return { text: t.now.applied, tone: 'success' };
  return { text: place.note ?? t.now.applying, tone: place.warn ? 'warning' : 'info' };
}

/** 상신 시각을 "방금·N분 전·N시간 전·N일 전"으로 */
function ago(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(min) || min < 1) return m.approvals.ago.now;
  if (min < 60) return m.approvals.ago.min(min);
  if (min < 60 * 24) return m.approvals.ago.hour(Math.floor(min / 60));
  return m.approvals.ago.day(Math.floor(min / (60 * 24)));
}

export function ApprovalListPage() {
  const api = useApi();
  const { session } = useSession();
  const me = session?.subject ?? null;
  const pv = usePreview((id) => `/approvals/${encodeURIComponent(id)}`);
  const seen = useSeenIds('approval');
  const [params, setParams] = useSearchParams();
  const view: View = pick(params.get('view'), VIEWS) ?? 'todo';
  const type = pick<ApprovalType>(params.get('type'), APPROVAL_TYPES);
  // 상태 거르기는 "내가 올린 것·모두"에서만(내가 심사할 것은 늘 심사 대기)
  const state = view === 'todo' ? undefined : pick<ReviewState>(params.get('state'), REVIEW_STATES);

  const query = useInfiniteQuery({
    queryKey: ['approval', 'list', view, me, type, state],
    enabled: view !== 'mine' || me !== null,
    queryFn: ({ pageParam: cursor }) =>
      request(
        'GET',
        api.approval.GET('/approvals', {
          params: {
            query: {
              ...(view === 'todo' ? { decidableByMe: true } : {}),
              ...(view === 'mine' && me ? { requesterId: me } : {}),
              ...(type ? { type } : {}),
              ...(state ? { reviewState: state } : {}),
              ...(cursor ? { cursor } : {}),
              size: 50,
            },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });
  // "내가 심사할 것" 수 — 탭 옆 숫자(유형 거르기와 상관없이 전체)
  const todo = useQuery({
    queryKey: ['approval', 'todo-count'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const r = await request('GET', api.approval.GET('/approvals', { params: { query: { decidableByMe: true, size: 50 } } }));
      return { n: (r.items ?? []).length, more: Boolean(r.page?.nextCursor) };
    },
  });

  const set = (patch: Readonly<Record<string, string | null>>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next);
  };

  const rows = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  useRememberQueue('approval', query.data ? rows.flatMap((a) => (a.approvalId ? [a.approvalId] : [])) : undefined, `/approvals?${params.toString()}`);
  const todoEmpty = view === 'todo' && query.isSuccess && rows.length === 0 && !type;
  // 2026-11-20 AWS 개편 3단계(ADR-0004): 제목줄(개수·정보·새로 고침)·속성 필터·상태 아이콘 글자·도움말 패널. 세 갈래 탭은 그대로(사용자 결정)
  const help = useHelp('approvals', m.approvals.title, (
    <>
      <p>{t.help.todo}</p>
      <p>{t.help.mine}</p>
      <p>{t.help.now}</p>
      <p>{t.help.decide}</p>
    </>
  ));
  const filterProps: FilterProp[] = [
    { key: 'type', label: t.whatLabel, options: APPROVAL_TYPES.map((x) => ({ value: x, label: m.approvals.typeName[x] ?? x })) },
    // 심사 상태는 "내가 올린 것·모두"에서만(내가 심사할 것은 늘 심사 기다림)
    ...(view === 'todo' ? [] : [{ key: 'state', label: t.reviewStateLabel, options: REVIEW_STATES.map((x) => ({ value: x, label: t.state[x] ?? x })) }]),
  ];

  return (
    <section className="max-w-6xl space-y-4">
      <ListHeader
        title={m.approvals.title}
        count={query.data ? `${rows.length}${query.hasNextPage ? '+' : ''}` : undefined}
        onInfo={help?.open}
        refresh={{ onClick: () => void Promise.all([query.refetch(), todo.refetch()]), busy: query.isFetching, readAt: query.dataUpdatedAt || undefined }}
      />
      <div className="overflow-hidden rounded-box border border-base-300 bg-base-100" data-testid="approval-list-card">
        {/* ① 내 일 기준 세 갈래 */}
        <div role="tablist" aria-label={t.viewLabel} className="flex gap-1 border-b border-base-300 px-3">
          {VIEWS.map((v) => {
            const on = view === v;
            return (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={on}
                data-testid={`approval-view-${v}`}
                onClick={() => set({ view: v === 'todo' ? null : v, state: null })}
                className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${on ? 'border-primary font-bold text-primary' : 'border-transparent text-base-content/70 hover:text-primary'}`}
              >
                {t.views[v]}
                {v === 'todo' && todo.data && todo.data.n > 0 && (
                  <span className="badge badge-primary badge-sm tabular-nums" data-testid="approval-todo-count">
                    {todo.data.n}
                    {todo.data.more ? '+' : ''}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/* ② 무엇을 승인·심사 상태 → 속성 필터 하나(AWS Property filter) */}
        <div className="border-b border-base-300 px-4 py-3">
          <PropertyFilter props={filterProps} value={{ type, state }} onChange={set} testId="approval-filter" />
        </div>

        {todoEmpty ? (
          <div className="p-4">
            <AllDone title={t.todoDone} body={m.allDone.approvalsBody} testId="approvals-all-done" />
          </div>
        ) : (
          <QueryState
            state={query.data ? (rows.length === 0 ? { kind: 'empty' } : { kind: 'ready', data: query.data }) : toUiState(query)}
            onRetry={() => void query.refetch()}
            emptyText={t.empty[view]}
          >
            {() => (
              <>
                <div className="overflow-x-auto">
                  <table className="table table-fixed min-w-[44rem] [&_tbody_tr:hover]:bg-base-200/60">
                    <colgroup>
                      <col />
                      <col className="w-44" />
                      <col className="w-28" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>{t.col.what}</th>
                        <th>{t.col.now}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((a, i) => {
                        const now = approvalNow(a);
                        const mine = me !== null && a.requesterId === me;
                        return (
                          <tr key={a.approvalId ?? `row-${i}`} data-testid="approval-row" {...pv.row(a.approvalId)}>
                            <td className="min-w-0">
                              <div className="flex min-w-0 items-center gap-2">
                                {/* 종류는 회색 작은 글자(꼬리표 대신), 요약은 점선 밑줄 링크 — 누르면 상세(AWS 이름 칸) */}
                                <span className="shrink-0 text-xs text-base-content/60" data-testid="approval-what">
                                  {approvalWhat(a)}
                                </span>
                                <Link to={`/approvals/${encodeURIComponent(a.approvalId ?? '')}`} className="truncate pb-0.5 font-medium underline decoration-dotted decoration-base-content/50 underline-offset-2 hover:text-primary" title={hideIds(a.summary) || undefined}>
                                  {hideIds(a.summary) || m.approvals.untitled}
                                </Link>
                                <SeenMark seen={!!a.approvalId && seen.has(a.approvalId)} />
                              </div>
                              <p className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-xs text-base-content/55">
                                {a.requesterId ? <Person id={a.requesterId} /> : null}
                                {a.submittedAt && <span title={formatSeoul(a.submittedAt)}>· {ago(a.submittedAt)}</span>}
                              </p>
                            </td>
                            <td>
                              <StatusText tone={now.tone} testId="approval-now">
                                {now.text}
                              </StatusText>
                            </td>
                            <td className="text-right">
                              {a.viewerCanDecide ? (
                                <Link className="btn btn-primary btn-xs" to={`/approvals/${encodeURIComponent(a.approvalId ?? '')}`} data-testid="approval-decide" onClick={(e) => e.stopPropagation()}>
                                  {t.decide}
                                </Link>
                              ) : mine ? (
                                <span className="text-xs text-base-content/50">{t.mine}</span>
                              ) : a.reviewState === 'REVIEW_PENDING' && a.viewerDecideBlockedReason ? (
                                // 심사 중인데 내가 못 하는 까닭(서버 판정 AP-3) — 다른 승인자 몫·본인 권한 요청 등
                                <span className="text-xs text-base-content/50" data-testid="approval-blocked">{t.blocked[a.viewerDecideBlockedReason] ?? ''}</span>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
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
