// ⚠ 화면 개발·시험용 목 — 라이더 운영 화면(2026-11-17, PC 5): 대시보드 수·라이더 찾기/상세/제한/원문/제한 검토·관제 위치·
// 직원용 수행료/운행시간·상태 정정·실패 결정·배차 취소·도움요청 대화·라이더 문의 대화·수행료 조정·추가 배달료·센터 목록.
// 실제 서버 동작이 아니다(권한·상태 규칙은 흉내만). 상태는 resetOps() 로 되돌린다.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { nextSeq, timestamp } from './db';
import { idempotent, operator, problem, unauthorized } from './support';

const OPS_ROLES = ['RIDER_OPS', 'OPERATOR_ADMIN'];
const canAct = (roles: readonly string[]) => roles.some((r) => OPS_ROLES.includes(r));

interface MockRider {
  riderId: string;
  nameMasked: string;
  phoneMasked: string;
  vehicleType: string;
  operatingStatus: 'ON_DUTY' | 'OFF_DUTY';
  restriction: string;
  joinedAt: string;
  version: number;
}

function seedRiders(): MockRider[] {
  return [
    { riderId: 'RD-7', nameMasked: '김*수', phoneMasked: '010****5678', vehicleType: 'MOTORCYCLE', operatingStatus: 'ON_DUTY', restriction: 'NORMAL', joinedAt: '2026-11-17T01:00:00.000Z', version: 2 },
    { riderId: 'RD-8', nameMasked: '이*', phoneMasked: '010****1234', vehicleType: 'BICYCLE', operatingStatus: 'OFF_DUTY', restriction: 'SUSPENDED', joinedAt: '2026-11-16T03:00:00.000Z', version: 1 },
  ];
}

export const ops = {
  riders: seedRiders(),
  restrictionHistory: [] as Array<Record<string, unknown>>,
  helpMessages: [] as Array<{ messageId: string; seq: number; senderType: 'RIDER' | 'SUPPORT'; body: string | null; masked?: boolean; createdAt: string }>,
  help: { state: 'OPEN' as 'OPEN' | 'IN_PROGRESS' | 'RESOLVED', resolvedAt: null as string | null },
  inquiryMessages: [] as Array<{ messageId: string; seq: number; senderType: 'RIDER' | 'SUPPORT'; body: string; createdAt: string }>,
  inquiryStatus: 'RECEIVED' as 'RECEIVED' | 'ANSWERED' | 'CLOSED',
  adjustments: [{ earningId: 'ERN-1', deliveryId: 'DLV-1', riderId: 'RD-7', calculable: false, settlementState: 'ESTIMATED', recordedAt: '2026-11-17T02:00:00.000Z', note: '자동 완료(픽업 5시간)' }],
  surcharges: [
    { requestId: 'SUR-1', deliveryId: 'DLV-3', riderId: 'RD-7', reason: 'ELEVATOR_OUT_OF_ORDER', floor: 22, amount: 1000, evidenceRefs: ['EVP-1'], state: 'REQUESTED', requestedAt: '2026-11-17T03:00:00.000Z' },
  ] as Array<Record<string, unknown> & { requestId: string; state: string }>,
};

export function resetOps(): void {
  ops.riders = seedRiders();
  ops.restrictionHistory = [];
  ops.helpMessages = [{ messageId: 'HM-1', seq: 1, senderType: 'RIDER', body: '공동현관 비밀번호가 틀려요', createdAt: '2026-11-17T01:00:00.000Z' }];
  ops.help = { state: 'OPEN', resolvedAt: null };
  ops.inquiryMessages = [];
  ops.inquiryStatus = 'RECEIVED';
  ops.adjustments = [{ earningId: 'ERN-1', deliveryId: 'DLV-1', riderId: 'RD-7', calculable: false, settlementState: 'ESTIMATED', recordedAt: '2026-11-17T02:00:00.000Z', note: '자동 완료(픽업 5시간)' }];
  ops.surcharges = [
    { requestId: 'SUR-1', deliveryId: 'DLV-3', riderId: 'RD-7', reason: 'ELEVATOR_OUT_OF_ORDER', floor: 22, amount: 1000, evidenceRefs: ['EVP-1'], state: 'REQUESTED', requestedAt: '2026-11-17T03:00:00.000Z' },
  ];
}
resetOps();

const applied = (id: string) => ({ status: 200, body: { status: 'APPLIED', requestId: id, resultId: id, occurredAt: timestamp() } });

/** 로그인 직원만, 조치는 라이더 운영·관리자만(서버처럼 403) */
function guard(request: Request, act = false) {
  const who = operator(request);
  if (!who) return { error: unauthorized() } as const;
  if (act && !canAct(who.roles)) return { error: problem(403, 'FORBIDDEN') } as const;
  return { who } as const;
}

const IQP_1 = { photoId: 'IQP-1', url: '/api/v1/inquiry-photos/IQP-1', contentType: 'image/jpeg' as const, sizeBytes: 4, uploadedAt: '2026-11-17T00:29:00.000Z' };
const SUR_DONE = { requestId: 'SUR-0', deliveryId: 'DLV-3', riderId: 'RD-8', reason: 'ELEVATOR_OUT_OF_ORDER', floor: 18, amount: 500, evidenceRefs: [], state: 'APPROVED', requestedAt: '2026-11-16T05:00:00.000Z', decidedAt: '2026-11-16T06:00:00.000Z', decidedBy: 'OP-rops-1', decisionNote: null };

export const opsHandlers = [
  http.get(`${API_BASE}/centers`, () => HttpResponse.json({ items: [{ centerId: 'MFC-BSJ-01', name: 'PMart 부산진구지점', type: 'MFC' }] })),

  http.get(`${API_BASE}/riders/stats`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    const rs = ops.riders;
    const by = (x: string) => rs.filter((r) => r.restriction === x).length;
    return HttpResponse.json({
      total: rs.length,
      onDuty: rs.filter((r) => r.operatingStatus === 'ON_DUTY').length,
      onDutyAcceptingNew: 1,
      byRestriction: { NORMAL: by('NORMAL'), DISPATCH_RESTRICTED: by('DISPATCH_RESTRICTED'), SUSPENDED: by('SUSPENDED'), TERMINATED: by('TERMINATED') },
      joinedToday: 1,
      asOf: timestamp(),
    });
  }),
  http.get(`${API_BASE}/delivery-stats`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return HttpResponse.json({
      inProgress: { UNASSIGNED: 1, ASSIGNED: 0, ARRIVED_AT_STORE: 0, PICKED_UP: 2, ARRIVED_AT_CUSTOMER: 0, FAILURE_REPORTED: 1, RETURN_PICKED_UP: 0 },
      completedToday: 5,
      failedToday: 1,
      openHelpRequests: 1,
      adjustmentPending: ops.adjustments.length,
      surchargeRequested: ops.surcharges.filter((s) => s.state === 'REQUESTED').length,
      asOf: timestamp(),
    });
  }),

  http.get(`${API_BASE}/riders/restriction-reviews`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return HttpResponse.json({
      items: [{ reviewId: 'RV-1', riderId: 'RD-8', complaintType: 'DAMAGE', state: 'OPEN', complaints: [{}, {}, {}], openedAt: '2026-11-17T00:00:00.000Z' }],
    });
  }),
  http.post(`${API_BASE}/riders/restriction-reviews/:reviewId/decisions`, async ({ request, params }) => {
    const g = guard(request, true);
    if ('error' in g) return g.error;
    const body = (await request.json()) as { decision: string };
    return idempotent(request, () => ({ status: 200, body: { reviewId: params.reviewId, state: body.decision } }));
  }),
  http.get(`${API_BASE}/riders`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    const q = new URL(request.url).searchParams;
    const items = ops.riders
      .filter((r) => !q.get('riderId') || r.riderId === q.get('riderId'))
      .filter((r) => !q.get('restriction') || r.restriction === q.get('restriction'))
      .filter((r) => !q.get('operatingStatus') || r.operatingStatus === q.get('operatingStatus'))
      .map((r) => ({ ...r, signupStatus: 'APPROVED' }));
    return HttpResponse.json({ items, page: 0, size: items.length, hasNext: false });
  }),
  http.get(`${API_BASE}/riders/:riderId/restrictions`, ({ request, params }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    const r = ops.riders.find((x) => x.riderId === params.riderId);
    if (!r) return problem(404, 'NOT_FOUND');
    return HttpResponse.json({ current: r.restriction, version: r.version, items: ops.restrictionHistory.filter((h) => h.riderId === r.riderId) });
  }),
  http.post(`${API_BASE}/riders/:riderId/restrictions`, async ({ request, params }) => {
    const g = guard(request, true);
    if ('error' in g) return g.error;
    const r = ops.riders.find((x) => x.riderId === params.riderId);
    if (!r) return problem(404, 'NOT_FOUND');
    const body = (await request.json()) as { restriction: string; reason: string };
    return idempotent(request, () => {
      const rec = { riderId: r.riderId, previous: r.restriction, restriction: body.restriction, reason: body.reason, changedBy: g.who.subject, changedAt: timestamp(), version: r.version + 1 };
      r.restriction = body.restriction;
      r.version += 1;
      ops.restrictionHistory.unshift(rec);
      return { status: 200, body: rec };
    });
  }),
  http.post(`${API_BASE}/riders/:riderId/pii-reveals`, async ({ request, params }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    const body = (await request.json()) as { reason?: string };
    if (!body.reason || body.reason.trim().length < 2) return problem(400, 'VALIDATION_FAILED');
    return idempotent(request, () => ({ status: 200, body: { riderId: params.riderId, name: '김민수', phone: '01012345678', recordedAt: timestamp() } }));
  }),
  http.get(`${API_BASE}/riders/:riderId`, ({ request, params }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    const r = ops.riders.find((x) => x.riderId === params.riderId);
    if (!r) return problem(404, 'NOT_FOUND');
    return HttpResponse.json({
      ...r,
      signupStatus: 'APPROVED',
      signupDecidedBy: 'AUTO',
      deliveryAreas: [{ mfcId: 'MFC-BSJ-01' }],
      operating: { status: r.operatingStatus, newDispatchEnabled: r.operatingStatus === 'ON_DUTY' },
      restriction: { state: r.restriction },
    });
  }),

  http.get(`${API_BASE}/rider-earnings/adjustment-queue`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return HttpResponse.json({ items: ops.adjustments });
  }),
  http.post(`${API_BASE}/rider-earnings/:earningId/adjustments`, ({ request, params }) => {
    const g = guard(request, true);
    if ('error' in g) return g.error;
    return idempotent(request, () => {
      ops.adjustments = ops.adjustments.filter((a) => a.earningId !== params.earningId);
      return { status: 200, body: { earningId: params.earningId, settlementState: 'CONFIRMED' } };
    });
  }),
  http.get(`${API_BASE}/rider-earnings`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return HttpResponse.json({
      items: [{ earningId: 'ERN-9', deliveryId: 'DLV-3', riderId: 'RD-7', calculable: true, total: 3900, settlementState: 'PENDING_CONFIRMATION', recordedAt: '2026-11-17T02:00:00.000Z' }],
      totals: { estimated: 3900, confirmed: 0, paid: 0 },
      page: { size: 1 },
    });
  }),
  http.get(`${API_BASE}/rider-operating-time`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return HttpResponse.json({ from: '2026-11-16', to: '2026-11-17', totalSeconds: 5400, days: [] });
  }),

  http.get(`${API_BASE}/surcharge-requests`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    // 거르기: state·riderId(완전 일치), 기본은 전부(계약). 목 전용: SUR-0 은 이미 승인된 건
    const q = new URL(request.url).searchParams;
    const all = [SUR_DONE, ...ops.surcharges];
    return HttpResponse.json({ items: all.filter((s) => (!q.get('state') || s.state === q.get('state')) && (!q.get('riderId') || s.riderId === q.get('riderId'))) });
  }),
  http.post(`${API_BASE}/surcharge-requests/:requestId/decisions`, async ({ request, params }) => {
    const g = guard(request, true);
    if ('error' in g) return g.error;
    const body = (await request.json()) as { decision: 'APPROVE' | 'REJECT' };
    const s = ops.surcharges.find((x) => x.requestId === params.requestId);
    if (!s) return problem(404, 'NOT_FOUND');
    return idempotent(request, () => {
      s.state = body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      return { status: 200, body: { ...s, decidedBy: g.who.subject, decidedAt: timestamp() } };
    });
  }),

  http.get(`${API_BASE}/rider-locations`, ({ request }) => {
    const g = guard(request, true);
    if ('error' in g) return g.error;
    return HttpResponse.json({
      asOf: timestamp(),
      items: [
        {
          riderId: 'RD-7',
          nameMasked: '김*수',
          vehicleType: 'MOTORCYCLE',
          newDispatchEnabled: true,
          restriction: 'NORMAL',
          location: { lat: 35.1585, lng: 129.062, accuracyM: 10, recordedAt: timestamp(), receivedAt: timestamp(), quality: 'GOOD' },
          staleSinceSeconds: 8,
          stale: false,
          activeDeliveries: [{ deliveryId: 'DLV-1', stage: 'TO_CUSTOMER', pickedUp: true, etaDrop: null }],
        },
        { riderId: 'RD-9', vehicleType: 'BICYCLE', newDispatchEnabled: false, restriction: 'NORMAL', location: null, staleSinceSeconds: null, stale: true, activeDeliveries: [] },
      ],
    });
  }),

  http.post(`${API_BASE}/deliveries/:deliveryId/status-corrections`, ({ request }) => {
    const g = guard(request, true);
    if ('error' in g) return g.error;
    return idempotent(request, () => applied(`COR-${nextSeq()}`));
  }),
  http.post(`${API_BASE}/deliveries/:deliveryId/failure-decisions`, async ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    const body = (await request.json()) as { reason?: string };
    if (body.reason && !canAct(g.who.roles)) return problem(403, 'FORBIDDEN');
    return idempotent(request, () => applied(`DEC-${nextSeq()}`));
  }),
  http.post(`${API_BASE}/deliveries/:deliveryId/assignment-cancellations`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return idempotent(request, () => applied(`CAN-${nextSeq()}`));
  }),

  http.get(`${API_BASE}/delivery-help-requests`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return HttpResponse.json({
      items: [{ requestId: 'HR-1', deliveryId: 'DLV-1', riderId: 'RD-7', category: 'ADDRESS_ISSUE', state: 'OPEN', createdAt: '2026-11-17T01:00:00.000Z' }],
    });
  }),
  http.get(`${API_BASE}/deliveries/:deliveryId/help-requests/:requestId/messages`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return HttpResponse.json({ items: ops.helpMessages, helpState: ops.help.state });
  }),
  http.post(`${API_BASE}/deliveries/:deliveryId/help-requests/:requestId/messages`, async ({ request }) => {
    const g = guard(request, true);
    if ('error' in g) return g.error;
    const body = (await request.json()) as { body: string };
    return idempotent(request, () => {
      const msg = { messageId: `HM-${nextSeq()}`, seq: ops.helpMessages.length + 1, senderType: 'SUPPORT' as const, body: body.body, createdAt: timestamp() };
      ops.helpMessages.push(msg);
      return { status: 201, body: msg };
    });
  }),
  http.get(`${API_BASE}/deliveries/:deliveryId/help-requests/:requestId`, ({ request, params }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    // 목 전용: HR-CASE 는 접수 건이 붙은 도움요청(처리함 409 HELP_REQUEST_HAS_CASE), 사진 EVP-H2 는 못 받는 사진(404)
    const withCase = params.requestId === 'HR-CASE';
    return HttpResponse.json({
      requestId: params.requestId,
      deliveryId: params.deliveryId,
      category: 'ADDRESS_ISSUE',
      state: withCase ? 'IN_PROGRESS' : ops.help.state,
      detail: '공동현관',
      evidenceRefs: ['EVP-H1', 'EVP-H2'],
      caseId: withCase ? 'CASE-9' : null,
      resolvedAt: ops.help.resolvedAt,
      createdAt: '2026-11-17T01:00:00.000Z',
    });
  }),
  // 도움요청 처리함(0.4.0) — OPEN·IN_PROGRESS → RESOLVED, 이미 RESOLVED 면 409 INVALID_STATE, 접수 건이 붙었으면 409 HELP_REQUEST_HAS_CASE
  http.post(`${API_BASE}/deliveries/:deliveryId/help-requests/:requestId/resolutions`, ({ request, params }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return idempotent(request, () => {
      if (params.requestId === 'HR-CASE') return problem(409, 'HELP_REQUEST_HAS_CASE');
      if (ops.help.state === 'RESOLVED') return problem(409, 'INVALID_STATE');
      ops.help = { state: 'RESOLVED', resolvedAt: timestamp() };
      return { status: 200, body: { requestId: params.requestId, deliveryId: params.deliveryId, state: 'RESOLVED', resolvedAt: ops.help.resolvedAt, resolvedBy: g.who.subject } };
    });
  }),
  // 대화 가리기(0.8.0) — OPERATOR_ADMIN 만, 사유 2~500자
  http.post(`${API_BASE}/deliveries/:deliveryId/help-requests/:requestId/messages/:messageId/maskings`, async ({ request, params }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    if (!g.who.roles.includes('OPERATOR_ADMIN')) return problem(403, 'FORBIDDEN');
    const body = (await request.json()) as { reason?: string };
    const reason = (body.reason ?? '').trim();
    if (reason.length < 2 || reason.length > 500) return problem(400, 'VALIDATION_FAILED', [{ field: 'reason', reason: 'LENGTH' }]);
    const msg = ops.helpMessages.find((x) => x.messageId === params.messageId);
    if (!msg) return problem(404, 'NOT_FOUND');
    return idempotent(request, () => {
      msg.body = null;
      msg.masked = true;
      return { status: 200, body: msg };
    });
  }),
  // 증빙 사진(0.20.0) — 원본 이미지. 목 전용: EVP-H2 는 404(못 받는 사진)
  http.get(`${API_BASE}/deliveries/:deliveryId/evidence-photos/:photoRef`, ({ request, params }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    if (params.photoRef === 'EVP-H2') return problem(404, 'NOT_FOUND');
    return new HttpResponse(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } });
  }),

  http.get(`${API_BASE}/inquiries`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    const status = new URL(request.url).searchParams.get('status');
    const one = { inquiryId: 'INQ-1', category: 'SETTLEMENT', title: '정산 문의', status: ops.inquiryStatus, createdAt: '2026-11-17T00:30:00.000Z' };
    return HttpResponse.json({ items: !status || status === ops.inquiryStatus ? [one] : [] });
  }),
  http.get(`${API_BASE}/inquiries/:inquiryId/messages`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return HttpResponse.json({ items: ops.inquiryMessages, status: ops.inquiryStatus });
  }),
  http.post(`${API_BASE}/inquiries/:inquiryId/replies`, async ({ request, params }) => {
    const g = guard(request, true);
    if ('error' in g) return g.error;
    const body = (await request.json()) as { body: string };
    return idempotent(request, () => {
      ops.inquiryMessages.push({ messageId: `IM-${nextSeq()}`, seq: ops.inquiryMessages.length + 1, senderType: 'SUPPORT', body: body.body, createdAt: timestamp() });
      ops.inquiryStatus = 'ANSWERED';
      return { status: 200, body: { inquiryId: params.inquiryId, status: 'ANSWERED' } };
    });
  }),
  http.post(`${API_BASE}/inquiries/:inquiryId/closures`, ({ request, params }) => {
    const g = guard(request, true);
    if ('error' in g) return g.error;
    return idempotent(request, () => {
      ops.inquiryStatus = 'CLOSED';
      return { status: 200, body: { inquiryId: params.inquiryId, status: 'CLOSED' } };
    });
  }),
  // 문의 사진(case 0.14.0) — 목 전용: IQP-1 만 있음, 그 밖 404
  http.get(`${API_BASE}/inquiry-photos/:photoId`, ({ request, params }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    if (params.photoId !== IQP_1.photoId) return problem(404, 'NOT_FOUND');
    return new HttpResponse(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store' } });
  }),
  http.get(`${API_BASE}/inquiries/:inquiryId`, ({ request, params }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return HttpResponse.json({ inquiryId: params.inquiryId, category: 'SETTLEMENT', title: '정산 문의', body: '지난주 정산이 빠졌어요', status: ops.inquiryStatus, createdAt: '2026-11-17T00:30:00.000Z', version: 1, replies: [], photos: [IQP_1] });
  }),
];
