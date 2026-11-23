// ⚠ 화면 개발·시험용 목 — 배송 운영 통계(2026-11-23): execution 0.38.0 `GET /delivery-metrics`, dispatch 0.16.0 `GET /metrics/dispatch`·`GET /metrics/on-time-deliveries`.
// 계약 모양 그대로. 관리자·라이더 운영·상담원은 모든 센터(그 밖 mfcId 필수 — 없으면 403), 정시 배송률은 관리자만 모든 센터. 최대 31일(넘으면 400).
// 숫자는 고정 목 값(날짜 = 요청 기간의 날짜들). 실제 집계가 아니다.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { operator, problem, unauthorized } from './support';

const DAY = 86_400_000;
const ALL_CENTERS = ['OPERATOR_ADMIN', 'RIDER_OPS', 'CS_AGENT'];

function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** from·to·센터 판정 — 통과면 { days, mfcId }, 아니면 Response */
function guard(request: Request, allCenters: readonly string[]): { days: string[]; mfcId: string | null; riderId: string | null } | Response {
  const who = operator(request);
  if (!who) return unauthorized();
  const q = new URL(request.url).searchParams;
  const from = q.get('from') ?? '';
  const to = q.get('to') ?? '';
  if (!from || !to || to < from) return problem(400, 'VALIDATION_FAILED');
  const days = daysOf(from, to);
  if (days.length > 31) return problem(400, 'VALIDATION_FAILED');
  const mfcId = q.get('mfcId');
  if (!mfcId && !who.roles.some((r) => allCenters.includes(r))) return problem(403, 'FORBIDDEN');
  return { days, mfcId, riderId: q.get('riderId') };
}

const MFCS = ['MFC-BSN-01', 'MFC-MOKPO-01'];
const RIDERS: Record<string, readonly string[]> = { 'MFC-BSN-01': ['RID-MOCK-1', 'RID-MOCK-2'], 'MFC-MOKPO-01': ['RID-MOCK-3'] };

export const deliveryStatsHandlers = [
  http.get(`${API_BASE}/delivery-metrics`, ({ request }) => {
    const g = guard(request, ALL_CENTERS);
    if (g instanceof Response) return g;
    const rows = g.days.flatMap((date, di) =>
      MFCS.filter((m) => !g.mfcId || m === g.mfcId).flatMap((mfcId) =>
        (RIDERS[mfcId] ?? [])
          .filter((riderId) => !g.riderId || riderId === g.riderId)
          .map((riderId, ri) => {
            const assigned = 6 + ((di + ri) % 4);
            const failed = (di + ri) % 3 === 0 ? 1 : 0;
            const late = (di + ri) % 2;
            return { date, mfcId, riderId, assigned, completed: assigned - failed, failed, cancelled: 0, late, judged: assigned - failed - 1, pickupWaitSeconds: 240 + ri * 60, pickupWaitCount: assigned - failed, deliverySeconds: 900 + di * 30, deliveryCount: assigned - failed };
          }),
      ),
    );
    const incidents = rows.length > 0 ? [{ category: 'CUSTOMER_UNREACHABLE', count: 3, resolved: 2, resolveSeconds: 600 }, { category: 'STORE_WAITING', count: 1, resolved: 1, resolveSeconds: 300 }] : [];
    return HttpResponse.json({ from: g.days[0], to: g.days.at(-1), rows, incidents });
  }),

  http.get(`${API_BASE}/metrics/dispatch`, ({ request }) => {
    const g = guard(request, ALL_CENTERS);
    if (g instanceof Response) return g;
    const rows = g.days.flatMap((date) =>
      MFCS.filter((m) => !g.mfcId || m === g.mfcId).map((mfcId) => ({
        date,
        mfcId,
        created: 20,
        assigned: 19,
        avgAssignSeconds: 75,
        reassigned: 2,
        failedRounds: 1,
        autoCancelled: 1,
        offersSent: 25,
        offersAccepted: 19,
        offersRejected: 4,
        offersExpired: 2,
        assignedByAi: 15,
        assignedByList: 3,
        assignedByFailedReturn: 1,
      })),
    );
    return HttpResponse.json({ from: g.days[0], to: g.days.at(-1), rows, failureReasons: [{ reason: 'NO_RIDER', rounds: 2 }] });
  }),

  http.get(`${API_BASE}/metrics/on-time-deliveries`, ({ request }) => {
    const g = guard(request, ['OPERATOR_ADMIN']);
    if (g instanceof Response) return g;
    const items = g.days.flatMap((date) => MFCS.filter((m) => !g.mfcId || m === g.mfcId).map((mfcId) => ({ date, mfcId, onTime: 17, late: 2, due: 19, pending: 0, unjudged: 1 })));
    return HttpResponse.json({ asOf: new Date().toISOString(), items });
  }),
];
