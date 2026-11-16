// 운영 제한 목: mfc-capacity-service 0.14.0 `/operation-restrictions*`.
// 서버 규칙 중 화면이 보여 줄 것만: 그 센터 권한, 등록·해제 = MFC_SUPERVISOR, approvalRef 필수(422 APPROVAL_REQUIRED),
// 수용 축소는 reducedCapacityUnits 필수, 기본 목록은 활성만(activeOnly=true), 해제는 ACTIVE 만·버전(이미 LIFTED 면 202 지금 상태).
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { db, nextSeq, type MockRestriction } from './db';
import { expectedVersion, idempotent, operator, problem, unauthorized } from './support';

const canAccess = (request: Request, mfcId: string) => operator(request)?.centers.includes(mfcId) ?? false;
const isSupervisor = (request: Request) => operator(request)?.roles.includes('MFC_SUPERVISOR') ?? false;
const keyOf = (request: Request) => request.headers.get('Idempotency-Key') ?? '';

export const restrictionHandlers = [
  http.get(`${API_BASE}/operation-restrictions`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    const q = new URL(request.url).searchParams;
    const mfcId = q.get('mfcId') ?? '';
    if (!canAccess(request, mfcId)) return problem(403, 'FORBIDDEN');
    const activeOnly = q.get('activeOnly') !== 'false';
    const items = [...db.restrictions.values()]
      .filter((r) => r.mfcId === mfcId && (!activeOnly || r.state === 'ACTIVE'))
      .sort((a, b) => (b.effectiveFrom ?? '').localeCompare(a.effectiveFrom ?? ''));
    return HttpResponse.json({ items });
  }),

  http.post(`${API_BASE}/operation-restrictions`, async ({ request }) => {
    if (!operator(request)) return unauthorized();
    const body = (await request.json()) as {
      mfcId: string;
      restrictionType: 'INTAKE_STOP' | 'CAPACITY_REDUCE';
      approvalRef: string;
      reason?: string;
      effectiveFrom: string;
      effectiveTo?: string | null;
      reducedCapacityUnits?: number;
    };
    if (!canAccess(request, body.mfcId) || !isSupervisor(request)) return problem(403, 'FORBIDDEN');
    return idempotent(request, () => {
      if (!body.approvalRef?.trim()) return problem(422, 'APPROVAL_REQUIRED');
      if (body.restrictionType === 'CAPACITY_REDUCE' && body.reducedCapacityUnits === undefined) {
        return problem(400, 'VALIDATION_FAILED', [{ field: 'reducedCapacityUnits', reason: 'REQUIRED' }]);
      }
      const r: MockRestriction = {
        restrictionId: `RST-${nextSeq()}`,
        mfcId: body.mfcId,
        restrictionType: body.restrictionType,
        state: 'ACTIVE',
        version: 1,
        approvalRef: body.approvalRef,
        liftApprovalRef: null,
        reason: body.reason ?? '',
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo ?? null,
        reducedCapacityUnits: body.reducedCapacityUnits ?? null,
        affectedOrderIds: [],
      };
      db.restrictions.set(r.restrictionId, r);
      return { status: 201, body: { status: 'APPLIED', requestId: keyOf(request), resultId: r.restrictionId, version: 1 } };
    });
  }),

  http.get(`${API_BASE}/operation-restrictions/:id`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const r = db.restrictions.get(String(params.id));
    if (!r || !canAccess(request, r.mfcId)) return problem(404, 'NOT_FOUND');
    return HttpResponse.json(r);
  }),

  http.delete(`${API_BASE}/operation-restrictions/:id`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const r = db.restrictions.get(String(params.id));
    if (!r || !canAccess(request, r.mfcId)) return problem(404, 'NOT_FOUND');
    if (!isSupervisor(request)) return problem(403, 'FORBIDDEN');
    const approvalRef = new URL(request.url).searchParams.get('approvalRef') ?? '';
    return idempotent(request, () => {
      if (r.state === 'LIFTED') return { status: 202, body: { status: 'APPLIED', requestId: keyOf(request), resultId: r.restrictionId, version: r.version } };
      if (!approvalRef.trim()) return problem(422, 'APPROVAL_REQUIRED');
      if (expectedVersion(request) !== undefined && expectedVersion(request) !== r.version) return problem(409, 'VERSION_CONFLICT');
      const next: MockRestriction = { ...r, state: 'LIFTED', liftApprovalRef: approvalRef, version: r.version + 1 };
      db.restrictions.set(next.restrictionId, next);
      return { status: 202, body: { status: 'APPLIED', requestId: keyOf(request), resultId: next.restrictionId, version: next.version } };
    });
  }),
];
