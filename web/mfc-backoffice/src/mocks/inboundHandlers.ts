// 입고 목: mfc-inbound-service 0.9.0 — 입고 작업(목록·단건·품질검사·적치), 초기 보유 수령, 회수품 반입, 공급 요청.
// 서버 규칙 중 화면이 보여 줄 것만: 그 센터 권한, 담당이 있으면 담당만(409 NOT_ASSIGNEE), 합계 ≤ 잔량(400), 품질검사 APPLIED → 정상 LOT 마다 적치 작업,
// 적치는 선반·피킹 칸만(아니면 REJECTED LOCATION_ZONE_MISMATCH), 초기 보유는 EXPECTED 만·승인 수량 이하·합계 0 이면 400,
// 공급 요청은 ACKNOWLEDGED 뒤 변경 409, 철회는 WITHDRAWN.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { db, nextSeq, timestamp, type MockInboundTask, type MockReturnReceipt, type MockSupplyRequest } from './db';
import { expectedVersion, idempotent, operator, problem, unauthorized } from './support';

const canAccess = (request: Request, mfcId: string) => operator(request)?.centers.includes(mfcId) ?? false;
const actor = (request: Request) => operator(request)?.subject ?? '';
const keyOf = (request: Request) => request.headers.get('Idempotency-Key') ?? '';

function foundTask(request: Request, taskId: string): MockInboundTask | HttpResponse<Record<string, unknown>> {
  const t = db.inboundTasks.get(taskId);
  if (!t) return problem(404, 'NOT_FOUND');
  if (!canAccess(request, t.mfcId)) return problem(403, 'FORBIDDEN');
  return t;
}

/** 실행 결과 + 작업 잔량 반영 */
function applyDone(t: MockInboundTask, qty: number): MockInboundTask {
  const doneQty = t.doneQty + qty;
  const next: MockInboundTask = { ...t, doneQty, version: t.version + 1, state: doneQty >= t.plannedQty ? 'COMPLETED' : 'READY' };
  db.inboundTasks.set(next.taskId, next);
  return next;
}

export const inboundHandlers = [
  http.get(`${API_BASE}/inbound-tasks`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    const q = new URL(request.url).searchParams;
    const mfcId = q.get('mfcId') ?? '';
    if (!canAccess(request, mfcId)) return problem(403, 'FORBIDDEN');
    const items = [...db.inboundTasks.values()]
      .filter((t) => t.mfcId === mfcId)
      .filter((t) => !q.get('state') || t.state === q.get('state'))
      .filter((t) => !q.get('taskType') || t.taskType === q.get('taskType'))
      .filter((t) => !q.get('receiptId') || t.receiptId === q.get('receiptId'))
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    return HttpResponse.json({ items });
  }),

  http.get(`${API_BASE}/inbound-tasks/:taskId`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const t = foundTask(request, String(params.taskId));
    return t instanceof Response ? t : HttpResponse.json(t);
  }),

  http.post(`${API_BASE}/inbound-tasks/:taskId/inspections`, async ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const t = foundTask(request, String(params.taskId));
    if (t instanceof Response) return t;
    const body = (await request.json()) as { results: Array<{ qty: number; resultQuality: 'NORMAL' | 'QUARANTINED'; sourceLotRef?: string; expiryDate?: string }> };
    return idempotent(request, () => {
      if (t.taskType !== 'INSPECT' || t.state !== 'READY') return problem(409, 'INVALID_STATE');
      if (t.assigneeId && t.assigneeId !== actor(request)) return problem(409, 'NOT_ASSIGNEE');
      const total = body.results.reduce((n, r) => n + r.qty, 0);
      if (total > t.plannedQty - t.doneQty) return problem(400, 'VALIDATION_FAILED', [{ field: 'results', reason: 'QTY_EXCEEDS_REMAINING' }]);
      // 정상 LOT(표기·기한이 같으면 하나)마다 적치 작업
      const groups = new Map<string, number>();
      for (const r of body.results.filter((x) => x.resultQuality === 'NORMAL')) {
        const k = `${r.sourceLotRef ?? ''}|${r.expiryDate ?? ''}`;
        groups.set(k, (groups.get(k) ?? 0) + r.qty);
      }
      const created = [...groups.entries()].map(([k, qty]) => {
        const id = `ITK-${nextSeq()}`;
        db.inboundTasks.set(id, {
          ...t,
          taskId: id,
          taskType: 'PUTAWAY',
          parentTaskId: t.taskId,
          lotId: `LOT-${k.split('|')[0] || 'NEW'}`,
          plannedQty: qty,
          doneQty: 0,
          state: 'READY',
          version: 1,
          assigneeId: null,
          createdAt: timestamp(),
        });
        return id;
      });
      const next = applyDone(t, total);
      return { status: 200, body: { executionId: `EXE-${keyOf(request).slice(0, 8)}`, taskId: t.taskId, applyStatus: 'APPLIED', inventoryCommitId: `CMT-${nextSeq()}`, rejectReason: null, createdTaskIds: created, task: next } };
    });
  }),

  http.post(`${API_BASE}/inbound-tasks/:taskId/putaways`, async ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const t = foundTask(request, String(params.taskId));
    if (t instanceof Response) return t;
    const body = (await request.json()) as { toLocationCode: string; qty: number };
    return idempotent(request, () => {
      if (t.taskType !== 'PUTAWAY' || t.state !== 'READY') return problem(409, 'INVALID_STATE');
      if (t.assigneeId && t.assigneeId !== actor(request)) return problem(409, 'NOT_ASSIGNEE');
      if (body.qty > t.plannedQty - t.doneQty) return problem(400, 'VALIDATION_FAILED', [{ field: 'qty', reason: 'QTY_EXCEEDS_REMAINING' }]);
      const loc = [...db.locations.values()].find((l) => l.mfcId === t.mfcId && l.locationCode === body.toLocationCode);
      const executionId = `EXE-${keyOf(request).slice(0, 8)}`;
      if (!loc || (loc.zone !== 'STORAGE' && loc.zone !== 'PICKING')) {
        // 재고가 거절 — 200 + REJECTED(작업 잔량 그대로)
        return { status: 200, body: { executionId, taskId: t.taskId, applyStatus: 'REJECTED', inventoryCommitId: null, rejectReason: loc ? 'LOCATION_ZONE_MISMATCH' : 'LOCATION_NOT_REGISTERED', createdTaskIds: [], task: t } };
      }
      const next = applyDone(t, body.qty);
      return { status: 200, body: { executionId, taskId: t.taskId, applyStatus: 'APPLIED', inventoryCommitId: `CMT-${nextSeq()}`, rejectReason: null, createdTaskIds: [], task: next } };
    });
  }),

  http.get(`${API_BASE}/initial-stock-loads`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    const approvalId = new URL(request.url).searchParams.get('approvalId') ?? '';
    return HttpResponse.json({ items: db.initialLoads.filter((l) => l.approvalId === approvalId) });
  }),

  http.post(`${API_BASE}/initial-stock-loads/:receiptId/receipts`, async ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const load = db.initialLoads.find((l) => l.receiptId === String(params.receiptId));
    if (!load) return problem(404, 'NOT_FOUND');
    if (!load.mfcId || !canAccess(request, load.mfcId)) return problem(403, 'FORBIDDEN');
    const body = (await request.json()) as { toLocationCode: string; lines: Array<{ sku: string; receivedQty: number }> };
    return idempotent(request, () => {
      if (load.state !== 'EXPECTED') return problem(409, 'INVALID_STATE');
      for (const line of body.lines) {
        const approved = load.lines.find((l) => l.sku === line.sku);
        if (!approved) return problem(400, 'VALIDATION_FAILED', [{ field: 'lines.sku', reason: 'NOT_ALLOWED' }]);
        if (line.receivedQty > approved.qty) return problem(400, 'VALIDATION_FAILED', [{ field: 'lines.receivedQty', reason: 'QTY_EXCEEDS_APPROVED' }]);
      }
      if (body.lines.reduce((n, l) => n + l.receivedQty, 0) === 0) return problem(400, 'VALIDATION_FAILED', [{ field: 'lines', reason: 'TOTAL_ZERO' }]);
      // 접수(PENDING) — 목은 바로 전기까지 끝낸다(APPLIED + 품질검사 작업)
      const next = {
        ...load,
        state: 'APPLIED' as const,
        receivingLocation: body.toLocationCode,
        receivedAt: timestamp(),
        appliedAt: timestamp(),
        inventoryCommitId: `CMT-${nextSeq()}`,
        lines: load.lines.map((l) => ({ ...l, receivedQty: body.lines.find((x) => x.sku === l.sku)?.receivedQty ?? 0 })),
      };
      db.initialLoads = db.initialLoads.map((l) => (l === load ? next : l));
      return { status: 202, body: { status: 'ACCEPTED', requestId: keyOf(request), resultId: load.receiptId } };
    });
  }),

  http.post(`${API_BASE}/return-receipts`, async ({ request }) => {
    if (!operator(request)) return unauthorized();
    const body = (await request.json()) as {
      mfcId: string;
      claimId: string;
      returnPickupId: string;
      toLocationCode: string;
      orderId?: string;
      lines: Array<{ orderLineId?: string; sku: string; qty: number; conditionNote?: string }>;
    };
    if (!canAccess(request, body.mfcId)) return problem(403, 'FORBIDDEN');
    return idempotent(request, () => {
      const id = `RR-${nextSeq()}`;
      const rec: MockReturnReceipt = {
        returnReceiptId: id,
        claimId: body.claimId,
        returnPickupId: body.returnPickupId,
        mfcId: body.mfcId,
        inventoryApplyStatus: 'APPLIED',
        inventoryCommitId: `CMT-${nextSeq()}`,
        inspectionState: 'PENDING',
        receivedAt: timestamp(),
        orderId: body.orderId ?? null,
        toLocationCode: body.toLocationCode,
        receivedBy: actor(request),
        rejectReason: null,
        lines: body.lines.map((l) => ({ orderLineId: l.orderLineId ?? null, sku: l.sku, qty: l.qty, lotId: `RET-${body.claimId}`, conditionNote: l.conditionNote ?? null })),
        putawayTaskIds: [],
      };
      db.returnReceipts.set(id, rec);
      return { status: 202, body: { status: 'APPLIED', requestId: keyOf(request), resultId: id } };
    });
  }),

  http.get(`${API_BASE}/return-receipts/:id`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const rec = db.returnReceipts.get(String(params.id));
    if (!rec) return problem(404, 'NOT_FOUND');
    if (!canAccess(request, rec.mfcId)) return problem(403, 'FORBIDDEN');
    return HttpResponse.json(rec);
  }),

  http.post(`${API_BASE}/supply-requests`, async ({ request }) => {
    if (!operator(request)) return unauthorized();
    const body = (await request.json()) as Omit<MockSupplyRequest, 'supplyRequestId' | 'version' | 'state'>;
    if (!canAccess(request, body.mfcId) || !operator(request)?.roles.includes('MFC_SUPERVISOR')) return problem(403, 'FORBIDDEN');
    return idempotent(request, () => {
      const rec: MockSupplyRequest = { ...body, supplyRequestId: `SR-${nextSeq()}`, version: 1, state: 'SUBMITTED', submittedBy: actor(request), submittedAt: timestamp(), acknowledgedAt: null, linkedTrfId: null };
      db.supplyRequests.set(rec.supplyRequestId, rec);
      return { status: 201, body: rec };
    });
  }),

  http.get(`${API_BASE}/supply-requests/:id`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const rec = db.supplyRequests.get(String(params.id));
    if (!rec) return problem(404, 'NOT_FOUND');
    if (!canAccess(request, rec.mfcId)) return problem(403, 'FORBIDDEN');
    return HttpResponse.json(rec);
  }),

  http.patch(`${API_BASE}/supply-requests/:id`, async ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const rec = db.supplyRequests.get(String(params.id));
    if (!rec) return problem(404, 'NOT_FOUND');
    if (!canAccess(request, rec.mfcId)) return problem(403, 'FORBIDDEN');
    const body = (await request.json()) as Omit<MockSupplyRequest, 'supplyRequestId' | 'version' | 'state'>;
    return idempotent(request, () => {
      if (expectedVersion(request) !== rec.version) return problem(409, 'VERSION_CONFLICT');
      if (rec.state !== 'DRAFT' && rec.state !== 'SUBMITTED') return problem(409, 'INVALID_STATE');
      const next: MockSupplyRequest = { ...rec, ...body, supplyRequestId: rec.supplyRequestId, state: rec.state, version: rec.version + 1 };
      db.supplyRequests.set(next.supplyRequestId, next);
      return { status: 200, body: next };
    });
  }),

  http.post(`${API_BASE}/supply-requests/:id/withdrawals`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const rec = db.supplyRequests.get(String(params.id));
    if (!rec) return problem(404, 'NOT_FOUND');
    if (!canAccess(request, rec.mfcId)) return problem(403, 'FORBIDDEN');
    return idempotent(request, () => {
      if (expectedVersion(request) !== rec.version) return problem(409, 'VERSION_CONFLICT');
      if (rec.state === 'WITHDRAWN') return { status: 202, body: { status: 'APPLIED', requestId: keyOf(request), resultId: rec.supplyRequestId, version: rec.version } };
      if (rec.linkedTrfId) return problem(409, 'INVALID_STATE');
      const next: MockSupplyRequest = { ...rec, state: 'WITHDRAWN', version: rec.version + 1 };
      db.supplyRequests.set(next.supplyRequestId, next);
      return { status: 202, body: { status: 'APPLIED', requestId: keyOf(request), resultId: next.supplyRequestId, version: next.version } };
    });
  }),
];
