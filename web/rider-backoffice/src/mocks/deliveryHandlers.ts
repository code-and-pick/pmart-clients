// ⚠ 화면 개발·시험용 목 — 배송 찾기(execution 0.4.0 GET /deliveries·/deliveries/{id})·배차 조회(dispatch GET /deliveries/{id}/dispatch).
// 실제 서버 동작이 아니다. 흉내: 주문·라이더 완전 일치, 상태·종류 거르기, NEWEST/OLDEST, size 를 넘으면 nextCursor(건너뛸 수).
// 목 전용: DLV-4 는 배차 조회가 404(배차 기록 없음 — 수행만 있는 배송).
import { http, HttpResponse } from 'msw';

import type { components as DispatchC } from '../api/generated/delivery-dispatch';
import type { components as ExecC } from '../api/generated/delivery-execution';
import { API_BASE } from '../api/client';
import { operator, problem, unauthorized } from './support';

type Execution = ExecC['schemas']['DeliveryExecution'];
type Dispatch = DispatchC['schemas']['Delivery'];

export const mockDeliveries: Execution[] = [
  {
    deliveryId: 'DLV-1',
    orderId: 'ORD-1',
    orderNumber: '48213075',
    type: 'FORWARD',
    purpose: 'DELIVERY',
    state: 'FAILURE_REPORTED',
    riderId: 'RD-7',
    mfcId: 'MFC-BSJ-01',
    mfcName: 'PMart 부산진구지점',
    assignedAt: '2026-11-17T00:40:00.000Z',
    failure: { reason: 'UNREACHABLE', reportedAt: '2026-11-17T01:00:00.000Z' },
    orderSummary: { orderNumber: '48213075', items: [{ name: '그릭요거트 플레인 400g', qty: 3, lineAmount: 17940 }] },
    history: [
      { state: 'ASSIGNED', actor: 'SYSTEM_EVENT', occurredAt: '2026-11-17T00:40:00.000Z' },
      { state: 'PICKED_UP', actor: 'RIDER', occurredAt: '2026-11-17T00:50:00.000Z' },
      { state: 'FAILURE_REPORTED', actor: 'RIDER', occurredAt: '2026-11-17T01:00:00.000Z' },
    ],
    version: 4,
  },
  {
    deliveryId: 'DLV-2',
    orderId: 'ORD-2',
    type: 'FORWARD',
    purpose: 'DELIVERY',
    state: 'UNASSIGNED',
    mfcId: 'MFC-BSJ-01',
    history: [],
    version: 1,
  },
  {
    deliveryId: 'DLV-3',
    orderId: 'ORD-3',
    type: 'FORWARD',
    purpose: 'DELIVERY',
    state: 'COMPLETED',
    riderId: 'RD-8',
    mfcId: 'MFC-BSJ-01',
    assignedAt: '2026-11-16T05:00:00.000Z',
    completedAt: '2026-11-16T05:30:00.000Z',
    version: 6,
  },
  {
    deliveryId: 'DLV-4',
    orderId: 'ORD-1',
    type: 'RETURN',
    purpose: 'FAILED_DELIVERY_RETURN',
    state: 'ASSIGNED',
    riderId: 'RD-7',
    mfcId: 'MFC-BSJ-01',
    version: 1,
  },
];

const created = (d: Execution) => d.assignedAt ?? '2026-11-17T00:00:00.000Z';

const summary = (d: Execution): ExecC['schemas']['StaffDeliverySummary'] => ({
  deliveryId: d.deliveryId ?? '',
  orderId: d.orderId ?? null,
  ...(d.type ? { type: d.type } : {}),
  state: d.state ?? 'UNASSIGNED',
  riderId: d.riderId ?? null,
  mfcId: d.mfcId ?? null,
  createdAt: created(d),
  assignedAt: d.assignedAt ?? null,
  completedAt: d.completedAt ?? null,
  version: d.version ?? 0,
});

const dispatchOf = (d: Execution): Dispatch => ({
  deliveryId: d.deliveryId ?? '',
  orderId: d.orderId ?? '',
  mfcId: d.mfcId ?? '',
  state: d.state === 'UNASSIGNED' ? 'DISPATCH_FAILED' : d.state === 'COMPLETED' ? 'CLOSED' : 'ASSIGNED',
  ...(d.riderId ? { assignment: { riderId: d.riderId } } : {}),
  attempts: d.state === 'UNASSIGNED' ? [{}, {}, {}] : [{}],
  arrivalWindow: { date: '2026-11-17', start: '10:00', end: '11:00' },
});

export const deliveryHandlers = [
  http.get(`${API_BASE}/deliveries`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    const q = new URL(request.url).searchParams;
    const size = Number(q.get('size') ?? '20') || 20;
    const skip = Number(q.get('cursor') ?? '0') || 0;
    const rows = mockDeliveries
      .filter((d) => !q.get('orderId') || d.orderId === q.get('orderId'))
      .filter((d) => !q.get('riderId') || d.riderId === q.get('riderId'))
      .filter((d) => !q.get('state') || d.state === q.get('state'))
      .filter((d) => !q.get('type') || d.type === q.get('type'))
      .sort((a, b) => (q.get('sort') === 'OLDEST' ? 1 : -1) * created(a).localeCompare(created(b)));
    const items = rows.slice(skip, skip + size).map(summary);
    const nextCursor = skip + size < rows.length ? String(skip + size) : null;
    return HttpResponse.json({ items, page: { nextCursor, size } });
  }),
  http.get(`${API_BASE}/deliveries/:deliveryId/dispatch`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const d = mockDeliveries.find((x) => x.deliveryId === params['deliveryId']);
    if (!d || d.deliveryId === 'DLV-4') return problem(404, 'NOT_FOUND');
    return HttpResponse.json(dispatchOf(d));
  }),
  http.get(`${API_BASE}/deliveries/:deliveryId`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const d = mockDeliveries.find((x) => x.deliveryId === params['deliveryId']);
    return d ? HttpResponse.json(d) : problem(404, 'NOT_FOUND');
  }),
];
