import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { ApprovalDetail, ApprovalType, ChangeRequestBody, Decision } from '../api/models';
import { db, nextId, timestamp } from './db';
import { decide, settle } from './effects';
import { expectedVersion, idempotent, keyOf, operator, problem, unauthorized } from './support';

/** 승인 종류별 승인자 역할(handoff 2026-10-30 §2) */
const approverRole: Partial<Record<ApprovalType, string | readonly string[]>> = {
  PRODUCT: 'PRODUCT_APPROVER',
  DISPLAY: 'DISPLAY_APPROVER',
  PRICE: 'PRICE_APPROVER',
  // 직원 권한 요청 수동 심사 = 운영 관리자(pmart-backend approval-service approver-roles.GRANT, 2026-11-13)
  GRANT: 'OPERATOR_ADMIN',
  // 검색 동의어(approval 0.5.0) — 승인자 운영 관리자
  SEARCH_SYNONYM: 'OPERATOR_ADMIN',
  // 행사(approval 0.6.0, ADR-0082) — 승인자 MARKETING 또는 OPERATOR_ADMIN(쉼표로 여럿 중 하나), 자기 승인 금지
  PROMOTION: ['MARKETING', 'OPERATOR_ADMIN'],
  // 운영자 RAG 문서(approval 0.7.0, ADR-0092) — 다른 운영 관리자, 자기 승인 금지
  RAG_DOCUMENT: 'OPERATOR_ADMIN',
};
/** 이 종류를 승인할 수 있는 역할을 가졌나(설정이 여럿이면 그중 하나) */
const hasApproverRole = (type: ApprovalType, roles: readonly string[]) => {
  const r = approverRole[type];
  return r !== undefined && (typeof r === 'string' ? [r] : r).some((x) => roles.includes(x));
};

/** GRANT 행이 권한을 줄 직원 ID(attributes.employee.operatorId) */
function grantEmployee(a: { lines?: ReadonlyArray<{ attributes?: Record<string, unknown> }> }): string[] {
  return (a.lines ?? []).flatMap((l) => {
    const emp = l.attributes?.['employee'];
    const id = typeof emp === 'object' && emp !== null ? (emp as Record<string, unknown>)['operatorId'] : null;
    return typeof id === 'string' ? [id] : [];
  });
}

/**
 * AP-3(approval 0.4.0): 보는 사람이 지금 결정할 수 있나 — 결정 API 와 같은 검사를 같은 순서로(심사 중 → 자기 요청 → 역할 설정 → 역할 → 자기 권한 요청).
 */
function viewerDecide(a: { type?: ApprovalType; reviewState?: string; requesterId?: string; lines?: ReadonlyArray<{ attributes?: Record<string, unknown> }> }, who: { subject: string; roles: readonly string[] } | null) {
  if (!who) return {};
  const reason =
    a.reviewState !== 'REVIEW_PENDING'
      ? 'NOT_PENDING'
      : a.requesterId === who.subject
        ? 'SELF_APPROVAL'
        : !a.type || !approverRole[a.type]
          ? 'CONFIG_REQUIRED'
          : !hasApproverRole(a.type, who.roles)
            ? 'NO_ROLE'
            : a.type === 'GRANT' && grantEmployee(a).includes(who.subject)
              ? 'GRANT_TO_SELF'
              : null;
  return reason ? { viewerCanDecide: false, viewerDecideBlockedReason: reason } : { viewerCanDecide: true, viewerDecideBlockedReason: null };
}

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
      // 같은 원객체·종류의 열린 승인이 있으면 DUPLICATE_APPROVAL(동의어는 대상이 하나라 한 번에 하나)
      if ([...db.approvals.values()].some((x) => x.type === cr.type && x.targetRef === cr.targetRef && (x.reviewState === 'REVIEW_PENDING' || x.reviewState === 'EVIDENCE_REQUIRED'))) return problem(409, 'DUPLICATE_APPROVAL');
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
    const who = operator(request);
    if (!who) return unauthorized();
    const q = new URL(request.url).searchParams;
    const items = [...db.approvals.values()]
      .map((a) => ({ ...a, ...viewerDecide(a, who) }))
      // AP-3: decidableByMe=true 면 지금 결정할 수 있는 것만
      .filter((a) => q.get('decidableByMe') !== 'true' || a.viewerCanDecide === true)
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

  http.get(`${API_BASE}/approvals/:id`, ({ request, params }) => {
    const id = String(params['id']);
    const before = db.approvals.get(id);
    if (!before) return problem(404, 'NOT_FOUND');
    const shown = { ...before, ...viewerDecide(before, operator(request)) };
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
      if (!a.type || !hasApproverRole(a.type, who.roles) || a.requesterId === who.subject || (a.type === 'GRANT' && grantEmployee(a).includes(who.subject))) return problem(403, 'FORBIDDEN');
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
