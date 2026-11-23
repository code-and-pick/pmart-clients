// 실시간 배송 현황 — bff 0.3.0 `GET /backoffice/views/live-delivery?mfcId=&state=&size=&cursor=`
// (백엔드 요청 backoffice/2026-11-16-request-live-delivery, PR #25, 배송 원문 §10.1).
// - OPERATOR_ADMIN·CS_AGENT·RIDER_OPS(서버 판정, 셋 다 모든 센터). 센터·상태·쪽은 URL 쿼리.
// - 상태를 비우면 끝나지 않은 배송 전부를 오래된 순 50건까지(쪽 넘김 없음, 넘으면 truncated). 상태를 주면 page.nextCursor 로 다음 쪽.
// - 수행 상태·배차 상태·열린 사건을 원천마다 따로 — 배차 원천 실패면 "모름", 사건 원천 실패(openCases null)면 "조회 실패"(0건과 구분).
// - "약속 지남"은 서버 promisedAt 이 서버 composedAt 보다 앞일 때 표시만(화면 시계를 쓰지 않음).
// - 화면 번호(bff 0.14.0, ADR-0070): 배송·주문 칸은 deliveryNumber·orderNumber, 라이더는 가린 이름 + 라이더 번호. 링크는 시스템 ID 로.
//   번호가 null 이면 시스템 ID 끝 8자리 회색 + "번호 없음", rider-service 를 못 읽었으면 라이더 칸 "번호 확인 불가"(원천 줄에도 보인다).
// - 자동 새로 고침 1분(요청서: 서버 부담 — 30초 이상 권장). 화면이 숨겨지면 멈춘다(TanStack Query 기본).
import { SearchSelect } from '../../shared/SearchSelect';
import { useNewIds } from '../../shared/motion';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/backoffice-bff';
import { useCenterScope, useSetCenterScope, CenterName } from '../../shared/centerScope';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { label, when } from '../../shared/ops';
import { SourceStamps } from '../../shared/SourceStamps';
import { CodeLabel, DataTable, NextAction, PageHeader, StatusBadge, useRowLink, AllDone } from '../../shared/admin';
import { executionTone } from '../deliveries/DeliveryPages';
import { EmptyBox, Icon, KindChip, UnderlineTabs } from '../lookup/parts';
import { DisplayNumber, RiderLabel, riderSourceFailed, type RiderDisplay } from '../../shared/displayNumber';

const m = messages.live;
const d = messages.deliveries;

/** 진행 중 상태(요청서 §1 — 비우면 서버가 이 상태들을 모은다). 고르기는 하나씩. */
const ACTIVE_STATES = [
  'UNASSIGNED',
  'ASSIGNED',
  'ARRIVED_AT_STORE',
  'PICKED_UP',
  'ARRIVED_AT_CUSTOMER',
  'FAILURE_REPORTED',
  'SUSPENDED',
  'RETURN_IN_PROGRESS',
  'RETURN_PICKED_UP',
] as const;
const PAGE_SIZE = 50;
const REFRESH_MS = 60_000;

type StampedState = components['schemas']['StampedState'];
interface OpenCase {
  readonly caseId?: string;
  /** bff 0.19.0 화면 번호(ADR-0070 덧붙임) */
  readonly caseNumber?: string | null;
  readonly kind?: string;
  readonly priority?: string | null;
  readonly overdue?: boolean | null;
}
interface LiveItem {
  readonly deliveryId?: string;
  readonly orderId?: string;
  readonly mfcId?: string | null;
  readonly type?: string | null;
  readonly delivery?: StampedState;
  readonly dispatch?: StampedState;
  readonly riderId?: string | null;
  /** bff 0.14.0 화면 번호(ADR-0070) — 원천 값 그대로, 없으면 null */
  readonly deliveryNumber?: string | null;
  readonly orderNumber?: string | null;
  readonly rider?: RiderDisplay;
  readonly arrivalWindow?: Record<string, unknown> | null;
  readonly promisedAt?: string | null;
  readonly openCases?: readonly OpenCase[] | null;
  /** bff 0.7.0 — tracking 고객 도착 예정(AVAILABLE 일 때만 값) */
  readonly latestEta?: string | null;
  readonly etaStatus?: string | null;
  readonly delayedBySeconds?: number | null;
  readonly etaSource?: { readonly confidence?: string } | null;
}

/**
 * 도착 예정(bff 0.7.0 — 백엔드 요청 backoffice/2026-11-17-request-live-delivery-eta). 숫자를 지어내지 않는다:
 * AVAILABLE + 값 → "도착 예정 HH:mm"(늦으면 "N분 늦음"), LOCATING·ETA_PENDING → "확인 중", tracking 장애 → "확인 불가", 그 밖(null·FINAL) → "—".
 */
function EtaLine({ it }: { readonly it: LiveItem }) {
  if (it.etaSource?.confidence === 'UNKNOWN')
    return (
      <div className="text-xs text-warning" data-testid="live-eta">
        {m.etaUnknown}
      </div>
    );
  if (it.etaStatus === 'AVAILABLE' && it.latestEta) {
    const late = (it.delayedBySeconds ?? 0) > 0 ? Math.ceil((it.delayedBySeconds ?? 0) / 60) : 0;
    return (
      <div className="text-xs" data-testid="live-eta">
        {m.eta(when(it.latestEta))}
        {late > 0 && <span className="ml-1 font-bold text-error">{m.etaLate(late)}</span>}
      </div>
    );
  }
  return (
    <div className="text-xs text-base-content/60" data-testid="live-eta">
      {it.etaStatus === 'LOCATING' || it.etaStatus === 'ETA_PENDING' ? m.etaChecking : m.etaNone}
    </div>
  );
}

/** arrivalWindow(date·start·end, 한국 시각 그대로) — 받은 값을 이어 붙이기만 */
function windowText(w: Record<string, unknown> | null | undefined): string {
  if (!w) return messages.none;
  const s = (k: string) => (typeof w[k] === 'string' ? w[k] : '');
  const range = [s('start'), s('end')].filter(Boolean).join('~');
  return [s('date'), range].filter(Boolean).join(' ') || messages.none;
}

export function LiveDeliveryPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  // 센터(2026-11-23): 주소의 mfcId(다른 화면 링크)가 먼저, 없으면 머리줄에서 고른 센터. 이 화면 센터 칸은 머리줄 센터 고르기와 같은 것
  const scope = useCenterScope();
  const setScope = useSetCenterScope();
  const urlMfc = params.get('mfcId') ?? '';
  const mfcId = urlMfc || scope;
  const state = params.get('state') ?? '';
  // 먼저 확인 카드로 거르기(2026-11-19) — 읽어 온 줄 안에서(late·noRider·withCases). 서버 상태 거르기는 state
  const focus = (['late', 'noRider', 'withCases'] as const).find((x) => x === params.get('focus'));
  const cursor = state ? (params.get('cursor') ?? '') : '';
  const set = (next: { mfcId?: string; state?: string; cursor?: string; focus?: string }) => {
    const merged = { mfcId: urlMfc, state, cursor: '', focus: '', ...next };
    const out: Record<string, string> = {};
    if (merged.mfcId) out.mfcId = merged.mfcId;
    if (merged.state) out.state = merged.state;
    if (merged.state && merged.cursor) out.cursor = merged.cursor;
    if (merged.focus) out.focus = merged.focus;
    setParams(out);
  };

  const centers = useQuery({
    queryKey: ['centers', 'MFC'],
    queryFn: async () => (await request('GET', api.center.GET('/centers', { params: { query: { type: 'MFC' } } }))).items ?? [],
  });
  const query = useQuery({
    queryKey: ['bff', 'live-delivery', mfcId, state, cursor],
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      request(
        'GET',
        api.bff.GET('/views/live-delivery', {
          params: { query: { size: PAGE_SIZE, ...(mfcId ? { mfcId } : {}), ...(state ? { state } : {}), ...(cursor ? { cursor } : {}) } },
        }),
      ),
  });

  // 카드 숫자는 상태 거르기 없는 목록으로(상태 탭을 골라도 단계별 수가 그대로) — 상태를 안 골랐으면 위 조회와 같은 캐시
  const all = useQuery({
    queryKey: ['bff', 'live-delivery', mfcId, '', ''],
    refetchInterval: REFRESH_MS,
    queryFn: () => request('GET', api.bff.GET('/views/live-delivery', { params: { query: { size: PAGE_SIZE, ...(mfcId ? { mfcId } : {}) } } })),
  });
  // 화면(2026-11-18 관제 화면처럼): 머리(새로 고침) → 숫자 카드(읽은 줄을 센 값) → 한 카드(수행 상태 탭 → 센터 → 표 → 쪽)
  return (
    <section className="space-y-4">
      <PageHeader
        title={m.title}
        actions={
          <>
            <span className={`h-2 w-2 rounded-full ${query.isFetching ? 'animate-pulse bg-info' : 'bg-success'}`} title={m.autoRefreshNote} aria-label={m.autoRefreshNote} role="img" />
            <button type="button" className="btn btn-sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
              {m.refresh}
            </button>
          </>
        }
      />
      {/* 2026-11-19 쿠팡 윙 배송관리 참고: "먼저 확인하고 처리해 주세요" + "배송 진행 단계" 두 줄 카드 */}
      {all.isSuccess && <LiveBoards items={all.data.items ?? []} composedAt={all.data.composedAt} state={state} focus={focus} onState={(st) => set({ state: st })} onFocus={(fx) => set({ focus: fx })} />}
      {/* 읽는 동안 카드 자리를 미리 잡는다 — 데이터가 온 뒤에 카드가 생기며 아래 표가 한꺼번에 밀려 내려가던 것(2026-11-20 화면 점검) */}
      {all.isPending && <LiveBoardsSkeleton />}
      {/* 다음 할 일은 카드와 같은 거르기 없는 목록으로 — 상태 탭을 바꿀 때마다 띠가 사라졌다 생기며 표가 위아래로 움직이던 것 */}
      {all.isSuccess && <LiveNext items={all.data.items ?? []} />}
      <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
        <UnderlineTabs
          label={m.state}
          value={state}
          options={[{ value: '', label: m.activeStates }, ...ACTIVE_STATES.map((s) => ({ value: s, label: label(d.executionState, s) }))]}
          onChange={(v) => set({ state: v })}
        />
        <div className="flex flex-wrap items-center gap-3 border-b border-base-300 bg-base-200/40 px-4 py-2.5 text-sm" role="group" aria-label={m.filters}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-base-content/55">{m.center}</span>
            {/* 쳐서 찾는 고르기(2026-11-19 — 센터가 늘어도 이름·센터 코드로 바로) */}
            <SearchSelect label={m.center} className="w-56" value={mfcId} allowEmpty={m.allCenters} options={(centers.data ?? []).flatMap((c) => (c.centerId ? [{ value: c.centerId, label: c.name ?? c.centerId, hint: c.centerId, keywords: c.centerId }] : []))} loading={centers.isPending} onChange={(v) => { setScope(v); set({ mfcId: '' }); }} />
          </div>
          {centers.isError && (
            <p role="alert" className="text-xs text-warning">
              {m.centersFailed}
            </p>
          )}
        </div>
        <div className="space-y-3 p-3">
          <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
            {(view) => {
              const rows = (view.items ?? []) as readonly LiveItem[];
              const items = focus ? rows.filter((it) => matchFocus(it, focus, view.composedAt)) : rows;
              const nextCursor = view.page?.nextCursor ?? null;
              return (
                <div className="space-y-3">
                  <SourceStamps sources={view.sources} unavailableSources={view.unavailableSources} />
                  {view.casesTruncated && (
                    <p role="status" className="alert alert-warning alert-soft text-sm" data-state="cases-truncated">
                      {m.casesTruncated}
                    </p>
                  )}
                  {view.truncated && (
                    <p role="status" className="alert alert-info alert-soft text-sm" data-state="truncated">
                      {m.truncated}
                    </p>
                  )}
                  {items.length === 0 ? (
                    <div data-state="empty">
                      <EmptyBox icon="truck">{m.empty}</EmptyBox>
                    </div>
                  ) : (
                    <LiveTable items={items} composedAt={view.composedAt} casesTruncated={view.casesTruncated ?? false} riderFailed={riderSourceFailed(view.unavailableSources)} />
                  )}
                  {state && (cursor || nextCursor) && (
                    <div className="flex justify-end gap-2">
                      {cursor && (
                        <button type="button" className="btn btn-sm" onClick={() => set({ cursor: '' })}>
                          {m.first}
                        </button>
                      )}
                      {nextCursor && (
                        <button type="button" className="btn btn-sm" onClick={() => set({ cursor: nextCursor })}>
                          {m.next}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            }}
          </QueryState>
        </div>
      </div>
    </section>
  );
}

/** "약속 지남" — 서버 promisedAt 이 서버 composedAt 보다 앞일 때만(화면 시계를 쓰지 않음) */
const isLate = (it: LiveItem, composedAt: string | undefined) => {
  const now = composedAt ? Date.parse(composedAt) : Number.NaN;
  return !!it.promisedAt && Date.parse(it.promisedAt) < now;
};

type Focus = 'late' | 'noRider' | 'withCases';
const matchFocus = (it: LiveItem, fx: Focus, composedAt: string | undefined) =>
  fx === 'late' ? isLate(it, composedAt) : fx === 'noRider' ? !it.riderId : (it.openCases ?? []).length > 0;
/** 진행 단계(카드 둘째 줄) — 서버 수행 상태 그대로, 앞에서 뒤 순서 */
const FLOW = ['UNASSIGNED', 'ASSIGNED', 'ARRIVED_AT_STORE', 'PICKED_UP', 'ARRIVED_AT_CUSTOMER'] as const;

/**
 * 두 줄 카드(2026-11-19 쿠팡 윙 배송관리 참고) — 이 화면에 읽어 온 줄을 센다(전체 건수 아님, 아래에 적음).
 * 위: 먼저 확인할 것(약속 시간 지남 = 서버 promisedAt < 서버 composedAt, 전달 실패 등록, 라이더 없음, 처리 중 접수 건). 모두 0 이면 "다 처리됐어요".
 * 아래: 진행 단계별 수 — 누르면 그 상태로. 접수 건을 못 읽은 줄은 0 으로 세지 않고 따로 알린다.
 */
/** 숫자 카드 두 줄의 자리(읽는 중) — LiveBoards 와 같은 높이 */
function LiveBoardsSkeleton() {
  const row = (n: number, key: string) => (
    <div className="pm-stat-strip flex flex-wrap gap-px overflow-hidden rounded-box border border-base-300 bg-base-300">
      {Array.from({ length: n }, (_, i) => (
        <div key={`${key}-${i}`} className="h-[86px] bg-base-100">
          <div className="skeleton m-3.5 h-4 w-24" />
        </div>
      ))}
    </div>
  );
  return (
    <div className="space-y-4" aria-busy="true" data-testid="live-kpis-loading">
      <div className="space-y-2">
        <div className="skeleton h-5 w-40" />
        {row(4, 'first')}
      </div>
      <div className="space-y-2">
        <div className="skeleton h-5 w-28" />
        {row(5, 'flow')}
        <div className="skeleton h-4 w-64" />
      </div>
    </div>
  );
}

function LiveBoards({
  items,
  composedAt,
  state,
  focus,
  onState,
  onFocus,
}: {
  readonly items: readonly LiveItem[];
  readonly composedAt: string | undefined;
  readonly state: string;
  readonly focus: Focus | undefined;
  readonly onState: (st: string) => void;
  readonly onFocus: (fx: string) => void;
}) {
  const b = m.boards;
  const late = composedAt ? items.filter((it) => isLate(it, composedAt)).length : null;
  const failed = items.filter((it) => it.delivery?.state === 'FAILURE_REPORTED').length;
  const noRider = items.filter((it) => !it.riderId).length;
  const casesKnown = items.filter((it) => it.openCases !== null && it.openCases !== undefined);
  const withCases = casesKnown.filter((it) => (it.openCases ?? []).length > 0).length;
  const casesUnknown = items.length - casesKnown.length;
  const byState = (st: string) => items.filter((it) => it.delivery?.state === st).length;
  const card = (key: string, label: string, value: number | null, tone: 'error' | 'warning', active: boolean, onClick: () => void, hint?: string) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={`live-first-${key}`}
      className="relative bg-base-100 px-5 py-4 text-left transition-colors hover:bg-base-200/50"
    >
      <span className="flex items-center gap-1.5 text-sm text-base-content/70">
        {value !== null && value > 0 && <span className={`h-1.5 w-1.5 rounded-full ${tone === 'error' ? 'bg-error' : 'bg-warning'}`} aria-hidden="true" />}
        {label}
      </span>
      <span className={`mt-0.5 block text-[26px] font-semibold leading-tight tracking-tight ${value === null ? 'text-base-content/40' : value > 0 ? (tone === 'error' ? 'text-error' : '') : 'text-base-content/45'}`}>{value === null ? messages.none : value}</span>
      {hint && <span className="block text-[11px] text-base-content/50">{hint}</span>}
    </button>
  );
  const allClear = late === 0 && failed === 0 && noRider === 0 && withCases === 0 && casesUnknown === 0;
  return (
    <div className="space-y-4" data-testid="live-kpis">
      <section aria-label={b.firstTitle} className="space-y-2">
        <h2 className="text-sm font-bold">{b.firstTitle}</h2>
        {allClear && items.length > 0 ? (
          <AllDone title={b.allClear} body={b.allClearBody(items.length)} testId="live-all-clear" />
        ) : (
          <div className="pm-stat-strip flex flex-wrap gap-px overflow-hidden rounded-box border border-base-300 bg-base-300">
            {card('late', m.kpi.late, late, 'error', focus === 'late', () => onFocus(focus === 'late' ? '' : 'late'))}
            {card('failed', b.failed, failed, 'error', state === 'FAILURE_REPORTED', () => onState(state === 'FAILURE_REPORTED' ? '' : 'FAILURE_REPORTED'))}
            {card('noRider', m.kpi.noRider, noRider, 'warning', focus === 'noRider', () => onFocus(focus === 'noRider' ? '' : 'noRider'))}
            {card('withCases', m.kpi.withCases, withCases, 'warning', focus === 'withCases', () => onFocus(focus === 'withCases' ? '' : 'withCases'), casesUnknown > 0 ? m.kpi.casesUnknown(casesUnknown) : undefined)}
          </div>
        )}
      </section>
      <section aria-label={b.flowTitle} className="space-y-2">
        <h2 className="text-sm font-bold">{b.flowTitle}</h2>
        <ol className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="live-flow">
          {FLOW.map((st, i) => (
            <li key={st} className="relative">
              <button
                type="button"
                onClick={() => onState(state === st ? '' : st)}
                aria-pressed={state === st}
                data-testid={`live-flow-${st}`}
                className={`w-full rounded-box border px-4 py-3.5 text-left transition hover:-translate-y-0.5 ${state === st ? 'border-primary bg-primary/5' : 'border-base-300 bg-base-100'}`}
              >
                <span className="block text-sm font-semibold">{label(d.executionState, st)}</span>
                <span className="mt-1 block text-2xl font-bold tabular-nums">{byState(st)}</span>
              </button>
              {i < FLOW.length - 1 && (
                <span className="pointer-events-none absolute -right-2.5 top-1/2 z-10 hidden -translate-y-1/2 text-base-content/45 md:block" aria-hidden="true">
                  ›
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className="text-xs text-base-content/50">{b.basis(items.length)}</p>
      </section>
    </div>
  );
}

/**
 * 다음 할 일(2026-11-18 "지금 뭘 해야 하는지 안 보인다") — 읽어 온 줄 중 서버 수행 상태가 전달 실패 등록(FAILURE_REPORTED)인 것이 있으면
 * 배송 확인의 "전달 실패 확정 대기" 빠른 보기로. 건수는 이 화면에 읽은 줄 기준(숫자 카드와 같음). 없으면 그리지 않는다.
 */
function LiveNext({ items }: { readonly items: readonly LiveItem[] }) {
  const n = items.filter((it) => it.delivery?.state === 'FAILURE_REPORTED').length;
  if (n === 0) return null;
  return (
    <NextAction tone="warning" title={m.nextStep.failureTitle(n)}>
      <Link className="btn btn-sm btn-warning" to="/deliveries?q=1&state=FAILURE_REPORTED&sort=OLDEST">
        {m.nextStep.failureGo}
      </Link>
    </NextAction>
  );
}

function LiveTable({ items, composedAt, casesTruncated = false, riderFailed = false }: { readonly items: readonly LiveItem[]; readonly composedAt: string | undefined; readonly casesTruncated?: boolean; readonly riderFailed?: boolean }) {
  const rowLink = useRowLink();
  // 새로 들어온 배송 줄 — 5초 동안 강조(2026-11-19). 거르기·쪽이 바뀌면 다시 센다
  const [params] = useSearchParams();
  const fresh = useNewIds(items.flatMap((it) => (it.deliveryId ? [it.deliveryId] : [])), params.toString());
  return (
    <DataTable>
      <thead>
        <tr>
          <th>{m.col.delivery}</th>
          <th>{m.col.type}</th>
          <th>{m.col.execution}</th>
          <th>{m.col.dispatch}</th>
          <th>{m.col.rider}</th>
          <th>{m.col.window}</th>
          <th>{m.col.cases}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => {
          const late = isLate(it, composedAt);
          const dispatchState = it.dispatch?.state ?? null;
          return (
            <tr key={it.deliveryId} data-testid="live-row" {...(it.deliveryId ? rowLink(`/deliveries/${encodeURIComponent(it.deliveryId)}`) : {})} className={`cursor-pointer ${late ? 'bg-error/5' : ''} ${it.deliveryId && fresh.has(it.deliveryId) ? 'row-new' : ''}`} data-new={it.deliveryId && fresh.has(it.deliveryId) ? 'true' : undefined}>
              {/* 첫 칸: 배송 번호 굵게 + 주문 번호 작게 — 화면 번호(bff 0.14.0, ADR-0070), 링크는 시스템 ID */}
              <td>
                <span className="block font-semibold" data-testid="live-delivery">
                  {it.deliveryId ? (
                    <Link className="text-base-content hover:text-primary hover:underline" to={`/deliveries/${encodeURIComponent(it.deliveryId)}`}>
                      <DisplayNumber number={it.deliveryNumber} systemId={it.deliveryId} />
                    </Link>
                  ) : (
                    <DisplayNumber number={it.deliveryNumber} />
                  )}
                </span>
                <span className="mt-0.5 block text-xs font-normal text-base-content/60" data-testid="live-order">
                  {it.orderId ? (
                    <Link className="hover:text-primary hover:underline" to={`/orders/${encodeURIComponent(it.orderId)}`}>
                      <DisplayNumber number={it.orderNumber} systemId={it.orderId} />
                    </Link>
                  ) : (
                    <DisplayNumber number={it.orderNumber} />
                  )}
                </span>
              </td>
              <td>
                <span className="flex flex-col items-start gap-1">
                  {it.type ? <KindChip icon={it.type === 'FORWARD' ? 'truck' : 'return'}><CodeLabel code={it.type} names={d.typeName} /></KindChip> : messages.none}
                  <span className="flex items-center gap-1 text-xs text-base-content/55">
                    <Icon name="store" className="h-3 w-3" />
                    <CenterName id={it.mfcId} />
                  </span>
                </span>
              </td>
              <td>{it.delivery?.state ? <StatusBadge tone={executionTone(it.delivery.state)}><CodeLabel code={it.delivery.state} names={d.executionState} /></StatusBadge> : <span className="text-warning">{m.unknown}</span>}</td>
              <td data-testid="dispatch-state">{dispatchState ? <StatusBadge tone="neutral"><CodeLabel code={dispatchState} names={d.dispatchState} /></StatusBadge> : <span className="text-warning">{m.unknown}</span>}</td>
              <td data-testid="live-rider">{it.rider?.riderId || it.riderId ? <RiderLabel rider={it.rider} riderId={it.riderId} failed={riderFailed} /> : <StatusBadge tone="warning">{m.noRider}</StatusBadge>}</td>
              <td className="min-w-40">
                <span className="flex flex-wrap items-center gap-1">
                  {windowText(it.arrivalWindow)}
                  {late && <span className="badge badge-error badge-sm">{m.late}</span>}
                </span>
                {it.promisedAt && <div className="text-xs text-base-content/60">{when(it.promisedAt)}</div>}
                <EtaLine it={it} />
              </td>
              <td data-testid="open-cases">
                {it.openCases === null || it.openCases === undefined ? (
                  // bff 0.9.2: 열린 사건을 1,000건까지만 읽었으면(casesTruncated) null = 모름 — 실패가 아니라 확인 불가
                  <span className="text-warning">{casesTruncated ? m.casesUnknown : m.casesFailed}</span>
                ) : it.openCases.length === 0 ? (
                  <span className="opacity-70">{messages.none}</span>
                ) : (
                  <ul className="space-y-1">
                    {it.openCases.map((c) => (
                      <li key={c.caseId} className="flex flex-wrap items-center gap-1">
                        <Link className={`text-sm hover:underline ${c.overdue ? 'font-semibold text-error' : 'text-primary'}`} to={`/cases/${encodeURIComponent(c.caseId ?? '')}`}>
                          {`${c.caseNumber ? `${c.caseNumber} ` : ''}${label(messages.cases.kindName, c.kind)}${c.priority ? ` ${c.priority}` : ''}`}
                        </Link>
                        {c.overdue && <span className="badge badge-error badge-sm">{m.overdue}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}
