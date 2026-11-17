// ⚠ 화면 개발·시험용 목(case-service 0.2.0 inquiries). 실제 서버 동작이 아니다.
// 0.13.0 라이더 문의: 보기 CS_AGENT = 고객 문의, RIDER_OPS = 라이더 문의, OPERATOR_ADMIN = 전부. ?requesterType= 로 못 보는 종류면 403. 답변은 종류별 역할.
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
  {
    inquiryId: 'INQ-MOCK-R1',
    requesterType: 'RIDER',
    category: 'SETTLEMENT',
    orderId: null,
    title: '정산 금액',
    status: 'RECEIVED',
    origin: 'INQUIRY_PAGE',
    createdAt: '2026-11-15T03:00:00Z',
    answeredAt: null,
    version: 1,
    caseId: 'CASE-MOCK-R1',
    riderId: 'RID-MOCK-1',
    body: '[목] 어제 정산 금액이 앱에 안 보여요.',
    replies: [],
  },
  {
    inquiryId: 'INQ-MOCK-R2',
    requesterType: 'RIDER',
    category: 'APP_ERROR',
    orderId: null,
    title: null,
    status: 'ANSWERED',
    origin: 'INQUIRY_PAGE',
    createdAt: '2026-11-14T03:00:00Z',
    answeredAt: '2026-11-14T04:00:00Z',
    version: 2,
    caseId: 'CASE-MOCK-R2',
    riderId: 'RID-MOCK-2',
    body: '[목] 배송 완료 버튼이 안 눌려요.',
    replies: [{ replyId: 'REP-MOCK-R1', authorType: 'AGENT', body: '[목] 앱을 다시 켜 주세요.', createdAt: '2026-11-14T04:00:00Z' }],
  },
];

const kindOf = (i: Inquiry) => i.requesterType ?? 'CUSTOMER';
/** 이 직원이 보는 문의 종류(0.13.0) */
const kindsFor = (roles: readonly string[]): string[] =>
  roles.includes('OPERATOR_ADMIN') ? ['CUSTOMER', 'RIDER'] : [...(roles.includes('CS_AGENT') ? ['CUSTOMER'] : []), ...(roles.includes('RIDER_OPS') ? ['RIDER'] : [])];

let inquiries = seed();
const replied = new Map<string, Inquiry>(); // Idempotency-Key → 결과

/** 상담원 접수(case 0.12.0 — csIntakeHandlers)가 만드는 문의(STAFF_INTAKE). 새 문의 ID 를 돌려준다. */
export function addStaffInquiry(x: {
  category: string;
  customerId: string;
  orderId: string | null;
  body: string;
  channel: string | null;
  callerRelation: string;
  createdAt: string;
  caseId: string;
}): string {
  const inquiryId = `INQ-MOCK-S${inquiries.length + 1}`;
  inquiries = [
    {
      inquiryId,
      category: x.category as Inquiry['category'],
      orderId: x.orderId,
      title: null,
      status: 'RECEIVED',
      origin: 'STAFF_INTAKE',
      requesterType: 'CUSTOMER',
      channel: x.channel,
      callerRelation: x.callerRelation,
      createdAt: x.createdAt,
      answeredAt: null,
      version: 1,
      caseId: x.caseId,
      customerId: x.customerId,
      body: x.body,
      replies: [],
    },
    ...inquiries,
  ];
  return inquiryId;
}

/** 시험 사이에 목 상태를 처음으로 돌린다. */
export function resetMockInquiries(): void {
  inquiries = seed();
  replied.clear();
}

const PAGE = 20;

/** 조회 — 상담원(고객 문의) + 지원센터(라이더 문의, 0.13.0) + 본사 관리자(전부, 보기만). 돌려주는 kinds = 볼 수 있는 종류. */
const reader = (request: Request): { denied: Response } | { kinds: string[] } => {
  const who = operator(request);
  if (!who) return { denied: unauthorized() };
  const kinds = kindsFor(who.roles);
  return kinds.length ? { kinds } : { denied: problem(403, 'FORBIDDEN') };
};

export const inquiryHandlers = [
  http.get(`${API_BASE}/inquiries`, ({ request }) => {
    const r = reader(request);
    if ('denied' in r) return r.denied;
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const wanted = url.searchParams.get('requesterType');
    if (wanted && !r.kinds.includes(wanted)) return problem(403, 'FORBIDDEN');
    const start = Number(url.searchParams.get('cursor') ?? '0');
    const all = inquiries.filter((i) => r.kinds.includes(kindOf(i)) && (!wanted || kindOf(i) === wanted) && (!status || i.status === status));
    const slice = all.slice(start, start + PAGE);
    return HttpResponse.json({
      // 목록은 InquirySummary — 본문·답변은 싣지 않는다.
      items: slice.map((i) => ({
        inquiryId: i.inquiryId,
        requesterType: kindOf(i),
        category: i.category,
        orderId: i.orderId,
        title: i.title,
        status: i.status,
        origin: i.origin,
        channel: i.channel ?? null,
        callerRelation: i.callerRelation ?? null,
        createdAt: i.createdAt,
        answeredAt: i.answeredAt,
        version: i.version,
      })),
      page: { nextCursor: start + PAGE < all.length ? String(start + PAGE) : null, size: PAGE },
    });
  }),

  http.get(`${API_BASE}/inquiries/:inquiryId`, ({ request, params }) => {
    const r = reader(request);
    if ('denied' in r) return r.denied;
    const found = inquiries.find((i) => i.inquiryId === params.inquiryId && r.kinds.includes(kindOf(i)));
    return found ? HttpResponse.json({ ...found, requesterType: kindOf(found) }) : problem(404, 'NOT_FOUND');
  }),

  http.post(`${API_BASE}/inquiries/:inquiryId/replies`, async ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const key = request.headers.get('Idempotency-Key') ?? '';
    const saved = replied.get(key);
    if (saved) return HttpResponse.json(saved);
    const index = inquiries.findIndex((i) => i.inquiryId === params.inquiryId);
    const found = inquiries[index];
    if (!found) return problem(404, 'NOT_FOUND');
    // 답변은 종류별 역할(0.13.0): 라이더 문의 RIDER_OPS, 고객 문의 CS_AGENT — 서로 403
    if (!who.roles.includes(kindOf(found) === 'RIDER' ? 'RIDER_OPS' : 'CS_AGENT')) return problem(403, 'FORBIDDEN');
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
