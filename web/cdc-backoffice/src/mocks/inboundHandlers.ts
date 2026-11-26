// cdc-inbound 0.2.0 목 — 적치·보충 작업 목록(cursor)·지시·취소, 피킹 선반 보충 판단(가짜 시연 값).
// 지시는 바로 DISPATCHED(설비 대기). 출발=목적 칸이면 409 DESTINATION_INVALID(목 — 실서버 판정은 더 많다).
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components } from '../api/generated/cdc-inbound';
import { idempotent, operator, problem, unauthorized } from './support';

type S = components['schemas'];
type Task = S['PutawayTask'];

function seed() {
  const tasks: Task[] = [
    {
      taskId: 'PT-0003',
      cdcId: 'CDC01',
      kind: 'PUTAWAY',
      state: 'PARTIALLY_COMPLETED',
      sku: 'SKU-2001',
      lot: 'LOT-O1',
      qualityState: 'RELEASED',
      fromLocationCode: 'CDC01-C-5-10-01-1-1',
      toLocationCode: 'CDC01-C-5-12-02-1-1',
      qty: 40,
      completedQty: 24,
      reservationId: 'RSV-3',
      deviceId: 'FORK-02',
      createdBy: 'OP-cdc-sup',
      reason: '입고 팔레트 정리',
      failureReason: null,
      results: [{ eventId: 'EV-31', status: 'PARTIAL', completedQty: 24, state: 'APPLIED', commitId: 'CM-31', rejectReason: null, receivedAt: '2026-11-26T00:25:00Z' }],
      createdAt: '2026-11-26T00:10:00Z',
      updatedAt: '2026-11-26T00:25:00Z',
    },
    {
      taskId: 'PT-0002',
      cdcId: 'CDC01',
      kind: 'REPLENISHMENT',
      state: 'DISPATCHED',
      sku: 'SKU-1001',
      lot: 'LOT-A1',
      qualityState: 'RELEASED',
      fromLocationCode: 'CDC01-A-5-01-03-2-1',
      toLocationCode: 'CDC01-A-5-63-01-2-1',
      qty: 24,
      completedQty: 0,
      reservationId: 'RSV-2',
      deviceId: null,
      createdBy: 'SYSTEM',
      reason: null,
      failureReason: null,
      results: [],
      createdAt: '2026-11-26T00:05:00Z',
      updatedAt: '2026-11-26T00:05:00Z',
    },
    {
      taskId: 'PT-0001',
      cdcId: 'CDC01',
      kind: 'PUTAWAY',
      state: 'COMPLETED',
      sku: 'SKU-1003',
      lot: 'LOT-C2',
      qualityState: 'RELEASED',
      fromLocationCode: 'CDC01-C-7-90-01-1-1',
      toLocationCode: 'CDC01-C-7-01-01-1-1',
      qty: 12,
      completedQty: 12,
      reservationId: 'RSV-1',
      deviceId: 'FORK-01',
      createdBy: 'OP-cdc-sup',
      reason: null,
      failureReason: null,
      results: [{ eventId: 'EV-11', status: 'DONE', completedQty: 12, state: 'APPLIED', commitId: 'CM-11', rejectReason: null, receivedAt: '2026-11-25T23:50:00Z' }],
      createdAt: '2026-11-25T23:30:00Z',
      updatedAt: '2026-11-25T23:50:00Z',
    },
  ];
  const checks: S['ReplenishmentCheck'][] = [
    { locationCode: 'CDC01-A-5-63-01-2-1', sku: 'SKU-1001', currentQty: 4, minQty: 10, targetQty: 30, openQty: 0, needQty: 26, orderedQty: 24, unitQty: 12, reason: 'CREATED', taskId: 'PT-0002', checkedAt: '2026-11-26T00:05:00Z' },
    { locationCode: 'CDC01-B-6-67-01-1-1', sku: 'SKU-1002', currentQty: 3, minQty: 6, targetQty: 20, openQty: null, needQty: null, orderedQty: null, unitQty: null, reason: 'UNIT_MISSING', taskId: null, checkedAt: '2026-11-26T00:05:00Z' },
    { locationCode: 'CDC01-C-7-01-01-1-1', sku: 'SKU-1003', currentQty: 18, minQty: 6, targetQty: 24, openQty: 0, needQty: 0, orderedQty: 0, unitQty: 6, reason: 'ABOVE_MIN', taskId: null, checkedAt: '2026-11-26T00:05:00Z' },
  ];
  return { tasks, checks, seq: 3 };
}

let store = seed();
export function resetInbound() {
  store = seed();
}

function guard(request: Request, cdcId: string) {
  const who = operator(request);
  if (!who) return unauthorized();
  if (!who.centers.includes(cdcId)) return problem(403, 'FORBIDDEN');
  return null;
}

export const inboundHandlers = [
  http.get(`${API_BASE}/cdcs/:cdcId/putaway-tasks`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const kind = q.get('kind');
    const state = q.get('state');
    const size = Number(q.get('size') ?? '50');
    const from = Number(q.get('cursor') ?? '0');
    const rows = store.tasks.filter((x) => (!kind || x.kind === kind) && (!state || x.state === state));
    return HttpResponse.json({ items: rows.slice(from, from + size), nextCursor: from + size < rows.length ? String(from + size) : null });
  }),
  http.get(`${API_BASE}/cdcs/:cdcId/putaway-tasks/:taskId`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const x = store.tasks.find((t) => t.taskId === params.taskId);
    return x ? HttpResponse.json(x) : problem(404, 'NOT_FOUND');
  }),
  http.post(`${API_BASE}/cdcs/:cdcId/putaway-tasks`, async ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const body = (await request.json()) as S['PutawayTaskInput'];
    return idempotent(request, () => {
      if (body.fromLocationCode === body.toLocationCode) return problem(409, 'DESTINATION_INVALID');
      store.seq += 1;
      const now = new Date().toISOString();
      const x: Task = {
        taskId: `PT-${String(store.seq).padStart(4, '0')}`,
        cdcId: String(params.cdcId),
        kind: 'PUTAWAY',
        state: 'DISPATCHED',
        sku: body.sku,
        lot: body.lot,
        qualityState: body.qualityState ?? 'RELEASED',
        fromLocationCode: body.fromLocationCode,
        toLocationCode: body.toLocationCode,
        qty: body.qty,
        completedQty: 0,
        reservationId: `RSV-${store.seq}`,
        deviceId: null,
        createdBy: operator(request)?.subject ?? '',
        reason: body.reason ?? null,
        failureReason: null,
        results: [],
        createdAt: now,
        updatedAt: now,
      };
      store.tasks.unshift(x);
      return { status: 201, body: x };
    });
  }),
  http.post(`${API_BASE}/cdcs/:cdcId/putaway-tasks/:taskId/cancellations`, async ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const x = store.tasks.find((t) => t.taskId === params.taskId);
    if (!x) return problem(404, 'NOT_FOUND');
    const body = (await request.json()) as { reason: string };
    return idempotent(request, () => {
      if (!['DISPATCHED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED'].includes(x.state ?? '')) return problem(409, 'INVALID_STATE');
      x.state = 'CANCELLED';
      x.failureReason = body.reason;
      x.updatedAt = new Date().toISOString();
      return { status: 200, body: x };
    });
  }),
  http.get(`${API_BASE}/cdcs/:cdcId/replenishment-checks`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const reason = new URL(request.url).searchParams.get('reason');
    return HttpResponse.json({ items: store.checks.filter((c) => !reason || c.reason === reason) });
  }),
];
