// ⚠ 화면 개발·시험용 목 — 고객 메뉴(bff 0.22.0 BF-2 `views/customer-search`·`views/customer/{id}`, customer 0.11.0 원문 열람).
// 계약 모양 그대로: 찾기는 customerNumber·phone·orderNumber 중 하나만(아니면 400), 완전 일치. 상세 칸은 원천 실패면 null + unavailableSources.
// 목 고객 둘은 목 주문(ORD-MOCK-1001·1005)과 이어진다. 원문은 원장에만 — 응답 머리는 가린 값.
import { http, HttpResponse } from 'msw';

import { API_BASE, BFF_BASE } from '../api/client';
import { mockClaimRowsOf } from './opsHandlers';
import { idempotent, keyOf, operator, problem, unauthorized } from './support';

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

type MockCustomer = { customerId: string; customerNumber: string; name: string; phone: string; email: string; provider: 'KAKAO' | 'NAVER' | 'GOOGLE' | 'APPLE'; verified: boolean; status: string; joinedAt: string; orderNumbers: string[] };

export const MOCK_CUSTOMERS: readonly MockCustomer[] = [
  { customerId: 'CUS-1001', customerNumber: '482913', name: '김고객', phone: '01012345678', email: 'kim.customer@example.com', provider: 'KAKAO', verified: true, status: 'ACTIVE', joinedAt: '2026-03-02T01:20:00Z', orderNumbers: ['74939001', '74939002'] },
  // 탈퇴 완료(customer 0.12.0) — 이름·연락처·이메일은 지워져 가린 값도 null, 고객번호는 남음
  { customerId: 'CUS-1009', customerNumber: '600112', name: '', phone: '', email: '', provider: 'KAKAO', verified: false, status: 'WITHDRAW_COMPLETED', joinedAt: '2026-01-10T03:00:00Z', orderNumbers: [] },
  { customerId: 'CUS-1005', customerNumber: '517204', name: '이민지', phone: '01098765678', email: 'minji@example.com', provider: 'NAVER', verified: false, status: 'WITHDRAW_PENDING', joinedAt: '2026-08-15T05:00:00Z', orderNumbers: ['74939005'] },
];

/** 목 고객 주문 ID(opsHandlers ORDER_NUMBERS: 74939001 ↔ ORD-MOCK-1001) */
const orderIdsOf = (c: MockCustomer) => c.orderNumbers.map((n) => `ORD-MOCK-100${n.slice(-1)}`);
/** 그 주문의 목 고객(클레임 목록 customerId 조건용) */
export const mockCustomerOfOrder = (orderId: string) => MOCK_CUSTOMERS.find((c) => orderIdsOf(c).includes(orderId))?.customerId;

const maskName = (n: string) => (n.length <= 1 ? '*' : `${n[0]}${'*'.repeat(Math.max(1, n.length - 2))}${n.length > 2 ? n[n.length - 1] : ''}`);
const maskPhone = (p: string) => `${p.slice(0, 3)}-****-${p.slice(-4)}`;
const maskEmail = (e: string) => `${e[0]}***@${e.split('@')[1] ?? ''}`;
const gone = (c: MockCustomer) => c.status === 'WITHDRAW_COMPLETED';
const summary = (c: MockCustomer) => ({ customerId: c.customerId, customerNumber: c.customerNumber, nameMasked: gone(c) ? null : maskName(c.name), phoneMasked: gone(c) ? null : maskPhone(c.phone), status: c.status });

/** CS_AGENT·OPERATOR_ADMIN 만(계약 x-roles) */
function deny(request: Request): Response | null {
  const s = operator(request);
  if (!s) return unauthorized();
  return s.roles.some((r) => r === 'CS_AGENT' || r === 'OPERATOR_ADMIN') ? null : problem(403, 'FORBIDDEN');
}

const composed = () => ({ composedAt: new Date().toISOString(), sources: [], unavailableSources: [] as string[] });

export const customerHandlers = [
  http.get(`${BFF_BASE}/views/customer-search`, ({ request }) => {
    const denied = deny(request);
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const given = (['customerNumber', 'phone', 'orderNumber'] as const).filter((k) => (q.get(k) ?? '').trim() !== '');
    if (given.length !== 1) return problem(400, 'VALIDATION_FAILED');
    const k = given[0]!;
    const v = (q.get(k) ?? '').replace(/[\s-]/g, '');
    const hits = MOCK_CUSTOMERS.filter((c) => (k === 'customerNumber' ? c.customerNumber === v : k === 'phone' ? c.phone === v : c.orderNumbers.includes(v)));
    return HttpResponse.json({ ...composed(), items: hits.map(summary) });
  }),

  http.get(`${BFF_BASE}/views/customer/:customerId`, ({ request, params }) => {
    const denied = deny(request);
    if (denied) return denied;
    const c = MOCK_CUSTOMERS.find((x) => x.customerId === params['customerId']);
    if (!c) return problem(404, 'NOT_FOUND');
    const first = c.customerId === 'CUS-1001';
    return HttpResponse.json({
      ...composed(),
      customer: { customerId: c.customerId, customerNumber: c.customerNumber, nameMasked: gone(c) ? null : maskName(c.name), phoneMasked: gone(c) ? null : maskPhone(c.phone), emailMasked: gone(c) ? null : maskEmail(c.email), status: c.status, socialProvider: c.provider, phoneVerified: c.verified, joinedAt: c.joinedAt },
      orders: {
        hasMore: false,
        items: c.orderNumbers.map((n, i) => ({ orderId: orderIdsOf(c)[i], orderNumber: n, status: i === 0 ? 'CONFIRMED' : 'IN_DELIVERY', confirmedAt: ago(2 + i * 24), itemCount: 1 + i, totalAmount: 15100, deliveryMode: 'INSTANT', mfcId: 'MFC-BSN-01', openFulfillmentIssues: 0 })),
      },
      inquiries: first
        ? { hasMore: false, items: [{ inquiryId: 'INQ-MOCK-3', inquiryNumber: '30418', category: 'DELIVERY', status: 'RECEIVED', channel: 'APP', origin: 'CUSTOMER', createdAt: ago(5 * 24), answeredAt: null, orderId: 'ORD-MOCK-1001' }] }
        : { hasMore: false, items: [] },
      csIntakes: first
        ? { hasMore: false, items: [{ intakeId: 'CSI-MOCK-1', channel: 'PHONE', category: 'DELIVERY', callerRelation: 'SELF', receivedAt: ago(30), receivedBy: 'op-cs-1', receivedByLabel: { operatorId: 'op-cs-1', name: '[목] 상담원', employeeNo: 'P2026-00003' }, linked: true, caseId: null, inquiryId: 'INQ-MOCK-3', subjectRef: null }] }
        : // 두 번째 고객은 상담 접수 원천을 못 읽은 것처럼 — 칸 null + unavailableSources
          null,
      // bff 0.23.0 클레임 칸(claim CL-7) — 최근 10건, 더 있으면 hasMore
      claims: (() => {
        const rows = mockClaimRowsOf(orderIdsOf(c));
        return { hasMore: rows.length > 10, items: rows.slice(0, 10) };
      })(),
      ...(first ? {} : { unavailableSources: ['case-service'] }),
    });
  }),

  http.post(`${API_BASE}/customers/:customerId/pii-reveals`, async ({ request, params }) => {
    const denied = deny(request);
    if (denied) return denied;
    const body = (await request.clone().json()) as { reason?: string; fields?: Array<'NAME' | 'PHONE'> };
    return idempotent(request, () => {
      const reason = (body.reason ?? '').trim();
      if (reason.length < 2 || reason.length > 200) return problem(400, 'VALIDATION_FAILED', [{ field: 'reason', reason: 'INVALID_FORMAT' }]);
      const c = MOCK_CUSTOMERS.find((x) => x.customerId === params['customerId']);
      if (!c) return problem(404, 'NOT_FOUND');
      const fields = body.fields && body.fields.length > 0 ? body.fields : (['NAME', 'PHONE'] as const);
      return {
        status: 200,
        body: { customerId: c.customerId, piiAccessLogId: `PAL-MOCK-C-${keyOf(request).slice(0, 8)}`, recordedAt: new Date().toISOString(), fields, name: fields.includes('NAME') ? c.name : null, phone: fields.includes('PHONE') ? c.phone : null },
      };
    });
  }),
];
