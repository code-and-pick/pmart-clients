// ⚠ 화면 개발·시험용 목 — 라이더 공지(notification 0.5.0)·직원 조치 이력(rider 0.14.0·execution 0.28.0·dispatch 0.11.0). 실제 서버 동작이 아니다.
// - 공지: RIDER_OPS·OPERATOR_ADMIN 만(그 밖 403), 같은 Idempotency-Key 는 같은 결과. 받는 수는 목 값(전체 128명, 센터 42명).
// - 조치 이력: OPERATOR_ADMIN 만(그 밖 403). 원천마다 보기용 줄 몇 개, size·cursor(건너뛸 수) — 쪽이 나뉘는 것을 시험할 수 있게.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { db, nextSeq, timestamp } from './db';
import { keyOf, operator, problem, unauthorized } from './support';

interface MockNotice {
  noticeId: string;
  title: string;
  body: string;
  targetType: 'ALL' | 'MFC';
  mfcId: string | null;
  recipientCount: number;
  sentBy: string;
  sentAt: string;
}

interface MockAction {
  at: string;
  actorId: string;
  action: string;
  riderId: string | null;
  deliveryId: string | null;
  detail: string | null;
  reason: string | null;
}

const seedNotices = (): MockNotice[] => [
  { noticeId: 'NT-1', title: '우천 시 안전 운행 안내', body: '비가 오는 날은 속도를 줄이고 안전모를 꼭 써 주세요.', targetType: 'ALL', mfcId: null, recipientCount: 128, sentBy: 'OP-rops-1', sentAt: '2026-11-17T23:00:00.000Z' },
];

export const noticeState = { notices: seedNotices() };

export function resetNotices(): void {
  noticeState.notices = seedNotices();
}

const ACTIONS: Record<'rider' | 'execution' | 'dispatch', readonly MockAction[]> = {
  rider: [
    { at: '2026-11-18T02:10:00.000Z', actorId: 'OP-rops-1', action: 'RESTRICTION_SET', riderId: 'RD-8', deliveryId: null, detail: 'NORMAL→SUSPENDED', reason: '파손 신고 3건 확인' },
    { at: '2026-11-17T05:00:00.000Z', actorId: 'OP-admin-1', action: 'RESTRICTION_REVIEW_DECIDED', riderId: 'RD-7', deliveryId: null, detail: 'DISMISSED', reason: '고객 오해 — 통화 확인' },
    { at: '2026-11-16T01:00:00.000Z', actorId: 'OP-rops-1', action: 'RESTRICTION_LIFTED', riderId: 'RD-7', deliveryId: null, detail: 'SUSPENDED→NORMAL', reason: '소명 확인' },
  ],
  execution: [
    { at: '2026-11-18T03:00:00.000Z', actorId: 'OP-rops-1', action: 'STATUS_CORRECTED', riderId: 'RD-7', deliveryId: 'DLV-1', detail: 'PICKED_UP→ARRIVED_AT_CUSTOMER', reason: '라이더 앱 오류로 도착 못 누름' },
    { at: '2026-11-17T08:30:00.000Z', actorId: 'OP-rops-1', action: 'SURCHARGE_APPROVED', riderId: 'RD-8', deliveryId: 'DLV-2', detail: '1,500원', reason: null },
    { at: '2026-11-17T04:00:00.000Z', actorId: 'OP-admin-1', action: 'FAILURE_CONFIRM', riderId: 'RD-9', deliveryId: 'DLV-4', detail: 'CUSTOMER_UNREACHABLE', reason: '통화 3회 실패 확인' },
  ],
  dispatch: [
    { at: '2026-11-18T01:20:00.000Z', actorId: 'OP-rops-1', action: 'ASSIGNMENT_CANCELLED', riderId: 'RD-8', deliveryId: 'DLV-3', detail: null, reason: '라이더 사고 — 다른 라이더에게' },
  ],
};

function roles(request: Request) {
  return operator(request)?.roles ?? null;
}

function actionList(source: keyof typeof ACTIONS, path: string) {
  return http.get(`${API_BASE}${path}`, ({ request }) => {
    const r = roles(request);
    if (!r) return unauthorized();
    if (!r.includes('OPERATOR_ADMIN')) return problem(403, 'FORBIDDEN');
    const q = new URL(request.url).searchParams;
    const size = Number(q.get('size') ?? 50);
    const skip = Number(q.get('cursor') ?? 0);
    const from = q.get('from');
    const to = q.get('to');
    const match = (a: MockAction) =>
      (!q.get('riderId') || a.riderId === q.get('riderId')) &&
      (!q.get('deliveryId') || a.deliveryId === q.get('deliveryId')) &&
      (!q.get('operatorId') || a.actorId === q.get('operatorId')) &&
      (!from || a.at >= from) &&
      (!to || a.at < to);
    const rows = ACTIONS[source].filter(match);
    const page = rows.slice(skip, skip + size);
    return HttpResponse.json({ items: page, nextCursor: skip + size < rows.length ? String(skip + size) : null });
  });
}

export const noticeHandlers = [
  http.get(`${API_BASE}/rider-notices`, ({ request }) => {
    const r = roles(request);
    if (!r) return unauthorized();
    if (!r.some((x) => x === 'RIDER_OPS' || x === 'OPERATOR_ADMIN')) return problem(403, 'FORBIDDEN');
    const items = noticeState.notices.toSorted((a, b) => b.sentAt.localeCompare(a.sentAt));
    return HttpResponse.json({ items, nextCursor: null });
  }),
  http.post(`${API_BASE}/rider-notices`, async ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!who.roles.some((x) => x === 'RIDER_OPS' || x === 'OPERATOR_ADMIN')) return problem(403, 'FORBIDDEN');
    const key = `notice:${who.subject}:${keyOf(request)}`;
    const seen = db.idempotent.get(key);
    if (seen) return HttpResponse.json(seen.body as MockNotice, { status: seen.status });
    const body = (await request.json()) as { title?: string; body?: string; target?: { type?: string; mfcId?: string } };
    const title = (body.title ?? '').trim();
    const text = (body.body ?? '').trim();
    const type = body.target?.type;
    if (title.length < 1 || title.length > 40 || text.length < 1 || text.length > 500 || (type !== 'ALL' && type !== 'MFC') || (type === 'MFC' && !body.target?.mfcId)) {
      return problem(400, 'VALIDATION_FAILED');
    }
    const notice: MockNotice = {
      noticeId: `NT-${nextSeq()}`,
      title,
      body: text,
      targetType: type,
      mfcId: type === 'MFC' ? (body.target?.mfcId ?? null) : null,
      recipientCount: type === 'ALL' ? 128 : 42,
      sentBy: who.subject,
      sentAt: timestamp(),
    };
    noticeState.notices.push(notice);
    db.idempotent.set(key, { status: 200, body: notice });
    return HttpResponse.json(notice);
  }),
  actionList('rider', '/rider-staff-actions'),
  actionList('execution', '/delivery-staff-actions'),
  actionList('dispatch', '/dispatch-staff-actions'),
];
