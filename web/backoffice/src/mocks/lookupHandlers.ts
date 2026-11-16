// ⚠ 화면 개발·시험용 목 — 통합 조회(bff 0.3.0 `GET /backoffice/views/unified-lookup`, 백엔드 PR #25 — 아직 main 미병합).
// 규칙(계약 설명 그대로 흉내): OPERATOR_ADMIN·CS_AGENT·RIDER_OPS(그 밖 403). q 완전 일치, kind 비우면 접두어(ORD-·DLV-·CASE-·CU-),
// TRANSFER·TRIP·모르는 접두어는 422 UNSUPPORTED_LOOKUP. 없는 대상은 200 + matches 비어 있음. 원천 실패는 unavailableSources(0건으로 바꾸지 않음).
// 원천 이름은 PR #25 LookupClients.Source(order-service·delivery-execution-service·delivery-dispatch-service·claim-service·case-service).
import { http, HttpResponse } from 'msw';

import { BFF_BASE } from '../api/client';
import { operator, problem, unauthorized } from './support';

const ROLES = ['OPERATOR_ADMIN', 'CS_AGENT', 'RIDER_OPS'];
// 고객 문의는 'case-service/inquiries'(사건과 다른 이름 — CS_AGENT·OPERATOR_ADMIN 만, 그 밖은 실패 원천으로)
const SYSTEMS = ['order-service', 'delivery-execution-service', 'delivery-dispatch-service', 'claim-service', 'case-service', 'case-service/inquiries'] as const;
type System = (typeof SYSTEMS)[number];

const at = '2026-11-16T01:00:00.000Z';

interface MockMatch {
  readonly kind: 'ORDER' | 'DELIVERY' | 'DISPATCH' | 'CLAIM' | 'CASE' | 'INQUIRY';
  readonly id: string;
  readonly system: System;
  readonly summary: Record<string, unknown>;
}

/** 주문 ORD-MOCK-1001 하나로 이은 원천들 */
const order1001: readonly MockMatch[] = [
  {
    kind: 'ORDER',
    id: 'ORD-MOCK-1001',
    system: 'order-service',
    summary: {
      orderId: 'ORD-MOCK-1001',
      customerId: 'CU-MOCK-1',
      status: 'IN_DELIVERY',
      mfcId: 'MFC-BSN-01',
      deliveryMode: 'INSTANT',
      confirmedAt: '2026-11-16T00:30:00.000Z',
      amounts: { itemsTotal: 21800, deliveryFee: 3000, total: 24800 },
      payment: { state: 'APPROVED', approvedAmount: 24800 },
      lineCount: 3,
      fulfillmentIssueCount: 0,
    },
  },
  {
    kind: 'DELIVERY',
    id: 'DLV-MOCK-1',
    system: 'delivery-execution-service',
    summary: { deliveryId: 'DLV-MOCK-1', type: 'ORDER', state: 'IN_TRANSIT', riderId: 'RID-MOCK-1', mfcId: 'MFC-BSN-01', assignedAt: '2026-11-16T00:40:00.000Z', pickedUpAt: '2026-11-16T00:50:00.000Z', completedAt: null },
  },
  {
    kind: 'DISPATCH',
    id: 'DLV-MOCK-1',
    system: 'delivery-dispatch-service',
    summary: { deliveryId: 'DLV-MOCK-1', state: 'ASSIGNED', assignment: { riderId: 'RID-MOCK-1' }, attempts: 1, delayAlertedAt: null, updatedAt: '2026-11-16T00:40:00.000Z' },
  },
  { kind: 'CLAIM', id: 'CLM-MOCK-1', system: 'claim-service', summary: { claimId: 'CLM-MOCK-1', type: 'RETURN', state: 'REQUESTED', openedAt: '2026-11-16T00:55:00.000Z' } },
  {
    kind: 'CASE',
    id: 'CASE-MOCK-1',
    system: 'case-service',
    summary: { caseId: 'CASE-MOCK-1', kind: 'RIDER_HELP', state: 'OPEN', priority: 'P1', summary: '[목] 공동현관 비밀번호 모름', slaDueAt: at, overdue: true, assigneeId: null },
  },
  {
    kind: 'CASE',
    id: 'CASE-MOCK-0',
    system: 'case-service',
    summary: { caseId: 'CASE-MOCK-0', kind: 'DELIVERY_INCIDENT', state: 'CLOSED', priority: 'P2', summary: '[목] 부재 — 문 앞 두기', slaDueAt: at, overdue: false, assigneeId: 'op-riderops-1' },
  },
  {
    kind: 'INQUIRY',
    id: 'INQ-MOCK-1',
    system: 'case-service/inquiries',
    summary: { inquiryId: 'INQ-MOCK-1', category: 'DELIVERY', orderId: 'ORD-MOCK-1001', status: 'RECEIVED', origin: 'APP', createdAt: '2026-11-16T00:58:00.000Z', answeredAt: null, version: 1 },
  },
];

/** 고객 CU-MOCK-1 의 주문 목록(목록 요약) */
const customerOrders: readonly MockMatch[] = [
  { kind: 'ORDER', id: 'ORD-MOCK-1001', system: 'order-service', summary: { orderId: 'ORD-MOCK-1001', status: 'IN_DELIVERY', totalAmount: 24800, itemCount: 3, confirmedAt: '2026-11-16T00:30:00.000Z' } },
  { kind: 'ORDER', id: 'ORD-MOCK-0990', system: 'order-service', summary: { orderId: 'ORD-MOCK-0990', status: 'DELIVERED', totalAmount: 12000, itemCount: 1, confirmedAt: '2026-11-10T03:00:00.000Z' } },
];

const KINDS = ['ORDER', 'DELIVERY', 'TRANSFER', 'TRIP', 'CUSTOMER', 'CASE', 'ANY'];
const PREFIX: ReadonlyArray<[string, string]> = [
  ['ORD-', 'ORDER'],
  ['DLV-', 'DELIVERY'],
  ['CASE-', 'CASE'],
  ['CU-', 'CUSTOMER'],
];

export const lookupHandlers = [
  http.get(`${BFF_BASE}/views/unified-lookup`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!who.roles.some((r) => ROLES.includes(r))) return problem(403, 'FORBIDDEN');
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') ?? '').trim();
    const raw = url.searchParams.get('kind') ?? 'ANY';
    if (!q) return problem(400, 'VALIDATION_FAILED', [{ field: 'q', reason: 'REQUIRED' }]);
    if (!KINDS.includes(raw)) return problem(400, 'VALIDATION_FAILED', [{ field: 'kind', reason: 'INVALID_FORMAT' }]);
    const kind = raw === 'ANY' ? PREFIX.find(([p]) => q.startsWith(p))?.[1] : raw;
    if (!kind || kind === 'TRANSFER' || kind === 'TRIP') return problem(422, 'UNSUPPORTED_LOOKUP');

    const composedAt = new Date().toISOString();
    const stamp = (system: string, ok: boolean) => ({
      system,
      confidence: ok ? ('DIRECT' as const) : ('UNKNOWN' as const),
      asOf: { asOf: composedAt, freshness: ok ? ('CURRENT' as const) : ('UNAVAILABLE' as const) },
    });
    // 고객 문의는 상담원·관리자만 — 그 밖은 "권한 없음"으로 실패 원천에
    const inquiryDenied = !who.roles.some((r) => r === 'CS_AGENT' || r === 'OPERATOR_ADMIN');
    const view = (orderId: string | null, matches: readonly MockMatch[], failedIn: readonly System[] = [], used: readonly System[] = SYSTEMS) => {
      const failed: readonly System[] = inquiryDenied && used.includes('case-service/inquiries') ? [...failedIn, 'case-service/inquiries'] : failedIn;
      return HttpResponse.json({
        sources: used.map((s) => stamp(s, !failed.includes(s))),
        unavailableSources: [...failed],
        composedAt,
        resolved: { kind, orderId },
        matches: matches.filter((x) => !failed.includes(x.system)).map((x) => ({ kind: x.kind, id: x.id, summary: x.summary, source: stamp(x.system, true) })),
      });
    };

    if (kind === 'CUSTOMER') return q === 'CU-MOCK-1' ? view(null, customerOrders, [], ['order-service']) : view(null, [], [], ['order-service']);
    // 배송·사건 번호도 그 주문으로 잇는다
    const linked = q === 'ORD-MOCK-1001' || q === 'DLV-MOCK-1' || q === 'CASE-MOCK-1';
    if (q === 'ORD-MOCK-FAIL') {
      // 클레임 원천 실패 — 칸에 "조회 실패"가 보여야 한다(0건 아님)
      return view('ORD-MOCK-FAIL', order1001.map((x) => (x.kind === 'ORDER' ? { ...x, id: 'ORD-MOCK-FAIL', summary: { ...x.summary, orderId: 'ORD-MOCK-FAIL' } } : x)).filter((x) => x.kind === 'ORDER'), ['claim-service']);
    }
    return linked ? view('ORD-MOCK-1001', order1001) : view(null, []);
  }),
];
