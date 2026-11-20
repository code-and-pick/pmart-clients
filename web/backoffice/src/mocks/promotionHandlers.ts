// promotion 0.2.0 행사(기간 할인·장바구니 쿠폰, ADR-0082) 목. 만들기·고치기·제출·조기 종료 MARKETING·OPERATOR_ADMIN, 보기 + CS_AGENT,
// 지정 발급 MARKETING·CS_AGENT·OPERATOR_ADMIN. 초안 → 제출(검사·잠금, approvalRequest) → approval PROMOTION → 승인되면 APPROVED(시작~끝 사이 RUNNING).
// 검사에 걸려도 초안은 저장하고 problems 로 알린다(제출 때 422 PROMOTION_INVALID). field 이름은 입력 경로(name·endsAt·discount.value·targets·coupon.useDays 등).
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components } from '../api/generated/promotion';
import { expectedVersion, idempotent, operator, problem, unauthorized } from './support';

type Promotion = components['schemas']['Promotion'];
type Input = components['schemas']['PromotionInput'];
type Problem = components['schemas']['Problem'];

const MANAGE = ['MARKETING', 'OPERATOR_ADMIN'];
const READ = [...MANAGE, 'CS_AGENT'];
const GRANT = ['MARKETING', 'CS_AGENT', 'OPERATOR_ADMIN'];

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function seed(): { items: Map<string, Promotion>; seq: number; grants: Map<string, Map<string, number>> } {
  const now = Date.now();
  const running: Promotion = {
    promotionId: 'PRM-seed-1',
    kind: 'COUPON',
    name: '첫 주문 3천원 쿠폰',
    state: 'APPROVED',
    phase: 'RUNNING',
    startsAt: iso(now - 3 * DAY),
    endsAt: iso(now + 27 * DAY),
    endedAt: null,
    discount: { type: 'AMOUNT', value: 3000, maxAmount: null },
    targets: [],
    coupon: { issueMode: 'ADMIN', minOrderAmount: 15000, totalQuantity: 1000, perCustomerLimit: 1, useDays: 7, useUntil: null },
    issuedCount: 12,
    usedCount: 4,
    problems: [],
    approvalId: 'apv-seed-promo-1',
    version: 3,
    createdBy: 'op-marketing-1',
    updatedAt: iso(now - 3 * DAY),
  };
  const draft: Promotion = {
    promotionId: 'PRM-seed-2',
    kind: 'PRICE_DISCOUNT',
    name: '겨울 과일 10% 할인',
    state: 'DRAFT',
    phase: 'NOT_APPROVED',
    startsAt: iso(now + 2 * DAY),
    endsAt: iso(now + 9 * DAY),
    endedAt: null,
    discount: { type: 'RATE', value: 10, maxAmount: null },
    targets: [],
    coupon: null,
    problems: [{ field: 'targets', reason: '기간 할인은 대상 SKU·카테고리를 1개 이상 넣어 주세요' }],
    approvalId: null,
    version: 1,
    createdBy: 'op-marketing-1',
    updatedAt: iso(now - DAY),
  };
  return { items: new Map([running, draft].map((p) => [p.promotionId, p])), seq: 2, grants: new Map() };
}

const store = seed();
export function resetPromotions(): void {
  Object.assign(store, seed());
}

function phaseOf(p: Pick<Promotion, 'state' | 'startsAt' | 'endsAt'>, now = Date.now()): Promotion['phase'] {
  if (p.state === 'ENDED') return 'FINISHED';
  if (p.state !== 'APPROVED') return 'NOT_APPROVED';
  if (now < Date.parse(p.startsAt)) return 'SCHEDULED';
  return now < Date.parse(p.endsAt) ? 'RUNNING' : 'FINISHED';
}

/** 서버 검사와 같은 뜻(계약 PromotionInput·CouponPolicy) */
export function checkPromotion(i: Input): Problem[] {
  const out: Problem[] = [];
  if (!i.name?.trim()) out.push({ field: 'name', reason: '이름을 넣어 주세요' });
  else if (i.name.length > 60) out.push({ field: 'name', reason: '이름은 60자까지예요' });
  if (!(Date.parse(i.startsAt) < Date.parse(i.endsAt))) out.push({ field: 'endsAt', reason: '끝 시각은 시작 시각 뒤여야 해요' });
  const d = i.discount;
  if (d.type === 'RATE' && (d.value < 1 || d.value > 90)) out.push({ field: 'discount.value', reason: '정률은 1~90% 예요' });
  if (d.type === 'AMOUNT' && d.value < 1) out.push({ field: 'discount.value', reason: '정액은 1원 이상이에요' });
  if (i.kind === 'PRICE_DISCOUNT') {
    if (!i.targets?.length) out.push({ field: 'targets', reason: '기간 할인은 대상 SKU·카테고리를 1개 이상 넣어 주세요' });
    if (d.maxAmount) out.push({ field: 'discount.maxAmount', reason: '최대 할인액은 정률 쿠폰만 쓸 수 있어요' });
  } else {
    const c = i.coupon;
    if (!c) out.push({ field: 'coupon', reason: '쿠폰 조건을 넣어 주세요' });
    else {
      if (!c.useDays === !c.useUntil) out.push({ field: 'coupon.useDays', reason: '사용 기간은 받은 날부터 N일 또는 고정 기한 중 하나만' });
      if (c.perCustomerLimit < 1 || c.perCustomerLimit > 10) out.push({ field: 'coupon.perCustomerLimit', reason: '1인 한도는 1~10장이에요' });
      if (c.useUntil && Date.parse(c.useUntil) < Date.parse(i.endsAt)) out.push({ field: 'coupon.useUntil', reason: '사용 기한은 받기 끝 시각 뒤여야 해요' });
    }
    if (d.maxAmount && d.type !== 'RATE') out.push({ field: 'discount.maxAmount', reason: '최대 할인액은 정률 쿠폰만 쓸 수 있어요' });
  }
  return out;
}

function deny(request: Request, roles: readonly string[]) {
  const who = operator(request);
  if (!who) return { denied: unauthorized(), who: null };
  if (!who.roles.some((r) => roles.includes(r))) return { denied: problem(403, 'FORBIDDEN'), who };
  return { denied: null, who };
}

const view = (p: Promotion): Promotion => ({ ...p, phase: phaseOf(p) });
/** 저장된 행사 → 검사용 입력 */
const inputFrom = (p: Promotion): Input => ({ kind: p.kind, name: p.name, startsAt: p.startsAt, endsAt: p.endsAt, discount: p.discount, targets: p.targets, ...(p.coupon ? { coupon: p.coupon } : {}) });

/** approval PROMOTION 결정 반영(목 effects 가 부른다) — ACTIVATE 승인 → APPROVED, END 승인 → ENDED, 반려 → REJECTED(발효) 또는 그대로(종료) */
export function decidePromotion(promotionId: string, approved: boolean, action: string | undefined): void {
  const p = store.items.get(promotionId);
  if (!p) return;
  const now = new Date().toISOString();
  if (action === 'END_PROMOTION') {
    if (approved && p.state === 'APPROVED') store.items.set(promotionId, { ...p, state: 'ENDED', endedAt: now, version: p.version + 1, updatedAt: now });
    return;
  }
  if (p.state !== 'SUBMITTED') return;
  store.items.set(promotionId, { ...p, state: approved ? 'APPROVED' : 'REJECTED', version: p.version + 1, updatedAt: now });
}

function save(input: Input, base: Partial<Promotion> & { promotionId: string; version: number; createdBy: string }): Promotion {
  const p: Promotion = {
    approvalId: null,
    endedAt: null,
    issuedCount: 0,
    usedCount: 0,
    ...base,
    kind: input.kind,
    name: input.name,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    discount: input.discount,
    targets: input.kind === 'PRICE_DISCOUNT' ? (input.targets ?? []) : [],
    coupon: input.kind === 'COUPON' ? (input.coupon ?? null) : null,
    problems: checkPromotion(input),
    state: 'DRAFT',
    phase: 'NOT_APPROVED',
    updatedAt: new Date().toISOString(),
  };
  store.items.set(p.promotionId, p);
  return p;
}

function approvalRequest(p: Promotion, action: 'ACTIVATE_PROMOTION' | 'END_PROMOTION', draftHash: string, reason?: string) {
  const what = p.kind === 'COUPON' ? '쿠폰' : '기간 할인';
  return {
    type: 'PROMOTION',
    targetService: 'promotion-service',
    targetRef: p.promotionId,
    allowedActions: [action],
    summary: action === 'END_PROMOTION' ? `행사 조기 종료 — ${p.name}` : `행사 발효 — ${what} · ${p.name}`,
    lines: [
      {
        lineKey: p.promotionId,
        attributes: {
          draftHash,
          promotionId: p.promotionId,
          action: action === 'END_PROMOTION' ? 'END' : 'ACTIVATE',
          kind: p.kind,
          name: p.name,
          startsAt: p.startsAt,
          endsAt: p.endsAt,
          // 실제 키(PC 1 2026-11-21): discount 객체가 아니라 discountType·discountValue, maxAmount 없음
          discountType: p.discount.type,
          discountValue: p.discount.value,
          ...(reason ? { reason } : {}),
        },
      },
    ],
  };
}

export const promotionHandlers = [
  http.get(`${API_BASE}/promotions`, ({ request }) => {
    const { denied } = deny(request, READ);
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const items = [...store.items.values()]
      .filter((p) => (!q.get('kind') || p.kind === q.get('kind')) && (!q.get('state') || p.state === q.get('state')))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(view);
    return HttpResponse.json({ items, page: { nextCursor: null, size: items.length } });
  }),
  http.post(`${API_BASE}/promotions`, async ({ request }) => {
    const { denied, who } = deny(request, MANAGE);
    if (denied) return denied;
    const input = (await request.json()) as Input;
    return idempotent(request, () => {
      const promotionId = `PRM-${++store.seq}`;
      return { status: 201, body: save(input, { promotionId, version: 1, createdBy: who?.subject ?? '' }) };
    });
  }),
  http.get(`${API_BASE}/promotions/:id`, ({ request, params }) => {
    const { denied } = deny(request, READ);
    if (denied) return denied;
    const p = store.items.get(String(params['id']));
    return p ? HttpResponse.json(view(p)) : problem(404, 'NOT_FOUND');
  }),
  http.put(`${API_BASE}/promotions/:id`, async ({ request, params }) => {
    const { denied } = deny(request, MANAGE);
    if (denied) return denied;
    const input = (await request.json()) as Input;
    return idempotent(request, () => {
      const p = store.items.get(String(params['id']));
      if (!p) return problem(404, 'NOT_FOUND');
      if (p.state !== 'DRAFT' && p.state !== 'REJECTED') return problem(409, 'INVALID_STATE');
      if (expectedVersion(request) !== p.version) return problem(409, 'VERSION_CONFLICT');
      return { status: 200, body: save(input, { promotionId: p.promotionId, version: p.version + 1, createdBy: p.createdBy }) };
    });
  }),
  http.post(`${API_BASE}/promotions/:id/submissions`, ({ request, params }) => {
    const { denied } = deny(request, MANAGE);
    if (denied) return denied;
    return idempotent(request, () => {
      const p = store.items.get(String(params['id']));
      if (!p) return problem(404, 'NOT_FOUND');
      if (p.state !== 'DRAFT' && p.state !== 'REJECTED') return problem(409, 'INVALID_STATE');
      const details = checkPromotion(inputFrom(p));
      if (details.length > 0) return problem(422, 'PROMOTION_INVALID', details);
      const draftHash = `h-${p.promotionId}-${p.version}`;
      const next = { ...p, state: 'SUBMITTED' as const, version: p.version + 1, updatedAt: new Date().toISOString() };
      store.items.set(p.promotionId, next);
      return { status: 200, body: { promotionId: p.promotionId, draftHash, approvalRequest: approvalRequest(next, 'ACTIVATE_PROMOTION', draftHash) } };
    });
  }),
  http.post(`${API_BASE}/promotions/:id/end-submissions`, async ({ request, params }) => {
    const { denied } = deny(request, MANAGE);
    if (denied) return denied;
    const body = (await request.json()) as { reason: string };
    return idempotent(request, () => {
      const p = store.items.get(String(params['id']));
      if (!p) return problem(404, 'NOT_FOUND');
      if (p.state !== 'APPROVED') return problem(409, 'INVALID_STATE');
      const draftHash = `h-end-${p.promotionId}-${p.version}`;
      return { status: 200, body: { promotionId: p.promotionId, draftHash, approvalRequest: approvalRequest(p, 'END_PROMOTION', draftHash, body.reason) } };
    });
  }),
  http.post(`${API_BASE}/promotions/:id/coupon-grants`, async ({ request, params }) => {
    const { denied } = deny(request, GRANT);
    if (denied) return denied;
    const body = (await request.json()) as { accountIds: string[]; reason: string };
    return idempotent(request, () => {
      const p = store.items.get(String(params['id']));
      if (!p) return problem(404, 'NOT_FOUND');
      if (p.kind !== 'COUPON' || p.coupon?.issueMode !== 'ADMIN') return problem(422, 'UNSUPPORTED_ACTION');
      if (phaseOf(p) !== 'RUNNING') return problem(422, 'NOT_ACTIVE');
      const mine = store.grants.get(p.promotionId) ?? new Map<string, number>();
      let issued = p.issuedCount ?? 0;
      const results = body.accountIds.map((accountId) => {
        if (p.coupon?.totalQuantity && issued >= p.coupon.totalQuantity) return { accountId, result: 'SOLD_OUT' as const, couponId: null };
        const had = mine.get(accountId) ?? 0;
        if (had >= (p.coupon?.perCustomerLimit ?? 1)) return { accountId, result: 'SKIPPED_LIMIT' as const, couponId: null };
        mine.set(accountId, had + 1);
        issued += 1;
        return { accountId, result: 'ISSUED' as const, couponId: `CPN-${p.promotionId}-${issued}` };
      });
      store.grants.set(p.promotionId, mine);
      store.items.set(p.promotionId, { ...p, issuedCount: issued });
      return { status: 200, body: { results } };
    });
  }),
];
