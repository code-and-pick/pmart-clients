import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { ApprovalDetail, ApprovalType, ChangeRequestBody, Decision } from '../api/models';
import { db, nextId, timestamp } from './db';
import { decide, settle } from './effects';
import { expectedVersion, idempotent, keyOf, operator, problem, unauthorized } from './support';

/** 승인 종류별 승인자 역할(handoff 2026-10-30 §2) */
const approverRole: Partial<Record<ApprovalType, string>> = {
  PRODUCT: 'PRODUCT_APPROVER',
  DISPLAY: 'DISPLAY_APPROVER',
  PRICE: 'PRICE_APPROVER',
};

export const approvalHandlers = [
  http.post(`${API_BASE}/change-requests`, async ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const body = (await request.json()) as ChangeRequestBody;
    return idempotent(request, () => {
      const changeRequestId = nextId('cr');
      const cr = {
        ...body,
        changeRequestId,
        version: 0,
        requestState: 'DRAFT' as const,
        requesterId: who.subject,
        approvalId: null,
        createdAt: timestamp(),
        submittedAt: null,
      };
      db.changeRequests.set(changeRequestId, cr);
      return { status: 201, body: cr };
    });
  }),

  http.get(`${API_BASE}/change-requests/:id`, ({ params }) => {
    const cr = db.changeRequests.get(String(params['id']));
    return cr ? HttpResponse.json(cr) : problem(404, 'NOT_FOUND');
  }),

  http.post(`${API_BASE}/change-requests/:id/submissions`, ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    return idempotent(request, () => {
      const cr = db.changeRequests.get(String(params['id']));
      if (!cr) return problem(404, 'NOT_FOUND');
      if (cr.requestState !== 'DRAFT') return problem(409, 'INVALID_STATE');
      const v = expectedVersion(request);
      if (v !== undefined && v !== cr.version) return problem(409, 'VERSION_CONFLICT');
      const approvalId = nextId('apv');
      const approval: ApprovalDetail = {
        approvalId,
        changeRequestId: cr.changeRequestId ?? '',
        type: cr.type,
        targetService: cr.targetService,
        targetRef: cr.targetRef,
        summary: cr.summary,
        requesterId: cr.requesterId ?? '',
        requestState: 'SUBMITTED',
        reviewState: 'REVIEW_PENDING',
        executionState: 'NOT_REQUESTED',
        deliveryState: 'PENDING',
        caseId: null,
        submittedAt: timestamp(),
        expiresAt: null,
        version: 0,
        approvalVersion: 1,
        allowedActions: cr.allowedActions,
        lines: cr.lines ?? [],
        effectiveFrom: cr.requestedEffectiveFrom ?? null,
        decisions: [],
        receipts: [],
      };
      db.approvals.set(approvalId, approval);
      db.changeRequests.set(cr.changeRequestId ?? '', {
        ...cr,
        requestState: 'SUBMITTED',
        approvalId,
        submittedAt: timestamp(),
        version: (cr.version ?? 0) + 1,
      });
      for (const line of cr.lines ?? []) {
        const pd = db.productDrafts.get(line.lineKey);
        if (pd && cr.targetService === 'product-service') db.productDrafts.set(pd.draftId, { ...pd, approvalId });
        const cd = db.contentDrafts.get(line.lineKey);
        if (cd && cr.targetService === 'product-content-service') db.contentDrafts.set(cd.draftId, { ...cd, approvalId });
      }
      return { status: 202, body: { status: 'ACCEPTED', requestId: keyOf(request), resultId: approvalId, occurredAt: timestamp() } };
    });
  }),

  http.get(`${API_BASE}/approvals`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    const q = new URL(request.url).searchParams;
    const items = [...db.approvals.values()]
      .filter((a) => !q.get('type') || a.type === q.get('type'))
      .filter((a) => !q.get('reviewState') || a.reviewState === q.get('reviewState'))
      // BR-41 회신: 대상 참조 정확히 일치(예 productImportBatch:{batchId})
      .filter((a) => !q.get('targetRef') || a.targetRef === q.get('targetRef'))
      .sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));
    // 커서 쪽 넘김(목: 커서 = 시작 위치)
    const size = Math.min(Number(q.get('size') ?? '50') || 50, 100);
    const start = Number(q.get('cursor') ?? '0') || 0;
    const page = items.slice(start, start + size);
    return HttpResponse.json({ items: page, page: { nextCursor: start + size < items.length ? String(start + size) : null, size } });
  }),

  http.get(`${API_BASE}/approvals/:id`, ({ params }) => {
    const id = String(params['id']);
    const before = db.approvals.get(id);
    if (!before) return problem(404, 'NOT_FOUND');
    const shown = before;
    settle(id); // 이번 응답은 반영 전 상태, 다음 조회부터 반영 완료
    return HttpResponse.json(shown);
  }),

  http.post(`${API_BASE}/approvals/:id/decisions`, async ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const body = (await request.json()) as { decision: string; comment?: string };
    return idempotent(request, () => {
      const id = String(params['id']);
      const a = db.approvals.get(id);
      if (!a) return problem(404, 'NOT_FOUND');
      const role = a.type ? approverRole[a.type] : undefined;
      if (!role || !who.roles.includes(role) || a.requesterId === who.subject) return problem(403, 'FORBIDDEN');
      if (body.decision !== 'APPROVE' && body.decision !== 'REJECT') return problem(422, 'UNSUPPORTED_ACTION');
      if (a.reviewState !== 'REVIEW_PENDING' && a.reviewState !== 'EVIDENCE_REQUIRED') return problem(409, 'INVALID_STATE');
      const v = expectedVersion(request);
      if (v !== undefined && v !== a.version) return problem(409, 'VERSION_CONFLICT');
      const approved = body.decision === 'APPROVE';
      const decision: Decision = {
        decisionId: nextId('dec'),
        approvalId: id,
        approverId: who.subject,
        decidedAt: timestamp(),
        decision: approved ? 'APPROVE' : 'REJECT',
        ...(body.comment ? { comment: body.comment } : {}),
      };
      const next: ApprovalDetail = {
        ...a,
        version: (a.version ?? 0) + 1,
        reviewState: approved ? 'APPROVED' : 'REJECTED',
        executionState: approved ? 'VALIDATING' : 'NOT_REQUESTED',
        decisions: [...(a.decisions ?? []), decision],
      };
      db.approvals.set(id, next);
      decide(next, approved);
      return { status: 202, body: { status: 'ACCEPTED', requestId: keyOf(request), resultId: decision.decisionId, occurredAt: timestamp() } };
    });
  }),
];
