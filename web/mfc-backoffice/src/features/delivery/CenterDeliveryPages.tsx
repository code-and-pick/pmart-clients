// 우리 센터 배송 현황·배차 실패 사건 — 센터 관리자(MFC_SUPERVISOR)
// (백엔드 요청 mfc-backoffice/2026-11-16-request-center-deliveries-and-dispatch-failures, bff 0.3.1·case 0.5.2, 배송 원문 §1·§3.6).
// - 배송 현황: bff `GET /backoffice/views/live-delivery?mfcId=<주소의 센터>&state=&size=50&cursor=` — 백오피스와 같은 API. 센터 관리자는 자기 센터로 고정
//   (다른 센터 403). 상태를 비우면 끝나지 않은 배송 전부 오래된 순 50건(넘으면 truncated), 상태를 고르면 page.nextCursor 로 다음 쪽. 1분마다 다시 읽는다.
//   배차 원천 실패면 "모름(조회 실패)", 사건 원천 실패(openCases null)면 "조회 실패"(0건과 구분). "약속 지남"은 서버 promisedAt < composedAt 일 때만.
// - 배차 실패: case `GET /cases?kind=DISPATCH_FAILED&centerId=`(열린 것 / state=CLOSED 닫힌 것) · `GET /cases/{caseId}` — 보기만.
//   집기·닫기는 없다(서버 403) — 처리는 지원센터(RIDER_OPS). 배차 쪽 사건에 센터가 실리기 전(DD-MFC)에는 0건이 정상이라 안내한다.
// - 배송·주문 상세 화면은 이 앱에 없어 번호만 보인다. 개인정보 없음.
import { useQuery } from '@tanstack/react-query';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import type { components as BffC } from '../../api/generated/backoffice-bff';
import type { components as CaseC } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';

const m = messages.centerDelivery;
const f = messages.dispatchFailures;
const none = messages.none;
const name = (map: Readonly<Record<string, string>>, v: string | null | undefined) => (v ? (map[v] ?? v) : none);
const when = (iso: string | null | undefined) => (iso ? formatSeoul(iso) : none);

// ---------------------------------------------------------------- 배송 현황

const ACTIVE_STATES = ['UNASSIGNED', 'ASSIGNED', 'ARRIVED_AT_STORE', 'PICKED_UP', 'ARRIVED_AT_CUSTOMER', 'FAILURE_REPORTED', 'SUSPENDED', 'RETURN_IN_PROGRESS', 'RETURN_PICKED_UP'] as const;
const PAGE_SIZE = 50;
const REFRESH_MS = 60_000;

type StampedState = BffC['schemas']['StampedState'];
interface OpenCase {
  readonly caseId?: string;
  readonly kind?: string;
  readonly priority?: string | null;
  readonly overdue?: boolean | null;
}
interface LiveItem {
  readonly deliveryId?: string;
  readonly orderId?: string;
  readonly type?: string | null;
  readonly delivery?: StampedState;
  readonly dispatch?: StampedState;
  readonly riderId?: string | null;
  readonly arrivalWindow?: Record<string, unknown> | null;
  readonly promisedAt?: string | null;
  readonly openCases?: readonly OpenCase[] | null;
}

function windowText(w: Record<string, unknown> | null | undefined): string {
  if (!w) return none;
  const s = (k: string) => (typeof w[k] === 'string' ? w[k] : '');
  const range = [s('start'), s('end')].filter(Boolean).join('~');
  return [s('date'), range].filter(Boolean).join(' ') || none;
}

/** `/c/:mfcId/deliveries` */
export function CenterDeliveriesMenu({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const raw = params.get('state') ?? '';
  const state = (ACTIVE_STATES as readonly string[]).includes(raw) ? raw : '';
  const cursor = state ? (params.get('cursor') ?? '') : '';
  const set = (next: { state?: string; cursor?: string }) => {
    const s = next.state ?? state;
    setParams({ ...(s ? { state: s } : {}), ...(s && next.cursor ? { cursor: next.cursor } : {}) });
  };
  const query = useQuery({
    queryKey: ['live-delivery', mfcId, state, cursor],
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      request(
        'GET',
        api.bff.GET('/views/live-delivery', { params: { query: { mfcId, size: PAGE_SIZE, ...(state ? { state } : {}), ...(cursor ? { cursor } : {}) } } }),
      ),
  });
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{m.title}</h1>
      <p className="text-sm opacity-70">{m.intro}</p>
      <div className="flex flex-wrap items-end gap-2 rounded-box bg-base-100 p-3 text-sm">
        <label className="flex flex-col gap-1">
          {m.state}
          <select className="select select-sm w-40" value={state} onChange={(e) => set({ state: e.target.value })}>
            <option value="">{m.activeStates}</option>
            {ACTIVE_STATES.map((s) => (
              <option key={s} value={s}>
                {name(m.executionState, s)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
          {m.refresh}
        </button>
        <span className="text-xs opacity-70">{m.autoRefreshNote}</span>
      </div>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(view) => {
          const items = (view.items ?? []) as readonly LiveItem[];
          const nextCursor = view.page?.nextCursor ?? null;
          const now = view.composedAt ? Date.parse(view.composedAt) : Number.NaN;
          return (
            <div className="space-y-3">
              {(view.unavailableSources?.length ?? 0) > 0 && (
                <p role="alert" className="alert alert-warning text-sm">{`${messages.unavailableSources}: ${(view.unavailableSources ?? []).join(', ')}`}</p>
              )}
              {view.truncated && (
                <p role="status" className="alert alert-info text-sm">
                  {m.truncated}
                </p>
              )}
              {items.length === 0 ? (
                <p data-state="empty" className="p-4 opacity-70">
                  {m.empty}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-sm rounded-box bg-base-100">
                    <thead>
                      <tr>
                        <th>{m.col.delivery}</th>
                        <th>{m.col.order}</th>
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
                        const late = !!it.promisedAt && Date.parse(it.promisedAt) < now;
                        const dispatchState = it.dispatch?.state ?? null;
                        return (
                          <tr key={it.deliveryId} data-testid="center-live-row">
                            <td className="font-mono">{it.deliveryId ?? none}</td>
                            <td className="font-mono">{it.orderId ?? none}</td>
                            <td>{name(m.typeName, it.type)}</td>
                            <td>{it.delivery?.state ? name(m.executionState, it.delivery.state) : <span className="text-warning">{m.unknown}</span>}</td>
                            <td data-testid="dispatch-state">{dispatchState ? name(m.dispatchState, dispatchState) : <span className="text-warning">{m.unknown}</span>}</td>
                            <td>{it.riderId ?? <span className="opacity-70">{m.noRider}</span>}</td>
                            <td>
                              {windowText(it.arrivalWindow)}
                              {late && <span className="badge badge-error badge-sm ml-1">{m.late}</span>}
                            </td>
                            <td data-testid="open-cases">
                              {it.openCases === null || it.openCases === undefined ? (
                                <span className="text-warning">{m.casesFailed}</span>
                              ) : it.openCases.length === 0 ? (
                                <span className="opacity-70">{none}</span>
                              ) : (
                                <ul className="space-y-1">
                                  {it.openCases.map((c) => (
                                    <li key={c.caseId}>
                                      {c.kind === 'DISPATCH_FAILED' && c.caseId ? (
                                        <Link className={`link ${c.overdue ? 'text-error' : ''}`} to={centerPath(mfcId, `dispatch-failures/${encodeURIComponent(c.caseId)}`)}>
                                          {`${f.kindName}${c.priority ? ` ${c.priority}` : ''}`}
                                        </Link>
                                      ) : (
                                        <span>{c.kind ?? none}</span>
                                      )}
                                      {c.overdue && <span className="badge badge-error badge-sm ml-1">{f.overdue}</span>}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {state && (cursor || nextCursor) && (
                <div className="flex gap-2">
                  {cursor && (
                    <button type="button" className="btn btn-sm" onClick={() => set({})}>
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
    </section>
  );
}

// ---------------------------------------------------------------- 배차 실패 사건(보기만)

type Case = CaseC['schemas']['Case'];

/** `/c/:mfcId/dispatch-failures/*` */
export function DispatchFailuresMenu({ mfcId }: { readonly mfcId: string }) {
  return (
    <Routes>
      <Route index element={<DispatchFailureListPage mfcId={mfcId} />} />
      <Route path=":caseId" element={<DispatchFailureDetailPage mfcId={mfcId} />} />
    </Routes>
  );
}

function Sla({ slaDueAt, overdue }: { readonly slaDueAt: string | null | undefined; readonly overdue: boolean | null | undefined }) {
  if (!slaDueAt) return <>{none}</>;
  return (
    <span className={overdue ? 'font-semibold text-error' : ''} data-overdue={overdue ? 'true' : 'false'}>
      {when(slaDueAt)}
      {overdue && ` · ${f.overdue}`}
    </span>
  );
}

const refsText = (refs: Case['refs']) =>
  (refs ?? [])
    .filter((r) => r.refType === 'deliveryId' || r.refType === 'orderId')
    .map((r) => `${name(f.refName, r.refType)} ${r.refId ?? ''}`)
    .join(' · ') || none;

function DispatchFailureListPage({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const closed = params.get('state') === 'CLOSED';
  const query = useQuery({
    queryKey: ['dispatch-failures', mfcId, closed],
    queryFn: () =>
      request('GET', api.cases.GET('/cases', { params: { query: { kind: 'DISPATCH_FAILED', centerId: mfcId, size: 50, ...(closed ? { state: 'CLOSED' as const } : {}) } } })),
  });
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{f.title}</h1>
      <p className="text-sm opacity-70">{f.intro}</p>
      <p role="note" className="alert alert-info text-sm">
        {f.handledBySupport}
      </p>
      <div role="tablist" className="tabs tabs-box w-fit">
        {([false, true] as const).map((c) => (
          <button key={String(c)} type="button" role="tab" aria-selected={c === closed} className={`tab ${c === closed ? 'tab-active' : ''}`} onClick={() => setParams(c ? { state: 'CLOSED' } : {})}>
            {c ? f.tabClosed : f.tabOpen}
          </button>
        ))}
      </div>
      <QueryState state={toUiState(query, (r) => (r.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={closed ? f.emptyClosed : f.emptyOpen}>
        {(r) => (
          <table className="table table-sm rounded-box bg-base-100">
            <thead>
              <tr>
                <th>{f.col.priority}</th>
                <th>{f.col.summary}</th>
                <th>{f.col.refs}</th>
                <th>{f.col.sla}</th>
                <th>{f.col.state}</th>
              </tr>
            </thead>
            <tbody>
              {(r.items ?? []).map((c, i) => (
                <tr key={c.caseId ?? `case-${i}`} data-testid="dispatch-failure-row" className={c.overdue ? 'bg-error/5' : ''}>
                  <td>
                    <span className={`badge badge-sm ${c.priority === 'P1' ? 'badge-error' : 'badge-ghost'}`}>{c.priority ?? none}</span>
                  </td>
                  <td>
                    <Link className="link" to={centerPath(mfcId, `dispatch-failures/${encodeURIComponent(c.caseId ?? '')}`)}>
                      {c.summary || f.kindName}
                    </Link>
                  </td>
                  <td className="font-mono text-xs">{refsText(c.refs)}</td>
                  <td>
                    <Sla slaDueAt={c.slaDueAt} overdue={c.overdue} />
                  </td>
                  <td>{name(f.stateName, c.state)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </QueryState>
      {!closed && <p className="text-xs opacity-70">{f.notYetNote}</p>}
    </section>
  );
}

function DispatchFailureDetailPage({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const { caseId = '' } = useParams();
  const query = useQuery({
    queryKey: ['dispatch-failure', caseId],
    queryFn: () => request('GET', api.cases.GET('/cases/{caseId}', { params: { path: { caseId } } })),
  });
  return (
    <section className="max-w-3xl space-y-4">
      <Link className="link text-sm" to={centerPath(mfcId, 'dispatch-failures')}>
        {f.back}
      </Link>
      <h1 className="text-xl font-bold">{f.detailTitle(caseId)}</h1>
      <p role="note" className="alert alert-info text-sm">
        {f.handledBySupport}
      </p>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(c) => (
          <div className="space-y-4">
            <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1 rounded-box bg-base-100 p-4 text-sm" data-testid="dispatch-failure-detail">
              <dt className="opacity-70">{f.col.summary}</dt>
              <dd>{c.summary || f.kindName}</dd>
              <dt className="opacity-70">{f.col.priority}</dt>
              <dd>{c.priority ?? none}</dd>
              <dt className="opacity-70">{f.col.state}</dt>
              <dd>{name(f.stateName, c.state)}</dd>
              <dt className="opacity-70">{f.col.refs}</dt>
              <dd className="font-mono">{refsText(c.refs)}</dd>
              <dt className="opacity-70">{f.openedAt}</dt>
              <dd>{when(c.openedAt)}</dd>
              <dt className="opacity-70">{f.col.sla}</dt>
              <dd>
                <Sla slaDueAt={c.slaDueAt} overdue={c.overdue} />
              </dd>
              <dt className="opacity-70">{f.assignee}</dt>
              <dd>{c.assigneeId ?? f.unassigned}</dd>
              {c.closure && (
                <>
                  <dt className="opacity-70">{f.closure}</dt>
                  <dd>{`${name(f.resolutionName, c.closure.resolution)}${c.closure.summary ? ` — ${c.closure.summary}` : ''} (${when(c.closure.closedAt)})`}</dd>
                </>
              )}
            </dl>
            <div>
              <h2 className="font-bold">{f.history}</h2>
              {(c.history ?? []).length === 0 ? (
                <p className="text-sm opacity-70">{none}</p>
              ) : (
                <ol className="space-y-1 text-sm" data-testid="dispatch-failure-history">
                  {(c.history ?? []).map((h, i) => (
                    <li key={`${h.at ?? ''}-${i}`}>
                      {`${when(h.at)} · ${name(f.actionName, h.action)}${h.toState ? ` → ${name(f.stateName, h.toState)}` : ''}${h.note ? ` — ${h.note}` : ''}`}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </QueryState>
    </section>
  );
}
