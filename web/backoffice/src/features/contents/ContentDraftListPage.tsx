// 콘텐츠 초안 목록(product-content 0.4.0 PCT-1, 2026-11-20 — 백엔드 알림 "콘텐츠 조회"): 작성 중·승인 대기·게시·반려를 최근 바뀐 순으로.
// 숫자 띠는 서버 상태별 수(`GET /content-drafts/counts`, 모든 상태 0 까지) — 못 읽으면 "?"(0 이 아니다). 상태 거르기는 주소 state=.
// 상품 초안 목록(PD-2)은 아직 계약에 없어 "등록 진행 중" 탭은 그 뒤 — 여기는 콘텐츠 초안만.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { ContentDraftSummary } from '../../api/models';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { ListHeader, listCount, refreshOf, StatCard, StatStrip, StatusBadge, type Tone } from '../../shared/admin';
import { EmptyBox, When } from '../lookup/parts';
import { AuthedImage } from './AuthedImage';
import { LineIcon, tableClass } from '../products/parts';

const d = messages.contents.draftList;
const STATES = ['DRAFT', 'SUBMITTED', 'PUBLISHED', 'REJECTED'] as const;
type DraftState = (typeof STATES)[number];
const isState = (v: string | null): v is DraftState => v !== null && (STATES as readonly string[]).includes(v);
const tone = (s: string): Tone => (s === 'PUBLISHED' ? 'success' : s === 'REJECTED' ? 'error' : s === 'SUBMITTED' ? 'warning' : 'info');

export function ContentDraftListPage() {
  const api = useApi();
  const [params] = useSearchParams();
  const stateParam = params.get('state');
  const state = isState(stateParam) ? stateParam : undefined;

  const counts = useQuery({ queryKey: ['content-drafts', 'counts'], queryFn: () => request('GET', api.content.GET('/content-drafts/counts', {})) });
  const countOf = (key?: DraftState) =>
    counts.isPending
      ? '…'
      : counts.isError
        ? '?'
        : (counts.data?.counts ?? [])
            .filter((c) => !key || c.key === key)
            .reduce((n, c) => n + Number(c.count), 0)
            .toLocaleString('ko-KR');

  const query = useInfiniteQuery({
    queryKey: ['content-drafts', 'list', state],
    queryFn: ({ pageParam }) =>
      request(
        'GET',
        api.content.GET('/content-drafts', { params: { query: { ...(state ? { state: [state] } : {}), ...(pageParam ? { cursor: pageParam } : {}), size: 50 } } }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });
  const items: ContentDraftSummary[] = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  const to = (s?: DraftState) => (s ? `/contents/drafts?state=${s}` : '/contents/drafts');

  return (
    <section className="space-y-4">
      <ListHeader
        title={d.title}
        count={listCount(query)}
        refresh={refreshOf(query)}
        actions={
          <Link className="btn btn-sm" to="/contents/drafts/new">
            {d.newDraft}
          </Link>
        }
      />
      <div className="space-y-1.5">
        <StatStrip label={d.stagesLabel} testId="content-draft-states">
          <StatCard layout="row" label={d.all} value={countOf()} to={to()} active={!state} testId="content-draft-state-all" />
          {STATES.map((s) => (
            <StatCard key={s} layout="row" label={d.state[s]} value={countOf(s)} to={to(s)} active={state === s} testId={`content-draft-state-${s}`} />
          ))}
        </StatStrip>
        <p className="text-xs text-base-content/50">{d.basis}</p>
      </div>
      <QueryState state={toUiState(query, () => items.length === 0)} onRetry={() => void query.refetch()} emptyText={d.empty}>
        {() =>
          items.length === 0 ? (
            <EmptyBox>{d.empty}</EmptyBox>
          ) : (
            <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th>{d.col.name}</th>
                    <th>{d.col.product}</th>
                    <th>{d.col.state}</th>
                    <th className="text-right">{d.col.updatedAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((x) => (
                    <tr key={x.draftId} data-testid="content-draft-row">
                      <td>
                        <Link to={`/contents/drafts/${encodeURIComponent(x.draftId)}`} className="flex items-center gap-3 font-medium hover:underline">
                          <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded border border-base-300 bg-base-200">
                            {x.imageId ? <AuthedImage imageId={x.imageId} alt="" className="h-full w-full object-cover" /> : <LineIcon name="box" className="h-5 w-5 text-base-content/35" />}
                          </span>
                          {x.name ?? <span className="text-base-content/50">{d.noName}</span>}
                        </Link>
                      </td>
                      <td>
                        {x.productId ? (
                          <Link to={`/products/${encodeURIComponent(x.productId)}?tab=content`} className="font-mono text-xs hover:underline">
                            {x.productId}
                          </Link>
                        ) : (
                          <span className="text-xs text-base-content/50">{d.noProduct}</span>
                        )}
                      </td>
                      <td>
                        <StatusBadge tone={tone(x.state)}>{d.state[x.state] ?? x.state}</StatusBadge>
                      </td>
                      <td className="text-right">
                        <When iso={x.updatedAt} align="right" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </QueryState>
      {query.hasNextPage && (
        <div className="flex justify-center">
          <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {d.more}
          </button>
        </div>
      )}
    </section>
  );
}
