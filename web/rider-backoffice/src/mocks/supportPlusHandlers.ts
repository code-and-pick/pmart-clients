// ⚠ 화면 개발·시험용 목 — 지원센터(접수 건·도움요청·라이더 문의) 화면 개편 때 더한 목. 실제 서버 동작이 아니다.
// - 도움요청 대기 목록(execution 0.4.0 `GET /delivery-help-requests`): HR-1(opsHandlers 의 상태를 따른다) + 보기용 건 몇 개.
//   거르기 state(기본 OPEN — 계약 default)·category·riderId, size·cursor. 보기용 건의 단건·대화도 여기서 준다(HR-1·HR-CASE 는 opsHandlers).
// - 라이더 문의 목록(case `GET /inquiries`): INQ-1(opsHandlers 의 상태를 따른다) + 보기용 문의 몇 개. 보기용 문의의 단건·대화도 여기서.
// 여기서 답하지 않는 요청은 아무것도 돌려주지 않아 다음 핸들러(opsHandlers)로 넘어간다.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { ops } from './opsHandlers';
import { operator, unauthorized } from './support';

type HelpState = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

interface ExtraHelp {
  requestId: string;
  deliveryId: string;
  riderId: string;
  mfcId: string;
  orderId: string;
  category: string;
  state: HelpState;
  stage: string;
  photoCount: number;
  caseId: string | null;
  detail: string;
  createdAt: string;
  resolvedAt: string | null;
}

const EXTRA_HELP: readonly ExtraHelp[] = [
  { requestId: 'HR-2', deliveryId: 'DLV-2', riderId: 'RD-8', mfcId: 'MFC-1', orderId: 'ORD-2', category: 'CUSTOMER_UNREACHABLE', state: 'OPEN', stage: 'ARRIVED_AT_CUSTOMER', photoCount: 0, caseId: null, detail: '고객이 전화를 안 받아요', createdAt: '2026-11-17T01:05:00.000Z', resolvedAt: null },
  { requestId: 'HR-3', deliveryId: 'DLV-3', riderId: 'RD-7', mfcId: 'MFC-1', orderId: 'ORD-3', category: 'STORE_WAITING', state: 'OPEN', stage: 'ASSIGNED', photoCount: 0, caseId: null, detail: '포장이 아직 안 끝났대요', createdAt: '2026-11-17T01:12:00.000Z', resolvedAt: null },
  { requestId: 'HR-4', deliveryId: 'DLV-4', riderId: 'RD-9', mfcId: 'MFC-2', orderId: 'ORD-4', category: 'GOODS_ISSUE', state: 'IN_PROGRESS', stage: 'PICKED_UP', photoCount: 1, caseId: null, detail: '봉투가 찢어졌어요', createdAt: '2026-11-17T00:40:00.000Z', resolvedAt: null },
  { requestId: 'HR-5', deliveryId: 'DLV-5', riderId: 'RD-8', mfcId: 'MFC-1', orderId: 'ORD-5', category: 'ADDRESS_ISSUE', state: 'RESOLVED', stage: 'COMPLETED', photoCount: 0, caseId: null, detail: '동 호수가 없어요', createdAt: '2026-11-16T23:10:00.000Z', resolvedAt: '2026-11-16T23:30:00.000Z' },
];

const helpQueueItem = () => ({
  requestId: 'HR-1',
  deliveryId: 'DLV-1',
  riderId: 'RD-7',
  mfcId: 'MFC-1',
  orderId: 'ORD-1',
  category: 'ADDRESS_ISSUE',
  state: ops.help.state,
  stage: 'ARRIVED_AT_CUSTOMER',
  photoCount: 2,
  caseId: null,
  createdAt: '2026-11-17T01:00:00.000Z',
  resolvedAt: ops.help.resolvedAt,
});

interface ExtraInquiry {
  inquiryId: string;
  riderId: string;
  category: 'SETTLEMENT' | 'ACCOUNT' | 'APP_ERROR' | 'OTHER';
  title: string;
  body: string;
  status: 'RECEIVED' | 'ANSWERED' | 'CLOSED';
  createdAt: string;
  answeredAt: string | null;
  closedAt: string | null;
}

const EXTRA_INQUIRIES: readonly ExtraInquiry[] = [
  { inquiryId: 'INQ-2', riderId: 'RD-8', category: 'APP_ERROR', title: '지도 화면이 멈춰요', body: '배송 중에 지도가 멈춰서 다시 켜야 해요', status: 'RECEIVED', createdAt: '2026-11-17T00:50:00.000Z', answeredAt: null, closedAt: null },
  { inquiryId: 'INQ-3', riderId: 'RD-9', category: 'ACCOUNT', title: '계좌 바꾸기', body: '정산 계좌를 바꾸고 싶어요', status: 'ANSWERED', createdAt: '2026-11-16T09:00:00.000Z', answeredAt: '2026-11-16T10:00:00.000Z', closedAt: null },
  { inquiryId: 'INQ-4', riderId: 'RD-7', category: 'OTHER', title: '헬멧 지급 문의', body: '헬멧은 어디서 받나요', status: 'CLOSED', createdAt: '2026-11-15T02:00:00.000Z', answeredAt: '2026-11-15T03:00:00.000Z', closedAt: '2026-11-15T04:00:00.000Z' },
];

const PAGE_DEFAULT = 20;

function page<T>(all: readonly T[], q: URLSearchParams) {
  const size = Math.max(1, Math.min(50, Number(q.get('size') ?? PAGE_DEFAULT) || PAGE_DEFAULT));
  const start = Number(q.get('cursor') ?? 0) || 0;
  const items = all.slice(start, start + size);
  const next = start + size < all.length ? String(start + size) : null;
  return { items, page: { nextCursor: next } };
}

export const supportPlusHandlers = [
  http.get(`${API_BASE}/delivery-help-requests`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    const q = new URL(request.url).searchParams;
    const state = q.get('state') ?? 'OPEN';
    const category = q.get('category');
    const riderId = q.get('riderId');
    // 오래된 것 먼저(계약)
    const all = [helpQueueItem(), ...EXTRA_HELP.map((x) => ({ requestId: x.requestId, deliveryId: x.deliveryId, riderId: x.riderId, mfcId: x.mfcId, orderId: x.orderId, category: x.category, state: x.state, stage: x.stage, photoCount: x.photoCount, caseId: x.caseId, createdAt: x.createdAt, resolvedAt: x.resolvedAt }))]
      .filter((x) => x.state === state && (!category || x.category === category) && (!riderId || x.riderId === riderId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return HttpResponse.json(page(all, q));
  }),
  http.get(`${API_BASE}/deliveries/:deliveryId/help-requests/:requestId/messages`, ({ request, params }) => {
    const x = EXTRA_HELP.find((h) => h.requestId === params.requestId);
    if (!x) return undefined;
    if (!operator(request)) return unauthorized();
    return HttpResponse.json({ items: [{ messageId: `${x.requestId}-M1`, seq: 1, senderType: 'RIDER', body: x.detail, createdAt: x.createdAt }], helpState: x.state });
  }),
  http.get(`${API_BASE}/deliveries/:deliveryId/help-requests/:requestId`, ({ request, params }) => {
    const x = EXTRA_HELP.find((h) => h.requestId === params.requestId);
    if (!x) return undefined;
    if (!operator(request)) return unauthorized();
    return HttpResponse.json({
      requestId: x.requestId,
      deliveryId: x.deliveryId,
      category: x.category,
      state: x.state,
      stage: x.stage,
      detail: x.detail,
      evidenceRefs: x.photoCount > 0 ? ['EVP-H1'] : [],
      caseId: x.caseId,
      lastRiderMessageAt: x.createdAt,
      lastSupportMessageAt: null,
      resolvedAt: x.resolvedAt,
      resolvedBy: x.resolvedAt ? 'OP-rops-1' : null,
      resolutionNote: x.resolvedAt ? '고객과 통화해 안내함' : null,
      createdAt: x.createdAt,
    });
  }),

  http.get(`${API_BASE}/inquiries`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    const q = new URL(request.url).searchParams;
    const status = q.get('status');
    const riderId = q.get('riderId'); // case 0.32.0 R-11 — 라이더 상세 "문의"
    const one = { inquiryId: 'INQ-1', riderId: 'RD-7', category: 'SETTLEMENT', title: '정산 문의', status: ops.inquiryStatus, createdAt: '2026-11-17T00:30:00.000Z', answeredAt: null, requesterType: 'RIDER', version: 1 };
    const extra = EXTRA_INQUIRIES.map((x) => ({ inquiryId: x.inquiryId, riderId: x.riderId, category: x.category, title: x.title, status: x.status, createdAt: x.createdAt, answeredAt: x.answeredAt, requesterType: 'RIDER', version: 1 }));
    const all = [one, ...extra].filter((x) => (!status || x.status === status) && (!riderId || x.riderId === riderId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return HttpResponse.json(page(all, q));
  }),
  http.get(`${API_BASE}/inquiries/:inquiryId/messages`, ({ request, params }) => {
    const x = EXTRA_INQUIRIES.find((i) => i.inquiryId === params.inquiryId);
    if (!x) return undefined;
    if (!operator(request)) return unauthorized();
    const items = x.answeredAt ? [{ messageId: `${x.inquiryId}-M1`, seq: 1, senderType: 'SUPPORT', body: '확인해서 안내드렸어요.', createdAt: x.answeredAt }] : [];
    return HttpResponse.json({ items, status: x.status });
  }),
  http.get(`${API_BASE}/inquiries/:inquiryId`, ({ request, params }) => {
    const x = EXTRA_INQUIRIES.find((i) => i.inquiryId === params.inquiryId);
    if (!x) return undefined;
    if (!operator(request)) return unauthorized();
    return HttpResponse.json({
      inquiryId: x.inquiryId,
      caseId: `CASE-${x.inquiryId}`,
      riderId: x.riderId,
      requesterType: 'RIDER',
      category: x.category,
      title: x.title,
      body: x.body,
      status: x.status,
      createdAt: x.createdAt,
      answeredAt: x.answeredAt,
      closedAt: x.closedAt,
      closedByType: x.closedAt ? 'STAFF' : null,
      closeReason: x.closedAt ? '안내 끝' : null,
      version: 1,
      replies: [],
      photos: [],
    });
  }),
];
