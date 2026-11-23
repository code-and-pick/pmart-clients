// 리뷰 신고 확인(2026-11-23 — review 0.7.0 BR-90, 백엔드 알림 backoffice/2026-11-23-notice-review-report-api, 사용자 "화면 만들 거 있으면 진행해").
// - 목록 `GET /review-reports?state=OPEN|RESOLVED&cursor=` — 리뷰마다 신고 묶음(사유별 수·기타 글 최대 10·처음/마지막 신고 시각·지금 숨김/작성자 삭제, RESOLVED 면 처리 결과·처리자·시각). 최근 신고 순.
// - 처리 `POST /review-reports/{reviewId}/resolutions` {action: HIDE|KEEP, note?} — 처리 전 신고를 모두 닫는다. HIDE = 리뷰 숨김(공개·별점에서 빠짐), KEEP = 그대로.
//   처리할 신고가 없으면 409 NO_OPEN_REPORTS(다른 직원이 먼저 처리) → 목록을 다시 읽는다. 결과는 신고자에게 알리지 않는다(사용자 결정).
// - 역할: CS_AGENT·OPERATOR_ADMIN(메뉴도 그 둘에게만). 신고만으로는 숨기지 않는다 — 운영자가 확인한 뒤에만.
// - 보낼 값(처리·메모)은 누른 때 명령 값으로(#410 — 결과 불명 뒤 같은 키로 다시 확인할 때 처음 값 그대로).
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { ProblemFailure, request } from '@pmart/web-core';
import { QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/review';
import { useApi } from '../../app/ApiContext';
import { ListHeader, Notice, StatusBadge, refreshOf } from '../../shared/admin';
import { CommandFeedback } from '../../shared/Feedback';
import { messages } from '../../shared/messages';
import { label, text, when } from '../../shared/ops';
import { StaffName } from '../lookup/parts';

const m = messages.reviewReports;
type Group = components['schemas']['ReviewReportGroup'];
type State = 'OPEN' | 'RESOLVED';
type Action = 'HIDE' | 'KEEP';
const STATES: readonly State[] = ['OPEN', 'RESOLVED'];
const KEY = ['review-reports'];

const stars = (n: number) => `${'★'.repeat(Math.max(0, Math.min(5, n)))}${'☆'.repeat(Math.max(0, 5 - Math.min(5, n)))}`;

const isGone = (e: unknown) => e instanceof ProblemFailure && e.problem.code === 'NO_OPEN_REPORTS';

function Resolve({ g, onDone }: { readonly g: Group; readonly onDone: () => void }) {
  const api = useApi();
  const [note, setNote] = useState('');
  const [ask, setAsk] = useState<Action | null>(null);
  const cmd = useCommand(async (v: { readonly action: Action; readonly note: string }, key) => {
    try {
      const r = await request(
        'POST',
        api.review.POST('/review-reports/{reviewId}/resolutions', { ...commandParams(key, { path: { reviewId: g.reviewId } }), body: { action: v.action, ...(v.note ? { note: v.note } : {}) } }),
      );
      onDone();
      return r;
    } catch (e) {
      // 다른 직원이 먼저 처리(409 NO_OPEN_REPORTS) — 목록을 다시 읽어 지금 상태로
      if (isGone(e)) onDone();
      throw e;
    }
  });
  const failure = cmd.phase.kind === 'rejected' ? cmd.phase.failure : null;
  const gone = isGone(failure);
  return (
    <div className="space-y-2" data-testid="review-report-resolve">
      <label className="flex flex-col gap-1 text-xs text-base-content/60">
        {m.note}
        <input className="input input-sm w-full" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} disabled={cmd.busy} />
      </label>
      {ask === null ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm btn-error btn-outline" disabled={cmd.busy || g.reviewDeleted} onClick={() => setAsk('HIDE')}>
            {m.hide}
          </button>
          <button type="button" className="btn btn-sm" disabled={cmd.busy} onClick={() => setAsk('KEEP')}>
            {m.keep}
          </button>
        </div>
      ) : (
        // 브라우저 확인 창 대신 줄 안에서 한 번 더 묻기
        <div className="flex flex-wrap items-center gap-2 rounded-box border border-base-300 bg-base-200/50 px-3 py-2 text-xs" role="group" aria-label={m.confirm}>
          <span>{ask === 'HIDE' ? m.askHide : m.askKeep}</span>
          <button
            type="button"
            className={`btn btn-xs ${ask === 'HIDE' ? 'btn-error' : 'btn-primary'}`}
            disabled={cmd.busy}
            onClick={() => {
              if (cmd.phase.kind === 'rejected') cmd.reset();
              void cmd.run({ action: ask, note: note.trim() });
            }}
          >
            {ask === 'HIDE' ? m.hide : m.keep}
          </button>
          <button type="button" className="btn btn-xs" disabled={cmd.busy} onClick={() => setAsk(null)}>
            {m.cancel}
          </button>
        </div>
      )}
      {gone ? (
        <p className="text-xs text-warning" data-testid="review-report-gone">
          {m.alreadyResolved}
        </p>
      ) : (
        <CommandFeedback command={cmd} />
      )}
    </div>
  );
}

function GroupRow({ g, onDone }: { readonly g: Group; readonly onDone: () => void }) {
  const reasons = Object.entries(g.reasonCounts ?? {}).filter(([, n]) => n > 0);
  return (
    <li className="grid gap-x-6 gap-y-3 px-5 py-4 text-sm md:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]" data-testid="review-report" data-state={g.state}>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-base-content/60">
          <span className="text-warning" aria-label={m.rating(g.rating)}>
            {stars(g.rating)}
          </span>
          <span>{text(g.authorMasked)}</span>
          <span>{when(g.reviewCreatedAt)}</span>
          <Link className="link link-hover" to={`/products/${encodeURIComponent(g.productId)}`}>
            {g.sku ?? m.product}
          </Link>
          {g.reviewHidden && <StatusBadge tone="warning">{m.hidden}</StatusBadge>}
          {g.reviewDeleted && <StatusBadge tone="ghost">{m.deleted}</StatusBadge>}
        </div>
        <p className="whitespace-pre-wrap rounded-box bg-base-200/60 px-3 py-2">{g.text ? g.text : <span className="text-base-content/50">{m.noText}</span>}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold">{m.reportCount(g.reportCount)}</span>
          {reasons.map(([k, n]) => (
            <span key={k} className="badge badge-ghost badge-sm" data-testid="review-report-reason">
              {label(m.reasonName, k)} {n}
            </span>
          ))}
          <span className="text-base-content/55">{m.reportedRange(when(g.firstReportedAt), when(g.lastReportedAt))}</span>
        </div>
        {(g.otherDetails ?? []).length > 0 && (
          <ul className="list-inside list-disc space-y-0.5 text-xs text-base-content/70" aria-label={m.otherDetails}>
            {(g.otherDetails ?? []).map((d, i) => (
              <li key={`${i}:${d}`}>{d}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="min-w-0">
        {g.state === 'OPEN' ? (
          <Resolve g={g} onDone={onDone} />
        ) : (
          <div className="space-y-1 text-xs" data-testid="review-report-result">
            <StatusBadge tone={g.resolution === 'HIDE' ? 'warning' : 'success'}>{label(m.resolutionName, g.resolution ?? null)}</StatusBadge>
            <p className="text-base-content/60">
              <StaffName id={g.resolvedBy} /> · {when(g.resolvedAt)}
            </p>
          </div>
        )}
      </div>
    </li>
  );
}

export function ReviewReportPage() {
  const api = useApi();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const state: State = params.get('state') === 'RESOLVED' ? 'RESOLVED' : 'OPEN';
  const query = useInfiniteQuery({
    queryKey: [...KEY, state],
    queryFn: ({ pageParam }) => request('GET', api.review.GET('/review-reports', { params: { query: { state, size: 20, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = () => void qc.invalidateQueries({ queryKey: KEY });
  return (
    <section className="space-y-4" data-testid="review-reports">
      <ListHeader title={m.title} count={query.data ? `${items.length}${query.hasNextPage ? '+' : ''}` : undefined} refresh={refreshOf(query)} />
      <Notice>{m.intro}</Notice>
      <div role="tablist" aria-label={m.stateLabel} className="flex gap-1 border-b border-base-300">
        {STATES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={state === s}
            onClick={() => setParams(s === 'OPEN' ? {} : { state: s })}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${state === s ? 'border-primary font-semibold' : 'border-transparent text-base-content/55 hover:text-base-content'}`}
          >
            {m.stateName[s]}
          </button>
        ))}
      </div>
      <QueryState state={toUiState(query, (d) => d.pages.every((p) => p.items.length === 0))} onRetry={() => void query.refetch()} emptyText={state === 'OPEN' ? m.emptyOpen : m.emptyResolved}>
        {() => (
          <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
            <ul className="divide-y divide-base-300/70">
              {items.map((g) => (
                <GroupRow key={`${g.reviewId}:${g.state}`} g={g} onDone={refresh} />
              ))}
            </ul>
            {query.hasNextPage && (
              <div className="border-t border-base-300 px-5 py-3">
                <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                  {m.more}
                </button>
              </div>
            )}
          </div>
        )}
      </QueryState>
    </section>
  );
}

