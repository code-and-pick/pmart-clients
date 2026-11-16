// ⚠ 화면 개발·시험용 목 — 우리 센터 배송 현황(bff 0.3.1 live-delivery)·배차 실패 사건(case 0.5.2). 실제 서버 동작이 아니다.
// 규칙(요청서 그대로 흉내): 센터 관리자는 자기 센터만 — 다른 센터 mfcId 403, mfcId 비우면 센터 하나면 그 센터·여럿이면 400.
// 배차 실패 사건은 자기 센터의 DISPATCH_FAILED 만(다른 센터 404), 집기·닫기 403. 상태 비우면 열린 것, CLOSED 면 닫힌 것.
// 목 전용 스위치: 상태 SUSPENDED 로 거르면 배차·사건 원천 실패(dispatch.state null, openCases null).
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { operator, problem, unauthorized } from './support';

const BFF = `${API_BASE}/backoffice`;
const ACTIVE = ['UNASSIGNED', 'ASSIGNED', 'ARRIVED_AT_STORE', 'PICKED_UP', 'ARRIVED_AT_CUSTOMER', 'FAILURE_REPORTED', 'SUSPENDED', 'RETURN_IN_PROGRESS', 'RETURN_PICKED_UP'];

interface Row {
  deliveryId: string;
  orderId: string;
  mfcId: string;
  execution: string;
  dispatch: string;
  riderId: string | null;
  promisedAt: string | null;
  openCases: Array<{ caseId: string; kind: string; priority: string; overdue: boolean }>;
}

const rows: Row[] = [
  { deliveryId: 'DLV-C-1', orderId: 'ORD-C-1', mfcId: 'MFC-BSN-01', execution: 'UNASSIGNED', dispatch: 'DISPATCH_FAILED', riderId: null, promisedAt: '2026-11-16T01:00:00.000Z', openCases: [{ caseId: 'CASE-DF-1', kind: 'DISPATCH_FAILED', priority: 'P2', overdue: true }] },
  { deliveryId: 'DLV-C-2', orderId: 'ORD-C-2', mfcId: 'MFC-BSN-01', execution: 'PICKED_UP', dispatch: 'PICKED_UP', riderId: 'RD-7', promisedAt: '2099-01-01T00:00:00.000Z', openCases: [] },
  { deliveryId: 'DLV-C-3', orderId: 'ORD-C-3', mfcId: 'MFC-BSN-01', execution: 'COMPLETED', dispatch: 'CLOSED', riderId: 'RD-8', promisedAt: null, openCases: [] },
  { deliveryId: 'DLV-S-1', orderId: 'ORD-S-1', mfcId: 'MFC-SEL-01', execution: 'ASSIGNED', dispatch: 'ASSIGNED', riderId: 'RD-9', promisedAt: null, openCases: [] },
];

interface MockCase {
  caseId: string;
  centerId: string;
  state: string;
  priority: string;
  summary: string;
  overdue: boolean;
  slaDueAt: string;
  openedAt: string;
  refs: Array<{ refType: string; refId: string }>;
  history: Array<{ action: string; at: string; actorId: string; toState: string; note?: string }>;
  closure?: { resolution: string; summary: string; closedAt: string; closedBy: string };
}

const cases: MockCase[] = [
  {
    caseId: 'CASE-DF-1',
    centerId: 'MFC-BSN-01',
    state: 'OPEN',
    priority: 'P2',
    summary: '배차 실패 2번째 — 응답 만료 (10분마다 자동 재배차 중)',
    overdue: true,
    slaDueAt: '2026-11-16T00:10:00.000Z',
    openedAt: '2026-11-16T00:00:00.000Z',
    refs: [{ refType: 'deliveryId', refId: 'DLV-C-1' }, { refType: 'orderId', refId: 'ORD-C-1' }],
    history: [
      { action: 'OPENED', at: '2026-11-16T00:00:00.000Z', actorId: 'SYSTEM', toState: 'OPEN' },
      { action: 'RECURRED', at: '2026-11-16T00:10:00.000Z', actorId: 'SYSTEM', toState: 'OPEN', note: '배차 실패 3번째 — 응답 만료' },
    ],
  },
  {
    caseId: 'CASE-DF-2',
    centerId: 'MFC-BSN-01',
    state: 'CLOSED',
    priority: 'P1',
    summary: '배차 실패 — 시스템 장애',
    overdue: false,
    slaDueAt: '2026-11-15T03:10:00.000Z',
    openedAt: '2026-11-15T03:00:00.000Z',
    refs: [{ refType: 'deliveryId', refId: 'DLV-C-0' }],
    history: [{ action: 'OPENED', at: '2026-11-15T03:00:00.000Z', actorId: 'SYSTEM', toState: 'OPEN' }],
    closure: { resolution: 'RESOLVED', summary: '수동 재배차로 픽업', closedAt: '2026-11-15T03:20:00.000Z', closedBy: 'OP-rider-ops-1' },
  },
  {
    caseId: 'CASE-DF-S',
    centerId: 'MFC-SEL-01',
    state: 'OPEN',
    priority: 'P2',
    summary: '다른 센터 배차 실패',
    overdue: false,
    slaDueAt: '2026-11-16T00:10:00.000Z',
    openedAt: '2026-11-16T00:00:00.000Z',
    refs: [{ refType: 'deliveryId', refId: 'DLV-S-1' }],
    history: [],
  },
];

const summaryOf = (c: MockCase) => ({ caseId: c.caseId, kind: 'DISPATCH_FAILED', state: c.state, priority: c.priority, summary: c.summary, centerId: c.centerId, overdue: c.overdue, slaDueAt: c.slaDueAt, openedAt: c.openedAt, refs: c.refs, assigneeGroup: 'DELIVERY_OPS', assigneeId: null });

export const centerDeliveryHandlers = [
  http.get(`${BFF}/views/live-delivery`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const q = new URL(request.url).searchParams;
    let mfcId = q.get('mfcId') ?? '';
    if (who.roles.includes('MFC_SUPERVISOR') && !who.roles.includes('OPERATOR_ADMIN')) {
      if (!mfcId) {
        if (who.centers.length !== 1) return problem(400, 'VALIDATION_FAILED', [{ field: 'mfcId', reason: 'REQUIRED' }]);
        mfcId = who.centers[0] ?? '';
      }
      if (!who.centers.includes(mfcId)) return problem(403, 'FORBIDDEN');
    } else if (!who.roles.includes('OPERATOR_ADMIN')) return problem(403, 'FORBIDDEN');
    const state = q.get('state') ?? '';
    if (state && !ACTIVE.includes(state)) return problem(400, 'VALIDATION_FAILED');
    const down = state === 'SUSPENDED';
    const now = new Date().toISOString();
    const stamp = (system: string, ok = true) => ({ system, confidence: ok ? 'DIRECT' : 'UNKNOWN', asOf: { asOf: now, freshness: ok ? 'CURRENT' : 'UNAVAILABLE' } });
    const hit = rows.filter((r) => (!mfcId || r.mfcId === mfcId) && (state ? r.execution === state : ACTIVE.includes(r.execution)));
    const items = hit.map((r) => ({
      deliveryId: r.deliveryId,
      orderId: r.orderId,
      mfcId: r.mfcId,
      type: 'FORWARD',
      delivery: { state: r.execution, version: 3, source: stamp('delivery-execution-service') },
      dispatch: down ? { state: null, version: null, source: stamp('delivery-dispatch-service', false) } : { state: r.dispatch, version: 2, source: stamp('delivery-dispatch-service') },
      riderId: r.riderId,
      arrivalWindow: { date: '2026-11-16', start: '10:00', end: '11:00' },
      promisedAt: r.promisedAt,
      latestEta: null,
      openCases: down ? null : r.openCases,
    }));
    return HttpResponse.json({
      composedAt: now,
      sources: [stamp('delivery-execution-service'), stamp('delivery-dispatch-service', !down), stamp('case-service', !down)],
      unavailableSources: down ? ['delivery-dispatch-service', 'case-service'] : [],
      truncated: false,
      items,
      page: { size: 50, nextCursor: null },
    });
  }),

  http.get(`${API_BASE}/cases`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const q = new URL(request.url).searchParams;
    if (q.get('kind') !== 'DISPATCH_FAILED') return HttpResponse.json({ items: [], page: { size: 0, nextCursor: null } });
    const state = q.get('state');
    const centerId = q.get('centerId');
    const items = cases
      .filter((c) => who.centers.includes(c.centerId))
      .filter((c) => !centerId || c.centerId === centerId)
      .filter((c) => (state ? c.state === state : c.state !== 'CLOSED'))
      .map(summaryOf);
    return HttpResponse.json({ items, page: { size: items.length, nextCursor: null } });
  }),

  http.get(`${API_BASE}/cases/:caseId`, ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const c = cases.find((x) => x.caseId === params['caseId']);
    if (!c || !who.centers.includes(c.centerId)) return problem(404, 'NOT_FOUND');
    return HttpResponse.json({ ...summaryOf(c), version: 2, history: c.history, ...(c.closure ? { closure: c.closure } : {}) });
  }),

  // 센터 관리자는 집기·닫기가 없다(서버 403) — 화면에 버튼도 없다
  http.post(`${API_BASE}/cases/:caseId/assignments`, () => problem(403, 'FORBIDDEN')),
  http.post(`${API_BASE}/cases/:caseId/closures`, () => problem(403, 'FORBIDDEN')),
];
