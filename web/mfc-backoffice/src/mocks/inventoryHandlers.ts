// 재고 목: mfc-inventory-service 0.16.0 — 위치·LOT 정정, 순환 실사(시작·조회·승인), 출하 부적격 LOT, 보충 기준, 상품 취급.
// 상품별 재고 조회(`/mfcs/{id}/stock`)는 moveHandlers 에 있다(같은 db.stockUnits).
// 서버 규칙 중 화면이 보여 줄 것만: 그 센터 권한, approvalRef 필수(422 APPROVAL_REQUIRED), 정정 수량 ≤ 출발 단위(422 INSUFFICIENT_STOCK),
// 실사 시작은 실사 잠금 칸만(409 LOCATION_NOT_LOCKED), 승인은 PENDING_APPROVAL·시작/계수한 사람 아님(422 SELF_APPROVAL),
// 보충 기준은 고회전 선반만(422 REPLENISH_ONLY_HIGH_TURNOVER)·min ≤ target, 취급 켜기는 ACTIVE 만(422 SKU_INACTIVE)·버전.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { db, nextSeq, timestamp, type MockCountSession } from './db';
import { expectedVersion, idempotent, operator, problem, unauthorized } from './support';

const canAccess = (request: Request, mfcId: string) => operator(request)?.centers.includes(mfcId) ?? false;
const isSupervisor = (request: Request) => operator(request)?.roles.includes('MFC_SUPERVISOR') ?? false;
const actor = (request: Request) => operator(request)?.subject ?? '';
const keyOf = (request: Request) => request.headers.get('Idempotency-Key') ?? '';
const base = `${API_BASE}/mfcs/:mfcId`;

function gate(request: Request, params: Record<string, unknown>): string | Response {
  if (!operator(request)) return unauthorized();
  const mfcId = String(params.mfcId);
  return canAccess(request, mfcId) ? mfcId : problem(403, 'FORBIDDEN');
}

export const inventoryHandlers = [
  http.post(`${base}/stock-corrections`, async ({ request, params }) => {
    const mfcId = gate(request, params);
    if (mfcId instanceof Response) return mfcId;
    const body = (await request.json()) as {
      reason: string;
      approvalRef: string;
      lines: Array<{ sku: string; lotId: string; fromLocation: string; qualityState: string; workState: string; qty: number; toLocation?: string; toSourceLotRef?: string }>;
    };
    return idempotent(request, () => {
      if (!body.approvalRef?.trim()) return problem(422, 'APPROVAL_REQUIRED');
      for (const l of body.lines) {
        const unit = db.stockUnits.find(
          (u) => u.mfcId === mfcId && u.sku === l.sku && u.lotId === l.lotId && u.locationCode === l.fromLocation && u.qualityState === l.qualityState && u.workState === l.workState,
        );
        if (!unit || unit.qty < l.qty) return problem(422, 'INSUFFICIENT_STOCK');
      }
      for (const l of body.lines) {
        db.stockUnits = db.stockUnits.flatMap((u) => {
          if (u.mfcId !== mfcId || u.sku !== l.sku || u.lotId !== l.lotId || u.locationCode !== l.fromLocation || u.qualityState !== l.qualityState) return [u];
          const rest = u.qty - l.qty;
          const moved = { ...u, qty: l.qty, locationCode: l.toLocation || u.locationCode, lotId: l.toSourceLotRef ? `LOT-${l.toSourceLotRef}` : u.lotId };
          return rest > 0 ? [{ ...u, qty: rest }, moved] : [moved];
        });
      }
      return { status: 201, body: { status: 'APPLIED', requestId: keyOf(request), resultId: `CMT-${nextSeq()}` } };
    });
  }),

  http.post(`${base}/count-sessions`, async ({ request, params }) => {
    const mfcId = gate(request, params);
    if (mfcId instanceof Response) return mfcId;
    const body = (await request.json()) as { locationCodes: string[]; reason?: string };
    return idempotent(request, () => {
      const locked = body.locationCodes.every((code) => [...db.locations.values()].some((l) => l.mfcId === mfcId && l.locationCode === code && l.state === 'COUNT_LOCKED'));
      if (!locked) return problem(409, 'LOCATION_NOT_LOCKED');
      const s: MockCountSession = {
        sessionId: `CNT-${nextSeq()}`,
        mfcId,
        state: 'COUNTING',
        locationCodes: body.locationCodes,
        reason: body.reason ?? null,
        createdBy: actor(request),
        firstCounter: null,
        recounter: null,
        approverId: null,
        approvalRef: null,
        baselineAt: timestamp(),
        sheet: db.stockUnits
          .filter((u) => u.mfcId === mfcId && body.locationCodes.includes(u.locationCode))
          .map((u) => ({ locationCode: u.locationCode, sku: u.sku, productName: null, barcodes: [], lotId: u.lotId, expiryDate: null })),
        differences: null,
        commitId: null,
        version: 1,
        updatedAt: timestamp(),
      };
      db.countSessions.set(s.sessionId, s);
      return { status: 201, body: s };
    });
  }),

  http.get(`${base}/count-sessions/:sessionId`, ({ request, params }) => {
    const mfcId = gate(request, params);
    if (mfcId instanceof Response) return mfcId;
    const s = db.countSessions.get(String(params.sessionId));
    return s && s.mfcId === mfcId ? HttpResponse.json(s) : problem(404, 'NOT_FOUND');
  }),

  http.post(`${base}/count-sessions/:sessionId/approvals`, async ({ request, params }) => {
    const mfcId = gate(request, params);
    if (mfcId instanceof Response) return mfcId;
    if (!isSupervisor(request)) return problem(403, 'FORBIDDEN');
    const s = db.countSessions.get(String(params.sessionId));
    if (!s || s.mfcId !== mfcId) return problem(404, 'NOT_FOUND');
    const body = (await request.json()) as { action: 'APPROVE' | 'REJECT'; approvalRef?: string; note?: string };
    return idempotent(request, () => {
      if (s.state !== 'PENDING_APPROVAL') return problem(409, 'INVALID_STATE');
      const me = actor(request);
      if ([s.createdBy, s.firstCounter, s.recounter].includes(me)) return problem(422, 'SELF_APPROVAL');
      if (body.action === 'APPROVE' && !body.approvalRef?.trim()) return problem(422, 'APPROVAL_REQUIRED');
      const next: MockCountSession = {
        ...s,
        state: body.action === 'APPROVE' ? 'ADJUSTED' : 'REJECTED',
        approverId: me,
        approvalRef: body.approvalRef ?? null,
        commitId: body.action === 'APPROVE' ? `CMT-${nextSeq()}` : null,
        version: (s.version ?? 0) + 1,
        updatedAt: timestamp(),
      };
      db.countSessions.set(next.sessionId, next);
      return { status: 200, body: next };
    });
  }),

  http.get(`${base}/unshippable-lots`, ({ request, params }) => {
    const mfcId = gate(request, params);
    if (mfcId instanceof Response) return mfcId;
    const items = db.unshippable
      .filter((u) => u.mfcId === mfcId)
      .sort((a, b) => (a.expiryDate ?? '').localeCompare(b.expiryDate ?? ''))
      .map((u) => ({
        sku: u.sku,
        lotId: u.lotId,
        expiryDate: u.expiryDate,
        manufactureDate: u.manufactureDate,
        locationCode: u.locationCode,
        locationCategoryId: u.locationCategoryId,
        onMiscShelf: u.onMiscShelf,
        qty: u.qty,
      }));
    return HttpResponse.json({ items });
  }),

  http.get(`${base}/replenishment-policies`, ({ request, params }) => {
    const mfcId = gate(request, params);
    if (mfcId instanceof Response) return mfcId;
    return HttpResponse.json({ items: db.policies.filter((p) => p.mfcId === mfcId) });
  }),

  http.put(`${base}/replenishment-policies`, async ({ request, params }) => {
    const mfcId = gate(request, params);
    if (mfcId instanceof Response) return mfcId;
    if (!isSupervisor(request)) return problem(403, 'FORBIDDEN');
    const body = (await request.json()) as { locationCode: string; sku: string; minQty: number; targetQty: number; unitQty: number };
    return idempotent(request, () => {
      if (body.minQty > body.targetQty || body.unitQty < 1) return problem(400, 'VALIDATION_FAILED', [{ field: 'minQty', reason: 'INVALID_FORMAT' }]);
      const loc = [...db.locations.values()].find((l) => l.mfcId === mfcId && l.locationCode === body.locationCode);
      if (!loc?.highTurnover) return problem(422, 'REPLENISH_ONLY_HIGH_TURNOVER');
      const p = { mfcId, ...body, updatedBy: actor(request), updatedAt: timestamp() };
      db.policies = [...db.policies.filter((x) => !(x.mfcId === mfcId && x.locationCode === body.locationCode && x.sku === body.sku)), p];
      return { status: 200, body: p };
    });
  }),

  http.delete(`${base}/replenishment-policies`, ({ request, params }) => {
    const mfcId = gate(request, params);
    if (mfcId instanceof Response) return mfcId;
    if (!isSupervisor(request)) return problem(403, 'FORBIDDEN');
    const q = new URL(request.url).searchParams;
    db.policies = db.policies.filter((x) => !(x.mfcId === mfcId && x.locationCode === q.get('locationCode') && x.sku === q.get('sku')));
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${base}/sku-handlings`, ({ request, params }) => {
    const mfcId = gate(request, params);
    if (mfcId instanceof Response) return mfcId;
    const enabled = new URL(request.url).searchParams.get('enabled');
    const items = db.handlings
      .filter((h) => enabled === null || String(h.handlingEnabled) === enabled)
      .map((h) => ({ sku: h.sku, handlingEnabled: h.handlingEnabled, version: h.version, skuState: h.skuState, productId: null, changedBy: null, reason: null, updatedAt: null }));
    return HttpResponse.json({ centerId: mfcId, items, page: { nextCursor: null, size: items.length } });
  }),

  http.post(`${base}/sku-handlings`, async ({ request, params }) => {
    const mfcId = gate(request, params);
    if (mfcId instanceof Response) return mfcId;
    const body = (await request.json()) as { sku: string; enabled: boolean; reason?: string };
    return idempotent(request, () => {
      const h = db.handlings.find((x) => x.sku === body.sku);
      if (!h) return problem(404, 'SKU_NOT_FOUND');
      if (expectedVersion(request) !== h.version) return problem(409, 'VERSION_CONFLICT');
      if (body.enabled && h.skuState === 'INACTIVE') return problem(422, 'SKU_INACTIVE');
      const changed = h.handlingEnabled !== body.enabled;
      const next = changed ? { ...h, handlingEnabled: body.enabled, version: h.version + 1 } : h;
      db.handlings = db.handlings.map((x) => (x === h ? next : x));
      return {
        status: 200,
        body: {
          status: 'APPLIED',
          requestId: keyOf(request),
          occurredAt: timestamp(),
          changed,
          handling: { sku: next.sku, handlingEnabled: next.handlingEnabled, version: next.version, skuState: next.skuState, productId: null, changedBy: actor(request), reason: body.reason ?? null, updatedAt: timestamp() },
        },
      };
    });
  }),
];
