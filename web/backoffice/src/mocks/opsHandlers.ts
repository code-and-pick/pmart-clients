// ⚠ 화면 개발·시험용 목 — 고객센터·라이더 운영(백엔드 요청 2026-11-15 cs-rider-menus). 실제 서버 동작이 아니다.
// 계약: order 0.3.0 lookups, case 0.3.0 rider-complaints, claim 0.1.0, rider 0.3.0 restrictions·reviews, dispatch 0.3.1, execution 0.3.2.
// 역할은 지금 계약 설명 그대로 흉내 낸다(PC 5 PR #17 — BOD-1~6 반영): RIDER_OPS 는 계정 제한·검토·배차 조회/취소·실패 결정, CS_AGENT 는 배차 조회·실패 결정(취소는 403).
// 응답 모양은 생성 타입을 따른다. 계약에 없는 필드는 넣지 않는다.
import { http, HttpResponse } from 'msw';

import { API_BASE, BFF_BASE } from '../api/client';
import type { components as CaseC } from '../api/generated/case';
import type { components as ClaimC } from '../api/generated/claim';
import type { components as DispatchC } from '../api/generated/delivery-dispatch';
import type { components as ExecutionC } from '../api/generated/delivery-execution';
import type { components as OrderC } from '../api/generated/order';
import type { components as RiderC } from '../api/generated/rider';
import { expectedVersion, idempotent, keyOf, operator, problem, unauthorized } from './support';

type StaffOrder = OrderC['schemas']['StaffOrderDetail'];
type Issue = OrderC['schemas']['FulfillmentIssue'];
type Complaint = CaseC['schemas']['RiderComplaint'];
type Claim = ClaimC['schemas']['Claim'];
type Refund = ClaimC['schemas']['Refund'];
type DispatchView = DispatchC['schemas']['Delivery'];
type Execution = ExecutionC['schemas']['DeliveryExecution'];
type RestrictionRecord = RiderC['schemas']['RiderRestrictionRecord'];
type Restriction = RiderC['schemas']['AccountRestriction'];
type Review = RiderC['schemas']['RestrictionReview'];

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

function order(orderId: string, status: StaffOrder['status'], confirmedAt: string, phone: string): StaffOrder {
  return {
    orderId,
    status,
    confirmedAt,
    customerId: `CUS-${orderId.slice(-4)}`,
    mfcId: 'MFC-BSN-01',
    deliveryMode: 'SINGLE',
    arrivalWindow: { date: confirmedAt.slice(0, 10), start: '14:00', end: '15:00' },
    plannedShipments: 1,
    outOfStockPreference: 'CANCEL_OOS_ONLY',
    version: 3,
    weightG: 1800,
    deliveryNote: '[목] 문 앞에 두세요',
    amounts: {
      itemAmount: 12000,
      deliveryTip: 3000,
      deliveryTipBase: 3000,
      deliveryTipReason: 'STANDARD',
      firstPurchaseApplied: false,
      bagFee: 100,
      totalAmount: 15100,
      approvedAmount: 15100,
    },
    payment: { paymentAttemptId: `PAY-${orderId}`, pgTransactionId: `PG-${orderId}` },
    lines: [
      { orderLineId: `${orderId}-L1`, sku: 'E-00000001', productName: '사과 1.5kg', originalQty: 1, cancelledBeforeShipQty: 0, handedOverQty: 1, deliveredQty: 0, returnedQty: 0, unitPrice: 12000, lineAmount: 12000 },
    ],
    fulfillmentIssues: [],
    // 목 원장은 원문을 둔다 — 상세 응답은 maskedDetail() 로 가리고(0.4.0·0.5.0), 원문은 POST …/pii-reveals 로만 준다.
    shippingAddressMasked: false,
    shippingAddress: {
      receiverName: '[목] 김고객',
      receiverPhone: phone,
      roadAddress: '[목] 부산 수영구 광안로 1',
      detailAddress: '101동 1001호',
      postalCode: '48300',
      entranceMethod: 'PASSWORD',
      entranceNote: '[목] #1234',
      capturedAt: confirmedAt,
    },
  };
}

const maskPhone = (p: string | undefined) => (p && p.length >= 8 ? `${p.slice(0, 3)}-****-${p.slice(-4)}` : null);
/** 이름 첫·끝 글자만(홍*동) */
const maskName = (n: string | undefined) => (n === undefined ? undefined : n.length <= 1 ? '*' : `${n[0]}${'*'.repeat(Math.max(1, n.length - 2))}${n.length > 2 ? n[n.length - 1] : ''}`);

type PiiField = OrderC['schemas']['StaffPiiField'];
const PII_FIELDS: readonly PiiField[] = ['NAME', 'PHONE', 'ADDRESS', 'ENTRANCE'];

/** order 0.4.0·0.5.0 직원 상세: 이름·연락처·상세주소·출입 메모·핀·배송 요청사항을 가린다. `open` 에 든 항목만 원문 */
function maskedAddress(o: StaffOrder, open: readonly PiiField[] = []): OrderC['schemas']['ShippingAddress'] {
  const a = o.shippingAddress;
  if (!a) return null;
  const has = (f: PiiField) => open.includes(f);
  const name = has('NAME') ? a.receiverName : maskName(a.receiverName);
  const phone = has('PHONE') ? a.receiverPhone : maskPhone(a.receiverPhone);
  return {
    ...a,
    ...(name !== undefined ? { receiverName: name } : {}),
    ...(phone ? { receiverPhone: phone } : {}),
    detailAddress: has('ADDRESS') ? (a.detailAddress ?? '') : '***',
    geo: has('ADDRESS') ? (a.geo ?? null) : null,
    entranceNote: has('ENTRANCE') ? (a.entranceNote ?? null) : null,
  };
}

function maskedDetail(o: StaffOrder): StaffOrder {
  return {
    ...o,
    shippingAddress: maskedAddress(o),
    shippingAddressMasked: true,
    deliveryNote: null,
    ...(o.deliveryNote ? { deliveryNoteMasked: true } : {}),
  };
}

function execution(deliveryId: string, orderId: string, state: ExecutionC['schemas']['ExecutionState'], riderId: string | undefined): Execution {
  return {
    deliveryId,
    orderId,
    mfcId: 'MFC-BSN-01',
    type: 'FORWARD',
    state,
    ...(riderId ? { riderId, assignedAt: ago(2) } : {}),
    version: 4,
    history: [{ state: 'ASSIGNED', actor: 'SYSTEM_EVENT', occurredAt: ago(2) }],
    incidents: [],
  };
}

function dispatch(deliveryId: string, orderId: string, state: DispatchC['schemas']['DispatchState'], riderId: string | undefined): DispatchView {
  return {
    deliveryId,
    orderId,
    mfcId: 'MFC-BSN-01',
    type: 'FORWARD',
    state,
    version: 2,
    ...(riderId
      ? { assignment: { riderId, assignedAt: ago(2), state: state === 'PICKED_UP' ? 'PICKED_UP' : 'ASSIGNED', ...(state === 'PICKED_UP' ? { pickedUpAt: ago(1) } : {}) } }
      : {}),
    attempts: [{ attemptId: `ATT-${deliveryId}`, state: riderId ? 'ASSIGNED' : 'SEARCHING', trigger: 'STORE_STAFF', startedAt: ago(2) }],
  };
}

interface OpsState {
  seq: number;
  orders: StaffOrder[];
  executions: Map<string, Execution>;
  dispatches: Map<string, DispatchView>;
  complaints: Complaint[];
  claims: Claim[];
  refunds: Map<string, Refund[]>;
  riders: Map<string, { version: number; current: Restriction; history: RestrictionRecord[] }>;
  reviews: Review[];
  /** 배차 취소 짝 조회: requestId → 처리 결과(다음 조회부터 확정으로 보인다) */
  cancellations: Map<string, { deliveryId: string; outcome: 'CANCELLED_BEFORE_PICKUP' | 'REJECTED_PICKED_UP'; polled: boolean }>;
  /** order 0.6.0 이행 확인 필요(처리 대기 메뉴) */
  issues: Issue[];
  /** orchestration 0.2.0 멈춘 사가(bff pending-work 의 STUCK_SAGA) — resolved 면 목록에서 빠진다 */
  sagas: Array<{ sagaId: string; orderId: string; sagaType: string; state: string; step: string; reasonCode: string; reasonMessage: string; since: string; requeryable: boolean; resolved: boolean }>;
  /** bff 명령 결과(짝 조회) */
  bffResults: Map<string, { requestId: string; status: 'APPLIED'; occurredAt: string }>;
}

function seed(): OpsState {
  const failed = execution('DLV-MOCK-2', 'ORD-MOCK-1002', 'FAILURE_REPORTED', 'RID-MOCK-2');
  failed.failure = { reason: 'CUSTOMER_UNREACHABLE', detail: '[목] 세 번 전화했지만 받지 않았어요.', goodsLocation: 'WITH_RIDER', contactAttempts: 3, reportedAt: ago(1) };
  return {
    seq: 100,
    sagas: [
      { sagaId: 'SAGA-MOCK-1', orderId: 'ORD-MOCK-1001', sagaType: 'S1_CHECKOUT', state: 'ESCALATED', step: 'PAYMENT_CONFIRM', reasonCode: 'PAYMENT_UNKNOWN', reasonMessage: '[목] PG 승인 결과를 모름 — 결제 결과 다시 확인 필요', since: ago(2), requeryable: true, resolved: false },
      { sagaId: 'SAGA-MOCK-2', orderId: 'ORD-MOCK-1003', sagaType: 'S2_FULFILLMENT', state: 'ESCALATED', step: 'MFC_RESERVE', reasonCode: 'RESERVATION_REJECTED', reasonMessage: '[목] MFC 예약 거절 — 밖에서 처리한 뒤 완료 표시', since: ago(6), requeryable: false, resolved: false },
    ],
    bffResults: new Map(),
    issues: [
      { issueId: 'FI-MOCK-1', orderId: 'ORD-MOCK-1003', mfcId: 'MFC-BSN-01', sku: 'E-00000001', lotId: 'LOT-MOCK-7', blockedQty: 1, reason: 'QUALITY_HOLD', state: 'OPEN', blockedAt: ago(3), reservationId: 'RSV-MOCK-1', note: null, acknowledgedBy: null, acknowledgedAt: null, resolvedAt: null },
      { issueId: 'FI-MOCK-2', orderId: 'ORD-MOCK-1001', mfcId: 'MFC-SEL-01', sku: 'E-00000002', lotId: null, blockedQty: 2, reason: 'COUNT_LOSS', state: 'OPEN', blockedAt: ago(5), reservationId: 'RSV-MOCK-2', note: null, acknowledgedBy: null, acknowledgedAt: null, resolvedAt: null },
      { issueId: 'FI-MOCK-3', orderId: 'ORD-MOCK-1002', mfcId: 'MFC-BSN-01', sku: 'E-00000003', lotId: 'LOT-MOCK-8', blockedQty: 1, reason: 'SHORT', state: 'ACKNOWLEDGED', blockedAt: ago(30), reservationId: 'RSV-MOCK-3', note: '[목] 고객센터 연락 완료', acknowledgedBy: 'OP-admin-1', acknowledgedAt: ago(28), resolvedAt: null },
    ],
    orders: [
      order('ORD-MOCK-1001', 'IN_DELIVERY', ago(1), '01012345678'),
      order('ORD-MOCK-1002', 'IN_DELIVERY', ago(26), '01055556666'),
      order('ORD-MOCK-1003', 'PREPARING', ago(72), '01012345678'),
    ],
    executions: new Map([
      ['DLV-MOCK-1', execution('DLV-MOCK-1', 'ORD-MOCK-1001', 'PICKED_UP', 'RID-MOCK-1')],
      ['DLV-MOCK-2', failed],
      ['DLV-MOCK-3', execution('DLV-MOCK-3', 'ORD-MOCK-1003', 'ASSIGNED', 'RID-MOCK-1')],
      ['DLV-MOCK-4', execution('DLV-MOCK-4', 'ORD-MOCK-1003', 'UNASSIGNED', undefined)],
    ]),
    dispatches: new Map([
      ['DLV-MOCK-1', dispatch('DLV-MOCK-1', 'ORD-MOCK-1001', 'PICKED_UP', 'RID-MOCK-1')],
      ['DLV-MOCK-2', dispatch('DLV-MOCK-2', 'ORD-MOCK-1002', 'PICKED_UP', 'RID-MOCK-2')],
      ['DLV-MOCK-3', dispatch('DLV-MOCK-3', 'ORD-MOCK-1003', 'ASSIGNED', 'RID-MOCK-1')],
      ['DLV-MOCK-4', dispatch('DLV-MOCK-4', 'ORD-MOCK-1003', 'DISPATCHING', undefined)],
    ]),
    complaints: [
      { complaintId: 'RCP-MOCK-2', complaintType: 'MISDELIVERY', deliveryId: 'DLV-MOCK-21', riderId: 'RID-MOCK-2', recordedAt: ago(20), recordedBy: 'op-cs-1', source: 'CS_AGENT', note: '[목] 옆집에 두고 감' },
      { complaintId: 'RCP-MOCK-1', complaintType: 'MISDELIVERY', deliveryId: 'DLV-MOCK-20', riderId: 'RID-MOCK-2', recordedAt: ago(48), recordedBy: 'op-cs-1', source: 'CS_AGENT', note: null },
    ],
    claims: [
      {
        claimId: 'CLM-MOCK-1',
        orderId: 'ORD-MOCK-1002',
        type: 'CANCEL',
        state: 'CLOSED',
        reason: 'CHANGE_OF_MIND',
        openedAt: ago(25),
        decidedAt: ago(25),
        closedAt: ago(24),
        version: 4,
        lines: [{ claimLineId: 'CL-1', sku: 'E-00000001', requestedQty: 1, approvedQty: 1, decision: 'APPROVED', refundAmount: 15100 }],
      },
      {
        claimId: 'CLM-MOCK-2',
        orderId: 'ORD-MOCK-1003',
        type: 'CANCEL',
        state: 'STOP_PENDING',
        openedAt: ago(2),
        version: 1,
        lines: [{ claimLineId: 'CL-2', sku: 'E-00000001', requestedQty: 1, decision: 'PENDING' }],
      },
    ],
    refunds: new Map([
      ['CLM-MOCK-1', [{ refundIntentId: 'RF-MOCK-1', claimId: 'CLM-MOCK-1', amount: 15100, state: 'COMPLETED', pgResult: 'SUCCESS', requestedAt: ago(25), completedAt: ago(24) }]],
      ['CLM-MOCK-2', [{ refundIntentId: 'RF-MOCK-2', claimId: 'CLM-MOCK-2', amount: 15100, state: 'PENDING_EXECUTION', requestedAt: ago(2) }]],
    ]),
    riders: new Map([
      ['RID-MOCK-1', { version: 1, current: 'NORMAL', history: [] }],
      [
        'RID-MOCK-2',
        {
          version: 3,
          current: 'NORMAL',
          history: [
            { riderId: 'RID-MOCK-2', previous: 'DISPATCH_RESTRICTED', restriction: 'NORMAL', reason: '[목] 소명 확인 — 제한 풀기', changedAt: ago(240), changedBy: 'op-admin-1', version: 3 },
            { riderId: 'RID-MOCK-2', previous: 'NORMAL', restriction: 'DISPATCH_RESTRICTED', reason: '[목] 오배송 반복', changedAt: ago(300), changedBy: 'op-admin-1', version: 2 },
          ],
        },
      ],
    ]),
    reviews: [
      {
        reviewId: 'REV-MOCK-1',
        riderId: 'RID-MOCK-2',
        complaintType: 'MISDELIVERY',
        state: 'OPEN',
        openedAt: ago(20),
        complaints: [
          { complaintId: 'RCP-MOCK-0', deliveryId: 'DLV-MOCK-19', recordedAt: ago(100) },
          { complaintId: 'RCP-MOCK-1', deliveryId: 'DLV-MOCK-20', recordedAt: ago(48) },
          { complaintId: 'RCP-MOCK-2', deliveryId: 'DLV-MOCK-21', recordedAt: ago(20) },
        ],
      },
    ],
    cancellations: new Map(),
  };
}

let ops = seed();

/** 시험 사이에 목 상태를 처음으로 돌린다. */
export function resetMockOps(): void {
  ops = seed();
}

/** 역할 검사: 토큰 없음 401, 역할 없음 403. */
const allow = (request: Request, ...roles: string[]) => {
  const who = operator(request);
  if (!who) return { denied: unauthorized(), who: null };
  return who.roles.some((r) => roles.includes(r)) ? { denied: null, who } : { denied: problem(403, 'FORBIDDEN'), who };
};

const PAGE = 20;
const cursorPage = <T,>(all: T[], url: URL) => {
  const start = Number(url.searchParams.get('cursor') ?? '0');
  const size = Number(url.searchParams.get('size') ?? PAGE) || PAGE;
  return { items: all.slice(start, start + size), page: { nextCursor: start + size < all.length ? String(start + size) : null, size } };
};
const inRange = (iso: string, from: string | null, to: string | null) => (!from || iso >= new Date(from).toISOString()) && (!to || iso < new Date(to).toISOString());
const complaintSummary = (c: Complaint) => ({
  complaintId: c.complaintId,
  complaintType: c.complaintType,
  deliveryId: c.deliveryId,
  riderId: c.riderId,
  recordedAt: c.recordedAt,
  recordedBy: c.recordedBy,
  source: c.source,
  ...(c.orderId ? { orderId: c.orderId } : {}),
  ...(c.inquiryId ? { inquiryId: c.inquiryId } : {}),
  ...(c.caseId ? { caseId: c.caseId } : {}),
});

const CS = ['CS_AGENT', 'OPERATOR_ADMIN'];
const LOOKUP = ['CS_AGENT', 'OPERATOR_ADMIN', 'RIDER_OPS'];
const ADMIN = ['OPERATOR_ADMIN'];
/** rider 0.4.0·dispatch 0.3.2·execution 0.4.0(BOD-1): 라이더 운영 역할도 계정 제한·검토·배차 취소·실패 결정 */
const RIDER_OPS_ROLES = ['OPERATOR_ADMIN', 'RIDER_OPS'];
const MAX_DAYS = 31;

/** rider 0.4.0 목 라이더(직원 찾기·상세·원문 열람). 계정 제한 상태·version 은 ops.riders 와 같은 값 */
const RIDER_PROFILES = [
  { riderId: 'RID-MOCK-1', name: '[목] 김라이더', phone: '01011112222', vehicleType: 'MOTORCYCLE' as const, operatingStatus: 'ON_DUTY' as const, newDispatchEnabled: true, operatingMfcId: 'MFC-BSN-01', joinedAt: '2026-10-01T00:00:00Z', lastHeartbeatAt: '2026-11-15T01:00:00Z' },
  { riderId: 'RID-MOCK-2', name: '[목] 이라이더', phone: '01033334444', vehicleType: 'BICYCLE' as const, operatingStatus: 'OFF_DUTY' as const, newDispatchEnabled: false, operatingMfcId: null, joinedAt: '2026-10-10T00:00:00Z', lastHeartbeatAt: null },
];

function riderSummary(r: (typeof RIDER_PROFILES)[number]) {
  const state = ops.riders.get(r.riderId);
  return {
    riderId: r.riderId,
    version: state?.version ?? 1,
    nameMasked: maskName(r.name) ?? null,
    phoneMasked: `${r.phone.slice(0, 3)}****${r.phone.slice(-4)}`,
    vehicleType: r.vehicleType,
    operatingStatus: r.operatingStatus,
    newDispatchEnabled: r.newDispatchEnabled,
    operatingMfcId: r.operatingMfcId,
    restriction: state?.current ?? ('NORMAL' as const),
    joinedAt: r.joinedAt,
    stateChangedAt: r.joinedAt,
  };
}
export const opsHandlers = [
  // ---- order 0.3.0 ----
  http.get(`${API_BASE}/orders/lookups`, ({ request }) => {
    const { denied } = allow(request, ...LOOKUP);
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const orderId = q.get('orderId');
    const customerId = q.get('customerId');
    const from = q.get('createdFrom');
    const to = q.get('createdTo');
    if (!orderId && !customerId) {
      if (!from || !to) return problem(400, 'VALIDATION_FAILED', [{ field: 'createdFrom', reason: 'REQUIRED' }]);
      const span = Date.parse(to) - Date.parse(from);
      if (span <= 0 || span > MAX_DAYS * 24 * HOUR) return problem(400, 'VALIDATION_FAILED', [{ field: 'createdTo', reason: 'RANGE' }]);
    }
    const phone = q.get('receiverPhone')?.replace(/\D/g, '');
    if (phone !== undefined && phone !== '' && (phone.length < 9 || phone.length > 11)) return problem(400, 'VALIDATION_FAILED', [{ field: 'receiverPhone' }]);
    const all = ops.orders
      .filter(
        (o) =>
          (!orderId || o.orderId === orderId) &&
          (!customerId || o.customerId === customerId) &&
          (!q.get('status') || o.status === q.get('status')) &&
          (!q.get('mfcId') || o.mfcId === q.get('mfcId')) &&
          (!phone || o.shippingAddress?.receiverPhone === phone) &&
          inRange(o.confirmedAt, from, to),
      )
      .toSorted((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));
    const page = Number(q.get('page') ?? '0');
    const size = Number(q.get('size') ?? '20');
    const slice = all.slice(page * size, page * size + size);
    return HttpResponse.json({
      items: slice.map((o) => ({
        orderId: o.orderId,
        status: o.status,
        confirmedAt: o.confirmedAt,
        customerId: o.customerId,
        mfcId: o.mfcId,
        deliveryMode: o.deliveryMode,
        ...(o.arrivalWindow ? { arrivalWindow: o.arrivalWindow } : {}),
        itemCount: o.lines.reduce((n, l) => n + (l.originalQty ?? 0), 0),
        lineCount: o.lines.length,
        openFulfillmentIssues: o.fulfillmentIssues.filter((f) => f.state === 'OPEN').length,
        plannedShipments: o.plannedShipments ?? 1,
        receiverPhoneMasked: maskPhone(o.shippingAddress?.receiverPhone),
        totalAmount: o.amounts.totalAmount,
        approvedAmount: o.amounts.approvedAmount,
        version: o.version,
      })),
      page: { page, size, hasNext: (page + 1) * size < all.length },
    });
  }),
  http.get(`${API_BASE}/orders/lookups/:orderId`, ({ request, params }) => {
    const { denied } = allow(request, ...LOOKUP);
    if (denied) return denied;
    const found = ops.orders.find((o) => o.orderId === params['orderId']);
    return found ? HttpResponse.json(maskedDetail(found)) : problem(404, 'ORDER_NOT_FOUND');
  }),

  // order 0.4.0·0.5.0 원문 열람 — 사유 2~200자, 열람 기록(목 ID)을 남긴 뒤 고른 항목만 원문. 같은 키면 같은 기록.
  http.post(`${API_BASE}/orders/lookups/:orderId/pii-reveals`, async ({ request, params }) => {
    const { denied } = allow(request, ...LOOKUP);
    if (denied) return denied;
    const body = (await request.clone().json()) as { reason?: string; fields?: PiiField[] };
    return idempotent(request, () => {
      const reason = (body.reason ?? '').trim();
      if (reason.length < 2 || reason.length > 200) return problem(400, 'VALIDATION_FAILED', [{ field: 'reason', reason: 'INVALID_FORMAT' }]);
      const found = ops.orders.find((o) => o.orderId === params['orderId']);
      if (!found) return problem(404, 'ORDER_NOT_FOUND');
      if (!found.shippingAddress) return problem(404, 'SHIPPING_COPY_NOT_FOUND');
      const fields = body.fields && body.fields.length > 0 ? PII_FIELDS.filter((f) => body.fields!.includes(f)) : [...PII_FIELDS];
      return {
        status: 200,
        body: {
          orderId: found.orderId,
          piiAccessLogId: `PAL-MOCK-${keyOf(request).slice(0, 8)}`,
          recordedAt: new Date().toISOString(),
          fields,
          shippingAddress: maskedAddress(found, fields),
          deliveryNote: fields.includes('ENTRANCE') ? (found.deliveryNote ?? null) : null,
        },
      };
    });
  }),

  // ---- order 0.6.0 이행 확인 필요(처리 대기) — OPERATOR_ADMIN 은 mfcId 를 비우면 모든 센터, 센터 운영자는 mfcId 필수(그 센터만) ----
  http.get(`${API_BASE}/fulfillment-issues`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const q = new URL(request.url).searchParams;
    const mfcId = q.get('mfcId');
    const state = q.get('state') ?? 'OPEN';
    const admin = who.roles.includes('OPERATOR_ADMIN');
    if (!admin && (!mfcId || !who.centers.includes(mfcId))) return problem(403, 'FORBIDDEN');
    const items = ops.issues
      .filter((i) => i.state === state && (!mfcId || i.mfcId === mfcId))
      .sort((a, b) => (b.blockedAt ?? '').localeCompare(a.blockedAt ?? ''));
    return HttpResponse.json({ items });
  }),
  http.post(`${API_BASE}/fulfillment-issues/:issueId/acknowledgements`, async ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const body = (await request.clone().json()) as { note?: string };
    return idempotent(request, () => {
      const issue = ops.issues.find((i) => i.issueId === params['issueId']);
      if (!issue) return problem(404, 'NOT_FOUND');
      if (!who.roles.includes('OPERATOR_ADMIN') && !who.centers.includes(issue.mfcId ?? '')) return problem(403, 'FORBIDDEN');
      const note = (body.note ?? '').trim();
      if (note.length < 1 || note.length > 500) return problem(400, 'VALIDATION_FAILED', [{ field: 'note', reason: 'INVALID_FORMAT' }]);
      if (issue.state === 'OPEN') Object.assign(issue, { state: 'ACKNOWLEDGED', note, acknowledgedBy: who.subject, acknowledgedAt: new Date().toISOString() });
      return { status: 200, body: issue };
    });
  }),

  // ---- bff 0.2.0 처리 대기(BO-12) — OPERATOR_ADMIN. 멈춘 사가 + 열린 이행 확인 필요를 한 목록으로 ----
  http.get(`${BFF_BASE}/views/pending-work`, ({ request }) => {
    const { denied } = allow(request, ...ADMIN);
    if (denied) return denied;
    const now = new Date().toISOString();
    const stamp = (system: string) => ({ system, confidence: 'DIRECT' as const, asOf: { asOf: now, freshness: 'CURRENT' as const } });
    const items = [
      ...ops.sagas
        .filter((s) => !s.resolved)
        .map((s) => ({
          kind: 'STUCK_SAGA' as const,
          refId: s.sagaId,
          orderId: s.orderId,
          sagaType: s.sagaType,
          state: s.state,
          step: s.step,
          reasonCode: s.reasonCode,
          reasonMessage: s.reasonMessage,
          since: s.since,
          allowedActions: s.requeryable ? ['REQUERY_RESULT', 'MARK_RESOLVED'] : ['MARK_RESOLVED'],
          source: stamp('order-orchestration-service'),
        })),
      ...ops.issues
        .filter((i) => i.state === 'OPEN')
        .map((i) => ({
          kind: 'FULFILLMENT_ISSUE' as const,
          refId: i.issueId ?? '',
          orderId: i.orderId ?? '',
          mfcId: i.mfcId ?? null,
          state: i.state ?? 'OPEN',
          reasonCode: i.reason ?? null,
          reasonMessage: `${i.sku ?? ''} × ${i.blockedQty ?? 0}`,
          since: i.blockedAt ?? now,
          allowedActions: ['ACKNOWLEDGE'],
          source: stamp('order-service'),
        })),
    ].sort((a, b) => a.since.localeCompare(b.since));
    return HttpResponse.json({ composedAt: now, sources: [stamp('order-orchestration-service'), stamp('order-service')], unavailableSources: [], items });
  }),

  // bff 명령 프록시: order-orchestration-service saga-requery·saga-resolve(승인 없음, OPERATOR_ADMIN). 이미 바뀐 사가는 422.
  http.post(`${BFF_BASE}/commands/:targetService/:command`, async ({ request, params }) => {
    const { denied } = allow(request, ...ADMIN);
    if (denied) return denied;
    if (params['targetService'] !== 'order-orchestration-service') return problem(404, 'NOT_FOUND');
    const body = (await request.clone().json()) as { targetRef?: string; reason?: string };
    return idempotent(request, () => {
      const saga = ops.sagas.find((s) => s.sagaId === body.targetRef);
      if (!saga) return problem(404, 'NOT_FOUND');
      if (params['command'] === 'saga-requery') {
        if (!saga.requeryable || saga.resolved) return problem(422, 'NOT_REQUERYABLE');
        saga.requeryable = false; // 목: 다시 확인하면 PG 결과가 와서 사가가 이어진다 → 목록에서 빠진다
        saga.resolved = true;
      } else if (params['command'] === 'saga-resolve') {
        if (!(body.reason ?? '').trim()) return problem(400, 'VALIDATION_FAILED', [{ field: 'reason', reason: 'REQUIRED' }]);
        if (saga.resolved) return problem(422, 'NOT_RESOLVABLE');
        saga.resolved = true;
      } else return problem(404, 'NOT_FOUND');
      const result = { requestId: keyOf(request), status: 'APPLIED' as const, occurredAt: new Date().toISOString() };
      ops.bffResults.set(keyOf(request), result);
      return { status: 202, body: result };
    });
  }),
  // 결과 조회는 실서버가 아직 501(백엔드 회신 reply-case-inbox-questions §3) — 화면은 부르지 않는다(목록 다시 읽기). 불리면 501 로 드러나게.
  http.get(`${BFF_BASE}/commands/:targetService/:command/:requestId`, () => problem(501, 'NOT_IMPLEMENTED')),

  // ---- case 0.3.0 rider-complaints ----
  http.post(`${API_BASE}/rider-complaints`, async ({ request }) => {
    const { denied, who } = allow(request, ...CS);
    if (denied) return denied;
    const body = (await request.clone().json()) as { deliveryId?: string; complaintType?: Complaint['complaintType']; orderId?: string; note?: string; inquiryId?: string };
    return idempotent(request, () => {
      if (!body.deliveryId || !body.complaintType) return problem(400, 'VALIDATION_FAILED');
      const d = ops.dispatches.get(body.deliveryId);
      if (!d) return problem(422, 'DELIVERY_NOT_FOUND');
      const riderId = d.assignment?.riderId;
      if (!riderId) return problem(422, 'RIDER_NOT_ASSIGNED');
      if (body.inquiryId && !body.inquiryId.startsWith('INQ-MOCK-')) return problem(422, 'INQUIRY_NOT_FOUND');
      const saved: Complaint = {
        complaintId: `RCP-MOCK-${++ops.seq}`,
        complaintType: body.complaintType,
        deliveryId: body.deliveryId,
        riderId,
        recordedAt: new Date().toISOString(),
        recordedBy: who?.subject ?? '',
        source: 'CS_AGENT',
        note: body.note ?? null,
        ...(body.orderId ? { orderId: body.orderId } : {}),
        ...(body.inquiryId ? { inquiryId: body.inquiryId, caseId: `CASE-${body.inquiryId}` } : {}),
      };
      ops.complaints.unshift(saved);
      return { status: 201, body: saved };
    });
  }),
  http.get(`${API_BASE}/rider-complaints`, ({ request }) => {
    const { denied } = allow(request, ...LOOKUP);
    if (denied) return denied;
    const url = new URL(request.url);
    const q = url.searchParams;
    const all = ops.complaints.filter(
      (c) =>
        (!q.get('riderId') || c.riderId === q.get('riderId')) &&
        (!q.get('deliveryId') || c.deliveryId === q.get('deliveryId')) &&
        (!q.get('complaintType') || c.complaintType === q.get('complaintType')) &&
        inRange(c.recordedAt, q.get('from'), q.get('to')),
    );
    const page = cursorPage(all, url);
    return HttpResponse.json({ items: page.items.map(complaintSummary), page: page.page });
  }),
  http.get(`${API_BASE}/rider-complaints/:complaintId`, ({ request, params }) => {
    const { denied } = allow(request, ...LOOKUP);
    if (denied) return denied;
    const found = ops.complaints.find((c) => c.complaintId === params['complaintId']);
    return found ? HttpResponse.json(found) : problem(404, 'NOT_FOUND');
  }),

  // ---- claim 0.1.0 (조회만) ----
  http.get(`${API_BASE}/claims`, ({ request }) => {
    const { denied } = allow(request, ...CS);
    if (denied) return denied;
    const url = new URL(request.url);
    const q = url.searchParams;
    const all = ops.claims.filter((c) => (!q.get('orderId') || c.orderId === q.get('orderId')) && (!q.get('type') || c.type === q.get('type')) && (!q.get('state') || c.state === q.get('state')));
    const page = cursorPage(all, url);
    return HttpResponse.json({
      items: page.items.map((c) => ({ claimId: c.claimId, orderId: c.orderId, type: c.type, state: c.state, openedAt: c.openedAt })),
      page: page.page,
    });
  }),
  http.get(`${API_BASE}/claims/:claimId`, ({ request, params }) => {
    const { denied } = allow(request, ...CS);
    if (denied) return denied;
    const found = ops.claims.find((c) => c.claimId === params['claimId']);
    return found ? HttpResponse.json(found) : problem(404, 'NOT_FOUND');
  }),
  http.get(`${API_BASE}/claims/:claimId/refunds`, ({ request, params }) => {
    const { denied } = allow(request, ...CS);
    if (denied) return denied;
    const id = String(params['claimId']);
    if (!ops.claims.some((c) => c.claimId === id)) return problem(404, 'NOT_FOUND');
    return HttpResponse.json({ claimId: id, items: ops.refunds.get(id) ?? [], asOf: { asOf: new Date().toISOString(), freshness: 'CURRENT' } });
  }),

  // ---- delivery-execution 0.3.2 ----
  http.get(`${API_BASE}/deliveries/:deliveryId`, ({ request, params }) => {
    const { denied } = allow(request, ...LOOKUP);
    if (denied) return denied;
    const found = ops.executions.get(String(params['deliveryId']));
    return found ? HttpResponse.json(found) : problem(404, 'NOT_FOUND');
  }),
  http.post(`${API_BASE}/deliveries/:deliveryId/failure-decisions`, async ({ request, params }) => {
    const { denied, who } = allow(request, ...LOOKUP);
    if (denied) return denied;
    const body = (await request.clone().json()) as { decision?: 'CONFIRM' | 'REJECT'; custody?: 'RIDER' | 'STORE'; note?: string };
    return idempotent(request, () => {
      const id = String(params['deliveryId']);
      const d = ops.executions.get(id);
      if (!d) return problem(404, 'NOT_FOUND');
      if (d.state !== 'FAILURE_REPORTED') return problem(409, 'INVALID_STATE');
      const v = expectedVersion(request);
      if (v !== undefined && v !== d.version) return problem(409, 'VERSION_CONFLICT');
      if (!body.decision) return problem(400, 'VALIDATION_FAILED');
      const at = new Date().toISOString();
      const next: Execution = {
        ...d,
        state: body.decision === 'CONFIRM' ? 'FAILED' : 'ARRIVED_AT_CUSTOMER',
        version: (d.version ?? 0) + 1,
        failure: { ...d.failure, decision: body.decision, decidedAt: at, decidedBy: who?.subject ?? '', ...(body.custody ? { custody: body.custody } : {}) },
        history: [...(d.history ?? []), { state: body.decision === 'CONFIRM' ? 'FAILED' : 'ARRIVED_AT_CUSTOMER', actor: 'OPERATOR', occurredAt: at }],
      };
      ops.executions.set(id, next);
      return { status: 200, body: { status: 'APPLIED', requestId: request.headers.get('Idempotency-Key') ?? '', resultId: id, version: next.version, occurredAt: at } };
    });
  }),

  // ---- delivery-dispatch 0.3.1 ----
  http.get(`${API_BASE}/deliveries/:deliveryId/dispatch`, ({ request, params }) => {
    // 0.3.2(BOD-1·2): 그 센터 직원·OPERATOR_ADMIN·RIDER_OPS·CS_AGENT(상담원은 조회만)
    const { denied } = allow(request, ...LOOKUP);
    if (denied) return denied;
    const found = ops.dispatches.get(String(params['deliveryId']));
    return found ? HttpResponse.json(found) : problem(404, 'NOT_FOUND');
  }),
  http.post(`${API_BASE}/deliveries/:deliveryId/assignment-cancellations`, async ({ request, params }) => {
    const { denied } = allow(request, ...RIDER_OPS_ROLES);
    if (denied) return denied;
    const body = (await request.clone().json()) as { requestedBy?: string; reason?: string; reassign?: boolean; approvalRef?: string };
    return idempotent(request, () => {
      const id = String(params['deliveryId']);
      const d = ops.dispatches.get(id);
      if (!d) return problem(404, 'NOT_FOUND');
      if (d.state === 'PICKED_UP') return problem(422, 'PICKED_UP_CASE_REQUIRED');
      if (d.state !== 'ASSIGNED') return problem(409, 'INVALID_STATE');
      const v = expectedVersion(request);
      if (v !== undefined && v !== d.version) return problem(409, 'VERSION_CONFLICT');
      if (body.reason === 'OPERATOR' && !body.approvalRef) return problem(422, 'APPROVAL_REQUIRED');
      const requestId = request.headers.get('Idempotency-Key') ?? '';
      // 접수만 하고(202), 반영은 짝 조회 두 번째부터 보인다(비동기 흉내).
      ops.cancellations.set(requestId, { deliveryId: id, outcome: 'CANCELLED_BEFORE_PICKUP', polled: false });
      const reassign = body.reassign ?? true;
      const next: DispatchView = { ...d, state: reassign ? 'DISPATCHING' : 'CANCELLED_BEFORE_PICKUP', version: (d.version ?? 0) + 1 };
      delete next.assignment; // 배정 해제
      ops.dispatches.set(id, next);
      return { status: 202, body: { status: 'ACCEPTED', requestId, occurredAt: new Date().toISOString() } };
    });
  }),
  http.get(`${API_BASE}/deliveries/:deliveryId/assignment-cancellations/:requestId`, ({ request, params }) => {
    const { denied } = allow(request, ...RIDER_OPS_ROLES);
    if (denied) return denied;
    const requestId = String(params['requestId']);
    const found = ops.cancellations.get(requestId);
    if (!found || found.deliveryId !== params['deliveryId']) return problem(404, 'NOT_FOUND');
    if (!found.polled) {
      found.polled = true;
      return HttpResponse.json({ requestId, state: 'PENDING' });
    }
    return HttpResponse.json({ requestId, state: found.outcome });
  }),

  // ---- rider 0.3.0 (지금 OPERATOR_ADMIN 만) ----
  http.get(`${API_BASE}/riders/restriction-reviews`, ({ request }) => {
    const { denied } = allow(request, ...RIDER_OPS_ROLES);
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const state = q.get('state') ?? 'OPEN';
    return HttpResponse.json({ items: ops.reviews.filter((r) => r.state === state && (!q.get('riderId') || r.riderId === q.get('riderId'))) });
  }),
  http.post(`${API_BASE}/riders/restriction-reviews/:reviewId/decisions`, async ({ request, params }) => {
    const { denied, who } = allow(request, ...RIDER_OPS_ROLES);
    if (denied) return denied;
    const body = (await request.clone().json()) as { decision?: 'RESTRICTED' | 'DISMISSED'; note?: string };
    return idempotent(request, () => {
      const index = ops.reviews.findIndex((r) => r.reviewId === params['reviewId']);
      const found = ops.reviews[index];
      if (!found) return problem(404, 'NOT_FOUND');
      if (found.state !== 'OPEN') return problem(409, 'INVALID_STATE');
      if (!body.decision) return problem(400, 'VALIDATION_FAILED');
      // 목 가정: "먼저 계정 제한을 건 뒤 RESTRICTED"(계약 요약) — 제한이 없으면 거절로 흉내 낸다.
      if (body.decision === 'RESTRICTED' && ops.riders.get(found.riderId ?? '')?.current === 'NORMAL') return problem(409, 'INVALID_STATE');
      const closed: Review = { ...found, state: body.decision, decidedAt: new Date().toISOString(), decidedBy: who?.subject ?? '', ...(body.note ? { note: body.note } : {}) };
      ops.reviews[index] = closed;
      return { status: 200, body: closed };
    });
  }),
  http.get(`${API_BASE}/riders/:riderId/restrictions`, ({ request, params }) => {
    const { denied } = allow(request, ...RIDER_OPS_ROLES);
    if (denied) return denied;
    const r = ops.riders.get(String(params['riderId']));
    return r ? HttpResponse.json({ current: r.current, items: r.history }) : problem(404, 'NOT_FOUND');
  }),
  http.post(`${API_BASE}/riders/:riderId/restrictions`, async ({ request, params }) => {
    const { denied, who } = allow(request, ...RIDER_OPS_ROLES);
    if (denied) return denied;
    const body = (await request.clone().json()) as { restriction?: Restriction; reason?: string; until?: string; evidenceRefs?: string[]; approvalRef?: string };
    return idempotent(request, () => {
      const riderId = String(params['riderId']);
      const r = ops.riders.get(riderId);
      if (!r) return problem(404, 'NOT_FOUND');
      if (!body.restriction || !body.reason) return problem(400, 'VALIDATION_FAILED');
      const v = expectedVersion(request);
      if (v !== undefined && v !== r.version) return problem(409, 'VERSION_CONFLICT');
      r.version += 1;
      const record: RestrictionRecord = {
        riderId,
        previous: r.current,
        restriction: body.restriction,
        reason: body.reason,
        changedAt: new Date().toISOString(),
        changedBy: who?.subject ?? '',
        version: r.version,
        ...(body.until ? { until: body.until } : {}),
        ...(body.evidenceRefs ? { evidenceRefs: body.evidenceRefs } : {}),
        ...(body.approvalRef ? { approvalRef: body.approvalRef } : {}),
      };
      r.current = body.restriction;
      r.history = [record, ...r.history];
      return { status: 200, body: record };
    });
  }),
  // ---- rider 0.4.0 직원용 찾기·상세·원문 열람(BOD-3) — OPERATOR_ADMIN·RIDER_OPS·CS_AGENT. 이름·전화는 가린 값, 원문은 사유 + pii-reveals ----
  // (경로 순서: 위의 /riders/restriction-reviews 가 먼저 맞도록 여기 둔다)
  http.get(`${API_BASE}/riders`, ({ request }) => {
    const { denied } = allow(request, ...LOOKUP);
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const phone = q.get('phone')?.replace(/\D/g, '');
    if (phone !== undefined && phone !== '' && (phone.length < 10 || phone.length > 11)) return problem(400, 'VALIDATION_FAILED', [{ field: 'phone', reason: 'INVALID_FORMAT' }]);
    const items = RIDER_PROFILES.filter(
      (r) =>
        (!q.get('riderId') || r.riderId === q.get('riderId')) &&
        (!phone || r.phone === phone) &&
        (!q.get('restriction') || (ops.riders.get(r.riderId)?.current ?? 'NORMAL') === q.get('restriction')) &&
        (!q.get('operatingStatus') || r.operatingStatus === q.get('operatingStatus')) &&
        (!q.get('vehicleType') || r.vehicleType === q.get('vehicleType')),
    ).map((r) => riderSummary(r));
    return HttpResponse.json({ items, page: Number(q.get('page') ?? 0), size: items.length, hasNext: false });
  }),
  http.get(`${API_BASE}/riders/:riderId`, ({ request, params }) => {
    const { denied } = allow(request, ...LOOKUP);
    if (denied) return denied;
    const r = RIDER_PROFILES.find((x) => x.riderId === params['riderId']);
    if (!r) return problem(404, 'NOT_FOUND');
    const s = riderSummary(r);
    return HttpResponse.json({
      riderId: r.riderId,
      version: s.version,
      nameMasked: s.nameMasked,
      phoneMasked: s.phoneMasked,
      vehicleType: r.vehicleType,
      joinedAt: r.joinedAt,
      lastHeartbeatAt: r.lastHeartbeatAt,
      deliveryAreas: r.operatingMfcId ? [{ mfcId: r.operatingMfcId, zoneId: 'ZONE-MOCK-1' }] : [],
      operating: { status: r.operatingStatus, newDispatchEnabled: r.newDispatchEnabled, activeDeliveryCount: r.operatingStatus === 'ON_DUTY' ? 1 : 0, ...(r.operatingMfcId ? { mfcId: r.operatingMfcId } : {}) },
      settings: { dispatchMode: 'AI_RECOMMENDED', oneAtATime: false },
      restriction: { state: s.restriction, until: null, reason: null },
    });
  }),
  http.post(`${API_BASE}/riders/:riderId/pii-reveals`, async ({ request, params }) => {
    const { denied } = allow(request, ...LOOKUP);
    if (denied) return denied;
    const body = (await request.clone().json()) as { reason?: string; fields?: Array<'NAME' | 'PHONE'> };
    return idempotent(request, () => {
      const reason = (body.reason ?? '').trim();
      if (reason.length < 2 || reason.length > 200) return problem(400, 'VALIDATION_FAILED', [{ field: 'reason', reason: 'INVALID_FORMAT' }]);
      const r = RIDER_PROFILES.find((x) => x.riderId === params['riderId']);
      if (!r) return problem(404, 'NOT_FOUND');
      const fields = body.fields && body.fields.length > 0 ? body.fields : (['NAME', 'PHONE'] as const);
      return {
        status: 200,
        body: {
          riderId: r.riderId,
          piiAccessLogId: `PAL-MOCK-R-${keyOf(request).slice(0, 8)}`,
          recordedAt: new Date().toISOString(),
          fields,
          name: fields.includes('NAME') ? r.name : null,
          phone: fields.includes('PHONE') ? r.phone : null,
        },
      };
    });
  }),

  // ---- execution 0.4.0 직원용 배송 찾기(BOD-5) — 개인정보 없이 ID·상태·시각만 ----
  http.get(`${API_BASE}/deliveries`, ({ request }) => {
    const { denied } = allow(request, ...LOOKUP);
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const items = [...ops.executions.values()]
      .filter(
        (e) =>
          (!q.get('orderId') || e.orderId === q.get('orderId')) &&
          (!q.get('riderId') || e.riderId === q.get('riderId')) &&
          (!q.get('state') || e.state === q.get('state')) &&
          (!q.get('mfcId') || e.mfcId === q.get('mfcId')),
      )
      .map((e, i) => ({
        deliveryId: e.deliveryId,
        orderId: e.orderId ?? null,
        mfcId: e.mfcId ?? null,
        riderId: e.riderId ?? null,
        state: e.state,
        type: e.type,
        createdAt: ago(10 - i),
        assignedAt: e.assignedAt ?? null,
        version: e.version,
      }))
      .sort((a, b) => (q.get('sort') === 'OLDEST' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)));
    return HttpResponse.json({ items, page: { nextCursor: null, size: items.length } });
  }),
  // execution 0.4.0 도움요청 단건(라이더가 쓴 내용·사진 참조) — 사건함의 RIDER_HELP 가 refs.incidentId 로 연다
  http.get(`${API_BASE}/deliveries/:deliveryId/help-requests/:requestId`, ({ request, params }) => {
    const { denied } = allow(request, ...LOOKUP);
    if (denied) return denied;
    if (params['deliveryId'] !== 'DLV-MOCK-1' || params['requestId'] !== 'HLP-MOCK-1') return problem(404, 'NOT_FOUND');
    return HttpResponse.json({
      requestId: 'HLP-MOCK-1',
      deliveryId: 'DLV-MOCK-1',
      incidentId: 'DLV-MOCK-1:HLP-MOCK-1',
      category: 'ADDRESS',
      stage: 'PICKED_UP',
      state: 'OPEN',
      detail: '[목] 공동현관이 잠겨 있고 호출해도 응답이 없어요.',
      evidenceRefs: ['PHOTO-MOCK-1'],
      createdAt: ago(1),
      caseId: 'CASE-MOCK-1',
    });
  }),
];
