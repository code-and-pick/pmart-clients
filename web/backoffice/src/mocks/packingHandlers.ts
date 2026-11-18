// ⚠ 화면 개발·시험용 목 — 포장 인계 현황(bff 0.11.0 `GET /backoffice/views/packing-handover`). 실제 서버 동작이 아니다.
// 규칙(계약 설명 흉내): 본사 역할(OPERATOR_ADMIN·CS_AGENT·RIDER_OPS) — mfcId 필수(400), 그 밖 403.
// state 비우면 끝나지 않은 출고(PREPARING·READY·PARTIALLY_HANDED_OVER), 만든 순, size·cursor.
// 시험용: mfcId=MFC-MOCK-DOWN 이면 MFC 원천 실패, MFC-MOCK-NODLV 면 배송 원천만 실패, MFC-MOCK-NORIDER 면 rider-service 만 실패(0.14.0).
// bff 0.14.0 화면 번호: deliveryNumber(DLV-MOCK-21 은 번호 전 — null), rider·packages[].rider(RiderDisplay).
import { http, HttpResponse } from 'msw';

import { BFF_BASE } from '../api/client';
import { operator, problem, unauthorized } from './support';

const ROLES = ['OPERATOR_ADMIN', 'CS_AGENT', 'RIDER_OPS'];
const OPEN = ['PREPARING', 'READY', 'PARTIALLY_HANDED_OVER'];
const at = (m: number) => new Date(Date.parse('2026-11-17T01:00:00Z') + m * 60_000).toISOString();

interface Row {
  shipmentId: string;
  orderId: string;
  orderNumber: string | null;
  workOrderKind: string;
  shipmentState: string;
  stage: string | null;
  pick: { state: string | null; blockReason?: string | null; startedAt?: string | null } | null;
  pack: { state: string | null; blockReason?: string | null; startedAt?: string | null } | null;
  packageCount: number | null;
  handed: number | null;
  remaining: number | null;
  packages: Array<{ packageId: string; state: string; fenceState: string | null; handoverAuthorizedAt: string | null; handedOverAt: string | null; riderId: string | null }>;
  readyAt: string | null;
  dispatchRequestedAt: string | null;
  deliveryId: string | null;
  deliveryState: string | null;
  riderId: string | null;
  createdAt: string;
}

/** bff 0.14.0 화면 배송 번호(execution 값 흉내) — 표에 없는 배송은 null(번호 전) */
const DELIVERY_NUMBER: Readonly<Record<string, string>> = { 'DLV-MOCK-24': '25111704-1' };
/** rider-service 에서 읽는 라이더 번호·가린 이름(목) */
const RIDERS: Readonly<Record<string, { riderNumber: string; nameMasked: string }>> = {
  'RID-MOCK-1': { riderNumber: '482913', nameMasked: '김*수' },
  'RID-MOCK-2': { riderNumber: '517204', nameMasked: '이*영' },
};

const rows: readonly Row[] = [
  { shipmentId: 'SHP-1', orderId: 'ORD-MOCK-2001', orderNumber: '25111701', workOrderKind: 'ORIGINAL', shipmentState: 'PREPARING', stage: 'PICKING', pick: { state: 'IN_PROGRESS', startedAt: at(1) }, pack: { state: 'WAITING' }, packageCount: null, handed: null, remaining: null, packages: [], readyAt: null, dispatchRequestedAt: at(0), deliveryId: 'DLV-MOCK-21', deliveryState: 'ASSIGNED', riderId: 'RID-MOCK-1', createdAt: at(0) },
  { shipmentId: 'SHP-2', orderId: 'ORD-MOCK-2002', orderNumber: null, workOrderKind: 'RESHIPMENT', shipmentState: 'PREPARING', stage: 'PACKING', pick: { state: 'COMPLETED' }, pack: { state: 'WAITING' }, packageCount: null, handed: null, remaining: null, packages: [], readyAt: null, dispatchRequestedAt: null, deliveryId: null, deliveryState: null, riderId: null, createdAt: at(2) },
  { shipmentId: 'SHP-3', orderId: 'ORD-MOCK-2003', orderNumber: '25111703', workOrderKind: 'ORIGINAL', shipmentState: 'PREPARING', stage: 'PACKING', pick: { state: 'COMPLETED' }, pack: { state: 'BLOCKED', blockReason: 'PACKAGE_MISMATCH' }, packageCount: null, handed: null, remaining: null, packages: [], readyAt: null, dispatchRequestedAt: null, deliveryId: null, deliveryState: null, riderId: null, createdAt: at(3) },
  {
    shipmentId: 'SHP-4', orderId: 'ORD-MOCK-2004', orderNumber: '25111704', workOrderKind: 'ORIGINAL', shipmentState: 'PARTIALLY_HANDED_OVER', stage: 'PARTIALLY_HANDED_OVER', pick: { state: 'COMPLETED' }, pack: { state: 'COMPLETED' }, packageCount: 3, handed: 1, remaining: 2,
    packages: [
      { packageId: 'PKG-4-1', state: 'HANDED_OVER', fenceState: 'AUTHORIZED', handoverAuthorizedAt: at(20), handedOverAt: at(21), riderId: 'RID-MOCK-2' },
      { packageId: 'PKG-4-2', state: 'SEALED', fenceState: null, handoverAuthorizedAt: null, handedOverAt: null, riderId: null },
      { packageId: 'PKG-4-3', state: 'SEALED', fenceState: null, handoverAuthorizedAt: null, handedOverAt: null, riderId: null },
    ],
    readyAt: at(15), dispatchRequestedAt: at(4), deliveryId: 'DLV-MOCK-24', deliveryState: 'ARRIVED_AT_STORE', riderId: 'RID-MOCK-2', createdAt: at(4),
  },
  { shipmentId: 'SHP-5', orderId: 'ORD-MOCK-2005', orderNumber: '25111705', workOrderKind: 'ORIGINAL', shipmentState: 'CANCELLED', stage: null, pick: { state: 'CANCELLED' }, pack: null, packageCount: null, handed: null, remaining: null, packages: [], readyAt: null, dispatchRequestedAt: null, deliveryId: null, deliveryState: null, riderId: null, createdAt: at(5) },
];

export const packingHandlers = [
  http.get(`${BFF_BASE}/views/packing-handover`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!who.roles.some((r) => ROLES.includes(r))) return problem(403, 'FORBIDDEN');
    const q = new URL(request.url).searchParams;
    const mfcId = q.get('mfcId') ?? '';
    if (!mfcId) return problem(400, 'VALIDATION_FAILED', [{ field: 'mfcId', reason: 'REQUIRED' }]);
    const states = q.getAll('state');
    const size = Math.min(Number(q.get('size') ?? '30') || 30, 50);
    const start = Number(q.get('cursor') ?? '0') || 0;
    const composedAt = new Date().toISOString();
    const stamp = (system: string, ok: boolean) => ({ system, confidence: ok ? ('DIRECT' as const) : ('UNKNOWN' as const), asOf: { asOf: composedAt, freshness: ok ? ('CURRENT' as const) : ('UNAVAILABLE' as const) } });
    const mfcDown = mfcId === 'MFC-MOCK-DOWN';
    const dlvDown = mfcId === 'MFC-MOCK-NODLV';
    const riderDown = mfcId === 'MFC-MOCK-NORIDER';
    const unavailable = [...(mfcDown ? ['mfc-fulfillment-service'] : []), ...(dlvDown ? ['delivery-execution-service'] : []), ...(riderDown ? ['rider-service'] : [])];
    // RiderDisplay — riderId 없으면 null, rider-service 실패·없는 라이더면 번호·이름 null(riderId 는 그대로)
    const riderOf = (riderId: string | null) => (riderId ? { riderId, riderNumber: riderDown ? null : (RIDERS[riderId]?.riderNumber ?? null), nameMasked: riderDown ? null : (RIDERS[riderId]?.nameMasked ?? null) } : null);
    const all = mfcDown ? [] : rows.filter((r) => (states.length ? states.includes(r.shipmentState) : OPEN.includes(r.shipmentState)));
    const page = all.slice(start, start + size);
    return HttpResponse.json({
      composedAt,
      sources: [stamp('mfc-fulfillment-service', !mfcDown), stamp('delivery-execution-service', !dlvDown), stamp('rider-service', !riderDown)],
      unavailableSources: unavailable,
      items: page.map((r) => ({
        shipmentId: r.shipmentId,
        fulfillmentId: `FUL-${r.shipmentId}`,
        mfcId,
        orderId: r.orderId,
        orderNumber: r.orderNumber,
        workOrderKind: r.workOrderKind,
        stage: r.stage,
        shipment: { state: r.shipmentState, source: stamp('mfc-fulfillment-service', true) },
        pick: r.pick,
        pack: r.pack,
        packageCount: r.packageCount,
        sealedPackages: null,
        handedOverQty: { qty: r.handed, source: stamp('mfc-fulfillment-service', true) },
        remainingPackages: r.remaining,
        packages: r.packages.map((p) => ({ ...p, rider: riderOf(p.riderId) })),
        readyAt: r.readyAt,
        dispatchRequestedAt: r.dispatchRequestedAt,
        deliveryId: r.deliveryId,
        deliveryNumber: r.deliveryId && !dlvDown ? (DELIVERY_NUMBER[r.deliveryId] ?? null) : null,
        rider: riderOf(r.riderId),
        delivery: r.deliveryId ? { state: dlvDown ? null : r.deliveryState, source: stamp('delivery-execution-service', !dlvDown) } : null,
        riderId: r.riderId,
        createdAt: r.createdAt,
      })),
      page: { nextCursor: start + size < all.length ? String(start + size) : null, size },
    });
  }),
];
