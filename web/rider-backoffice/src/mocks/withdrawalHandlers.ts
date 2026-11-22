// ⚠ 화면 개발·시험용 목 — 라이더 탈퇴 신청 목록(rider 0.19.0 `GET /riders/withdrawals`, 2026-11-20 PC 5). 실제 서버 동작이 아니다.
// `/riders/:riderId` 목보다 먼저 등록해야 한다(handlers.ts).
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { operator, problem, unauthorized } from './support';

const STAFF = ['RIDER_OPS', 'OPERATOR_ADMIN', 'CS_AGENT'];

const withdrawals = [
  { riderId: 'RD-W1', riderNumber: 'R6152', state: 'COMPLETED', blockers: [], reason: '다른 일을 하게 됐어요', requestedAt: '2026-11-20T09:40:00Z', completedAt: '2026-11-20T09:40:01Z' },
  { riderId: 'RD-7', riderNumber: 'R4829', state: 'REJECTED', blockers: ['ACTIVE_DELIVERY', 'UNCONFIRMED_EARNING'], reason: null, requestedAt: '2026-11-20T08:10:00Z', completedAt: null },
  { riderId: 'RD-W2', riderNumber: 'R3771', state: 'COMPLETED', blockers: [], reason: null, requestedAt: '2026-11-19T03:00:00Z', completedAt: '2026-11-19T03:00:01Z' },
] as const;

export const withdrawalHandlers = [
  http.get(`${API_BASE}/riders/withdrawals`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!who.roles.some((r) => STAFF.includes(r))) return problem(403, 'FORBIDDEN');
    const q = new URL(request.url).searchParams;
    const items = withdrawals.filter((w) => (!q.get('state') || w.state === q.get('state')) && (!q.get('riderNumber') || w.riderNumber === q.get('riderNumber')));
    return HttpResponse.json({ items, page: Number(q.get('page') ?? 0), size: items.length, hasNext: false });
  }),
];
