// 제한 검토(라이더 운영) — rider-service 0.3.0 `GET /riders/restriction-reviews`, `POST …/{reviewId}/decisions`.
// 컴플레인이 같은 종류로 7일 안 서로 다른 배송 3건 이상이면 시스템이 연다. 자동 제재 없음 — 제한하려면 먼저 계정 제한을 건 뒤 RESTRICTED 로 닫는다.
// 지금 서버 권한은 OPERATOR_ADMIN 만(RIDER_OPS 는 PC 5 반영 뒤) — 403 은 그대로 보인다.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/rider';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback } from '../../shared/Feedback';
import { messages as m } from '../../shared/messages';
import { label, text, when } from '../../shared/ops';
import { DataTable, PageHeader } from '../../shared/admin';

type Review = components['schemas']['RestrictionReview'];
type ReviewState = 'OPEN' | 'RESTRICTED' | 'DISMISSED';
const STATES: readonly ReviewState[] = ['OPEN', 'RESTRICTED', 'DISMISSED'];
const isState = (v: string | null): v is ReviewState => v !== null && (STATES as readonly string[]).includes(v);

function Decide({ review }: { readonly review: Review }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const reviewId = review.reviewId ?? '';
  const [note, setNote] = useState('');
  const decide = useCommand(async (body: { decision: 'RESTRICTED' | 'DISMISSED'; note?: string }, key) => {
    try {
      const closed = await request(
        'POST',
        api.riders.POST('/riders/restriction-reviews/{reviewId}/decisions', { ...commandParams(key, { path: { reviewId } }), body }),
      );
      // 닫힌 검토를 그 자리에 그대로 보인다(목록을 다시 읽으면 열린 목록에서 사라져 결과를 못 본다). 다른 상태 목록은 다음에 열 때 새로 읽는다.
      queryClient.setQueriesData<{ items?: Review[] }>({ queryKey: ['riders', 'restriction-reviews'] }, (old) =>
        old ? { ...old, items: (old.items ?? []).map((v) => (v.reviewId === closed.reviewId ? closed : v)) } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ['riders', 'restriction-reviews'], refetchType: 'none' });
      return closed;
    } catch (e) {
      void queryClient.invalidateQueries({ queryKey: ['riders', 'restriction-reviews'] });
      throw e;
    }
  });
  const locked = decide.busy || decide.phase.kind === 'done';
  const run = (decision: 'RESTRICTED' | 'DISMISSED') => void decide.run({ decision, ...(note.trim() ? { note: note.trim() } : {}) });
  return (
    <div className="space-y-1">
      <input className="input input-xs w-full" placeholder={m.reviews.noteHint} aria-label={m.reviews.note} value={note} disabled={locked} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-1">
        <button type="button" className="btn btn-xs btn-warning" disabled={locked} onClick={() => run('RESTRICTED')}>
          {m.reviews.restrict}
        </button>
        <button type="button" className="btn btn-xs" disabled={locked} onClick={() => run('DISMISSED')}>
          {m.reviews.dismiss}
        </button>
        {review.riderId && (
          <Link className="btn btn-xs btn-ghost" to={`/riders/${encodeURIComponent(review.riderId)}`}>
            {m.reviews.goRestrict}
          </Link>
        )}
      </div>
      <CommandFeedback command={decide} unknown={{ body: m.reviews.unknown }}>
        {(r) => (
          <p role="status" className="text-xs text-success">
            {`${m.reviews.closed} ${label(m.reviews.state, r.state)}`}
          </p>
        )}
      </CommandFeedback>
    </div>
  );
}

/** 검토 표. 라이더 상세에서도 쓴다(riderId). */
export function ReviewTable({ state, riderId }: { readonly state: ReviewState; readonly riderId?: string | undefined }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['riders', 'restriction-reviews', state, riderId ?? ''],
    queryFn: () =>
      request('GET', api.riders.GET('/riders/restriction-reviews', { params: { query: { state, ...(riderId ? { riderId } : {}) } } })),
  });
  return (
    <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
      {(r) =>
        (r.items ?? []).length === 0 ? (
          <p className="text-sm text-base-content/60">{m.reviews.empty}</p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>{m.reviews.rider}</th>
                <th>{m.reviews.type}</th>
                <th>{m.reviews.openedAt}</th>
                <th>{m.reviews.complaints}</th>
                <th>{state === 'OPEN' ? '' : m.reviews.decidedAt}</th>
              </tr>
            </thead>
            <tbody>
              {(r.items ?? []).map((v, i) => (
                // 열린 검토는 행마다 결정 명령 하나 — 상태가 바뀌어도 같은 행으로 남게 reviewId 를 키로 쓴다.
                <tr key={v.reviewId ?? `review-${i}`} data-testid="review-row">
                  <td>{v.riderId ? <Link className="link" to={`/riders/${encodeURIComponent(v.riderId)}`}>{v.riderId}</Link> : m.none}</td>
                  <td>{label(m.complaints.typeName, v.complaintType)}</td>
                  <td>{when(v.openedAt)}</td>
                  <td>
                    <ul>
                      {(v.complaints ?? []).map((c, n) => (
                        <li key={c.complaintId ?? `c-${n}`}>
                          {c.complaintId ? <Link className="link" to={`/rider-complaints/${encodeURIComponent(c.complaintId)}`}>{c.complaintId}</Link> : m.none}
                          <span className="opacity-60">{` · ${text(c.deliveryId)} · ${when(c.recordedAt)}`}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="min-w-56">
                    {v.state === 'OPEN' ? <Decide review={v} /> : `${label(m.reviews.state, v.state)} · ${when(v.decidedAt)} · ${text(v.decidedBy)}${v.note ? ` · ${v.note}` : ''}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )
      }
    </QueryState>
  );
}

export function RestrictionReviewPage() {
  const [search, setSearch] = useSearchParams();
  const raw = search.get('state');
  const state: ReviewState = isState(raw) ? raw : 'OPEN';
  return (
    <section className="space-y-4">
      <PageHeader title={m.reviews.title} description={m.reviews.intro} />
      <div role="group" aria-label={m.reviews.title} className="join">
        {STATES.map((s) => (
          <button key={s} type="button" aria-pressed={state === s} className={`btn join-item btn-sm ${state === s ? 'btn-active' : ''}`} onClick={() => setSearch({ state: s })}>
            {m.reviews.state[s]}
          </button>
        ))}
      </div>
      <ReviewTable state={state} />
    </section>
  );
}
