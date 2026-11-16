// 화면 개발·시험용 목 — 개인정보 열람 기록(audit-service 0.3.0 `GET /pii-access-logs`·`/{id}`).
// 규칙(계약 설명 그대로 흉내): OPERATOR_ADMIN 만(그 밖 403). occurredAt 새 것부터, size(최대 200)건씩 cursor.
// from(포함)·to(미포함) 은 열람 시각. from ≥ to 또는 깨진 cursor → 400. 없는 기록 → 404.
// 목 기록에는 개인정보 값이 없다(계약처럼 참조·항목 코드·사유만).
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { operator, problem, unauthorized } from './support';

interface MockLog {
  readonly piiAccessLogId: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly actor: { actorId: string; actorType: 'OPERATOR'; roles: string[]; centerScope: string[] };
  readonly subjectType: 'CUSTOMER' | 'RIDER' | 'DRIVER' | 'OPERATOR';
  readonly subjectRef: string;
  readonly accessType: 'VIEW' | 'DOWNLOAD' | 'EXPORT' | 'SEARCH';
  readonly fields: string[];
  readonly purpose: string;
  readonly screen: string;
  readonly caseRef: string | null;
  readonly recordCount: number;
  readonly sourceSystem: string;
  readonly requestId: string;
}

const log = (n: number, extra: Partial<MockLog>): MockLog => ({
  piiAccessLogId: `PAL-MOCK-${n}`,
  occurredAt: `2026-11-${String(16 - Math.floor(n / 3)).padStart(2, '0')}T0${n % 3}:30:00Z`,
  recordedAt: `2026-11-${String(16 - Math.floor(n / 3)).padStart(2, '0')}T0${n % 3}:30:01Z`,
  actor: { actorId: 'OP-cs-1', actorType: 'OPERATOR', roles: ['CS_AGENT'], centerScope: [] },
  subjectType: 'CUSTOMER',
  subjectRef: 'CU-MOCK-1',
  accessType: 'VIEW',
  fields: ['PHONE'],
  purpose: '배송 지연 문의 회신 전화',
  screen: 'backoffice/order-detail',
  caseRef: 'ORDER:ORD-MOCK-1001',
  recordCount: 1,
  sourceSystem: 'order-service',
  requestId: `req-mock-${n}`,
  ...extra,
});

/** 7건 — 직원 2명, 고객·라이더, 날짜 11-14 ~ 11-16 */
export const mockPiiLogs: readonly MockLog[] = [
  log(0, {}),
  log(1, { fields: ['NAME', 'ADDRESS', 'ENTRANCE'], purpose: '오배송 확인 — 수령지 대조' }),
  log(2, { actor: { actorId: 'OP-rider-ops-1', actorType: 'OPERATOR', roles: ['RIDER_OPS'], centerScope: [] }, subjectType: 'RIDER', subjectRef: 'RD-1', caseRef: 'RIDER:RD-1', fields: ['PHONE'], purpose: '라이더 연락 두절 확인', screen: 'backoffice/rider-detail', sourceSystem: 'rider-service' }),
  log(3, { subjectRef: 'CU-MOCK-2', caseRef: 'ORDER:ORD-MOCK-1002' }),
  log(4, { actor: { actorId: 'OP-admin-1', actorType: 'OPERATOR', roles: ['OPERATOR_ADMIN'], centerScope: [] }, caseRef: null }),
  log(5, {}),
  log(6, { subjectRef: 'CU-MOCK-3', caseRef: 'ORDER:ORD-MOCK-1003' }),
].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

const MAX = 200;

export const piiAccessLogHandlers = [
  http.get(`${API_BASE}/pii-access-logs`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!who.roles.includes('OPERATOR_ADMIN')) return problem(403, 'FORBIDDEN');
    const q = new URL(request.url).searchParams;
    const from = q.get('from');
    const to = q.get('to');
    if (from && to && Date.parse(from) >= Date.parse(to)) return problem(400, 'VALIDATION_FAILED');
    const size = Math.min(Number(q.get('size') ?? 20) || 20, MAX);
    const cursor = q.get('cursor');
    const start = cursor ? Number(cursor.replace('c-', '')) : 0;
    if (cursor && (!cursor.startsWith('c-') || Number.isNaN(start))) return problem(400, 'VALIDATION_FAILED');
    const eq = (k: string, v: string) => !q.get(k) || q.get(k) === v;
    const hit = mockPiiLogs.filter(
      (l) =>
        eq('actorId', l.actor.actorId) &&
        eq('subjectType', l.subjectType) &&
        eq('subjectRef', l.subjectRef) &&
        eq('caseRef', l.caseRef ?? '') &&
        eq('accessType', l.accessType) &&
        (!from || Date.parse(l.occurredAt) >= Date.parse(from)) &&
        (!to || Date.parse(l.occurredAt) < Date.parse(to)),
    );
    const items = hit.slice(start, start + size);
    const next = start + size < hit.length ? `c-${start + size}` : null;
    return HttpResponse.json({ items, page: { size, nextCursor: next } });
  }),
  http.get(`${API_BASE}/pii-access-logs/:id`, ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!who.roles.includes('OPERATOR_ADMIN')) return problem(403, 'FORBIDDEN');
    const found = mockPiiLogs.find((l) => l.piiAccessLogId === params.id);
    return found ? HttpResponse.json(found) : problem(404, 'NOT_FOUND');
  }),
];
