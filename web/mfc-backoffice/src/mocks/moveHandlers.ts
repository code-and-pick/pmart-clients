// 이동·보충 목: mfc-inbound-service 0.9.0 `/move-orders*`(목록·한 건·만들기·취소), 고르기 도움용 mfc-inventory `/mfcs/{id}/stock`·mfc-location `/putaway-candidates`.
// 서버 규칙 중 화면이 보여 줄 것만: 그 센터 권한, 만들기·취소는 MFC_SUPERVISOR, 같은 키 = 같은 이동, 카테고리 칸 거절(CATEGORY_MISMATCH), 취소는 진행 중만.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { db, nextSeq, timestamp, type MockMove } from './db';
import { idempotent, operator, problem, unauthorized } from './support';

const isSupervisor = (request: Request) => operator(request)?.roles.includes('MFC_SUPERVISOR') ?? false;
const canAccess = (request: Request, mfcId: string) => operator(request)?.centers.includes(mfcId) ?? false;

/** 목 상품 — 고르기 도움(재고 보기)과 표시 이름 */
const products: Readonly<Record<string, { name: string; category: string }>> = {
  'SKU-MILK-1': { name: '서울우유 1L', category: 'CAT-DAIRY' },
  'SKU-RAMEN-5': { name: '신라면 5입', category: 'CAT-NOODLE' },
};

function found(request: Request, moveId: string): MockMove | HttpResponse<Record<string, unknown>> {
  const move = db.moves.get(moveId);
  if (!move) return problem(404, 'NOT_FOUND');
  if (!canAccess(request, move.mfcId)) return problem(403, 'FORBIDDEN');
  return move;
}

interface CreateBody {
  mfcId: string;
  sku: string;
  lotId: string;
  fromLocation: string;
  toLocation: string;
  qty: number;
  reason?: string;
  urgent?: boolean;
}

export const moveHandlers = [
  http.get(`${API_BASE}/move-orders`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    const q = new URL(request.url).searchParams;
    const mfcId = q.get('mfcId') ?? '';
    if (!canAccess(request, mfcId)) return problem(403, 'FORBIDDEN');
    const state = q.get('state');
    // 기본은 진행 중(ACTIVE·CANCEL_PENDING)
    const wanted = state ? [state] : ['ACTIVE', 'CANCEL_PENDING'];
    const items = [...db.moves.values()]
      .filter((m) => m.mfcId === mfcId && wanted.includes(m.state))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return HttpResponse.json({ items });
  }),

  http.get(`${API_BASE}/move-orders/:moveId`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const move = found(request, String(params.moveId));
    return move instanceof Response ? move : HttpResponse.json(move);
  }),

  http.post(`${API_BASE}/move-orders`, async ({ request }) => {
    if (!operator(request)) return unauthorized();
    const body = (await request.json()) as CreateBody;
    if (!canAccess(request, body.mfcId) || !isSupervisor(request)) return problem(403, 'FORBIDDEN');
    return idempotent(request, () => {
      const target = [...db.locations.values()].find((l) => l.mfcId === body.mfcId && l.locationCode === body.toLocation);
      const category = products[body.sku]?.category;
      if (target?.categoryId && category && target.categoryId !== category) return problem(409, 'CATEGORY_MISMATCH');
      const at = timestamp();
      const move: MockMove = {
        moveId: `MOVE-${nextSeq()}`,
        kind: 'MOVE',
        mfcId: body.mfcId,
        sku: body.sku,
        productName: products[body.sku]?.name ?? null,
        barcodes: [],
        lotId: body.lotId,
        fromLocation: body.fromLocation,
        toLocation: body.toLocation,
        cartLocation: null,
        qty: body.qty,
        pickedQty: 0,
        droppedQty: 0,
        onCartQty: 0,
        state: 'ACTIVE',
        reason: body.reason ?? null,
        createdBy: operator(request)?.subject ?? '',
        createdAt: at,
        updatedAt: at,
        urgent: body.urgent ?? false,
        assigneeId: null,
        pickedBy: null,
      };
      db.moves.set(move.moveId, move);
      return { status: 201, body: move };
    });
  }),

  // 취소: 집지 않은 몫만 풀린다. 카트에 남은 것이 있으면 CANCEL_PENDING(내려놓아야 CANCELLED)
  http.post(`${API_BASE}/move-orders/:moveId/cancellations`, async ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const move = found(request, String(params.moveId));
    if (move instanceof Response) return move;
    if (!isSupervisor(request)) return problem(403, 'FORBIDDEN');
    const body = (await request.json()) as { reason: string };
    return idempotent(request, () => {
      if (move.state === 'CANCEL_PENDING') return { status: 200, body: move };
      if (move.state !== 'ACTIVE') return problem(409, 'INVALID_STATE');
      const next: MockMove = { ...move, state: move.onCartQty > 0 ? 'CANCEL_PENDING' : 'CANCELLED', reason: body.reason, updatedAt: timestamp() };
      db.moves.set(next.moveId, next);
      return { status: 200, body: next };
    });
  }),

  // 고르기 도움: 상품의 위치·LOT 별 재고(sku 필수)
  http.get(`${API_BASE}/mfcs/:mfcId/stock`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const mfcId = String(params.mfcId);
    if (!canAccess(request, mfcId)) return problem(403, 'FORBIDDEN');
    const sku = new URL(request.url).searchParams.get('sku') ?? '';
    const units = db.stockUnits
      .filter((u) => u.mfcId === mfcId && u.sku === sku)
      .map((u) => ({ locationCode: u.locationCode, lotId: u.lotId, qualityState: u.qualityState, workState: u.workState, qty: u.qty }));
    const lots = [...new Set(units.map((u) => u.lotId))].map((lotId) => {
      const of = units.filter((u) => u.lotId === lotId);
      const onHand = of.reduce((n, u) => n + u.qty, 0);
      const quarantined = of.filter((u) => u.qualityState === 'QUARANTINED').reduce((n, u) => n + u.qty, 0);
      const sellable = onHand - quarantined;
      return { lotId, tracking: 'TRACKED', expiryDate: '2026-11-25', manufactureDate: null, onHand, quarantined, sellable, reserved: 0, available: sellable };
    });
    return HttpResponse.json({ mfcId, sku, lots, units });
  }),

  // 고르기 도움: 도착 칸 후보
  http.get(`${API_BASE}/putaway-candidates`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    const q = new URL(request.url).searchParams;
    const mfcId = q.get('mfcId') ?? '';
    if (!canAccess(request, mfcId)) return problem(403, 'FORBIDDEN');
    const category = products[q.get('sku') ?? '']?.category;
    const items = [...db.locations.values()]
      .filter((l) => l.mfcId === mfcId && l.state === 'ACTIVE' && (l.zone === 'STORAGE' || l.zone === 'PICKING'))
      .filter((l) => !l.categoryId || l.categoryId === category)
      .map((l, i) => ({ locationId: l.locationId, locationCode: l.locationCode, zone: l.zone, remainingSpace: i === 0 ? null : 12, rank: i + 1 }));
    return HttpResponse.json({ asOf: { asOf: timestamp(), freshness: 'CURRENT' }, items });
  }),
];
