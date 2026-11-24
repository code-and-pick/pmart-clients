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
  compensationCount?: number;
  deductionTotal?: number;
  expectedDeduction?: number;
  netTotal?: number;
  rolledInCount?: number;
  rolledTo?: string | null;
  rollCount?: number;
  finalAttempt?: boolean;
  escalated?: boolean;
  state: 'CONFIRMED' | 'PAYING' | 'PAID' | 'PAYMENT_FAILED' | 'MIXED';
  lastResult: { result: 'PAYING' | 'PAID' | 'FAILED'; recordedAt: string; recordedBy: string; reference: string | null; failureReason: string | null } | null;
}

interface MockRollover {
  rolloverId: string;
  riderId: string;
  fromDate: string;
  toDate: string;
  lineCount: number;
  total: number;
  failureReason: string | null;
  rolledAt: string;
  rollCount?: number;
  finalAttempt?: boolean;
}

type DeductionState = 'PENDING_OBJECTION' | 'OBJECTED' | 'CONFIRMED' | 'CANCELLED';
interface MockDeduction {
  deductionId: string;
  caseId: string;
  deliveryId: string;
  deliveryNumber: string | null;
  recoveryDeliveryId: string | null;
  orderId: string;
  riderId: string;
  amount: number;
  source?: 'MISDELIVERY_RECOVERY' | 'MANUAL';
  reason?: string | null;
  createdBy?: string | null;
  remaining: number;
  state: DeductionState;
  objectionDeadline: string;
  objection: { note: string; objectedAt: string } | null;
  decision: { result: 'ACCEPT' | 'REJECT'; note: string; decidedBy: string | null; decidedAt: string } | null;
  confirmedAt: string | null;
  applications: { payoutDate: string; amount: number }[];
  createdAt: string;
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

interface MockCompensation {
  compensationId: string;
  appealId: string;
  deliveryId: string;
  riderId: string;
  amount: number;
  reason: string;
  settlementState: 'CONFIRMED' | 'PAYING' | 'PAID' | 'PAYMENT_FAILED';
  payoutDate: string;
  recordedBy: string;
  recordedAt: string;
}

/** 목 "오늘"(서울) — 시험이 날짜에 흔들리지 않게 고정 */
export const MOCK_TODAY = '2026-11-19';

const seed = () => ({
  payouts: [
    { riderId: 'RD-7', payoutDate: '2026-11-19', count: 3, total: 10500, compensationCount: 1, state: 'CONFIRMED', lastResult: null },
    { riderId: 'RD-8', payoutDate: '2026-11-19', count: 2, total: 7000, state: 'PAYING', lastResult: { result: 'PAYING', recordedAt: '2026-11-19T00:30:00.000Z', recordedBy: 'OP-admin-1', reference: 'ACC-1119-02', failureReason: null } },
    // 확정된 오배송 차감(DED-2 남은 12,000원)을 이 묶음에서 뺄 예정(execution 0.41.0 expectedDeduction·netTotal) — 3,500원 묶음이라 다 빼고 0
    { riderId: 'RD-7', payoutDate: '2026-11-21', count: 1, total: 3500, deductionTotal: 0, expectedDeduction: 3500, netTotal: 0, state: 'CONFIRMED', lastResult: null },
    // 11-21 지급 실패 → 서버가 다음 지급일(11-24) 묶음으로 넘김(execution 0.42.0) — 다시 지급할 때까지 메뉴 숫자·경고·대시보드 할 일
    { riderId: 'RD-8', payoutDate: '2026-11-24', count: 1, total: 4000, rolledInCount: 1, rollCount: 1, state: 'CONFIRMED', lastResult: null },
    // (0.43.0) 자동 넘김 상한을 다 쓰고 또 실패 — 직원이 직접 지급해야 함(날짜 무관 escalated=true)
    { riderId: 'RD-7', payoutDate: '2026-11-12', count: 1, total: 3200, rolledInCount: 1, rollCount: 3, finalAttempt: true, escalated: true, state: 'PAYMENT_FAILED', lastResult: { result: 'FAILED', recordedAt: '2026-11-12T02:00:00.000Z', recordedBy: 'OP-admin-1', reference: null, failureReason: '계좌 해지' } },
  ] as MockPayout[],
  appeals: [
    { appealId: 'AP-1', riderId: 'RD-8', targetType: 'RESTRICTION', targetRef: 'RH-3', restriction: 'SUSPENDED', body: '파손은 포장 불량이었어요. 사진 있어요.', state: 'OPEN', submittedAt: '2026-11-18T05:00:00.000Z', decidedAt: null, decidedBy: null, decisionNote: null },
    { appealId: 'AP-2', riderId: 'RD-7', targetType: 'EARNING', targetRef: 'DLV-3', restriction: null, body: '엘리베이터 고장이었는데 추가 배달료가 반려됐어요.', state: 'OPEN', submittedAt: '2026-11-18T06:00:00.000Z', decidedAt: null, decidedBy: null, decisionNote: null },
    { appealId: 'AP-0', riderId: 'RD-7', targetType: 'EARNING', targetRef: 'DLV-1', restriction: null, body: '거리 계산이 틀렸어요.', state: 'UPHELD', submittedAt: '2026-11-16T05:00:00.000Z', decidedAt: '2026-11-16T07:00:00.000Z', decidedBy: 'OP-rops-1', decisionNote: '경로 확인 결과 정상 산정이에요.' },
  ] as MockAppeal[],
  // RD-7 11-19 묶음(3건 중 보상 1)의 보상금 — 지급 관리 "이 묶음의 배송"(2026-11-24)
  compensations: [
    { compensationId: 'CMP-0', appealId: 'AP-old', deliveryId: 'DLV-3', riderId: 'RD-7', amount: 3000, reason: '이의 인정 보상', settlementState: 'CONFIRMED', payoutDate: '2026-11-19', recordedBy: 'OP-rops-1', recordedAt: '2026-11-16T07:00:00.000Z' },
  ] as MockCompensation[],
  rollovers: [
    { rolloverId: 'RO-1', riderId: 'RD-8', fromDate: '2026-11-21', toDate: '2026-11-24', lineCount: 1, total: 4000, failureReason: '계좌 오류', rolledAt: '2026-11-21T02:00:30.000Z', rollCount: 1, finalAttempt: false },
    { rolloverId: 'RO-0', riderId: 'RD-7', fromDate: '2026-11-11', toDate: '2026-11-12', lineCount: 1, total: 3200, failureReason: '계좌 해지', rolledAt: '2026-11-11T02:00:30.000Z', rollCount: 3, finalAttempt: true },
  ] as MockRollover[],
  // 오배송 차감(execution 0.41.0) — 이의 결정 대기 1·이의 기간 1·확정(남은 금액) 1·취소 1
  deductions: [
    {
      deductionId: 'DED-1', caseId: 'CASE-LS-1', deliveryId: 'DLV-1', deliveryNumber: null, recoveryDeliveryId: 'DLV-2', orderId: 'ORD-1', riderId: 'RD-7',
      amount: 18900, remaining: 18900, state: 'OBJECTED', objectionDeadline: '2026-11-26T03:00:00.000Z',
      objection: { note: '고객이 동 호수를 잘못 알려줬어요. 통화 기록 있어요.', objectedAt: '2026-11-22T05:00:00.000Z' }, decision: null, confirmedAt: null, applications: [], createdAt: '2026-11-21T03:00:00.000Z',
    },
    {
      deductionId: 'DED-3', caseId: 'CASE-LS-1', deliveryId: 'DLV-3', deliveryNumber: null, recoveryDeliveryId: null, orderId: 'ORD-3', riderId: 'RD-8',
      amount: 9800, remaining: 9800, state: 'PENDING_OBJECTION', objectionDeadline: '2026-11-28T03:00:00.000Z', objection: null, decision: null, confirmedAt: null, applications: [], createdAt: '2026-11-23T03:00:00.000Z',
    },
    {
      deductionId: 'DED-2', caseId: 'CASE-LS-1', deliveryId: 'DLV-2', deliveryNumber: null, recoveryDeliveryId: null, orderId: 'ORD-2', riderId: 'RD-7',
      source: 'MANUAL', reason: '회수품이 상해 폐기 — 결제 금액만큼 차감', createdBy: 'OP-rops-1',
      amount: 15500, remaining: 12000, state: 'CONFIRMED', objectionDeadline: '2026-11-15T03:00:00.000Z', objection: null, decision: null, confirmedAt: '2026-11-15T03:00:00.000Z',
      applications: [{ payoutDate: '2026-11-19', amount: 3500 }], createdAt: '2026-11-10T03:00:00.000Z',
    },
    {
      deductionId: 'DED-0', caseId: 'CASE-LS-1', deliveryId: 'DLV-1', deliveryNumber: null, recoveryDeliveryId: null, orderId: 'ORD-1', riderId: 'RD-8',
      amount: 7000, remaining: 0, state: 'CANCELLED', objectionDeadline: '2026-11-12T03:00:00.000Z',
      objection: { note: '회수하러 갔는데 고객이 이미 버렸대요.', objectedAt: '2026-11-09T05:00:00.000Z' },
      decision: { result: 'ACCEPT', note: '고객 확인 결과 라이더 귀책 아님 — 차감 취소', decidedBy: 'OP-rops-1', decidedAt: '2026-11-10T02:00:00.000Z' }, confirmedAt: null, applications: [], createdAt: '2026-11-07T03:00:00.000Z',
    },
  ] as MockDeduction[],
});

export const payoutAppealState = seed();

export function resetPayoutAppeals(): void {
  Object.assign(payoutAppealState, seed());
}

/** 다음 영업일(목 — 주말만 건너뜀, 법정공휴일은 서버) */
function nextBusinessDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

const staff = (roles: readonly string[]) => roles.some((r) => r === 'RIDER_OPS' || r === 'OPERATOR_ADMIN');

function replay(request: Request, scope: string) {
  return db.idempotent.get(`${scope}:${keyOf(request)}`);
}

export const payoutAppealHandlers = [
  // 이의 인정 보상금(execution 0.30.0): 인정한 수행료 이의만(422 APPEAL_NOT_ACCEPTED), 이의마다 한 줄(409 COMPENSATION_EXISTS).
  http.get(`${API_BASE}/rider-compensations`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!staff(who.roles)) return problem(403, 'FORBIDDEN');
    const q = new URL(request.url).searchParams;
    const items = payoutAppealState.compensations.filter(
      (c) => (!q.get('appealId') || c.appealId === q.get('appealId')) && (!q.get('riderId') || c.riderId === q.get('riderId')) && (!q.get('deliveryId') || c.deliveryId === q.get('deliveryId')),
    );
    return HttpResponse.json({ items });
  }),
  http.post(`${API_BASE}/rider-compensations`, async ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!staff(who.roles)) return problem(403, 'FORBIDDEN');
    const seen = replay(request, 'compensation');
    if (seen) return HttpResponse.json(seen.body as MockCompensation, { status: seen.status });
    const body = (await request.json()) as { appealId?: string; amount?: number; reason?: string };
    const amount = body.amount ?? 0;
    if (!Number.isInteger(amount) || amount < 1 || amount > 100_000 || !(body.reason ?? '').trim()) return problem(400, 'VALIDATION_FAILED');
    const a = payoutAppealState.appeals.find((x) => x.appealId === body.appealId);
    if (!a || a.targetType !== 'EARNING' || a.state !== 'ACCEPTED') return problem(422, 'APPEAL_NOT_ACCEPTED');
    if (payoutAppealState.compensations.some((c) => c.appealId === a.appealId)) return problem(409, 'COMPENSATION_EXISTS');
    const c: MockCompensation = {
      compensationId: `CMP-${payoutAppealState.compensations.length + 1}`,
      appealId: a.appealId,
      deliveryId: a.targetRef,
      riderId: a.riderId,
      amount,
      reason: (body.reason ?? '').trim(),
      settlementState: 'CONFIRMED',
      payoutDate: '2026-11-24',
      recordedBy: who.subject,
      recordedAt: timestamp(),
    };
    payoutAppealState.compensations.push(c);
    db.idempotent.set(`compensation:${keyOf(request)}`, { status: 200, body: c });
    return HttpResponse.json(c);
  }),
  http.get(`${API_BASE}/rider-payouts`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!staff(who.roles)) return problem(403, 'FORBIDDEN');
    const q = new URL(request.url).searchParams;
    // 0.42.0: payoutDate 가 없고 from·to 가 있으면 기간(포함)
    const from = q.get('payoutDate') ?? q.get('from') ?? (q.get('to') ? null : MOCK_TODAY);
    const to = q.get('payoutDate') ?? q.get('to') ?? from;
    // 0.43.0: escalated=true 면 날짜와 상관없이 상한을 다 쓴 묶음만
    if (q.get('escalated') === 'true') return HttpResponse.json({ items: payoutAppealState.payouts.filter((p) => p.escalated).toSorted((a, b) => a.payoutDate.localeCompare(b.payoutDate)) });
    const items = payoutAppealState.payouts.filter(
      (p) => (!from || p.payoutDate >= from) && (!to || p.payoutDate <= to) && (!q.get('riderId') || p.riderId === q.get('riderId')) && (!q.get('state') || p.state === q.get('state')),
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
    // 0.42.0: 실패 줄은 같은 트랜잭션에서 다음 지급일(오늘과 원래 지급일 중 늦은 날의 다음 영업일)로 넘어가 CONFIRMED — 목은 주말만 건너뛴다
    if (body.result === 'FAILED') {
      const toDate = nextBusinessDay(p.payoutDate > MOCK_TODAY ? p.payoutDate : MOCK_TODAY);
      const res = { ...p, rolledTo: toDate };
      payoutAppealState.rollovers.push({ rolloverId: `RO-${payoutAppealState.rollovers.length + 1}`, riderId: p.riderId, fromDate: p.payoutDate, toDate, lineCount: p.count, total: p.total, failureReason: body.failureReason ?? null, rolledAt: timestamp() });
      const target = payoutAppealState.payouts.find((x) => x.riderId === p.riderId && x.payoutDate === toDate);
      if (target) {
        target.count += p.count;
        target.total += p.total;
        target.rolledInCount = (target.rolledInCount ?? 0) + p.count;
      } else payoutAppealState.payouts.push({ riderId: p.riderId, payoutDate: toDate, count: p.count, total: p.total, rolledInCount: p.count, state: 'CONFIRMED', lastResult: null });
      payoutAppealState.payouts.splice(payoutAppealState.payouts.indexOf(p), 1);
      db.idempotent.set(`payout:${keyOf(request)}`, { status: 200, body: res });
      return HttpResponse.json(res);
    }
    db.idempotent.set(`payout:${keyOf(request)}`, { status: 200, body: { ...p } });
    return HttpResponse.json(p);
  }),
  http.get(`${API_BASE}/rider-payout-rollovers`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!staff(who.roles)) return problem(403, 'FORBIDDEN');
    const rid = new URL(request.url).searchParams.get('riderId');
    const items = payoutAppealState.rollovers.filter((r) => !rid || r.riderId === rid).toSorted((a, b) => b.rolledAt.localeCompare(a.rolledAt));
    return HttpResponse.json({ items });
  }),
  // 오배송 차감(execution 0.41.0): 보기 RIDER_OPS·OPERATOR_ADMIN·CS_AGENT, 결정 RIDER_OPS·OPERATOR_ADMIN(OBJECTED 만, 아니면 409 NOT_DECIDABLE)
  http.get(`${API_BASE}/rider-deductions`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!staff(who.roles) && !who.roles.includes('CS_AGENT')) return problem(403, 'FORBIDDEN');
    const q = new URL(request.url).searchParams;
    const rid = q.get('riderId');
    const items = payoutAppealState.deductions
      .filter((d) => (!rid || d.riderId === rid) && (!q.get('state') || d.state === q.get('state')) && (!q.get('caseId') || d.caseId === q.get('caseId')))
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
    const mine = payoutAppealState.deductions.filter((d) => d.riderId === rid);
    const totals = rid
      ? {
          remainingTotal: mine.filter((d) => d.state === 'CONFIRMED').reduce((n, d) => n + d.remaining, 0),
          pendingTotal: mine.filter((d) => d.state === 'PENDING_OBJECTION' || d.state === 'OBJECTED').reduce((n, d) => n + d.amount, 0),
        }
      : { remainingTotal: null, pendingTotal: null };
    return HttpResponse.json({ items, ...totals });
  }),
  // 0.43.0 직원 직접 차감 — 배송·사건당 한 번(409 DEDUCTION_EXISTS), 금액을 비우면 결제 금액 − 배달비(목은 12,000원), 넘으면 422 AMOUNT_EXCEEDS_ORDER
  http.post(`${API_BASE}/rider-deductions`, async ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!staff(who.roles)) return problem(403, 'FORBIDDEN');
    const seen = replay(request, 'deduction-create');
    if (seen) return HttpResponse.json(seen.body as MockDeduction, { status: seen.status });
    const body = (await request.json()) as { deliveryId?: string; caseId?: string; amount?: number; reason?: string };
    const reason = (body.reason ?? '').trim();
    if (!body.deliveryId || !(body.caseId ?? '').trim() || reason.length < 2 || reason.length > 300) return problem(400, 'VALIDATION_FAILED');
    const max = 12000;
    if (body.amount !== undefined && body.amount > max) return problem(422, 'AMOUNT_EXCEEDS_ORDER');
    if (payoutAppealState.deductions.some((d) => d.deliveryId === body.deliveryId && d.caseId === body.caseId)) return problem(409, 'DEDUCTION_EXISTS');
    const now = timestamp();
    const d: MockDeduction = {
      deductionId: `DED-M${payoutAppealState.deductions.length + 1}`, caseId: body.caseId!, deliveryId: body.deliveryId, deliveryNumber: null, recoveryDeliveryId: null, orderId: 'ORD-9', riderId: 'RD-8',
      amount: body.amount ?? max, source: 'MANUAL', reason, createdBy: who.subject, remaining: body.amount ?? max, state: 'PENDING_OBJECTION',
      objectionDeadline: new Date(Date.parse(now) + 5 * 86400_000).toISOString(), objection: null, decision: null, confirmedAt: null, applications: [], createdAt: now,
    };
    payoutAppealState.deductions.push(d);
    db.idempotent.set(`deduction-create:${keyOf(request)}`, { status: 201, body: d });
    return HttpResponse.json(d, { status: 201 });
  }),
  http.post(`${API_BASE}/rider-deductions/:deductionId/decisions`, async ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!staff(who.roles)) return problem(403, 'FORBIDDEN');
    const seen = replay(request, 'deduction');
    if (seen) return HttpResponse.json(seen.body as MockDeduction, { status: seen.status });
    const d = payoutAppealState.deductions.find((x) => x.deductionId === params['deductionId']);
    if (!d) return problem(404, 'NOT_FOUND');
    const body = (await request.json()) as { decision?: string; note?: string };
    const note = (body.note ?? '').trim();
    if ((body.decision !== 'ACCEPT' && body.decision !== 'REJECT') || note.length < 2 || note.length > 500) return problem(400, 'VALIDATION_FAILED');
    if (d.state !== 'OBJECTED') return problem(409, 'NOT_DECIDABLE');
    d.decision = { result: body.decision, note, decidedBy: who.subject, decidedAt: timestamp() };
    if (body.decision === 'ACCEPT') {
      d.state = 'CANCELLED';
      d.remaining = 0;
    } else {
      d.state = 'CONFIRMED';
      d.confirmedAt = timestamp();
    }
    db.idempotent.set(`deduction:${keyOf(request)}`, { status: 200, body: { ...d } });
    return HttpResponse.json(d);
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
