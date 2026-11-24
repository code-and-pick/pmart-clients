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

/** 목 화면 번호(case 0.25.0 inquiryNumber) — INQ-MOCK-3 → Q-1119-0003, INQ-MOCK-R2 → Q-1119-0102 */
const mockInquiryNumber = (id: string) => `Q-1119-${String((id.includes('-R') ? 100 : 0) + Number(id.match(/\d+$/)?.[0] ?? 0)).padStart(4, '0')}`;

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
    body: '배송 완료라고 뜨는데 아직 못 받았어요.',
    deliveryIssue: 'NOT_RECEIVED',
    deliveryId: 'DLV-MOCK-1',
    photos: [photo('IPH-MOCK-1'), photo('IPH-MOCK-2')],
    replies: [],
    // case 0.39.0 R-16 — 전달 완료 배송의 "받지 못함" 문의라 서버가 오배송 접수 건을 열고 고객 선택을 기다린다
    misdelivery: { caseId: 'CASE-MOCK-3', deliveryId: 'DLV-MOCK-1', state: 'AWAITING_CHOICE', options: ['RESHIP', 'REFUND'], deadlineAt: new Date(Date.now() + 4 * 3_600_000).toISOString(), resolution: null, chosenByType: null, chosenAt: null, autoResolved: false, chosenBy: null, chosenReason: null },
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
    body: '환불은 언제 들어오나요?',
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
    body: '우유 소비기한이 얼마나 남은 상품이 오나요?',
    satisfaction: { score: 4, comment: '빨리 답해 줘서 좋았어요', ratedAt: '2026-11-13T05:00:00Z' },
    replies: [{ replyId: 'REP-MOCK-1', authorType: 'AGENT', authorId: 'op-cs-1', body: '남은 기한을 확인하고 보내 드립니다.', createdAt: '2026-11-13T03:00:00Z' }],
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
    body: '어제 정산 금액이 앱에 안 보여요.',
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
    status: 'RECEIVED',
    origin: 'INQUIRY_PAGE',
    createdAt: '2026-11-14T03:00:00Z',
    answeredAt: '2026-11-14T04:00:00Z',
    version: 2,
    caseId: 'CASE-MOCK-R2',
    riderId: 'RID-MOCK-2',
    body: '배송 완료 버튼이 안 눌려요.',
    // case 0.21.0: 라이더가 답변 뒤에 이어 씀 → 다시 RECEIVED
    replies: [
      { replyId: 'REP-MOCK-R1', authorType: 'AGENT', authorId: 'op-rider-ops-1', body: '앱을 다시 켜 주세요.', createdAt: '2026-11-14T04:00:00Z' },
      { replyId: 'REP-MOCK-R2', authorType: 'RIDER', body: '다시 켜도 안 눌려요.', createdAt: '2026-11-14T05:00:00Z' },
    ],
  },
];

const kindOf = (i: Inquiry) => i.requesterType ?? 'CUSTOMER';
/** case 0.40.0 문의 센터 — 고객 = 주문 이행 센터(목 주문은 모두 부산진구), 라이더 = 접수 때 운행 센터(목: R1 부산진구, R2 없음). 없으면 null */
const centerOf = (i: Inquiry): string | null => (kindOf(i) === 'RIDER' ? (i.inquiryId === 'INQ-MOCK-R1' ? 'MFC-BSN-01' : null) : i.orderId ? 'MFC-BSN-01' : null);
/** 이 직원이 보는 문의 종류(0.13.0) */
const kindsFor = (roles: readonly string[]): string[] =>
  roles.includes('OPERATOR_ADMIN') ? ['CUSTOMER', 'RIDER'] : [...(roles.includes('CS_AGENT') ? ['CUSTOMER'] : []), ...(roles.includes('RIDER_OPS') ? ['RIDER'] : [])];

let inquiries = seed();
const replied = new Map<string, Inquiry>(); // Idempotency-Key → 결과
/** case 0.36.0 목록 lastAnsweredBy — 마지막으로 답한 직원(답 없으면 null) */
const seedAnswerers = () => new Map<string, string>(seed().filter((i) => i.answeredAt).map((i) => [i.inquiryId, kindOf(i) === 'RIDER' ? 'op-rider-ops-1' : 'op-cs-1']));
let answerers = seedAnswerers();

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
  answerers = seedAnswerers();
}

const PAGE = 20;

/** 조회 — 상담원(고객 문의) + 지원센터(라이더 문의, 0.13.0) + 본사 관리자(전부, 보기만). 돌려주는 kinds = 볼 수 있는 종류. */
const reader = (request: Request): { denied: Response } | { kinds: string[]; admin: boolean } => {
  const who = operator(request);
  if (!who) return { denied: unauthorized() };
  const kinds = kindsFor(who.roles);
  return kinds.length ? { kinds, admin: who.roles.includes('OPERATOR_ADMIN') } : { denied: problem(403, 'FORBIDDEN') };
};

/** 만족도 모아 보기 공통 — 관리자·기간 92일·고객 문의만(상담원 접수·라이더 문의 제외) */
function satisfactionScope(request: Request): { denied: Response } | { answered: Inquiry[]; fromText: string | null; toText: string | null } {
  const who = operator(request);
  if (!who) return { denied: unauthorized() };
  if (!who.roles.includes('OPERATOR_ADMIN')) return { denied: problem(403, 'FORBIDDEN') };
  const q = new URL(request.url).searchParams;
  const from = Date.parse(q.get('answeredFrom') ?? '');
  const to = Date.parse(q.get('answeredTo') ?? '');
  if (Number.isNaN(from) || Number.isNaN(to) || to < from || to - from > 92 * 86_400_000) return { denied: problem(400, 'VALIDATION_FAILED') };
  const answered = inquiries.filter((i) => kindOf(i) === 'CUSTOMER' && i.answeredAt && Date.parse(i.answeredAt) >= from && Date.parse(i.answeredAt) <= to);
  return { answered, fromText: q.get('answeredFrom'), toText: q.get('answeredTo') };
}
/** 문의 몫 직원 — 평가 직전 마지막 AGENT 답변자(평가 없으면 마지막 AGENT 답변자) */
function agentOf(i: Inquiry): string | null {
  const cut = i.satisfaction ? Date.parse(i.satisfaction.ratedAt) : Infinity;
  const last = [...i.replies].reverse().find((x) => x.authorType === 'AGENT' && Date.parse(x.createdAt ?? '') <= cut);
  return last?.authorId ?? null;
}

export const inquiryHandlers = [
  // 만족도 모아 보기는 /inquiries/:inquiryId 보다 먼저(같은 모양 경로)
  // case 0.15.0 만족도 모아 보기 — 관리자만, 답변 시각 기준 92일까지. 상담원별 값 없음
  http.get(`${API_BASE}/inquiries/satisfaction-summary`, ({ request }) => {
    // 대상 = 고객 문의(계약 — 라이더 문의·상담원 접수 제외). 2026-11-24 전에는 라이더 문의까지 세어 계약과 달랐다
    const p = satisfactionScope(request);
    if ('denied' in p) return p.denied;
    const answered = p.answered;
    const rated = answered.filter((i) => i.satisfaction);
    const byScore: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const i of rated) byScore[String(i.satisfaction?.score)] = (byScore[String(i.satisfaction?.score)] ?? 0) + 1;
    const scoreSum = rated.reduce((s, i) => s + (i.satisfaction?.score ?? 0), 0);
    return HttpResponse.json({
      answeredFrom: p.fromText,
      answeredTo: p.toText,
      answeredCount: answered.length,
      ratedCount: rated.length,
      scoreSum,
      averageScore: rated.length ? scoreSum / rated.length : null,
      byScore,
    });
  }),

  // case 0.38.0 직원별 만족도(2026-11-24) — 관리자만, 전체 요약과 같은 기간·대상(고객 문의만). 몫 = 평가 직전 마지막 AGENT 답변자(평가 없으면 마지막 AGENT 답변자)
  http.get(`${API_BASE}/inquiries/satisfaction-summary/by-agent`, ({ request }) => {
    const p = satisfactionScope(request);
    if ('denied' in p) return p.denied;
    const rows = new Map<string | null, { answeredCount: number; ratedCount: number; scoreSum: number; byScore: Record<string, number> }>();
    for (const i of p.answered) {
      const id = agentOf(i);
      const row = rows.get(id) ?? { answeredCount: 0, ratedCount: 0, scoreSum: 0, byScore: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } };
      row.answeredCount += 1;
      if (i.satisfaction) {
        row.ratedCount += 1;
        row.scoreSum += i.satisfaction.score;
        row.byScore[String(i.satisfaction.score)] = (row.byScore[String(i.satisfaction.score)] ?? 0) + 1;
      }
      rows.set(id, row);
    }
    const items = [...rows.entries()]
      .map(([agentId, x]) => ({ agentId, ...x, averageScore: x.ratedCount ? Math.round((x.scoreSum / x.ratedCount) * 100) / 100 : null }))
      .sort((a, b) => b.answeredCount - a.answeredCount);
    return HttpResponse.json({ answeredFrom: p.fromText, answeredTo: p.toText, items });
  }),
  http.get(`${API_BASE}/inquiries/satisfaction-ratings`, ({ request }) => {
    const p = satisfactionScope(request);
    if ('denied' in p) return p.denied;
    const q = new URL(request.url).searchParams;
    const agentId = q.get('agentId') ?? '';
    if (!agentId) return problem(400, 'VALIDATION_FAILED');
    const items = p.answered
      .filter((i) => i.satisfaction && agentOf(i) === agentId)
      .sort((a, b) => Date.parse(b.satisfaction!.ratedAt) - Date.parse(a.satisfaction!.ratedAt))
      .map((i) => ({ inquiryId: i.inquiryId, inquiryNumber: mockInquiryNumber(i.inquiryId), score: i.satisfaction!.score, comment: i.satisfaction!.comment ?? null, ratedAt: i.satisfaction!.ratedAt, answeredAt: i.answeredAt! }));
    return HttpResponse.json({ items, page: { nextCursor: null, size: Number(q.get('size') ?? 20) } });
  }),

  http.get(`${API_BASE}/inquiries`, ({ request }) => {
    const r = reader(request);
    if ('denied' in r) return r.denied;
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const wanted = url.searchParams.get('requesterType');
    if (wanted && !r.kinds.includes(wanted)) return problem(403, 'FORBIDDEN');
    const start = Number(url.searchParams.get('cursor') ?? '0');
    // centerId(0.40.0): 그 센터 + 센터 없는 문의는 늘 함께(사용자 결정 b)
    const centerId = url.searchParams.get('centerId');
    const all = inquiries.filter((i) => r.kinds.includes(kindOf(i)) && (!wanted || kindOf(i) === wanted) && (!status || i.status === status) && (!centerId || centerOf(i) === centerId || centerOf(i) === null));
    const slice = all.slice(start, start + PAGE);
    return HttpResponse.json({
      // 목록은 InquirySummary — 본문·답변은 싣지 않는다.
      items: slice.map((i) => ({
        inquiryId: i.inquiryId,
        inquiryNumber: mockInquiryNumber(i.inquiryId),
        requesterType: kindOf(i),
        category: i.category,
        orderId: i.orderId,
        title: i.title,
        status: i.status,
        origin: i.origin,
        channel: i.channel ?? null,
        callerRelation: i.callerRelation ?? null,
        deliveryIssue: i.deliveryIssue ?? null,
        centerId: centerOf(i),
        misdeliveryState: i.misdelivery?.state ?? null,
        misdeliveryDeadlineAt: i.misdelivery?.state === 'AWAITING_CHOICE' ? i.misdelivery.deadlineAt : null,
        createdAt: i.createdAt,
        answeredAt: i.answeredAt,
        lastAnsweredBy: answerers.get(i.inquiryId) ?? null,
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
    return HttpResponse.json({ ...rest, inquiryNumber: mockInquiryNumber(found.inquiryId), requesterType: kindOf(found), ...(r.admin && satisfaction ? { satisfaction } : {}) });
  }),

  // case 0.39.0 문의 대화 — 답변(SUPPORT)·라이더(RIDER)·시스템 안내(오배송 선택 요청·결과), seq 순
  http.get(`${API_BASE}/inquiries/:inquiryId/messages`, ({ request, params }) => {
    const r = reader(request);
    if ('denied' in r) return r.denied;
    const found = inquiries.find((i) => i.inquiryId === params.inquiryId && r.kinds.includes(kindOf(i)));
    if (!found) return problem(404, 'NOT_FOUND');
    type Msg = { senderType: 'SUPPORT' | 'RIDER' | 'CUSTOMER' | 'SYSTEM'; systemKind: 'MISDELIVERY_CHOICE_REQUEST' | 'MISDELIVERY_CHOSEN' | null; body: string; createdAt: string };
    const md = found.misdelivery;
    const list: Msg[] = [
      ...(md ? [{ senderType: 'SYSTEM' as const, systemKind: 'MISDELIVERY_CHOICE_REQUEST' as const, body: '다른 곳으로 배달된 것 같아요. 다시 보내기 또는 취소·환불 중 하나를 골라 주세요(5시간 안에 안 고르면 자동으로 환불돼요).', createdAt: found.createdAt }] : []),
      ...found.replies.map((x) => ({ senderType: x.authorType === 'RIDER' ? ('RIDER' as const) : ('SUPPORT' as const), systemKind: null, body: x.body ?? '', createdAt: x.createdAt ?? found.createdAt })),
      ...(md?.state === 'CHOSEN' && md.chosenAt ? [{ senderType: 'SYSTEM' as const, systemKind: 'MISDELIVERY_CHOSEN' as const, body: md.resolution === 'RESHIP' ? '다시 보내기로 정해졌어요.' : '취소·환불로 정해졌어요.', createdAt: md.chosenAt }] : []),
    ].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return HttpResponse.json({ items: list.map((x, i) => ({ messageId: `MSG-${found.inquiryId}-${i + 1}`, seq: i + 1, senderId: null, ...x })), status: found.status });
  }),

  // case 0.39.0 오배송 — 상담원이 대신 고르기(사유 2~200 필수, 한 번만, 기한 안)
  http.post(`${API_BASE}/inquiries/:inquiryId/misdelivery-choices`, async ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!who.roles.some((x) => x === 'CS_AGENT' || x === 'OPERATOR_ADMIN')) return problem(403, 'FORBIDDEN');
    const key = request.headers.get('Idempotency-Key') ?? '';
    const saved = replied.get(key);
    if (saved) return HttpResponse.json(saved);
    const index = inquiries.findIndex((i) => i.inquiryId === params.inquiryId);
    const found = inquiries[index];
    const md = found?.misdelivery;
    if (!found || !md) return problem(404, 'MISDELIVERY_NOT_FOUND');
    if (md.state === 'CHOSEN') return problem(409, 'MISDELIVERY_ALREADY_CHOSEN');
    if (Date.parse(md.deadlineAt) <= Date.now()) return problem(409, 'MISDELIVERY_CHOICE_EXPIRED');
    const body = (await request.json()) as { resolution?: string; reason?: string | null };
    if (body.resolution !== 'RESHIP' && body.resolution !== 'REFUND') return problem(400, 'VALIDATION_FAILED', [{ field: 'resolution', reason: 'INVALID_FORMAT' }]);
    const reason = (body.reason ?? '').trim();
    if (reason.length < 2 || reason.length > 200) return problem(400, 'VALIDATION_FAILED', [{ field: 'reason', reason: 'INVALID_FORMAT' }]);
    const next: Inquiry = { ...found, misdelivery: { ...md, state: 'CHOSEN', resolution: body.resolution, chosenByType: 'STAFF', chosenAt: new Date().toISOString(), autoResolved: false, chosenBy: who.subject, chosenReason: reason } };
    inquiries[index] = next;
    const out = { ...next, inquiryNumber: mockInquiryNumber(next.inquiryId), requesterType: kindOf(next) };
    replied.set(key, out);
    return HttpResponse.json(out);
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
      replies: [...found.replies, { replyId: `REP-MOCK-${found.replies.length + 2}`, authorType: 'AGENT', authorId: who.subject, body, createdAt: at }],
    };
    inquiries[index] = next;
    answerers.set(found.inquiryId, who.subject);
    replied.set(key, next);
    return HttpResponse.json(next);
  }),
];
