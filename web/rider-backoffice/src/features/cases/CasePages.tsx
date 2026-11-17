// 접수 건 — 라이더 운영(RIDER_OPS)·운영 관리자. case-service `GET /cases`·`GET /cases/{caseId}`(case 0.22.0).
// 보이는 범위는 서버가 정한다(RIDER_OPS = 배송 쪽 사건만 — RIDER_HELP·DELIVERY_INCIDENT·RIDER_LOCATION_STALE·MISDELIVERY·DISPATCH_FAILED).
// 1차(2026-11-17, PC 5): 보기만 — 맡기·이관·처리 끝내기는 다음 차례. 필터·쪽은 주소 쿼리에 둔다.
import { useQuery } from '@tanstack/react-query';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';

const m = messages.cases;
const n = messages.names;
const none = messages.none;
const name = (map: Readonly<Record<string, string>>, v: string | null | undefined) => (v ? (map[v] ?? v) : none);
const when = (iso: string | null | undefined) => (iso ? formatSeoul(iso) : none);

type CaseKind = components['schemas']['CaseKind'];
type CaseSummary = components['schemas']['CaseSummary'];

/** 라이더 운영이 다루는 배송 쪽 종류(서버 보이는 범위와 같다) */
export const DELIVERY_KINDS: readonly CaseKind[] = ['RIDER_HELP', 'DISPATCH_FAILED', 'RIDER_LOCATION_STALE', 'MISDELIVERY', 'DELIVERY_INCIDENT'];
const PAGE_SIZE = 50;

export function CasesMenu() {
  return (
    <Routes>
      <Route index element={<CaseListPage />} />
      <Route path=":caseId" element={<CaseDetailPage />} />
    </Routes>
  );
}

function Sla({ slaDueAt, overdue }: { readonly slaDueAt: string | null | undefined; readonly overdue: boolean | null | undefined }) {
  if (!slaDueAt) return <>{none}</>;
  return (
    <span className={overdue ? 'font-semibold text-error' : ''} data-overdue={overdue ? 'true' : 'false'}>
      {when(slaDueAt)}
      {overdue && ` · ${m.overdue}`}
    </span>
  );
}

function Refs({ refs }: { readonly refs: CaseSummary['refs'] }) {
  const shown = (refs ?? []).filter((r) => r.refId && (r.refType === 'deliveryId' || r.refType === 'orderId' || r.refType === 'riderId'));
  if (shown.length === 0) return <>{none}</>;
  return (
    <span className="space-x-2 font-mono text-xs">
      {shown.map((r) =>
        r.refType === 'deliveryId' ? (
          <Link key={`${r.refType}-${r.refId}`} className="link" to={`/deliveries/${encodeURIComponent(r.refId ?? '')}`}>
            {`${name(n.refType, r.refType)} ${r.refId}`}
          </Link>
        ) : (
          <span key={`${r.refType}-${r.refId}`}>{`${name(n.refType, r.refType)} ${r.refId}`}</span>
        ),
      )}
    </span>
  );
}

function CaseListPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const closed = params.get('state') === 'CLOSED';
  const rawKind = params.get('kind') ?? '';
  const kind = (DELIVERY_KINDS as readonly string[]).includes(rawKind) ? (rawKind as CaseKind) : undefined;
  const overdue = params.get('overdue') === 'true';
  const unassigned = params.get('unassigned') === 'true';
  const cursor = params.get('cursor') ?? '';
  const set = (next: Partial<{ state: string; kind: string; overdue: boolean; unassigned: boolean; cursor: string }>) => {
    const v = { state: closed ? 'CLOSED' : '', kind: kind ?? '', overdue, unassigned, cursor: '', ...next };
    setParams({
      ...(v.state ? { state: v.state } : {}),
      ...(v.kind ? { kind: v.kind } : {}),
      ...(v.overdue ? { overdue: 'true' } : {}),
      ...(v.unassigned ? { unassigned: 'true' } : {}),
      ...(v.cursor ? { cursor: v.cursor } : {}),
    });
  };
  const query = useQuery({
    queryKey: ['cases', closed, kind, overdue, unassigned, cursor],
    queryFn: () =>
      request(
        'GET',
        api.cases.GET('/cases', {
          params: {
            query: {
              size: PAGE_SIZE,
              ...(closed ? { state: 'CLOSED' as const } : {}),
              ...(kind ? { kind } : {}),
              ...(overdue ? { overdue: true } : {}),
              ...(unassigned ? { unassigned: true } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
  });
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{m.title}</h1>
      <p className="text-sm opacity-70">{m.intro}</p>
      <div role="tablist" className="tabs tabs-box w-fit">
        {([false, true] as const).map((c) => (
          <button key={String(c)} type="button" role="tab" aria-selected={c === closed} className={`tab ${c === closed ? 'tab-active' : ''}`} onClick={() => set({ state: c ? 'CLOSED' : '' })}>
            {c ? m.tabClosed : m.tabOpen}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-box bg-base-100 p-3 text-sm">
        <label className="flex flex-col gap-1">
          {m.kind}
          <select className="select select-sm w-44" value={kind ?? ''} onChange={(e) => set({ kind: e.target.value })}>
            <option value="">{m.allKinds}</option>
            {DELIVERY_KINDS.map((k) => (
              <option key={k} value={k}>
                {name(n.caseKind, k)}
              </option>
            ))}
          </select>
        </label>
        {!closed && (
          <>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="checkbox checkbox-sm" checked={overdue} onChange={(e) => set({ overdue: e.target.checked })} />
              {m.overdueOnly}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="checkbox checkbox-sm" checked={unassigned} onChange={(e) => set({ unassigned: e.target.checked })} />
              {m.unassignedOnly}
            </label>
          </>
        )}
      </div>
      <QueryState state={toUiState(query, (r) => (r.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={closed ? m.emptyClosed : m.emptyOpen}>
        {(r) => {
          const nextCursor = r.page?.nextCursor ?? null;
          return (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="table table-sm rounded-box bg-base-100">
                  <thead>
                    <tr>
                      <th>{m.col.priority}</th>
                      <th>{m.col.kind}</th>
                      <th>{m.col.summary}</th>
                      <th>{m.col.refs}</th>
                      <th>{m.col.sla}</th>
                      <th>{m.col.state}</th>
                      <th>{m.col.assignee}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(r.items ?? []).map((c, i) => (
                      <tr key={c.caseId ?? `case-${i}`} data-testid="case-row" className={c.overdue ? 'bg-error/5' : ''}>
                        <td>
                          <span className={`badge badge-sm ${c.priority === 'P1' ? 'badge-error' : 'badge-ghost'}`}>{c.priority ?? none}</span>
                        </td>
                        <td>{name(n.caseKind, c.kind)}</td>
                        <td>
                          <Link className="link" to={`/cases/${encodeURIComponent(c.caseId ?? '')}`}>
                            {c.summary || name(n.caseKind, c.kind)}
                          </Link>
                        </td>
                        <td>
                          <Refs refs={c.refs} />
                        </td>
                        <td>
                          <Sla slaDueAt={c.slaDueAt} overdue={c.overdue} />
                        </td>
                        <td>{name(n.caseState, c.state)}</td>
                        <td>{c.assigneeId ?? <span className="opacity-70">{m.unassigned}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(cursor || nextCursor) && (
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

function CaseDetailPage() {
  const api = useApi();
  const { caseId = '' } = useParams();
  const query = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => request('GET', api.cases.GET('/cases/{caseId}', { params: { path: { caseId } } })),
  });
  return (
    <section className="max-w-3xl space-y-4">
      <Link className="link text-sm" to="/cases">
        {m.back}
      </Link>
      <h1 className="text-xl font-bold">{m.detailTitle(caseId)}</h1>
      <p role="note" className="alert alert-info text-sm">
        {m.viewOnlyNote}
      </p>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(c) => (
          <div className="space-y-4">
            <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1 rounded-box bg-base-100 p-4 text-sm" data-testid="case-detail">
              <dt className="opacity-70">{m.col.kind}</dt>
              <dd>{name(n.caseKind, c.kind)}</dd>
              <dt className="opacity-70">{m.col.summary}</dt>
              <dd>{c.summary || none}</dd>
              <dt className="opacity-70">{m.col.priority}</dt>
              <dd>{c.priority ?? none}</dd>
              <dt className="opacity-70">{m.col.state}</dt>
              <dd>{name(n.caseState, c.state)}</dd>
              <dt className="opacity-70">{m.col.refs}</dt>
              <dd>
                <Refs refs={c.refs} />
              </dd>
              <dt className="opacity-70">{m.col.openedAt}</dt>
              <dd>{when(c.openedAt)}</dd>
              <dt className="opacity-70">{m.col.sla}</dt>
              <dd>
                <Sla slaDueAt={c.slaDueAt} overdue={c.overdue} />
              </dd>
              <dt className="opacity-70">{m.col.assignee}</dt>
              <dd>{c.assigneeId ?? m.unassigned}</dd>
              {c.closure && (
                <>
                  <dt className="opacity-70">{m.closure}</dt>
                  <dd>{`${name(n.resolution, c.closure.resolution)}${c.closure.summary ? ` — ${c.closure.summary}` : ''} (${when(c.closure.closedAt)})`}</dd>
                </>
              )}
            </dl>
            <div>
              <h2 className="font-bold">{m.history}</h2>
              {(c.history ?? []).length === 0 ? (
                <p className="text-sm opacity-70">{none}</p>
              ) : (
                <ol className="space-y-1 text-sm" data-testid="case-history">
                  {(c.history ?? []).map((h, i) => (
                    <li key={`${h.at ?? ''}-${i}`}>
                      {`${when(h.at)} · ${name(n.caseAction, h.action)}${h.toState ? ` → ${name(n.caseState, h.toState)}` : ''}${h.note ? ` — ${h.note}` : ''}`}
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
