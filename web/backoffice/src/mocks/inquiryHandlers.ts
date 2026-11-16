// ⚠ 화면 개발·시험용 목(case-service 0.2.0 inquiries). 실제 서버 동작이 아니다.
// 계약의 뜻만 흉내 낸다: 조회는 상담원(CS_AGENT)·본사 관리자(OPERATOR_ADMIN, 0.4.2), 답변은 상담원만(그 밖 403), 답변하면 ANSWERED·version+1,
// 낡은 X-Expected-Version 409 VERSION_CONFLICT, 닫힌 문의 409 INQUIRY_CLOSED, 같은 Idempotency-Key 재전송은 같은 결과.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components } from '../api/generated/case';
import { operator, problem, unauthorized } from './support';

type Inquiry = components['schemas']['Inquiry'];

const seed = (): Inquiry[] => [
  {
    inquiryId: 'INQ-MOCK-3',
    category: 'DELIVERY',
    orderId: 'ORD-MOCK-1001',
    title: '배송 문의',
    status: 'RECEIVED',
    origin: 'INQUIRY_PAGE',
    createdAt: '2026-11-15T01:10:00Z',
    answeredAt: null,
    version: 1,
    caseId: 'CASE-MOCK-3',
    customerId: 'CUS-MOCK-1',
    body: '[목] 배송 완료라고 뜨는데 아직 못 받았어요.',
    replies: [],
  },
  {
    inquiryId: 'INQ-MOCK-2',
    category: 'REFUND',
    orderId: null,
    title: null,
    status: 'RECEIVED',
    origin: 'ASSISTANT_HANDOFF',
    createdAt: '2026-11-14T08:00:00Z',
    answeredAt: null,
    version: 1,
    caseId: 'CASE-MOCK-2',
    customerId: 'CUS-MOCK-2',
    body: '[목] 환불은 언제 들어오나요?',
    replies: [],
  },
  {
    inquiryId: 'INQ-MOCK-1',
    category: 'PRODUCT',
    orderId: null,
    title: '소비기한',
    status: 'ANSWERED',
    origin: 'INQUIRY_PAGE',
    createdAt: '2026-11-13T02:00:00Z',
    answeredAt: '2026-11-13T03:00:00Z',
    version: 2,
    caseId: 'CASE-MOCK-1',
    customerId: 'CUS-MOCK-3',
    body: '[목] 우유 소비기한이 얼마나 남은 상품이 오나요?',
    replies: [{ replyId: 'REP-MOCK-1', authorType: 'AGENT', body: '[목] 남은 기한을 확인하고 보내 드립니다.', createdAt: '2026-11-13T03:00:00Z' }],
  },
];

let inquiries = seed();
const replied = new Map<string, Inquiry>(); // Idempotency-Key → 결과

/** 시험 사이에 목 상태를 처음으로 돌린다. */
export function resetMockInquiries(): void {
  inquiries = seed();
  replied.clear();
}

const PAGE = 20;

const agent = (request: Request) => {
  const who = operator(request);
  if (!who) return unauthorized();
  return who.roles.includes('CS_AGENT') ? null : problem(403, 'FORBIDDEN');
};

/** 조회 — 상담원 + 본사 관리자(보기만, case 0.4.2). */
const reader = (request: Request) => {
  const who = operator(request);
  if (!who) return unauthorized();
  return who.roles.includes('CS_AGENT') || who.roles.includes('OPERATOR_ADMIN') ? null : problem(403, 'FORBIDDEN');
};

export const inquiryHandlers = [
  http.get(`${API_BASE}/inquiries`, ({ request }) => {
    const denied = reader(request);
    if (denied) return denied;
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const start = Number(url.searchParams.get('cursor') ?? '0');
    const all = inquiries.filter((i) => !status || i.status === status);
    const slice = all.slice(start, start + PAGE);
    return HttpResponse.json({
      // 목록은 InquirySummary — 본문·답변은 싣지 않는다.
      items: slice.map((i) => ({
        inquiryId: i.inquiryId,
        category: i.category,
        orderId: i.orderId,
        title: i.title,
        status: i.status,
        origin: i.origin,
        createdAt: i.createdAt,
        answeredAt: i.answeredAt,
        version: i.version,
      })),
      page: { nextCursor: start + PAGE < all.length ? String(start + PAGE) : null, size: PAGE },
    });
  }),

  http.get(`${API_BASE}/inquiries/:inquiryId`, ({ request, params }) => {
    const denied = reader(request);
    if (denied) return denied;
    const found = inquiries.find((i) => i.inquiryId === params.inquiryId);
    return found ? HttpResponse.json(found) : problem(404, 'NOT_FOUND');
  }),

  http.post(`${API_BASE}/inquiries/:inquiryId/replies`, async ({ request, params }) => {
    const denied = agent(request);
    if (denied) return denied;
    const key = request.headers.get('Idempotency-Key') ?? '';
    const saved = replied.get(key);
    if (saved) return HttpResponse.json(saved);
    const index = inquiries.findIndex((i) => i.inquiryId === params.inquiryId);
    const found = inquiries[index];
    if (!found) return problem(404, 'NOT_FOUND');
    if (found.status === 'CLOSED') return problem(409, 'INQUIRY_CLOSED');
    if (Number(request.headers.get('X-Expected-Version')) !== found.version) return problem(409, 'VERSION_CONFLICT');
    const { body } = (await request.json()) as { body?: string };
    if (!body) return problem(400, 'VALIDATION_FAILED');
    const at = new Date().toISOString();
    const next: Inquiry = {
      ...found,
      status: 'ANSWERED',
      answeredAt: at,
      version: found.version + 1,
      replies: [...found.replies, { replyId: `REP-MOCK-${found.replies.length + 2}`, authorType: 'AGENT', body, createdAt: at }],
    };
    inquiries[index] = next;
    replied.set(key, next);
    return HttpResponse.json(next);
  }),
];
