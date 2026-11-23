// ⚠ 화면 개발·시험용 목 — 리뷰 신고 확인(review 0.7.0 BR-90)·FAQ 답 의견 집계(customer-assistant 0.4.0 BR-91), 2026-11-23.
// 계약 모양 그대로. CS_AGENT·OPERATOR_ADMIN 만(그 밖 403). 처리는 멱등 키로 같은 결과, 처리할 신고가 없으면 409 NO_OPEN_REPORTS.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { idempotent, keyOf, operator, problem, unauthorized } from './support';

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

type Group = {
  reviewId: string;
  productId: string;
  sku: string | null;
  rating: number;
  text: string | null;
  authorMasked: string;
  reviewCreatedAt: string;
  reasonCounts: Record<string, number>;
  otherDetails: string[];
  reportCount: number;
  firstReportedAt: string;
  lastReportedAt: string;
  reviewHidden: boolean;
  reviewDeleted: boolean;
  state: 'OPEN' | 'RESOLVED';
  resolution: 'HIDE' | 'KEEP' | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
};

const seed = (): Group[] => [
  { reviewId: 'RV-MOCK-1', productId: 'PRD-MOCK-1', sku: 'E-MILK-1L', rating: 1, text: '이딴 걸 팔다니 ○○ 같은 가게', authorMasked: '김*수', reviewCreatedAt: ago(30), reasonCounts: { ABUSE: 3, OTHER: 1 }, otherDetails: ['직원 욕을 써 놨어요'], reportCount: 4, firstReportedAt: ago(20), lastReportedAt: ago(2), reviewHidden: false, reviewDeleted: false, state: 'OPEN', resolution: null, resolvedBy: null, resolvedAt: null },
  { reviewId: 'RV-MOCK-2', productId: 'PRD-MOCK-2', sku: 'E-EGG-10', rating: 5, text: '최고예요! 할인 링크 → example.com', authorMasked: '이*희', reviewCreatedAt: ago(50), reasonCounts: { AD: 2 }, otherDetails: [], reportCount: 2, firstReportedAt: ago(40), lastReportedAt: ago(5), reviewHidden: false, reviewDeleted: false, state: 'OPEN', resolution: null, resolvedBy: null, resolvedAt: null },
  { reviewId: 'RV-MOCK-3', productId: 'PRD-MOCK-1', sku: 'E-MILK-1L', rating: 3, text: '그냥 그래요', authorMasked: '박*준', reviewCreatedAt: ago(90), reasonCounts: { IRRELEVANT: 1 }, otherDetails: [], reportCount: 1, firstReportedAt: ago(80), lastReportedAt: ago(80), reviewHidden: false, reviewDeleted: false, state: 'RESOLVED', resolution: 'KEEP', resolvedBy: 'op-cs-1', resolvedAt: ago(70) },
];
let groups = seed();
export const resetMockReviewReports = () => {
  groups = seed();
};

const deny = (request: Request) => {
  const who = operator(request);
  if (!who) return unauthorized();
  return who.roles.some((r) => r === 'CS_AGENT' || r === 'OPERATOR_ADMIN') ? null : problem(403, 'FORBIDDEN');
};

export const reviewHandlers = [
  http.get(`${API_BASE}/review-reports`, ({ request }) => {
    const denied = deny(request);
    if (denied) return denied;
    const state = new URL(request.url).searchParams.get('state') === 'RESOLVED' ? 'RESOLVED' : 'OPEN';
    const items = groups.filter((g) => g.state === state).sort((a, b) => b.lastReportedAt.localeCompare(a.lastReportedAt));
    return HttpResponse.json({ items, nextCursor: null });
  }),

  http.post(`${API_BASE}/review-reports/:reviewId/resolutions`, async ({ request, params }) => {
    const denied = deny(request);
    if (denied) return denied;
    const who = operator(request)!;
    const body = (await request.clone().json()) as { action?: 'HIDE' | 'KEEP'; note?: string };
    return idempotent(request, () => {
      const g = groups.find((x) => x.reviewId === params['reviewId']);
      if (!g) return problem(404, 'NOT_FOUND');
      if (g.state !== 'OPEN') return problem(409, 'NO_OPEN_REPORTS');
      if (body.action !== 'HIDE' && body.action !== 'KEEP') return problem(400, 'VALIDATION_FAILED');
      Object.assign(g, { state: 'RESOLVED', resolution: body.action, resolvedBy: who.subject, resolvedAt: new Date().toISOString(), reviewHidden: body.action === 'HIDE' });
      return { status: 200, body: { requestId: keyOf(request), status: 'APPLIED', resultId: g.reviewId, occurredAt: new Date().toISOString() } };
    });
  }),

  http.get(`${API_BASE}/customer-assistant/faq-feedback`, ({ request }) => {
    const denied = deny(request);
    if (denied) return denied;
    return HttpResponse.json({
      items: [
        { faqId: 'FAQ-REFUND-1', category: 'refund', question: '환불은 언제 들어오나요?', helpfulCount: 3, notHelpfulCount: 9, lastAt: ago(1) },
        { faqId: 'FAQ-OLD-7', category: null, question: null, helpfulCount: 0, notHelpfulCount: 4, lastAt: ago(30) },
        { faqId: 'FAQ-CANCEL-1', category: 'cancel', question: '주문을 취소하고 싶어요', helpfulCount: 12, notHelpfulCount: 2, lastAt: ago(3) },
        { faqId: 'FAQ-NEW-1', category: 'delivery-status', question: '배송은 어디쯤 왔나요?', helpfulCount: 0, notHelpfulCount: 0, lastAt: ago(5) },
      ],
    });
  }),
];
