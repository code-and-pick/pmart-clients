// ⚠ 화면 개발·시험용 목 — 실시간 배송 현황(bff 0.3.0 `GET /backoffice/views/live-delivery`, 백엔드 PR #25 — 아직 main 미병합).
// 규칙(계약 설명 그대로 흉내): OPERATOR_ADMIN·CS_AGENT·RIDER_OPS(그 밖 403), mfcId 비우면 모든 센터.
// state 비우면 진행 중 전부를 생긴 순(오래된 것 먼저) size 건 — cursor 없음, 넘으면 truncated. state 주면 그 상태만 + page.nextCursor.
// 상태 없이 cursor → 400, 모르는 상태 → 400. 배차 원천 실패면 dispatch.state null·UNKNOWN, 사건 원천 실패면 openCases null.
// 목 전용 스위치: mfcId=MFC-MOCK-DOWN 이면 배차·사건 원천 실패.
import { http, HttpResponse } from 'msw';

import { BFF_BASE } from '../api/client';
import { operator, problem, unauthorized } from './support';

const ROLES = ['OPERATOR_ADMIN', 'CS_AGENT', 'RIDER_OPS'];
const ACTIVE = ['UNASSIGNED', 'ASSIGNED', 'ARRIVED_AT_STORE', 'PICKED_UP', 'ARRIVED_AT_CUSTOMER', 'FAILURE_REPORTED', 'SUSPENDED', 'RETURN_IN_PROGRESS', 'RETURN_PICKED_UP'];
const ALL = [...ACTIVE, 'COMPLETED', 'FAILED', 'RETURNED_TO_STORE', 'CANCELLED'];

interface Row {
  readonly deliveryId: string;
  readonly orderId: string;
  readonly mfcId: string;
  readonly type: string;
  readonly execution: string;
  readonly dispatch: string;
  readonly riderId: string | null;
  readonly createdAt: string;
  readonly window: { date: string; start: string; end: string } | null;
  readonly promisedAt: string | null;
  readonly openCases: ReadonlyArray<{ caseId: string; kind: string; priority: string; overdue: boolean }>;
}

const row = (n: number, extra: Partial<Row>): Row => ({
  deliveryId: `DLV-LIVE-${n}`,
  orderId: `ORD-LIVE-${n}`,
  mfcId: 'MFC-BSN-01',
  type: 'FORWARD',
  execution: 'ASSIGNED',
  dispatch: 'ASSIGNED',
  riderId: `RD-${n}`,
  createdAt: `2026-11-16T0${Math.min(n, 9)}:00:00.000Z`,
  window: { date: '2026-11-16', start: '10:00', end: '11:00' },
  promisedAt: '2099-01-01T02:00:00.000Z',
  openCases: [],
  ...extra,
});

/** 진행 중 4 + 끝난 1, 다른 센터 1. 미배정 5건(쪽 넘김 시험용 — 상태 UNASSIGNED, 2건씩) */
const rows: readonly Row[] = [
  row(1, { execution: 'PICKED_UP', dispatch: 'PICKED_UP', promisedAt: '2026-11-16T01:00:00.000Z', openCases: [{ caseId: 'CASE-MOCK-1', kind: 'RIDER_HELP', priority: 'P1', overdue: true }] }),
  row(2, { execution: 'FAILURE_REPORTED', type: 'RESHIPMENT' }),
  row(3, { mfcId: 'MFC-SEL-01', execution: 'ARRIVED_AT_STORE' }),
  row(4, { execution: 'COMPLETED', dispatch: 'CLOSED' }),
  ...[5, 6, 7, 8, 9].map((n) => row(n, { execution: 'UNASSIGNED', dispatch: 'DISPATCHING', riderId: null, window: null, promisedAt: null })),
];

export const liveDeliveryHandlers = [
  http.get(`${BFF_BASE}/views/live-delivery`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!who.roles.some((r) => ROLES.includes(r))) return problem(403, 'FORBIDDEN');
    const q = new URL(request.url).searchParams;
    const mfcId = q.get('mfcId') ?? '';
    const state = q.get('state') ?? '';
    const cursor = q.get('cursor') ?? '';
    const size = Math.min(Number(q.get('size') ?? '20') || 20, 50);
    if (!state && cursor) return problem(400, 'VALIDATION_FAILED');
    if (state && !ALL.includes(state)) return problem(400, 'VALIDATION_FAILED');
    const down = mfcId === 'MFC-MOCK-DOWN';

    const matched = rows
      .filter((r) => (down ? r.mfcId === 'MFC-BSN-01' : !mfcId || r.mfcId === mfcId))
      .filter((r) => (state ? r.execution === state : ACTIVE.includes(r.execution)))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const start = state && cursor ? Number(cursor.replace('C', '')) : 0;
    const pageRows = matched.slice(start, start + size);
    const rest = matched.length > start + size;

    const composedAt = new Date().toISOString();
    const stamp = (system: string, ok: boolean) => ({
      system,
      confidence: ok ? ('DIRECT' as const) : ('UNKNOWN' as const),
      asOf: { asOf: composedAt, freshness: ok ? ('CURRENT' as const) : ('UNAVAILABLE' as const) },
    });
    const failed = down ? ['delivery-dispatch-service', 'case-service'] : [];
    const ok = (s: string) => !failed.includes(s);
    return HttpResponse.json({
      sources: ['delivery-execution-service', 'delivery-dispatch-service', 'case-service'].map((s) => stamp(s, ok(s))),
      unavailableSources: failed,
      composedAt,
      truncated: !state && rest,
      page: { nextCursor: state && rest ? `C${start + size}` : null },
      items: pageRows.map((r) => ({
        deliveryId: r.deliveryId,
        orderId: r.orderId,
        mfcId: r.mfcId,
        type: r.type,
        riderId: r.riderId,
        createdAt: r.createdAt,
        assignedAt: r.riderId ? r.createdAt : null,
        pickedUpAt: r.execution === 'PICKED_UP' ? r.createdAt : null,
        delivery: { state: r.execution, version: 3, source: stamp('delivery-execution-service', true) },
        dispatch: ok('delivery-dispatch-service') ? { state: r.dispatch, version: 2, source: stamp('delivery-dispatch-service', true) } : { state: null, version: null, source: stamp('delivery-dispatch-service', false) },
        arrivalWindow: r.window,
        promisedAt: r.promisedAt,
        latestEta: null,
        openCases: ok('case-service') ? r.openCases : null,
      })),
    });
  }),
];
