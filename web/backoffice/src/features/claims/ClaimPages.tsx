// 클레임 조회(고객센터) — claim-service 0.1.0 `GET /claims`, `GET /claims/{id}`, `GET /claims/{id}/refunds`. 조회만.
// 클레임 결정(`POST …/decisions`)은 서버가 아직 501 — 화면에 넣지 않는다(요청서 §2). PG 환불 성공 전에는 "완료"로 보이지 않는다(서버 상태 그대로).
import type { components as BffC } from '../../api/generated/backoffice-bff';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState, uiStateFromError } from '@pmart/web-ui';
import type { components } from '../../api/generated/claim';
import { useApi } from '../../app/ApiContext';
import { ChipGroup, CodeLabel, DataTable, DetailHeader, NextAction, Notice, PageHeader, ResultBar, SearchPanel, SearchRow, Section, StatCard, StatStrip, StatusBadge, type Tone } from '../../shared/admin';
import { EmptyBox, KindChip, ListFoot, SideFields, When } from '../lookup/parts';
import { DisplayNumber, SystemNumbers } from '../../shared/displayNumber';
import { SavedViews } from '../../shared/SavedViews';
import { useRecordRecent } from '../../shared/recentViews';
import { messages as m } from '../../shared/messages';
import { isOrderNumber, orderIdOfNumber, useOrderNumbers } from '../../shared/numberLookups';
import { label, text, when, won } from '../../shared/ops';
import { PreviewDrawer, PreviewFacts, usePreview } from '../../shared/Preview';
import { availableActions, RecoveryActions, ReturnProgress } from './ReturnClaim';

type ClaimType = components['schemas']['ClaimType'];
type ClaimState = components['schemas']['ClaimState'];
type ClaimSummary = BffC['schemas']['ClaimListItem'];
/** 주문번호 원천(bff unavailableSources 이름) */
const ORDER_SOURCE = 'order-service';

const TYPES = Object.keys(m.claims.typeName) as ClaimType[];
const STATES = Object.keys(m.claims.stateName) as ClaimState[];
const isType = (v: string | null): v is ClaimType => v !== null && (TYPES as readonly string[]).includes(v);
const isState = (v: string | null): v is ClaimState => v !== null && (STATES as readonly string[]).includes(v);
/**
 * 클레임 화면 표기(ADR-0070 덧붙임 2026-11-19): 주문번호 + 종류(순번은 claim CL-4 뒤). 주문번호를 아직 모르면 종류 · 시각.
 * 시스템 ID(CLM-…)는 상세의 시스템 번호 칸에서만.
 */
export const claimLabel = (orderNumber: string | null | undefined, type: string | null | undefined, openedAt: string | null | undefined) =>
  orderNumber ? `${orderNumber} ${label(m.claims.typeName, type ?? null)}` : `${label(m.claims.typeName, type ?? null)} · ${openedAt ? when(openedAt) : m.none}`;

/** 상태 꼬리표 색(표시만) */
export const claimTone = (s: string | null | undefined): Tone =>
  s === 'CLOSED' ? 'success' : s === 'REJECTED' || s === 'CANCELLED' || s === 'WITHDRAWN' ? 'ghost' : s === 'RECOVERY_FAILED' ? 'error' : s === 'FEE_PENDING' || s === 'STOP_PENDING' ? 'warning' : 'info';

function useClaimList(filter: { orderId?: string | undefined; type?: ClaimType | undefined; state?: ClaimState | undefined }) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: ['claims', 'list', filter],
    queryFn: ({ pageParam }) =>
      request(
        'GET',
        // bff 0.18.0 `views/claims`(2026-11-19 백엔드 회신 — 웹 요청 display-numbers-in-responses): claim 줄 값 그대로 + 주문번호를 한 번에. 원천 권한(401·403·400)은 그대로 온다
        api.bff.GET('/views/claims', {
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

const cl = m.claims.listView;
/** 진행 단계(2026-11-19 쿠팡 윙 반품관리 "반품접수·반품진행·반품완료" 참고) — 서버 상태를 묶어 보일 뿐(판정은 서버 상태 그대로) */
export type Stage = 'opened' | 'progress' | 'contact' | 'done';
const STAGE_OF: Readonly<Record<string, Stage>> = {
  OPENED: 'opened',
  UNDER_REVIEW: 'progress',
  STOP_PENDING: 'progress',
  DECIDED: 'progress',
  IN_PROGRESS: 'progress',
  FEE_PENDING: 'progress',
  RECOVERY_FAILED: 'contact',
  CLOSED: 'done',
  WITHDRAWN: 'done',
  REJECTED: 'done',
  CANCELLED: 'done',
};
const stageOf = (st: string | null | undefined): Stage | undefined => (st ? STAGE_OF[st] : undefined);
const STAGES: readonly Stage[] = ['opened', 'progress', 'contact', 'done'];
const isStage = (v: string | null): v is Stage => v !== null && (STAGES as readonly string[]).includes(v);

/** 환불 칸 — 서버 요약 그대로(진행 중을 완료로 보이지 않는다) */
function RefundCell({ r }: { readonly r: ClaimSummary['refund'] }) {
  if (!r || r.state === 'NONE' || r.requestedAmount === undefined) return <span className="text-base-content/35">—</span>;
  const tone = r.state === 'COMPLETED' ? 'text-success' : r.state === 'FAILED' ? 'text-error' : 'text-warning';
  return (
    <span className="inline-flex flex-col items-end">
      <span className="font-semibold tabular-nums">{won(r.requestedAmount)}</span>
      <span className={`text-xs ${tone}`}>{r.state ? (cl.refundState[r.state as keyof typeof cl.refundState] ?? r.state) : m.none}</span>
    </span>
  );
}

function ClaimTable({ query, withCount = false, preview = false, stage }: { readonly query: ReturnType<typeof useClaimList>; readonly withCount?: boolean; readonly preview?: boolean; readonly stage?: Stage | undefined }) {
  const navigate = useNavigate();
  // 오른쪽 미리보기(2026-11-19 관제 형식) — 클레임 목록 화면에서만(주문 상세 안의 표는 전처럼 상세로)
  const pv = usePreview();
  const loaded: ClaimSummary[] = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  // 단계 카드로 거르기(2026-11-19) — 불러온 목록 안에서(서버는 상태 하나로만 거른다)
  const items = stage ? loaded.filter((c) => stageOf(c.state) === stage) : loaded;
  // 화면 주문번호 — bff 응답의 orderNumber(줄마다 따로 부르지 않는다). 주문 원천을 못 읽었으면 그 칸만 null + unavailableSources → "번호 확인 불가"
  const orderSourceFailed = (query.data?.pages ?? []).some((p) => (p.unavailableSources ?? []).includes(ORDER_SOURCE));
  const orders = {
    get: (id: string | null | undefined) => (id ? items.find((c) => c.orderId === id)?.orderNumber : undefined),
    failed: (id: string | null | undefined) => orderSourceFailed && !items.find((c) => c.orderId === id)?.orderNumber,
  };
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
      <EmptyBox icon="return" listPart={withCount && !preview}>
        {m.claims.empty}
      </EmptyBox>
    );
  // 목록(2026-11-18 Shopify·Medusa 목록처럼): 첫 칸 종류 색 꼬리표 + 클레임 번호, 상태 점 꼬리표, 주문 번호 작게, "N일 전" → 아래 건수·더 보기
  return (
    <>
      {withCount && !preview && <ResultBar count={items.length} more={query.hasNextPage} />}
      {preview && (
        <div className="flex flex-wrap items-center gap-3 border-b border-base-300 pb-3 text-sm">
          <h2 className="text-base font-bold">{stage ? cl.stage[stage] : cl.listTitle}</h2>
          <span className="text-base-content/60">{cl.total(items.length, Boolean(query.hasNextPage))}</span>
        </div>
      )}
      <DataTable>
        <thead>
          <tr>
            <th>{m.claims.detailTitle}</th>
            {preview && <th>{cl.col.reason}</th>}
            {preview && <th className="text-right">{cl.col.refund}</th>}
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
              {...(preview ? pv.row(c.claimId) : { className: c.claimId ? 'cursor-pointer' : undefined, onClick: () => c.claimId && void navigate(`/claims/${encodeURIComponent(c.claimId)}`) })}
            >
              <td>
                <span className="flex flex-wrap items-center gap-2">
                  <ClaimTypeChip type={c.type} />
                  {c.claimId ? (
                    <span className="font-mono font-semibold text-base-content" data-testid="claim-label">
                      {claimLabel(orders.get(c.orderId), c.type, c.openedAt)}
                    </span>
                  ) : (
                    m.none
                  )}
                </span>
                {preview && c.channel && <span className="mt-0.5 block text-xs text-base-content/45">{cl.channel[c.channel as keyof typeof cl.channel] ?? c.channel}</span>}
              </td>
              {preview && <td className="text-sm">{c.reason ? (m.claims.reasonName[c.reason] ?? c.reason) : m.none}</td>}
              {preview && (
                <td className="text-right text-sm" data-testid="claim-refund">
                  <RefundCell r={c.refund} />
                </td>
              )}
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
      {preview &&
        pv.id &&
        (() => {
          const c = items.find((x) => x.claimId === pv.id);
          return (
            <PreviewDrawer id={pv.id} ids={items.flatMap((x) => (x.claimId ? [x.claimId] : []))} onMove={pv.open} onClose={pv.close} title={(() => { const x = items.find((y) => y.claimId === pv.id); return x ? claimLabel(orders.get(x.orderId), x.type, x.openedAt) : m.claims.detailTitle; })()} detailTo={`/claims/${encodeURIComponent(pv.id)}`}>
              {c ? (
                <div className="space-y-4" data-testid="claim-preview">
                  <ClaimTypeChip type={c.type} />
                  <PreviewFacts
                    rows={[
                      [m.claims.state, <StatusBadge key="s" tone={claimTone(c.state)}>{c.state ? <CodeLabel code={c.state} names={m.claims.stateName} /> : m.none}</StatusBadge>],
                      [
                        m.claims.orderId,
                        c.orderId ? (
                          <Link key="o" className="link text-sm" to={`/orders/${encodeURIComponent(c.orderId)}`}>
                            <DisplayNumber number={orders.get(c.orderId)} systemId={c.orderId} failed={orders.failed(c.orderId)} />
                          </Link>
                        ) : (
                          m.none
                        ),
                      ],
                      // 사유·환불까지(2026-11-20 — 미리보기가 상태·주문·시각뿐이었다)
                      [cl.col.reason, c.reason ? (m.claims.reasonName[c.reason] ?? c.reason) : m.none],
                      [cl.col.refund, <RefundCell key="r" r={c.refund} />],
                      [m.claims.openedAt, when(c.openedAt)],
                    ]}
                  />
                </div>
              ) : null}
            </PreviewDrawer>
          );
        })()}
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
      const id = await orderIdOfNumber(api, order.replace(/[\s-]/g, '')).catch(() => undefined);
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

  // 단계 카드 숫자 — 거르기 없는 최근 목록 한 쪽으로 센다(넘치면 "+"). 서버가 단계별 수를 세 주지 않는다
  const recent = useClaimList({});
  const stageParam = search.get('stage');
  const stage = isStage(stageParam) ? stageParam : undefined;
  const recentItems = recent.data?.pages[0]?.items ?? [];
  const more = Boolean(recent.data?.pages[0]?.page?.nextCursor);
  const count = (st: Stage) => (recent.isPending ? '…' : recent.isError ? '?' : `${recentItems.filter((c) => stageOf(c.state) === st).length}${more ? '+' : ''}`);
  const stageTo = (st: Stage | '') => {
    const next = new URLSearchParams(search);
    if (st) next.set('stage', st);
    else next.delete('stage');
    return `/claims${next.toString() ? `?${next.toString()}` : ''}`;
  };

  // 2026-11-19 쿠팡 윙 반품관리 참고: 안내 상자 → 단계 숫자 카드 → 검색 조건(드롭다운) → 목록(사유·환불 칸)
  return (
    <section className="space-y-4">
      <PageHeader
        title={m.claims.title}
        actions={
          <Link className="btn btn-sm" to="/return-intake">
            {cl.newReturn}
          </Link>
        }
      />
      <div className="space-y-1.5">
        <StatStrip label={cl.stagesLabel} testId="claim-stages">
          <StatCard layout="row" label={cl.all} value={recent.isPending ? '…' : `${recentItems.length}${more ? '+' : ''}`} to={stageTo('')} active={!stage} testId="claim-stage-all" />
          {STAGES.map((st) => {
            const v = count(st);
            const has = /^[1-9]/.test(v);
            return (
              <StatCard
                key={st}
                layout="row"
                label={cl.stage[st]}
                value={v}
                tone={has ? (st === 'contact' ? 'error' : st === 'opened' ? 'warning' : st === 'progress' ? 'info' : undefined) : undefined}
                to={stageTo(st)}
                active={stage === st}
                testId={`claim-stage-${st}`}
              />
            );
          })}
        </StatStrip>
        <p className="text-xs text-base-content/50">{cl.basis}</p>
      </div>
      {/* 내 보기(2026-11-18 Saleor 참고) — 지금 주소 조건을 이름 붙여 저장 */}
      <SavedViews listKey="claims" />
      {/* 조건을 건 뒤에는 한 줄 칩으로 접힌다(2026-11-19 쿠팡 윙 반품관리 참고) */}
      <SearchPanel
        onSubmit={(e) => void submit(e)}
        onReset={() => setDraft({ orderId: '', type: '', state: '' })}
        submitLabel={m.claims.filter}
        resetLabel={m.claims.reset}
        summary={[
          [m.claims.orderId, orderId ? m.searchChip.oneOrder : ''],
          [m.claims.type, isType(type) ? (m.claims.typeName[type] ?? type) : ''],
          [m.claims.state, isState(state) ? (m.claims.stateName[state] ?? state) : ''],
        ]}
      >
        <SearchRow label={m.claims.orderId}>
          <input className="input input-sm w-56" aria-label={m.claims.orderId} placeholder={m.claims.orderFilterHint} value={draft.orderId} onChange={(e) => setDraft((d) => ({ ...d, orderId: e.target.value }))} />
          {notFound && (
            <span role="alert" className="text-xs text-warning">
              {m.claims.orderNumberNotFound(notFound)}
            </span>
          )}
        </SearchRow>
        <SearchRow label={m.claims.type}>
          <ChipGroup label={m.claims.type} value={draft.type} options={[{ value: '', label: m.claims.any }, ...TYPES.map((t) => ({ value: t, label: m.claims.typeName[t] ?? t }))]} onChange={(v) => setDraft((d) => ({ ...d, type: v }))} />
        </SearchRow>
        {/* 상태는 11가지라 칩 대신 고르기(2026-11-19 — 한 줄에 칩 12개는 읽기 힘들다). 단계는 위 카드로 */}
        <SearchRow label={m.claims.state}>
          <select className="select select-sm w-56" aria-label={m.claims.state} value={draft.state} onChange={(e) => setDraft((d) => ({ ...d, state: e.target.value }))}>
            <option value="">{m.claims.any}</option>
            {STATES.map((st) => (
              <option key={st} value={st}>
                {m.claims.stateName[st] ?? st}
              </option>
            ))}
          </select>
        </SearchRow>
      </SearchPanel>
      <ClaimTable query={query} withCount preview stage={stage} />
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
  // 최근 본 항목(2026-11-18) — 서버 응답을 받은 뒤에만 남긴다
  // 최근 본 항목 이름은 화면 번호·요약(2026-11-19 — 시스템 ID 를 이름으로 남기던 것 고침, ADR-0070 덧붙임)
  useRecordRecent('claim', claimId, query.data ? claimLabel(detailOrders.get(query.data.orderId), query.data.type, query.data.openedAt) : null);
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
                  <span className="ml-2 font-mono text-sm font-normal text-base-content/50" data-testid="claim-label">{claimLabel(detailOrders.get(c.orderId), c.type, c.openedAt)}</span>
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
            {/* 시스템 번호(ADR-0070 덧붙임) — 상세에서만 */}
            <SystemNumbers ids={[{ label: m.claims.detailTitle, id: claimId }, { label: m.displayNumber.system.orderId, id: c.orderId }]} />
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
