// 클레임 조회(고객센터) — claim-service 0.1.0 `GET /claims`, `GET /claims/{id}`, `GET /claims/{id}/refunds`. 조회만.
// 클레임 결정(`POST …/decisions`)은 서버가 아직 501 — 화면에 넣지 않는다(요청서 §2). PG 환불 성공 전에는 "완료"로 보이지 않는다(서버 상태 그대로).
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState, uiStateFromError } from '@pmart/web-ui';
import type { components } from '../../api/generated/claim';
import { useApi } from '../../app/ApiContext';
import { ChipGroup, DataTable, DetailHeader, FieldList, Notice, PageHeader, ResultBar, SearchPanel, SearchRow, Section, StatusBadge, type Tone } from '../../shared/admin';
import { messages as m } from '../../shared/messages';
import { label, text, when, won } from '../../shared/ops';
import { RecoveryActions, ReturnProgress } from './ReturnClaim';

type ClaimType = components['schemas']['ClaimType'];
type ClaimState = components['schemas']['ClaimState'];
type ClaimSummary = components['schemas']['ClaimSummary'];

const TYPES = Object.keys(m.claims.typeName) as ClaimType[];
const STATES = Object.keys(m.claims.stateName) as ClaimState[];
const isType = (v: string | null): v is ClaimType => v !== null && (TYPES as readonly string[]).includes(v);
const isState = (v: string | null): v is ClaimState => v !== null && (STATES as readonly string[]).includes(v);
/** 상태 꼬리표 색(표시만) */
export const claimTone = (s: string | undefined): Tone =>
  s === 'CLOSED' ? 'success' : s === 'REJECTED' || s === 'CANCELLED' || s === 'WITHDRAWN' ? 'ghost' : s === 'RECOVERY_FAILED' ? 'error' : s === 'FEE_PENDING' || s === 'STOP_PENDING' ? 'warning' : 'info';

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

function ClaimTable({ query, withCount = false }: { readonly query: ReturnType<typeof useClaimList>; readonly withCount?: boolean }) {
  const navigate = useNavigate();
  const items: ClaimSummary[] = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  if (query.isPending) return <QueryState state={{ kind: 'loading' }}>{() => null}</QueryState>;
  if (query.isError && items.length === 0) {
    return (
      <QueryState state={uiStateFromError(query.error)} onRetry={() => void query.refetch()}>
        {() => null}
      </QueryState>
    );
  }
  if (items.length === 0) return <p className="text-sm text-base-content/60">{m.claims.empty}</p>;
  return (
    <>
      {withCount && <ResultBar count={items.length} more={query.hasNextPage} />}
      <DataTable>
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
            <tr
              key={c.claimId ?? `claim-${i}`}
              data-testid="claim-row"
              className={c.claimId ? 'cursor-pointer' : undefined}
              onClick={() => c.claimId && void navigate(`/claims/${encodeURIComponent(c.claimId)}`)}
            >
              <td>
                {c.claimId ? (
                  <Link className="font-mono text-primary hover:underline" to={`/claims/${encodeURIComponent(c.claimId)}`} onClick={(e) => e.stopPropagation()}>
                    {c.claimId}
                  </Link>
                ) : (
                  m.none
                )}
              </td>
              <td>{label(m.claims.typeName, c.type)}</td>
              <td>
                <StatusBadge tone={claimTone(c.state)}>{label(m.claims.stateName, c.state)}</StatusBadge>
              </td>
              <td>
                {c.orderId ? (
                  <Link className="font-mono text-primary hover:underline" to={`/orders/${encodeURIComponent(c.orderId)}`} onClick={(e) => e.stopPropagation()}>
                    {c.orderId}
                  </Link>
                ) : (
                  m.none
                )}
              </td>
              <td>{when(c.openedAt)}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      {query.isFetchNextPageError && <p className="text-sm text-error">{m.claims.moreFailed}</p>}
      {query.hasNextPage && (
        <button type="button" className="btn btn-sm mx-auto block border-base-300 bg-base-100" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
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

  const typeOptions = [{ value: '', label: m.claims.any }, ...TYPES.map((t) => ({ value: t, label: m.claims.typeName[t] ?? t }))];
  const stateOptions = [{ value: '', label: m.claims.any }, ...STATES.map((st) => ({ value: st, label: m.claims.stateName[st] ?? st }))];

  // 관리자 형식(2026-11-18): 머리말 → 검색 조건 상자 → 결과 줄·표
  return (
    <section className="space-y-5">
      <PageHeader title={m.claims.title} description={m.claims.intro} />
      <SearchPanel onSubmit={submit} onReset={() => setDraft({ orderId: '', type: '', state: '' })} submitLabel={m.claims.filter} resetLabel={m.claims.reset}>
        <SearchRow label={m.claims.orderId}>
          <input className="input input-sm w-56" aria-label={m.claims.orderId} value={draft.orderId} onChange={(e) => setDraft((d) => ({ ...d, orderId: e.target.value }))} />
        </SearchRow>
        <SearchRow label={m.claims.type}>
          <ChipGroup label={m.claims.type} value={draft.type} options={typeOptions} onChange={(v) => setDraft((d) => ({ ...d, type: v }))} />
        </SearchRow>
        <SearchRow label={m.claims.state}>
          <ChipGroup label={m.claims.state} value={draft.state} options={stateOptions} onChange={(v) => setDraft((d) => ({ ...d, state: v }))} />
        </SearchRow>
      </SearchPanel>
      <ClaimTable query={query} withCount />
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
          <p className="text-sm text-base-content/60">{m.claims.noRefunds}</p>
        ) : (
          <DataTable>
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
          </DataTable>
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

  // 관리자 형식(2026-11-18): 상세 머리 → 구역 상자 → 맨 아래 운영 조치(회수 조치)
  return (
    <section className="max-w-5xl space-y-4">
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(c) => (
          <>
            <DetailHeader
              back={{ to: '/claims', label: m.claims.back }}
              title={`${m.claims.detailTitle} ${claimId}`}
              badges={
                <>
                  <StatusBadge tone="neutral">{label(m.claims.typeName, c.type)}</StatusBadge>
                  <StatusBadge tone={claimTone(c.state)} testId="claim-state">
                    {label(m.claims.stateName, c.state)}
                  </StatusBadge>
                </>
              }
              summary={`${label(m.claims.reasonName, c.reason)} · ${when(c.openedAt)}`}
            />
            <Section title={m.claims.sectionBasic}>
              <FieldList
                testId="claim-summary"
                rows={[
                  [m.claims.type, label(m.claims.typeName, c.type)],
                  [m.claims.state, label(m.claims.stateName, c.state)],
                  [m.claims.orderId, c.orderId ? <Link key="o" className="font-mono text-primary hover:underline" to={`/orders/${encodeURIComponent(c.orderId)}`}>{c.orderId}</Link> : m.none],
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
              <p className="mt-3 text-xs text-base-content/55">{m.claims.noDecision}</p>
            </Section>
            {c.type === 'RETURN' && (
              <Section title={m.claims.sectionReturn}>
                <ReturnProgress claim={c} />
              </Section>
            )}

            <Section title={m.claims.lines}>
              <DataTable>
                <thead>
                  <tr>
                    <th>{m.claims.sku}</th>
                    <th>{m.claims.requested}</th>
                    <th>{m.claims.approved}</th>
                    <th>{m.claims.decision}</th>
                    <th className="text-right">{m.claims.refundAmount}</th>
                    <th>{m.claims.deadline}</th>
                  </tr>
                </thead>
                <tbody>
                  {(c.lines ?? []).map((l, i) => (
                    <tr key={l.claimLineId ?? `line-${i}`} data-testid="claim-line">
                      <td className="font-mono text-xs">{text(l.sku)}</td>
                      <td>{text(l.requestedQty)}</td>
                      <td>{text(l.approvedQty)}</td>
                      <td>{label(m.claims.decisionName, l.decision)}</td>
                      <td className="text-right">{won(l.refundAmount)}</td>
                      <td>{when(l.windowDeadline)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </Section>

            <Section title={m.claims.refunds}>
              <Notice>{m.claims.refundsNote}</Notice>
              <div className="mt-3">
                <Refunds claimId={claimId} />
              </div>
            </Section>

            {/* 맨 아래 운영 조치 — 반품 회수 조치(조건이 안 맞으면 칸이 없다) */}
            <RecoveryActions claim={c} />
          </>
        )}
      </QueryState>
    </section>
  );
}
