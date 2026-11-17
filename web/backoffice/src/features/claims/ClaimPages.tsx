// 클레임 조회(고객센터) — claim-service 0.1.0 `GET /claims`, `GET /claims/{id}`, `GET /claims/{id}/refunds`. 조회만.
// 클레임 결정(`POST …/decisions`)은 서버가 아직 501 — 화면에 넣지 않는다(요청서 §2). PG 환불 성공 전에는 "완료"로 보이지 않는다(서버 상태 그대로).
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState, uiStateFromError } from '@pmart/web-ui';
import type { components } from '../../api/generated/claim';
import { useApi } from '../../app/ApiContext';
import { messages as m } from '../../shared/messages';
import { Facts, label, text, when, won } from '../../shared/ops';
import { RecoveryActions, ReturnProgress } from './ReturnClaim';

type ClaimType = components['schemas']['ClaimType'];
type ClaimState = components['schemas']['ClaimState'];
type ClaimSummary = components['schemas']['ClaimSummary'];

const TYPES = Object.keys(m.claims.typeName) as ClaimType[];
const STATES = Object.keys(m.claims.stateName) as ClaimState[];
const isType = (v: string | null): v is ClaimType => v !== null && (TYPES as readonly string[]).includes(v);
const isState = (v: string | null): v is ClaimState => v !== null && (STATES as readonly string[]).includes(v);

function useClaimList(filter: { orderId?: string | undefined; type?: ClaimType | undefined; state?: ClaimState | undefined }) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: ['claims', 'list', filter],
    queryFn: ({ pageParam }) =>
      request(
        'GET',
        api.claims.GET('/claims', {
          params: {
            query: {
              ...(filter.orderId ? { orderId: filter.orderId } : {}),
              ...(filter.type ? { type: filter.type } : {}),
              ...(filter.state ? { state: filter.state } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });
}

function ClaimTable({ query }: { readonly query: ReturnType<typeof useClaimList> }) {
  const items: ClaimSummary[] = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  if (query.isPending) return <QueryState state={{ kind: 'loading' }}>{() => null}</QueryState>;
  if (query.isError && items.length === 0) {
    return (
      <QueryState state={uiStateFromError(query.error)} onRetry={() => void query.refetch()}>
        {() => null}
      </QueryState>
    );
  }
  if (items.length === 0) return <p className="text-sm opacity-70">{m.claims.empty}</p>;
  return (
    <>
      <table className="table table-sm rounded-box bg-base-100">
        <thead>
          <tr>
            <th>ID</th>
            <th>{m.claims.type}</th>
            <th>{m.claims.state}</th>
            <th>{m.claims.orderId}</th>
            <th>{m.claims.openedAt}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c, i) => (
            <tr key={c.claimId ?? `claim-${i}`} data-testid="claim-row">
              <td>
                {c.claimId ? (
                  <Link className="link" to={`/claims/${encodeURIComponent(c.claimId)}`}>
                    {c.claimId}
                  </Link>
                ) : (
                  m.none
                )}
              </td>
              <td>{label(m.claims.typeName, c.type)}</td>
              <td>{label(m.claims.stateName, c.state)}</td>
              <td>{c.orderId ? <Link className="link" to={`/orders/${encodeURIComponent(c.orderId)}`}>{c.orderId}</Link> : m.none}</td>
              <td>{when(c.openedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {query.isFetchNextPageError && <p className="text-sm text-error">{m.claims.moreFailed}</p>}
      {query.hasNextPage && (
        <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {m.claims.more}
        </button>
      )}
    </>
  );
}

/** 주문 상세 아래 — 이 주문의 클레임(`GET /claims?orderId=`). */
export function ClaimsOfOrder({ orderId }: { readonly orderId: string }) {
  return <ClaimTable query={useClaimList({ orderId })} />;
}

export function ClaimListPage() {
  const [search, setSearch] = useSearchParams();
  const orderId = search.get('orderId') ?? '';
  const type = search.get('type');
  const state = search.get('state');
  const [draft, setDraft] = useState({ orderId, type: type ?? '', state: state ?? '' });
  const query = useClaimList({
    orderId: orderId || undefined,
    type: isType(type) ? type : undefined,
    state: isState(state) ? state : undefined,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams();
    if (draft.orderId.trim()) next.set('orderId', draft.orderId.trim());
    if (draft.type) next.set('type', draft.type);
    if (draft.state) next.set('state', draft.state);
    setSearch(next);
  };

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{m.claims.title}</h1>
      <p className="text-sm opacity-70">{m.claims.intro}</p>
      <form className="flex flex-wrap items-end gap-2 rounded-box bg-base-100 p-4" onSubmit={submit} aria-label={m.claims.title}>
        <label className="text-sm">
          {m.claims.orderId}
          <input className="input input-sm mt-1 block" value={draft.orderId} onChange={(e) => setDraft((d) => ({ ...d, orderId: e.target.value }))} />
        </label>
        <label className="text-sm">
          {m.claims.type}
          <select className="select select-sm mt-1 block" value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}>
            <option value="">{m.claims.any}</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {m.claims.typeName[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {m.claims.state}
          <select className="select select-sm mt-1 block" value={draft.state} onChange={(e) => setDraft((d) => ({ ...d, state: e.target.value }))}>
            <option value="">{m.claims.any}</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {m.claims.stateName[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary btn-sm">
          {m.claims.filter}
        </button>
      </form>
      <ClaimTable query={query} />
    </section>
  );
}

function Refunds({ claimId }: { readonly claimId: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['claims', 'refunds', claimId],
    queryFn: () => request('GET', api.claims.GET('/claims/{claimId}/refunds', { params: { path: { claimId } } })),
  });
  return (
    <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
      {(r) =>
        (r.items ?? []).length === 0 ? (
          <p className="text-sm opacity-70">{m.claims.noRefunds}</p>
        ) : (
          <table className="table table-sm rounded-box bg-base-100">
            <thead>
              <tr>
                <th>{m.claims.state}</th>
                <th>{m.claims.amount}</th>
                <th>{m.claims.requestedAt}</th>
                <th>{m.claims.completedAt}</th>
              </tr>
            </thead>
            <tbody>
              {(r.items ?? []).map((f, i) => (
                <tr key={f.refundIntentId ?? `refund-${i}`} data-testid="refund-row">
                  <td>
                    {label(m.claims.refundState, f.state)}
                    {/* claim 0.3.0 — 상품 환불(ITEMS)과 반품 회수비 돌려주기(RETURN_FEE)를 나눠 보인다 */}
                    {f.kind === 'RETURN_FEE' && <span className="badge badge-ghost badge-sm ml-1">{m.claims.refundKindFee}</span>}
                  </td>
                  <td>{won(f.amount)}</td>
                  <td>{when(f.requestedAt)}</td>
                  <td>{when(f.completedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </QueryState>
  );
}

export function ClaimDetailPage() {
  const { claimId = '' } = useParams();
  const api = useApi();
  const query = useQuery({
    queryKey: ['claims', 'detail', claimId],
    queryFn: () => request('GET', api.claims.GET('/claims/{claimId}', { params: { path: { claimId } } })),
  });

  return (
    <section className="max-w-4xl space-y-4">
      <h1 className="text-xl font-bold">{`${m.claims.detailTitle} ${claimId}`}</h1>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(c) => (
          <>
            <Facts
              testId="claim-summary"
              rows={[
                [m.claims.type, label(m.claims.typeName, c.type)],
                [m.claims.state, <span key="s" data-testid="claim-state">{label(m.claims.stateName, c.state)}</span>],
                [m.claims.orderId, c.orderId ? <Link key="o" className="link" to={`/orders/${encodeURIComponent(c.orderId)}`}>{c.orderId}</Link> : m.none],
                [m.claims.reason, label(m.claims.reasonName, c.reason)],
                [m.claims.reasonDetail, text(c.reasonDetail)],
                [m.claims.openedAt, when(c.openedAt)],
                [m.claims.decidedAt, when(c.decidedAt)],
                [m.claims.closedAt, when(c.closedAt)],
                [m.claims.pickup, c.pickup ? `${text(c.pickup.state)}${c.pickup.deliveryId ? ` · ${c.pickup.deliveryId}` : ''}` : m.none],
                [m.claims.reshipment, text(c.reshipment?.state)],
                [m.claims.fees, c.fees ? [won(c.fees.exchangeRoundTripFee), won(c.fees.returnPickupFee)].join(' / ') : m.none],
              ]}
            />
            <p className="text-xs opacity-60">{m.claims.noDecision}</p>
            <ReturnProgress claim={c} />
            <RecoveryActions claim={c} />

            <h2 className="font-bold">{m.claims.lines}</h2>
            <table className="table table-sm rounded-box bg-base-100">
              <thead>
                <tr>
                  <th>{m.claims.sku}</th>
                  <th>{m.claims.requested}</th>
                  <th>{m.claims.approved}</th>
                  <th>{m.claims.decision}</th>
                  <th>{m.claims.refundAmount}</th>
                  <th>{m.claims.deadline}</th>
                </tr>
              </thead>
              <tbody>
                {(c.lines ?? []).map((l, i) => (
                  <tr key={l.claimLineId ?? `line-${i}`} data-testid="claim-line">
                    <td>{text(l.sku)}</td>
                    <td>{text(l.requestedQty)}</td>
                    <td>{text(l.approvedQty)}</td>
                    <td>{label(m.claims.decisionName, l.decision)}</td>
                    <td>{won(l.refundAmount)}</td>
                    <td>{when(l.windowDeadline)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h2 className="font-bold">{m.claims.refunds}</h2>
            <p className="text-xs opacity-60">{m.claims.refundsNote}</p>
            <Refunds claimId={claimId} />
          </>
        )}
      </QueryState>
      <Link className="link text-sm" to="/claims">
        {m.claims.back}
      </Link>
    </section>
  );
}
