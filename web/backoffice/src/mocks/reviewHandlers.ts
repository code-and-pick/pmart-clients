// ⚠ 화면 개발·시험용 목 — 리뷰 신고 확인(review 0.7.0 BR-90)·FAQ 답 의견 집계(customer-assistant 0.4.0 BR-91), 2026-11-23.
// 신고 상세 `GET /review-reports/{reviewId}`·사진 본문 `GET /review-photos/{photoId}`(review 0.8.0 — 백엔드 PR #430 병합 전, 2026-11-24). 신고자는 싣지 않는다.
// 계약 모양 그대로. CS_AGENT·OPERATOR_ADMIN 만(그 밖 403). 처리는 멱등 키로 같은 결과, 처리할 신고가 없으면 409 NO_OPEN_REPORTS.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { idempotent, keyOf, operator, problem, unauthorized } from './support';

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const PIXEL = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

type Report = {
  reportId: string;
  reason: 'ABUSE' | 'AD' | 'IRRELEVANT' | 'PRIVACY' | 'OTHER';
  detail: string | null;
  reportedAt: string;
  state: 'OPEN' | 'RESOLVED';
  resolution: 'HIDE' | 'KEEP' | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
};
const open = (reportId: string, reason: Report['reason'], h: number, detail: string | null = null): Report => ({ reportId, reason, detail, reportedAt: ago(h), state: 'OPEN', resolution: null, resolvedAt: null, resolvedBy: null, resolutionNote: null });

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
  reviewUpdatedAt: string | null;
  photos: { photoId: string; url: string }[];
  reports: Report[];
};

const photo = (photoId: string) => ({ photoId, url: `/api/v1/review-photos/${photoId}` });

const seed = (): Group[] => [
  { reviewId: 'RV-MOCK-1', productId: 'PRD-MOCK-1', sku: 'E-MILK-1L', rating: 1, text: '이딴 걸 팔다니 ○○ 같은 가게', authorMasked: '김*수', reviewCreatedAt: ago(30), reasonCounts: { ABUSE: 3, OTHER: 1 }, otherDetails: ['직원 욕을 써 놨어요'], reportCount: 4, firstReportedAt: ago(20), lastReportedAt: ago(2), reviewHidden: false, reviewDeleted: false, state: 'OPEN', resolution: null, resolvedBy: null, resolvedAt: null, reviewUpdatedAt: null, photos: [photo('RPH-MOCK-1'), photo('RPH-MOCK-2')],
    reports: [open('RR-MOCK-4', 'ABUSE', 2), open('RR-MOCK-3', 'OTHER', 6, '직원 욕을 써 놨어요'), open('RR-MOCK-2', 'ABUSE', 12), open('RR-MOCK-1', 'ABUSE', 20)] },
  { reviewId: 'RV-MOCK-2', productId: 'PRD-MOCK-2', sku: 'E-EGG-10', rating: 5, text: '최고예요! 할인 링크 → example.com', authorMasked: '이*희', reviewCreatedAt: ago(50), reasonCounts: { AD: 2 }, otherDetails: [], reportCount: 2, firstReportedAt: ago(40), lastReportedAt: ago(5), reviewHidden: false, reviewDeleted: false, state: 'OPEN', resolution: null, resolvedBy: null, resolvedAt: null, reviewUpdatedAt: null, photos: [],
    reports: [open('RR-MOCK-6', 'AD', 5), open('RR-MOCK-5', 'AD', 40)] },
  { reviewId: 'RV-MOCK-3', productId: 'PRD-MOCK-1', sku: 'E-MILK-1L', rating: 3, text: '그냥 그래요', authorMasked: '박*준', reviewCreatedAt: ago(90), reasonCounts: { IRRELEVANT: 1 }, otherDetails: [], reportCount: 1, firstReportedAt: ago(80), lastReportedAt: ago(80), reviewHidden: false, reviewDeleted: false, state: 'RESOLVED', resolution: 'KEEP', resolvedBy: 'op-cs-1', resolvedAt: ago(70), reviewUpdatedAt: null, photos: [],
    reports: [{ ...open('RR-MOCK-7', 'IRRELEVANT', 80), state: 'RESOLVED', resolution: 'KEEP', resolvedAt: ago(70), resolvedBy: 'op-cs-1', resolutionNote: '상품 이야기라 그대로 둠' }] },
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
    const items = groups
      .filter((g) => g.state === state)
      .sort((a, b) => b.lastReportedAt.localeCompare(a.lastReportedAt))
      // 목록 줄은 ReviewReportGroup 모양만(상세 칸은 빼고)
      .map((g) => {
        const row: Partial<Group> = { ...g };
        delete row.reports;
        delete row.photos;
        delete row.reviewUpdatedAt;
        return row;
      });
    return HttpResponse.json({ items, nextCursor: null });
  }),

  // 신고 상세(0.8.0) — 리뷰 글 전체·사진·상태와 신고 한 건 한 건(최근 순, 처리 전·끝 모두). 없는·신고 없는 리뷰는 404 REVIEW_NOT_FOUND
  http.get(`${API_BASE}/review-reports/:reviewId`, ({ request, params }) => {
    const denied = deny(request);
    if (denied) return denied;
    const g = groups.find((x) => x.reviewId === params['reviewId']);
    if (!g || g.reports.length === 0) return problem(404, 'REVIEW_NOT_FOUND');
    const reports = [...g.reports].sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
    return HttpResponse.json({
      reviewId: g.reviewId,
      productId: g.productId,
      sku: g.sku,
      rating: g.rating,
      text: g.text,
      authorMasked: g.authorMasked,
      reviewCreatedAt: g.reviewCreatedAt,
      reviewUpdatedAt: g.reviewUpdatedAt,
      reviewHidden: g.reviewHidden,
      reviewDeleted: g.reviewDeleted,
      photos: g.photos,
      openReportCount: reports.filter((x) => x.state === 'OPEN').length,
      reports,
    });
  }),

  // 사진 본문 — 숨긴 리뷰 사진은 직원 토큰(상담원·관리자)이 있어야(0.8.0), 작성자가 지운 리뷰 사진은 직원에게도 404
  http.get(`${API_BASE}/review-photos/:photoId`, ({ request, params }) => {
    const g = groups.find((x) => x.photos.some((p) => p.photoId === params['photoId']));
    if (!g || g.reviewDeleted) return problem(404, 'NOT_FOUND');
    if (g.reviewHidden && deny(request)) return problem(404, 'NOT_FOUND');
    return new HttpResponse(PIXEL, { headers: { 'content-type': 'image/png' } });
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
      const at = new Date().toISOString();
      Object.assign(g, { state: 'RESOLVED', resolution: body.action, resolvedBy: who.subject, resolvedAt: at, reviewHidden: body.action === 'HIDE' });
      if (body.action === 'HIDE') g.reviewUpdatedAt = at;
      for (const x of g.reports) if (x.state === 'OPEN') Object.assign(x, { state: 'RESOLVED', resolution: body.action, resolvedAt: at, resolvedBy: who.subject, resolutionNote: body.note ?? null });
      return { status: 200, body: { requestId: keyOf(request), status: 'APPLIED', resultId: g.reviewId, occurredAt: new Date().toISOString() } };
    });
  }),

  http.get(`${API_BASE}/customer-assistant/faq-feedback`, ({ request }) => {
    const denied = deny(request);
    if (denied) return denied;
    return HttpResponse.json({
      items: [
        { faqId: 'FAQ-REFUND-1', category: 'refund', categoryTitle: '환불', question: '환불은 언제 들어오나요?', helpfulCount: 3, notHelpfulCount: 9, lastAt: ago(1) },
        { faqId: 'FAQ-OLD-7', category: null, categoryTitle: null, question: null, helpfulCount: 0, notHelpfulCount: 4, lastAt: ago(30) },
        { faqId: 'FAQ-CANCEL-1', category: 'cancel', categoryTitle: '주문 취소', question: '주문을 취소하고 싶어요', helpfulCount: 12, notHelpfulCount: 2, lastAt: ago(3) },
        { faqId: 'FAQ-NEW-1', category: 'delivery-status', categoryTitle: '배송 현황·지연·예약 시간', question: '배송은 어디쯤 왔나요?', helpfulCount: 0, notHelpfulCount: 0, lastAt: ago(5) },
      ],
    });
  }),
];
