// 품질 목: mfc-quality-service 0.2.0 — 격리·해제 판정(+해제 승인), 폐기(요청·승인·실행), 회수품 검수.
// 서버 규칙 중 화면이 보여 줄 것만: 그 센터 권한, QUARANTINE 은 바로 반영(APPLIED), RELEASE 는 요청만(ACCEPTED·REQUESTED) → 다른 관리자 승인,
// 요청자·판정자 본인 승인 불가(422 SELF_APPROVAL), 폐기 승인은 approvalRef 필수(422 APPROVAL_REQUIRED)·버전, 실행은 잔량 이하(422 QTY_EXCEEDS_APPROVED),
// 회수품 검수는 관리자·반입한 사람 아님, RESALE 은 상온·미개봉·신선 아님만(422 RESALE_NOT_ALLOWED), 줄 합계 = 반입 수량.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { db, nextSeq, timestamp, type MockDecision, type MockDisposal, type MockInspection } from './db';
import { expectedVersion, idempotent, operator, problem, unauthorized } from './support';

const canAccess = (request: Request, mfcId: string) => operator(request)?.centers.includes(mfcId) ?? false;
const isSupervisor = (request: Request) => operator(request)?.roles.includes('MFC_SUPERVISOR') ?? false;
const actor = (request: Request) => operator(request)?.subject ?? '';
const keyOf = (request: Request) => request.headers.get('Idempotency-Key') ?? '';

type Line = { sku: string; lotId: string; locationCode: string; qty: number; workState?: 'STORED' | 'UNSTOWED' };

export const qualityHandlers = [
  http.post(`${API_BASE}/quality-decisions`, async ({ request }) => {
    if (!operator(request)) return unauthorized();
    const body = (await request.json()) as { mfcId: string; decisionType: 'QUARANTINE' | 'RELEASE'; reason: MockDecision['reason']; note?: string; lines: Line[] };
    if (!canAccess(request, body.mfcId)) return problem(403, 'FORBIDDEN');
    return idempotent(request, () => {
      const release = body.decisionType === 'RELEASE';
      const d: MockDecision = {
        qualityDecisionId: `QD-${nextSeq()}`,
        mfcId: body.mfcId,
        decisionType: body.decisionType,
        decidedBy: actor(request),
        reason: body.reason,
        ...(body.note ? { note: body.note } : {}),
        lines: body.lines,
        version: 1,
        state: release ? 'REQUESTED' : 'APPLIED',
        rejectReason: null,
        approvedAt: null,
        inventoryApplyStatus: release ? 'NOT_REQUESTED' : 'APPLIED',
        inventoryCommitId: release ? null : `CMT-${nextSeq()}`,
        appliedQty: release ? 0 : body.lines.reduce((n, l) => n + l.qty, 0),
        affectedOrderIds: [],
        decidedAt: timestamp(),
      };
      db.decisions.set(d.qualityDecisionId, d);
      return { status: 202, body: { status: release ? 'ACCEPTED' : 'APPLIED', requestId: keyOf(request), resultId: d.qualityDecisionId } };
    });
  }),

  http.get(`${API_BASE}/quality-decisions/:id`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const d = db.decisions.get(String(params.id));
    if (!d || !canAccess(request, d.mfcId)) return problem(404, 'NOT_FOUND');
    return HttpResponse.json(d);
  }),

  http.post(`${API_BASE}/quality-decisions/:id/approvals`, async ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const d = db.decisions.get(String(params.id));
    if (!d || !canAccess(request, d.mfcId)) return problem(404, 'NOT_FOUND');
    if (!isSupervisor(request)) return problem(403, 'FORBIDDEN');
    const body = (await request.json()) as { action: 'APPROVE' | 'REJECT'; note?: string };
    return idempotent(request, () => {
      if (d.state !== 'REQUESTED') return problem(409, 'INVALID_STATE');
      if (d.decidedBy === actor(request)) return problem(422, 'SELF_APPROVAL');
      const approve = body.action === 'APPROVE';
      const next: MockDecision = {
        ...d,
        approverId: actor(request),
        state: approve ? 'APPLIED' : 'DECLINED',
        inventoryApplyStatus: approve ? 'APPLIED' : 'NOT_REQUESTED',
        inventoryCommitId: approve ? `CMT-${nextSeq()}` : null,
        appliedQty: approve ? d.lines.reduce((n, l) => n + l.qty, 0) : 0,
        approvedAt: approve ? timestamp() : null,
        version: (d.version ?? 0) + 1,
      };
      db.decisions.set(next.qualityDecisionId, next);
      return { status: 200, body: next };
    });
  }),

  http.post(`${API_BASE}/disposal-approvals`, async ({ request }) => {
    if (!operator(request)) return unauthorized();
    const body = (await request.json()) as { action: 'REQUEST' | 'APPROVE' | 'REJECT'; mfcId: string; disposalApprovalId?: string; approvalRef?: string; reason?: string; sourceRef?: string; lines?: Line[] };
    if (!canAccess(request, body.mfcId)) return problem(403, 'FORBIDDEN');
    return idempotent(request, () => {
      if (body.action === 'REQUEST') {
        const id = `DSP-${nextSeq()}`;
        const lines = (body.lines ?? []).map((l) => ({ sku: l.sku, lotId: l.lotId, locationCode: l.locationCode, requestedQty: l.qty, approvedQty: 0, executedQty: 0, remainingQty: 0 }));
        db.disposals.set(id, {
          disposalApprovalId: id,
          mfcId: body.mfcId,
          version: 1,
          state: 'REQUESTED',
          requesterId: actor(request),
          approverId: null,
          approvalRef: null,
          sourceRef: body.sourceRef ?? '',
          lines,
          executions: [],
          reason: body.reason ?? null,
          requestedAt: timestamp(),
          decidedAt: null,
        });
        return { status: 202, body: { status: 'APPLIED', requestId: keyOf(request), resultId: id, version: 1 } };
      }
      const d = db.disposals.get(body.disposalApprovalId ?? '');
      if (!d) return problem(404, 'NOT_FOUND');
      if (!isSupervisor(request)) return problem(403, 'FORBIDDEN');
      if (expectedVersion(request) !== undefined && expectedVersion(request) !== d.version) return problem(409, 'VERSION_CONFLICT');
      if (d.state !== 'REQUESTED') return problem(409, 'INVALID_STATE');
      if (d.requesterId === actor(request)) return problem(422, 'SELF_APPROVAL');
      if (body.action === 'APPROVE' && !body.approvalRef?.trim()) return problem(422, 'APPROVAL_REQUIRED');
      const approve = body.action === 'APPROVE';
      const next: MockDisposal = {
        ...d,
        version: d.version + 1,
        state: approve ? 'APPROVED' : 'REJECTED',
        approverId: actor(request),
        approvalRef: body.approvalRef ?? null,
        decidedAt: timestamp(),
        lines: (d.lines ?? []).map((l) => (approve ? { ...l, approvedQty: l.requestedQty ?? 0, remainingQty: l.requestedQty ?? 0 } : l)),
      };
      db.disposals.set(next.disposalApprovalId, next);
      return { status: 202, body: { status: 'APPLIED', requestId: keyOf(request), resultId: next.disposalApprovalId, version: next.version } };
    });
  }),

  http.get(`${API_BASE}/disposal-approvals/:id`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const d = db.disposals.get(String(params.id));
    if (!d || !canAccess(request, d.mfcId)) return problem(404, 'NOT_FOUND');
    return HttpResponse.json(d);
  }),

  http.post(`${API_BASE}/disposal-approvals/:id/executions`, async ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const d = db.disposals.get(String(params.id));
    if (!d || !canAccess(request, d.mfcId)) return problem(404, 'NOT_FOUND');
    const body = (await request.json()) as { lines: Line[] };
    return idempotent(request, () => {
      if (d.state !== 'APPROVED' && d.state !== 'PARTIALLY_EXECUTED') return problem(409, 'INVALID_STATE');
      for (const l of body.lines) {
        const own = d.lines?.find((x) => x.sku === l.sku && x.lotId === l.lotId && x.locationCode === l.locationCode);
        if (!own || l.qty > (own.remainingQty ?? 0)) return problem(422, 'QTY_EXCEEDS_APPROVED');
      }
      const lines = (d.lines ?? []).map((x) => {
        const q = body.lines.find((l) => l.sku === x.sku && l.lotId === x.lotId && l.locationCode === x.locationCode)?.qty ?? 0;
        return { ...x, executedQty: (x.executedQty ?? 0) + q, remainingQty: (x.remainingQty ?? 0) - q };
      });
      const qty = body.lines.reduce((n, l) => n + l.qty, 0);
      const exe = { executionId: `EXE-${keyOf(request).slice(0, 8)}`, disposalApprovalId: d.disposalApprovalId, state: 'APPLIED' as const, executedBy: actor(request), lines: body.lines, qty, inventoryCommitId: `CMT-${nextSeq()}`, rejectReason: null, executedAt: timestamp() };
      const done = lines.every((x) => (x.remainingQty ?? 0) === 0);
      db.disposals.set(d.disposalApprovalId, { ...d, version: d.version + 1, lines, state: done ? 'COMPLETED' : 'PARTIALLY_EXECUTED', executions: [...(d.executions ?? []), exe] });
      return { status: 201, body: exe };
    });
  }),

  http.post(`${API_BASE}/return-inspections`, async ({ request }) => {
    if (!operator(request)) return unauthorized();
    const body = (await request.json()) as MockInspection;
    if (!canAccess(request, body.mfcId) || !isSupervisor(request)) return problem(403, 'FORBIDDEN');
    return idempotent(request, () => {
      const rr = db.returnReceipts.get(body.returnReceiptId);
      if (!rr || rr.inspectionState !== 'PENDING') return problem(409, 'INVALID_STATE');
      if (rr.receivedBy === actor(request)) return problem(422, 'SELF_APPROVAL');
      if (body.lines.some((l) => l.verdict === 'RESALE' && (l.temperatureZone !== 'AMBIENT' || l.opened || l.fresh))) return problem(422, 'RESALE_NOT_ALLOWED');
      const total = body.lines.reduce((n, l) => n + l.qty, 0);
      if (total !== rr.lines.reduce((n, l) => n + l.qty, 0)) return problem(422, 'QTY_EXCEEDS_RECEIVED');
      const id = `RI-${nextSeq()}`;
      const resaleQty = body.lines.filter((l) => l.verdict === 'RESALE').reduce((n, l) => n + l.qty, 0);
      const disposeQty = total - resaleQty;
      const insp: MockInspection = {
        ...body,
        returnInspectionId: id,
        version: 1,
        resaleQty,
        disposeQty,
        inventoryApplyStatus: 'APPLIED',
        inventoryCommitId: resaleQty ? `CMT-${nextSeq()}` : null,
        disposalApprovalId: disposeQty ? `DSP-${nextSeq()}` : null,
        inspectedAt: timestamp(),
      };
      db.inspections.set(id, insp);
      db.returnReceipts.set(rr.returnReceiptId, { ...rr, inspectionState: 'INSPECTED' });
      return { status: 202, body: { status: 'APPLIED', requestId: keyOf(request), resultId: id } };
    });
  }),

  http.get(`${API_BASE}/return-inspections/:id`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const i = db.inspections.get(String(params.id));
    if (!i || !canAccess(request, i.mfcId)) return problem(404, 'NOT_FOUND');
    return HttpResponse.json(i);
  }),
];
