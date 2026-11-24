// 목: dispatch 정시 배송률(GET /metrics/on-time-deliveries, 0.13.0)·배차 지연 배송(GET /dispatch-delays, 0.12.0).
// 권한은 서버와 같게 — 정시 배송률은 OPERATOR_ADMIN 이 아니면 mfcId 필수(없으면 403), 배차 지연은 RIDER_OPS·OPERATOR_ADMIN 이면 mfcId 없이도.
// 운영 통계(2026-11-23): execution GET /delivery-metrics(0.38.0)·dispatch GET /metrics/dispatch(0.16.0) — 날마다 RD-7·RD-8 두 라이더, 센터 하나(고르면 그 센터).
// 수치는 날짜에서 지은 고정 값(새로 고쳐도 같다) — 실제 서버 셈이 아니다.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { operator, problem, unauthorized } from './support';

const DAY = 86_400_000;

function dates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`) && out.length < 31; t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

function range(q: URLSearchParams) {
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const to = q.get('to') ?? today;
  const from = q.get('from') ?? to;
  return { from, to };
}

export const metricsHandlers = [
  http.get(`${API_BASE}/delivery-metrics`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const q = new URL(request.url).searchParams;
    const { from, to } = range(q);
    const mfcId = q.get('mfcId') || 'MFC-BSJ-01';
    const riderId = q.get('riderId');
    const rows = dates(from, to).flatMap((date) =>
      (['RD-7', 'RD-8'] as const)
        .filter((r) => !riderId || r === riderId)
        .map((r, i) => ({ date, mfcId, riderId: r, assigned: 5 + i, completed: 4 + i, failed: 1, cancelled: 0, late: 1, judged: 4, pickupWaitSeconds: 300 + i * 60, pickupWaitCount: 4, deliverySeconds: 900 + i * 300, deliveryCount: 4 })),
    );
    return HttpResponse.json({ from, to, rows, incidents: [{ category: 'CUSTOMER_UNREACHABLE', count: 3, resolved: 2, resolveSeconds: 900 }, { category: 'ADDRESS_ISSUE', count: 1, resolved: 1, resolveSeconds: 600 }] });
  }),
  // 배차 불가 자동 취소 내역(2026-11-24, dispatch 0.17.0) — 기간에는 취소됨 1·막힘 1(이미 취소됨). 막혔고 아직 대기(BLOCKED_OPEN)는 기본 없음
  http.get(`${API_BASE}/metrics/auto-cancellations`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    const q = new URL(request.url).searchParams;
    const mfcId = q.get('mfcId') || 'MFC-BSJ-01';
    const filter = q.get('filter') ?? 'ALL';
    if (filter === 'BLOCKED_OPEN') return HttpResponse.json({ from: q.get('from') ?? '', to: q.get('to') ?? '', items: [] });
    const { from, to } = range(q);
    const at = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const promised = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const items = [
      { deliveryId: 'DLV-AC-1', orderId: 'ORD-AC-1', mfcId, deliveryNumber: 'D31110001', promisedAt: promised, attemptedAt: at, result: 'CANCELLED' as const, rejectCode: null, deliveryState: 'CANCELLED' },
      { deliveryId: 'DLV-AC-2', orderId: 'ORD-AC-2', mfcId, deliveryNumber: 'D31110002', promisedAt: promised, attemptedAt: at, result: 'BLOCKED' as const, rejectCode: 'ORDER_NOT_CANCELLABLE', deliveryState: 'CANCELLED' },
    ].filter((x) => filter === 'ALL' || x.result === filter);
    return HttpResponse.json({ from, to, items });
  }),
  http.get(`${API_BASE}/metrics/dispatch`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    const q = new URL(request.url).searchParams;
    const { from, to } = range(q);
    const mfcId = q.get('mfcId') || 'MFC-BSJ-01';
    const rows = dates(from, to).map((date) => ({ date, mfcId, created: 12, assigned: 11, avgAssignSeconds: 120, reassigned: 1, failedRounds: 2, autoCancelled: 0, offersSent: 20, offersAccepted: 10, offersRejected: 2, offersExpired: 8, assignedByAi: 9, assignedByList: 2, assignedByFailedReturn: 0 }));
    return HttpResponse.json({ from, to, rows, failureReasons: [{ reason: 'NO_RIDER', rounds: 2 }] });
  }),
  http.get(`${API_BASE}/metrics/on-time-deliveries`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const q = new URL(request.url).searchParams;
    const mfcId = q.get('mfcId') ?? '';
    if (!who.roles.includes('OPERATOR_ADMIN') && !mfcId) return problem(403, 'FORBIDDEN');
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const from = q.get('from') ?? today;
    const to = q.get('to') ?? from;
    const items = dates(from, to).map((date) => {
      const d = Number(date.slice(8, 10));
      const onTime = 6 + (d % 5);
      const late = d % 3;
      return { date, mfcId: mfcId || 'MFC-BSJ-01', due: onTime + late, onTime, late, unjudged: d % 2, pending: date === today ? 2 : 0 };
    });
    return HttpResponse.json({ items, asOf: new Date().toISOString() });
  }),
  http.get(`${API_BASE}/dispatch-delays`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    const mfcId = new URL(request.url).searchParams.get('mfcId') || 'MFC-BSJ-01';
    const now = Date.now();
    return HttpResponse.json({
      items: [{ deliveryId: 'DLV-2', orderId: 'ORD-2', mfcId, state: 'DISPATCHING', createdAt: new Date(now - 30 * 60_000).toISOString(), delayAlertedAt: new Date(now - 5 * 60_000).toISOString(), promisedAt: new Date(now + 20 * 60_000).toISOString(), riderId: null }],
    });
  }),
];
