// ⚠ 화면 개발·시험용 목(case-service 0.2.0 inquiries). 실제 서버 동작이 아니다.
// 0.13.0 라이더 문의: 보기 CS_AGENT = 고객 문의, RIDER_OPS = 라이더 문의, OPERATOR_ADMIN = 전부. ?requesterType= 로 못 보는 종류면 403. 답변은 종류별 역할.
// 계약의 뜻만 흉내 낸다: 조회는 상담원(CS_AGENT)·본사 관리자(OPERATOR_ADMIN, 0.4.2), 답변은 상담원만(그 밖 403), 답변하면 ANSWERED·version+1,
// 낡은 X-Expected-Version 409 VERSION_CONFLICT, 닫힌 문의 409 INQUIRY_CLOSED, 같은 Idempotency-Key 재전송은 같은 결과.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components } from '../api/generated/case';
import { operator, problem, unauthorized } from './support';

/** 1x1 PNG(목 사진 본문) */
const PIXEL = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const photo = (photoId: string) => ({ photoId, url: `/api/v1/inquiry-photos/${photoId}`, contentType: 'image/png' as const, sizeBytes: PIXEL.length, uploadedAt: '2026-11-15T01:09:00Z' });

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
    deliveryIssue: 'NOT_RECEIVED',
    deliveryId: 'DLV-MOCK-1',
    photos: [photo('IPH-MOCK-1'), photo('IPH-MOCK-2')],
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
    satisfaction: { score: 4, comment: '[목] 빨리 답해 줘서 좋았어요', ratedAt: '2026-11-13T05:00:00Z' },
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
    // 두 번째는 저장소에서 지워진 사진처럼 본문 404
    photos: [photo('IPH-MOCK-R1'), photo('IPH-MOCK-GONE')],
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

/** case 0.18.0 현황 건수 목 — 종류별 답변 대기(RECEIVED). 0건이면 줄 없음 */
export function mockAwaitingInquiries(): Array<{ requesterType: 'CUSTOMER' | 'RIDER'; awaitingAnswer: number; oldestReceivedAt: string | null }> {
  return (['CUSTOMER', 'RIDER'] as const).flatMap((t) => {
    const waiting = inquiries.filter((i) => kindOf(i) === t && i.status === 'RECEIVED');
    if (waiting.length === 0) return [];
    const oldest = waiting.map((i) => i.createdAt).sort()[0] ?? null;
    return [{ requesterType: t, awaitingAnswer: waiting.length, oldestReceivedAt: oldest }];
  });
}

/** 시험 사이에 목 상태를 처음으로 돌린다. */
export function resetMockInquiries(): void {
  inquiries = seed();
  replied.clear();
}

const PAGE = 20;

/** 조회 — 상담원(고객 문의) + 지원센터(라이더 문의, 0.13.0) + 본사 관리자(전부, 보기만). 돌려주는 kinds = 볼 수 있는 종류. */
const reader = (request: Request): { denied: Response } | { kinds: string[]; admin: boolean } => {
  const who = operator(request);
  if (!who) return { denied: unauthorized() };
  const kinds = kindsFor(who.roles);
  return kinds.length ? { kinds, admin: who.roles.includes('OPERATOR_ADMIN') } : { denied: problem(403, 'FORBIDDEN') };
};

export const inquiryHandlers = [
  // 만족도 모아 보기는 /inquiries/:inquiryId 보다 먼저(같은 모양 경로)
  // case 0.15.0 만족도 모아 보기 — 관리자만, 답변 시각 기준 92일까지. 상담원별 값 없음
  http.get(`${API_BASE}/inquiries/satisfaction-summary`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!who.roles.includes('OPERATOR_ADMIN')) return problem(403, 'FORBIDDEN');
    const q = new URL(request.url).searchParams;
    const from = Date.parse(q.get('answeredFrom') ?? '');
    const to = Date.parse(q.get('answeredTo') ?? '');
    if (Number.isNaN(from) || Number.isNaN(to) || to < from || to - from > 92 * 86_400_000) return problem(400, 'VALIDATION_FAILED');
    const answered = inquiries.filter((i) => i.answeredAt && Date.parse(i.answeredAt) >= from && Date.parse(i.answeredAt) <= to);
    const rated = answered.filter((i) => i.satisfaction);
    const byScore: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const i of rated) byScore[String(i.satisfaction?.score)] = (byScore[String(i.satisfaction?.score)] ?? 0) + 1;
    const scoreSum = rated.reduce((s, i) => s + (i.satisfaction?.score ?? 0), 0);
    return HttpResponse.json({
      answeredFrom: q.get('answeredFrom'),
      answeredTo: q.get('answeredTo'),
      answeredCount: answered.length,
      ratedCount: rated.length,
      scoreSum,
      averageScore: rated.length ? scoreSum / rated.length : null,
      byScore,
    });
  }),

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
        deliveryIssue: i.deliveryIssue ?? null,
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
    if (!found) return problem(404, 'NOT_FOUND');
    // 만족도는 관리자에게만(0.15.0) — 상담원·지원센터 응답에는 없다
    const { satisfaction, ...rest } = found;
    return HttpResponse.json({ ...rest, requesterType: kindOf(found), ...(r.admin && satisfaction ? { satisfaction } : {}) });
  }),

  // case 0.19.0 문의 닫기 — 답변 역할 직원만(관리자 403), 사유 2~500자, 이미 닫힘 409
  http.post(`${API_BASE}/inquiries/:inquiryId/closures`, async ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const key = request.headers.get('Idempotency-Key') ?? '';
    const saved = replied.get(key);
    if (saved) return HttpResponse.json(saved);
    const index = inquiries.findIndex((i) => i.inquiryId === params.inquiryId);
    const found = inquiries[index];
    if (!found) return problem(404, 'NOT_FOUND');
    if (!who.roles.includes(kindOf(found) === 'RIDER' ? 'RIDER_OPS' : 'CS_AGENT')) return problem(403, 'FORBIDDEN');
    if (found.status === 'CLOSED') return problem(409, 'INQUIRY_CLOSED');
    const { reason } = (await request.json()) as { reason?: string };
    if (!reason || reason.trim().length < 2 || reason.length > 500) return problem(400, 'VALIDATION_FAILED', [{ field: 'reason', reason: 'INVALID_FORMAT' }]);
    const next: Inquiry = { ...found, status: 'CLOSED', closedAt: new Date().toISOString(), closedByType: 'STAFF', closeReason: reason.trim(), version: found.version + 1 };
    inquiries[index] = next;
    replied.set(key, next);
    return HttpResponse.json({ ...next, requesterType: kindOf(next) });
  }),

  // case 0.14.0 사진 본문 — 토큰 필요, 그 문의를 볼 수 있는 직원만(못 보면 404, 역할 없음 403)
  http.get(`${API_BASE}/inquiry-photos/:photoId`, ({ request, params }) => {
    const r = reader(request);
    if ('denied' in r) return r.denied;
    const id = String(params['photoId']);
    const owner = inquiries.find((i) => (i.photos ?? []).some((p) => p.photoId === id));
    if (!owner || !r.kinds.includes(kindOf(owner)) || id === 'IPH-MOCK-GONE') return problem(404, 'NOT_FOUND');
    return new HttpResponse(PIXEL, { headers: { 'content-type': 'image/png' } });
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
