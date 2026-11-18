// ⚠ 화면 개발·시험용 목 — 지급 관리(execution 0.29.0)·소명·이의(rider 0.15.0). 실제 서버 동작이 아니다.
// - 지급 묶음: 보기 RIDER_OPS·OPERATOR_ADMIN, 결과 표시 OPERATOR_ADMIN 만. 예정일이 오늘(서울)보다 뒤면 PAYING·PAID 는 422 PAYOUT_NOT_DUE,
//   바꿀 줄이 없으면(이미 PAID) 409. FAILED 는 사유 필수(400).
// - 소명·이의: 보기·결정 RIDER_OPS·OPERATOR_ADMIN, OPEN 만 결정(아니면 409 NOT_DECIDABLE). EARNING 인정이면 adjustmentRequired true.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { db, timestamp } from './db';
import { keyOf, operator, problem, unauthorized } from './support';

interface MockPayout {
  riderId: string;
  payoutDate: string;
  count: number;
  total: number;
  state: 'CONFIRMED' | 'PAYING' | 'PAID' | 'PAYMENT_FAILED' | 'MIXED';
  lastResult: { result: 'PAYING' | 'PAID' | 'FAILED'; recordedAt: string; recordedBy: string; reference: string | null; failureReason: string | null } | null;
}

interface MockAppeal {
  appealId: string;
  riderId: string;
  targetType: 'RESTRICTION' | 'EARNING';
  targetRef: string;
  restriction: string | null;
  body: string;
  state: 'OPEN' | 'UPHELD' | 'ACCEPTED';
  submittedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  adjustmentRequired?: boolean;
}

/** 목 "오늘"(서울) — 시험이 날짜에 흔들리지 않게 고정 */
export const MOCK_TODAY = '2026-11-19';

const seed = () => ({
  payouts: [
    { riderId: 'RD-7', payoutDate: '2026-11-19', count: 3, total: 10500, state: 'CONFIRMED', lastResult: null },
    { riderId: 'RD-8', payoutDate: '2026-11-19', count: 2, total: 7000, state: 'PAYING', lastResult: { result: 'PAYING', recordedAt: '2026-11-19T00:30:00.000Z', recordedBy: 'OP-admin-1', reference: 'ACC-1119-02', failureReason: null } },
    { riderId: 'RD-7', payoutDate: '2026-11-21', count: 1, total: 3500, state: 'CONFIRMED', lastResult: null },
  ] as MockPayout[],
  appeals: [
    { appealId: 'AP-1', riderId: 'RD-8', targetType: 'RESTRICTION', targetRef: 'RH-3', restriction: 'SUSPENDED', body: '파손은 포장 불량이었어요. 사진 있어요.', state: 'OPEN', submittedAt: '2026-11-18T05:00:00.000Z', decidedAt: null, decidedBy: null, decisionNote: null },
    { appealId: 'AP-2', riderId: 'RD-7', targetType: 'EARNING', targetRef: 'DLV-3', restriction: null, body: '엘리베이터 고장이었는데 추가 배달료가 반려됐어요.', state: 'OPEN', submittedAt: '2026-11-18T06:00:00.000Z', decidedAt: null, decidedBy: null, decisionNote: null },
    { appealId: 'AP-0', riderId: 'RD-7', targetType: 'EARNING', targetRef: 'DLV-1', restriction: null, body: '거리 계산이 틀렸어요.', state: 'UPHELD', submittedAt: '2026-11-16T05:00:00.000Z', decidedAt: '2026-11-16T07:00:00.000Z', decidedBy: 'OP-rops-1', decisionNote: '경로 확인 결과 정상 산정이에요.' },
  ] as MockAppeal[],
});

export const payoutAppealState = seed();

export function resetPayoutAppeals(): void {
  Object.assign(payoutAppealState, seed());
}

const staff = (roles: readonly string[]) => roles.some((r) => r === 'RIDER_OPS' || r === 'OPERATOR_ADMIN');

function replay(request: Request, scope: string) {
  return db.idempotent.get(`${scope}:${keyOf(request)}`);
}

export const payoutAppealHandlers = [
  http.get(`${API_BASE}/rider-payouts`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!staff(who.roles)) return problem(403, 'FORBIDDEN');
    const q = new URL(request.url).searchParams;
    const date = q.get('payoutDate') ?? MOCK_TODAY;
    const items = payoutAppealState.payouts.filter(
      (p) => p.payoutDate === date && (!q.get('riderId') || p.riderId === q.get('riderId')) && (!q.get('state') || p.state === q.get('state')),
    );
    return HttpResponse.json({ items });
  }),
  http.post(`${API_BASE}/rider-payouts/:riderId/:payoutDate/results`, async ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!who.roles.includes('OPERATOR_ADMIN')) return problem(403, 'FORBIDDEN');
    const seen = replay(request, 'payout');
    if (seen) return HttpResponse.json(seen.body as MockPayout, { status: seen.status });
    const p = payoutAppealState.payouts.find((x) => x.riderId === params['riderId'] && x.payoutDate === params['payoutDate']);
    if (!p) return problem(404, 'NOT_FOUND');
    const body = (await request.json()) as { result?: string; reference?: string; failureReason?: string };
    if (body.result !== 'PAYING' && body.result !== 'PAID' && body.result !== 'FAILED') return problem(400, 'VALIDATION_FAILED');
    if (body.result === 'FAILED' && !(body.failureReason ?? '').trim()) return problem(400, 'VALIDATION_FAILED', [{ field: 'failureReason', reason: 'REQUIRED' }]);
    if (body.result !== 'FAILED' && p.payoutDate > MOCK_TODAY) return problem(422, 'PAYOUT_NOT_DUE');
    if (p.state === 'PAID') return problem(409, 'INVALID_STATE');
    p.state = body.result === 'FAILED' ? 'PAYMENT_FAILED' : body.result;
    p.lastResult = { result: body.result, recordedAt: timestamp(), recordedBy: who.subject, reference: body.reference ?? null, failureReason: body.failureReason ?? null };
    db.idempotent.set(`payout:${keyOf(request)}`, { status: 200, body: { ...p } });
    return HttpResponse.json(p);
  }),
  http.get(`${API_BASE}/rider-appeals`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!staff(who.roles)) return problem(403, 'FORBIDDEN');
    const q = new URL(request.url).searchParams;
    const state = q.get('state') ?? 'OPEN';
    const items = payoutAppealState.appeals
      .filter((a) => a.state === state && (!q.get('riderId') || a.riderId === q.get('riderId')) && (!q.get('targetType') || a.targetType === q.get('targetType')))
      .toSorted((a, b) => a.submittedAt.localeCompare(b.submittedAt));
    return HttpResponse.json({ items });
  }),
  http.post(`${API_BASE}/rider-appeals/:appealId/decisions`, async ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!staff(who.roles)) return problem(403, 'FORBIDDEN');
    const seen = replay(request, 'appeal');
    if (seen) return HttpResponse.json(seen.body as MockAppeal, { status: seen.status });
    const a = payoutAppealState.appeals.find((x) => x.appealId === params['appealId']);
    if (!a) return problem(404, 'NOT_FOUND');
    const body = (await request.json()) as { decision?: string; note?: string };
    const note = (body.note ?? '').trim();
    if ((body.decision !== 'UPHELD' && body.decision !== 'ACCEPTED') || note.length < 1 || note.length > 300) return problem(400, 'VALIDATION_FAILED');
    if (a.state !== 'OPEN') return problem(409, 'NOT_DECIDABLE');
    a.state = body.decision;
    a.decidedAt = timestamp();
    a.decidedBy = who.subject;
    a.decisionNote = note;
    const res = { ...a, adjustmentRequired: a.targetType === 'EARNING' && body.decision === 'ACCEPTED' };
    db.idempotent.set(`appeal:${keyOf(request)}`, { status: 200, body: res });
    return HttpResponse.json(res);
  }),
];
