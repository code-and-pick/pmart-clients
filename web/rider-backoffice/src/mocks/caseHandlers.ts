// ⚠ 화면 개발·시험용 목 — 접수 건(case 0.22.0 GET /cases·/cases/{caseId}). 실제 서버 동작이 아니다.
// 흉내: RIDER_OPS 는 배송 쪽 종류만(그 밖 단건 404), 상태를 비우면 열린 것·CLOSED 면 끝난 것, overdue·unassigned·kind 거르기,
// size 2 를 넘으면 nextCursor(목: 건너뛸 수).
import { http, HttpResponse } from 'msw';

import type { components } from '../api/generated/case';
import { API_BASE } from '../api/client';
import { operator, problem, unauthorized } from './support';

type Case = components['schemas']['Case'];

const DELIVERY_KINDS = new Set(['RIDER_HELP', 'DELIVERY_INCIDENT', 'RIDER_LOCATION_STALE', 'MISDELIVERY', 'DISPATCH_FAILED']);

const ref = (refType: string, refId: string) => ({ refType, refId }) as NonNullable<Case['refs']>[number];

export const mockCases: Case[] = [
  {
    caseId: 'CASE-RH-1',
    kind: 'RIDER_HELP',
    state: 'OPEN',
    priority: 'P2',
    summary: '고객 연락 안 됨 — 전달 불가 신고',
    refs: [ref('deliveryId', 'DLV-1'), ref('orderId', 'ORD-1'), ref('riderId', 'RD-7')],
    openedAt: '2026-11-17T01:00:00.000Z',
    slaDueAt: '2026-11-17T01:30:00.000Z',
    overdue: true,
    assigneeId: null,
    history: [{ at: '2026-11-17T01:00:00.000Z', action: 'OPENED', toState: 'OPEN' }],
  },
  {
    caseId: 'CASE-DF-1',
    kind: 'DISPATCH_FAILED',
    state: 'ASSIGNED',
    priority: 'P1',
    summary: '응답 만료 — 배차 실패',
    refs: [ref('deliveryId', 'DLV-2'), ref('orderId', 'ORD-2')],
    openedAt: '2026-11-17T02:00:00.000Z',
    slaDueAt: '2099-01-01T00:00:00.000Z',
    overdue: false,
    assigneeId: 'OP-rops-1',
    history: [
      { at: '2026-11-17T02:00:00.000Z', action: 'OPENED', toState: 'OPEN' },
      { at: '2026-11-17T02:05:00.000Z', action: 'ASSIGNED', toState: 'ASSIGNED' },
    ],
  },
  {
    caseId: 'CASE-LS-1',
    kind: 'RIDER_LOCATION_STALE',
    state: 'OPEN',
    priority: 'P3',
    summary: '위치 3분 끊김',
    refs: [ref('riderId', 'RD-8'), ref('deliveryId', 'DLV-3')],
    openedAt: '2026-11-17T03:00:00.000Z',
    slaDueAt: '2099-01-01T00:00:00.000Z',
    overdue: false,
    assigneeId: null,
    history: [{ at: '2026-11-17T03:00:00.000Z', action: 'OPENED', toState: 'OPEN' }],
  },
  {
    caseId: 'CASE-RH-0',
    kind: 'RIDER_HELP',
    state: 'CLOSED',
    priority: 'P3',
    summary: '포장 대기 — 처리함',
    refs: [ref('deliveryId', 'DLV-4')],
    openedAt: '2026-11-16T01:00:00.000Z',
    slaDueAt: '2026-11-16T02:00:00.000Z',
    overdue: false,
    assigneeId: 'OP-rops-1',
    closure: { closedAt: '2026-11-16T01:20:00.000Z', resolution: 'RESOLVED', summary: '매장 확인 뒤 픽업' },
    history: [
      { at: '2026-11-16T01:00:00.000Z', action: 'OPENED', toState: 'OPEN' },
      { at: '2026-11-16T01:20:00.000Z', action: 'CLOSED', toState: 'CLOSED' },
    ],
  },
  {
    caseId: 'CASE-PAY-1',
    kind: 'PAYMENT_UNKNOWN',
    state: 'OPEN',
    priority: 'P2',
    summary: '결제 결과 모름',
    refs: [ref('orderId', 'ORD-9')],
    openedAt: '2026-11-17T04:00:00.000Z',
    overdue: false,
    assigneeId: null,
  },
];

const visibleTo = (roles: readonly string[], c: Case) => roles.includes('OPERATOR_ADMIN') || DELIVERY_KINDS.has(c.kind ?? '');
const PAGE = 2;

export const caseHandlers = [
  http.get(`${API_BASE}/cases`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const q = new URL(request.url).searchParams;
    const closed = q.get('state') === 'CLOSED';
    const skip = Number(q.get('cursor') ?? '0') || 0;
    const rows = mockCases
      .filter((c) => visibleTo(who.roles, c))
      .filter((c) => (closed ? c.state === 'CLOSED' : c.state !== 'CLOSED'))
      .filter((c) => !q.get('kind') || c.kind === q.get('kind'))
      .filter((c) => q.get('overdue') !== 'true' || c.overdue)
      .filter((c) => q.get('unassigned') !== 'true' || !c.assigneeId);
    const items = rows.slice(skip, skip + PAGE);
    const nextCursor = skip + PAGE < rows.length ? String(skip + PAGE) : null;
    return HttpResponse.json({ items, page: { nextCursor, size: PAGE } });
  }),
  http.get(`${API_BASE}/cases/:caseId`, ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const found = mockCases.find((c) => c.caseId === params['caseId']);
    if (!found || !visibleTo(who.roles, found)) return problem(404, 'NOT_FOUND');
    return HttpResponse.json(found);
  }),
];
