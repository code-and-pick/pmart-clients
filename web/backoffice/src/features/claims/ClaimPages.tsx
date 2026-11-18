// 클레임 조회(고객센터) — claim-service 0.1.0 `GET /claims`, `GET /claims/{id}`, `GET /claims/{id}/refunds`. 조회만.
// 클레임 결정(`POST …/decisions`)은 서버가 아직 501 — 화면에 넣지 않는다(요청서 §2). PG 환불 성공 전에는 "완료"로 보이지 않는다(서버 상태 그대로).
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState, uiStateFromError } from '@pmart/web-ui';
import type { components } from '../../api/generated/claim';
import { useApi } from '../../app/ApiContext';
import { ChipGroup, CodeLabel, DataTable, DetailHeader, NextAction, Notice, PageHeader, ResultBar, SearchPanel, SearchRow, Section, StatusBadge, type Tone } from '../../shared/admin';
import { EmptyBox, KindChip, ListFoot, SideFields, When } from '../lookup/parts';
import { DisplayNumber } from '../../shared/displayNumber';
import { SavedViews } from '../../shared/SavedViews';
import { messages as m } from '../../shared/messages';
import { isOrderNumber, orderIdOfNumber, useOrderNumbers } from '../../shared/numberLookups';
import { label, text, when, won } from '../../shared/ops';
import { availableActions, RecoveryActions, ReturnProgress } from './ReturnClaim';

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
  // 화면 주문번호(ADR-0070) — 클레임 응답엔 번호가 없어 주문 조회로 붙인다(같은 주문은 캐시)
  const orders = useOrderNumbers(items.map((c) => c.orderId));
  if (query.isPending) return <QueryState state={{ kind: 'loading' }}>{() => null}</QueryState>;
  if (query.isError && items.length === 0) {
    return (
      <QueryState state={uiStateFromError(query.error)} onRetry={() => void query.refetch()}>
        {() => null}
      </QueryState>
    );
  }
  if (items.length === 0)
    return (
      <EmptyBox icon="return" listPart={withCount}>
        {m.claims.empty}
      </EmptyBox>
    );
  // 목록(2026-11-18 Shopify·Medusa 목록처럼): 첫 칸 종류 색 꼬리표 + 클레임 번호, 상태 점 꼬리표, 주문 번호 작게, "N일 전" → 아래 건수·더 보기
  return (
    <>
      {withCount && <ResultBar count={items.length} more={query.hasNextPage} />}
      <DataTable>
        <thead>
          <tr>
            <th>{m.claims.detailTitle}</th>
            <th>{m.claims.state}</th>
            <th>{m.claims.orderId}</th>
            <th className="text-right">{m.claims.openedAt}</th>
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
                <span className="flex flex-wrap items-center gap-2">
                  <ClaimTypeChip type={c.type} />
                  {c.claimId ? (
                    <Link className="font-mono font-semibold text-base-content hover:text-primary hover:underline" to={`/claims/${encodeURIComponent(c.claimId)}`} onClick={(e) => e.stopPropagation()}>
                      {c.claimId}
                    </Link>
                  ) : (
                    m.none
                  )}
                </span>
              </td>
              <td>
                <StatusBadge tone={claimTone(c.state)}>{c.state ? <CodeLabel code={c.state} names={m.claims.stateName} /> : m.none}</StatusBadge>
              </td>
              <td>
                {c.orderId ? (
                  <Link className="font-mono text-xs text-base-content/55 hover:text-primary hover:underline" to={`/orders/${encodeURIComponent(c.orderId)}`} onClick={(e) => e.stopPropagation()}>
                    <DisplayNumber number={orders.get(c.orderId)} systemId={c.orderId} failed={orders.failed(c.orderId)} />
                  </Link>
                ) : (
                  m.none
                )}
              </td>
              <td>
                <When iso={c.openedAt} align="right" />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      {(query.hasNextPage || query.isFetchNextPageError) && (
        <ListFoot>
          <span className="text-base-content/55">{m.approvals.shown(items.length, !!query.hasNextPage)}</span>
          {query.isFetchNextPageError && <span className="text-error">{m.claims.moreFailed}</span>}
          {query.hasNextPage && (
            <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              {m.claims.more}
            </button>
          )}
        </ListFoot>
      )}
    </>
  );
}

/** 주문 상세 아래 — 이 주문의 클레임(`GET /claims?orderId=`). */
export function ClaimsOfOrder({ orderId }: { readonly orderId: string }) {
  return <ClaimTable query={useClaimList({ orderId })} />;
}

export function ClaimListPage() {
  const api = useApi();
  const [search, setSearch] = useSearchParams();
  const [notFound, setNotFound] = useState<string | null>(null);
  const orderId = search.get('orderId') ?? '';
  const type = search.get('type');
  const state = search.get('state');
  const [draft, setDraft] = useState({ orderId, type: type ?? '', state: state ?? '' });
  const query = useClaimList({
    orderId: orderId || undefined,
    type: isType(type) ? type : undefined,
    state: isState(state) ? state : undefined,
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setNotFound(null);
    const next = new URLSearchParams();
    const order = draft.orderId.trim();
    // 화면 주문번호(8자리)를 넣으면 주문 조회로 주문 ID 를 찾아 그 ID 로 거른다(클레임 목록은 주문 ID 로만 거른다)
    if (order && isOrderNumber(order)) {
      const id = await orderIdOfNumber(api, order.replace(/[s-]/g, '')).catch(() => undefined);
      if (!id) {
        setNotFound(order);
        return;
      }
      next.set('orderId', id);
    } else if (order) next.set('orderId', order);
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
      {/* 내 보기(2026-11-18 Saleor 참고) — 지금 주소 조건을 이름 붙여 저장 */}
      <SavedViews listKey="claims" />
      <SearchPanel onSubmit={(e) => void submit(e)} onReset={() => setDraft({ orderId: '', type: '', state: '' })} submitLabel={m.claims.filter} resetLabel={m.claims.reset}>
        <SearchRow label={m.claims.orderId}>
          <input className="input input-sm w-56" aria-label={m.claims.orderId} placeholder={m.claims.orderFilterHint} value={draft.orderId} onChange={(e) => setDraft((d) => ({ ...d, orderId: e.target.value }))} />
          {notFound && (
            <span role="alert" className="text-xs text-warning">
              {m.claims.orderNumberNotFound(notFound)}
            </span>
          )}
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
                    {f.state ? <CodeLabel code={f.state} names={m.claims.refundState} /> : m.none}
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
  const detailOrders = useOrderNumbers([query.data?.orderId]);

  // 상세(2026-11-18 Shopify 상세처럼): 상세 머리 → 두 칸
  // 왼쪽(넓게) = 품목·반품 진행·환불·회수 조치, 오른쪽 = 클레임 정보·회수/재배송/비용
  return (
    <section className="max-w-7xl space-y-4">
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(c) => {
          // 다음 할 일 — 회수 조치 칸(RecoveryActions)이 열리는 서버 상태와 같은 판정(availableActions)만 쓴다
          const can = availableActions(c);
          const next =
            can.size === 0
              ? null
              : c.state === 'FEE_PENDING'
                ? { tone: 'info' as const, title: m.claims.nextStep.feeTitle, body: m.claims.nextStep.feeBody }
                : c.state === 'RECOVERY_FAILED'
                  ? { tone: 'warning' as const, title: m.claims.nextStep.recoveryTitle, body: m.claims.nextStep.recoveryBody }
                  : { tone: 'warning' as const, title: m.claims.nextStep.shortTitle, body: m.claims.nextStep.shortBody };
          return (
          <>
            <DetailHeader
              back={{ to: '/claims', label: m.claims.back }}
              // 제목(2026-11-18 사용자 "직관적이지 않다"): 종류 · 사유를 앞에, 클레임 번호는 옆에 작게
              title={
                <>
                  {c.type ? m.claims.titleOf(label(m.claims.typeName, c.type), label(m.claims.reasonName, c.reason)) : m.claims.detailTitle}
                  <span className="ml-2 font-mono text-sm font-normal text-base-content/50">{claimId}</span>
                </>
              }
              badges={
                <>
                  <ClaimTypeChip type={c.type} />
                  <StatusBadge tone={claimTone(c.state)} testId="claim-state">
                    {c.state ? <CodeLabel code={c.state} names={m.claims.stateName} /> : m.none}
                  </StatusBadge>
                </>
              }
              summary={`${m.claims.orderId} ${detailOrders.get(c.orderId) ?? (c.orderId ? m.claims.orderNumberUnknown : m.none)} · ${when(c.openedAt)}`}
            />
            {next && (
              <NextAction tone={next.tone} title={next.title} body={next.body}>
                <a className="btn btn-sm" href="#recovery-actions">
                  {m.claims.nextStep.go}
                </a>
              </NextAction>
            )}
            <div className="grid items-start gap-4 lg:grid-cols-3">
              <div className="min-w-0 space-y-4 lg:col-span-2">
                {/* 맨 위 운영 조치 — 반품 회수 조치(조건이 안 맞으면 칸이 없다) */}
                <div id="recovery-actions" className="scroll-mt-12 empty:hidden">
                  <RecoveryActions claim={c} />
                </div>

                <Section title={m.claims.lines} aside={<span className="text-base-content/55">{m.orders.lineCount((c.lines ?? []).length)}</span>}>
                  <DataTable>
                    <thead>
                      <tr>
                        <th>{m.claims.sku}</th>
                        <th className="text-right">{m.claims.requested}</th>
                        <th className="text-right">{m.claims.approved}</th>
                        <th>{m.claims.decision}</th>
                        <th className="text-right">{m.claims.refundAmount}</th>
                        <th>{m.claims.deadline}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(c.lines ?? []).map((l, i) => (
                        <tr key={l.claimLineId ?? `line-${i}`} data-testid="claim-line">
                          <td className="font-mono text-xs">{text(l.sku)}</td>
                          <td className="text-right tabular-nums">{text(l.requestedQty)}</td>
                          <td className="text-right tabular-nums">{text(l.approvedQty)}</td>
                          <td>
                            <StatusBadge tone={l.decision === 'APPROVED' ? 'success' : l.decision === 'REJECTED' ? 'error' : 'ghost'}>{l.decision ? <CodeLabel code={l.decision} names={m.claims.decisionName} /> : m.none}</StatusBadge>
                          </td>
                          <td className="text-right font-semibold tabular-nums">{won(l.refundAmount)}</td>
                          <td className="whitespace-nowrap text-xs">{when(l.windowDeadline)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                </Section>

                {c.type === 'RETURN' && (
                  <Section title={m.claims.sectionReturn}>
                    <ReturnProgress claim={c} />
                  </Section>
                )}

                <Section title={m.claims.refunds}>
                  <Notice>{m.claims.refundsNote}</Notice>
                  <div className="mt-3">
                    <Refunds claimId={claimId} />
                  </div>
                </Section>
              </div>

              <aside className="min-w-0 space-y-4">
                <Section title={m.claims.sectionBasic}>
                  <SideFields
                    testId="claim-summary"
                    rows={[
                      [m.claims.orderId, c.orderId ? <Link key="o" className="text-primary hover:underline" to={`/orders/${encodeURIComponent(c.orderId)}`}><DisplayNumber number={detailOrders.get(c.orderId)} systemId={c.orderId} failed={detailOrders.failed(c.orderId)} /></Link> : m.none],
                      [m.claims.reason, c.reason ? <CodeLabel key="r" code={c.reason} names={m.claims.reasonName} /> : m.none],
                      [m.claims.reasonDetail, text(c.reasonDetail)],
                      [m.claims.openedAt, <When key="o" iso={c.openedAt} />],
                      [m.claims.decidedAt, when(c.decidedAt)],
                      [m.claims.closedAt, when(c.closedAt)],
                    ]}
                  />
                  <p className="mt-4 border-t border-base-300 pt-3 text-xs text-base-content/55">{m.claims.noDecision}</p>
                </Section>
                <Section title={m.claims.sectionLogistics}>
                  <SideFields
                    rows={[
                      [
                        m.claims.pickup,
                        c.pickup ? (
                          <span key="p">
                            {c.pickup.state ? <CodeLabel code={c.pickup.state} names={m.claims.pickupStateName} /> : m.none}
                            {c.pickup.deliveryId ? ` · ${c.pickup.deliveryId}` : ''}
                          </span>
                        ) : (
                          m.none
                        ),
                      ],
                      [m.claims.reshipment, c.reshipment?.state ? <CodeLabel key="s" code={c.reshipment.state} names={m.claims.reshipmentStateName} /> : m.none],
                      [m.claims.fees, c.fees ? [won(c.fees.exchangeRoundTripFee), won(c.fees.returnPickupFee)].join(' / ') : m.none],
                    ]}
                  />
                </Section>
              </aside>
            </div>
          </>
          );
        }}
      </QueryState>
    </section>
  );
}

const TYPE_TONE: Readonly<Record<string, Tone>> = { CANCEL: 'error', RETURN: 'warning', EXCHANGE: 'info' };

/** 클레임 종류 꼬리표(색 + 그림) */
function ClaimTypeChip({ type }: { readonly type: string | null | undefined }) {
  if (!type) return null;
  return (
    <KindChip tone={TYPE_TONE[type] ?? 'ghost'} icon={type === 'CANCEL' ? 'alert' : 'return'}>
      <CodeLabel code={type} names={m.claims.typeName} />
    </KindChip>
  );
}
