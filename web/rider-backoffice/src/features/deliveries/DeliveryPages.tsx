// 배송 찾기 — 라이더 운영(RIDER_OPS)·운영 관리자.
// - 찾기: delivery-execution `GET /deliveries`(주문 ID·라이더 ID 완전 일치, 상태·종류, 정렬, cursor — execution 0.4.0 BOD-5). 개인정보 없음.
// - 상세: 수행 `GET /deliveries/{id}`(execution) + 배차 `GET /deliveries/{id}/dispatch`(dispatch) — 서로 다른 서비스의 값이라 따로 보인다.
// 1차(2026-11-17, PC 5): 보기만 — 배차 취소·전달 실패 확정은 다음 차례. 필터·쪽은 주소 쿼리에 둔다.
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/delivery-execution';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { DeliveryActions } from './DeliveryActions';

const m = messages.deliveries;
const n = messages.names;
const none = messages.none;
const name = (map: Readonly<Record<string, string>>, v: string | null | undefined) => (v ? (map[v] ?? v) : none);
const when = (iso: string | null | undefined) => (iso ? formatSeoul(iso) : none);

type ExecutionState = components['schemas']['ExecutionState'];
const STATES = Object.keys(n.executionState) as ExecutionState[];
const TYPES = ['FORWARD', 'RETURN', 'RESHIPMENT'] as const;
type DeliveryType = (typeof TYPES)[number];
const PAGE_SIZE = 20;

export function DeliveriesMenu() {
  return (
    <Routes>
      <Route index element={<DeliverySearchPage />} />
      <Route path=":deliveryId" element={<DeliveryDetailPage />} />
    </Routes>
  );
}

function DeliverySearchPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const orderId = params.get('orderId') ?? '';
  const orderNumber = params.get('orderNumber') ?? '';
  const riderId = params.get('riderId') ?? '';
  const rawState = params.get('state') ?? '';
  const state = (STATES as readonly string[]).includes(rawState) ? (rawState as ExecutionState) : undefined;
  const rawType = params.get('type') ?? '';
  const type = (TYPES as readonly string[]).includes(rawType) ? (rawType as DeliveryType) : undefined;
  const oldest = params.get('sort') === 'OLDEST';
  const cursor = params.get('cursor') ?? '';
  const [draft, setDraft] = useState({ orderId, orderNumber, riderId });

  const set = (next: Partial<{ orderId: string; orderNumber: string; riderId: string; state: string; type: string; oldest: boolean; cursor: string }>) => {
    const v = { orderId, orderNumber, riderId, state: state ?? '', type: type ?? '', oldest, cursor: '', ...next };
    setParams({
      ...(v.orderId ? { orderId: v.orderId } : {}),
      ...(v.orderNumber ? { orderNumber: v.orderNumber } : {}),
      ...(v.riderId ? { riderId: v.riderId } : {}),
      ...(v.state ? { state: v.state } : {}),
      ...(v.type ? { type: v.type } : {}),
      ...(v.oldest ? { sort: 'OLDEST' } : {}),
      ...(v.cursor ? { cursor: v.cursor } : {}),
    });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    set({ orderId: draft.orderId.trim(), orderNumber: draft.orderNumber.trim(), riderId: draft.riderId.trim() });
  };

  const query = useQuery({
    queryKey: ['deliveries', orderId, orderNumber, riderId, state, type, oldest, cursor],
    queryFn: () =>
      request(
        'GET',
        api.execution.GET('/deliveries', {
          params: {
            query: {
              size: PAGE_SIZE,
              ...(orderId ? { orderId } : {}),
              ...(orderNumber ? { orderNumber } : {}),
              ...(riderId ? { riderId } : {}),
              ...(state ? { state } : {}),
              ...(type ? { type } : {}),
              ...(oldest ? { sort: 'OLDEST' as const } : {}),
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
      <form className="flex flex-wrap items-end gap-3 rounded-box bg-base-100 p-3 text-sm" onSubmit={submit}>
        <label className="flex flex-col gap-1">
          {m.orderId}
          <input className="input input-sm w-44" value={draft.orderId} maxLength={64} onChange={(e) => setDraft({ ...draft, orderId: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          {ops.actions.orderNumber}
          <input className="input input-sm w-32" value={draft.orderNumber} maxLength={8} inputMode="numeric" onChange={(e) => setDraft({ ...draft, orderNumber: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          {m.riderId}
          <input className="input input-sm w-44" value={draft.riderId} maxLength={64} onChange={(e) => setDraft({ ...draft, riderId: e.target.value })} />
        </label>
        <button type="submit" className="btn btn-sm btn-primary">
          {m.search}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            setDraft({ orderId: '', orderNumber: '', riderId: '' });
            setParams({});
          }}
        >
          {m.reset}
        </button>
        <label className="flex flex-col gap-1">
          {m.state}
          <select className="select select-sm w-40" value={state ?? ''} onChange={(e) => set({ state: e.target.value })}>
            <option value="">{m.allStates}</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {name(n.executionState, s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {m.type}
          <select className="select select-sm w-32" value={type ?? ''} onChange={(e) => set({ type: e.target.value })}>
            <option value="">{m.allTypes}</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {name(n.deliveryType, t)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {m.sort}
          <select className="select select-sm w-36" value={oldest ? 'OLDEST' : 'NEWEST'} onChange={(e) => set({ oldest: e.target.value === 'OLDEST' })}>
            <option value="NEWEST">{m.newest}</option>
            <option value="OLDEST">{m.oldest}</option>
          </select>
        </label>
      </form>
      <QueryState state={toUiState(query, (r) => (r.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={m.empty}>
        {(r) => {
          const nextCursor = r.page?.nextCursor ?? null;
          return (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="table table-sm rounded-box bg-base-100">
                  <thead>
                    <tr>
                      <th>{m.col.delivery}</th>
                      <th>{m.col.order}</th>
                      <th>{m.col.type}</th>
                      <th>{m.col.state}</th>
                      <th>{m.col.rider}</th>
                      <th>{m.col.mfc}</th>
                      <th>{m.col.createdAt}</th>
                      <th>{m.col.completedAt}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(r.items ?? []).map((d, i) => (
                      <tr key={d.deliveryId ?? `d-${i}`} data-testid="delivery-row">
                        <td className="font-mono">
                          <Link className="link" to={`/deliveries/${encodeURIComponent(d.deliveryId ?? '')}`}>
                            {d.deliveryId ?? none}
                          </Link>
                        </td>
                        <td className="font-mono">{d.orderId ?? none}</td>
                        <td>{name(n.deliveryType, d.type)}</td>
                        <td>
                          {name(n.executionState, d.state)}
                          {d.resumeRequestedAt && <span className="badge badge-warning badge-sm ml-1">{m.resumeRequested}</span>}
                        </td>
                        <td className="font-mono">{d.riderId ?? <span className="opacity-70">{m.noRider}</span>}</td>
                        <td className="font-mono">{d.mfcId ?? none}</td>
                        <td>{when(d.createdAt)}</td>
                        <td>{when(d.completedAt)}</td>
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

function DeliveryDetailPage() {
  const api = useApi();
  const { deliveryId = '' } = useParams();
  const execution = useQuery({
    queryKey: ['delivery', deliveryId],
    queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}', { params: { path: { deliveryId } } })),
  });
  const dispatch = useQuery({
    queryKey: ['delivery-dispatch', deliveryId],
    queryFn: () => request('GET', api.dispatch.GET('/deliveries/{deliveryId}/dispatch', { params: { path: { deliveryId } } })),
  });
  return (
    <section className="max-w-4xl space-y-4">
      <Link className="link text-sm" to="/deliveries">
        {m.back}
      </Link>
      <h1 className="text-xl font-bold">{m.detailTitle(deliveryId)}</h1>
      <p role="note" className="alert alert-info text-sm">
        {m.viewOnlyNote}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h2 className="font-bold">{m.execution}</h2>
          <QueryState state={toUiState(execution)} onRetry={() => void execution.refetch()}>
            {(d) => (
              <div className="space-y-3">
                <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 rounded-box bg-base-100 p-4 text-sm" data-testid="execution-detail">
                  <dt className="opacity-70">{m.col.state}</dt>
                  <dd>{name(n.executionState, d.state)}</dd>
                  <dt className="opacity-70">{m.col.type}</dt>
                  <dd>{name(n.deliveryType, d.type)}</dd>
                  <dt className="opacity-70">{m.purpose}</dt>
                  <dd>{name(n.purpose, d.purpose)}</dd>
                  <dt className="opacity-70">{m.orderNumber}</dt>
                  <dd className="font-mono">{d.orderNumber ?? d.orderId ?? none}</dd>
                  <dt className="opacity-70">{m.col.mfc}</dt>
                  <dd>{d.mfcName ?? d.mfcId ?? none}</dd>
                  <dt className="opacity-70">{m.col.rider}</dt>
                  <dd className="font-mono">{d.riderId ?? m.noRider}</dd>
                  <dt className="opacity-70">{m.col.assignedAt}</dt>
                  <dd>{when(d.assignedAt)}</dd>
                  <dt className="opacity-70">{m.col.completedAt}</dt>
                  <dd>{when(d.completedAt)}</dd>
                </dl>
                {d.failure && (
                  <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 rounded-box bg-base-100 p-4 text-sm" data-testid="failure-detail">
                    <dt className="col-span-2 font-semibold">{m.failure}</dt>
                    <dt className="opacity-70">{m.failureReason}</dt>
                    <dd>{name(n.failureReason, d.failure.reason)}</dd>
                    <dt className="opacity-70">{m.decision}</dt>
                    <dd>{d.failure.decision ? `${name(n.decision, d.failure.decision)} (${when(d.failure.decidedAt)})` : none}</dd>
                    <dt className="opacity-70">{m.custody}</dt>
                    <dd>{name(n.custody, d.failure.custody)}</dd>
                    {d.failure.returnDeliveryId && (
                      <>
                        <dt className="opacity-70">{m.returnDelivery}</dt>
                        <dd className="font-mono">
                          <Link className="link" to={`/deliveries/${encodeURIComponent(d.failure.returnDeliveryId)}`}>
                            {d.failure.returnDeliveryId}
                          </Link>
                        </dd>
                      </>
                    )}
                  </dl>
                )}
                {(d.orderSummary?.items ?? []).length > 0 && (
                  <div className="rounded-box bg-base-100 p-4 text-sm">
                    <h3 className="mb-1 font-semibold">{m.items}</h3>
                    <ul className="list-disc pl-5" data-testid="order-items">
                      {(d.orderSummary?.items ?? []).map((it, i) => (
                        <li key={`${it.name ?? ''}-${i}`}>{`${[it.name, it.optionLabel].filter(Boolean).join(' ')} × ${it.qty ?? 0}`}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <h3 className="font-semibold">{m.history}</h3>
                  {(d.history ?? []).length === 0 ? (
                    <p className="text-sm opacity-70">{none}</p>
                  ) : (
                    <ol className="space-y-1 text-sm" data-testid="execution-history">
                      {(d.history ?? []).map((h, i) => (
                        <li key={`${h.occurredAt ?? ''}-${i}`}>{`${when(h.occurredAt)} · ${name(n.executionState, h.state)} · ${name(n.actor, h.actor)}`}</li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            )}
          </QueryState>
        </div>
        <div className="space-y-2">
          <h2 className="font-bold">{m.dispatch}</h2>
          <QueryState state={toUiState(dispatch)} onRetry={() => void dispatch.refetch()}>
            {(p) => (
              <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 rounded-box bg-base-100 p-4 text-sm" data-testid="dispatch-detail">
                <dt className="opacity-70">{m.col.state}</dt>
                <dd>{name(n.dispatchState, p.state)}</dd>
                <dt className="opacity-70">{m.col.rider}</dt>
                <dd className="font-mono">{p.assignment?.riderId ?? m.noRider}</dd>
                <dt className="opacity-70">{m.attempts}</dt>
                <dd>{m.attemptsCount((p.attempts ?? []).length)}</dd>
                <dt className="opacity-70">{m.arrivalWindow}</dt>
                <dd>{p.arrivalWindow ? [p.arrivalWindow.date, [p.arrivalWindow.start, p.arrivalWindow.end].filter(Boolean).join('~')].filter(Boolean).join(' ') || none : none}</dd>
              </dl>
            )}
          </QueryState>
        </div>
      </div>
      {execution.data && <DeliveryActions delivery={execution.data} dispatch={dispatch.data} />}
    </section>
  );
}
