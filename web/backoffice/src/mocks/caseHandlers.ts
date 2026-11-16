// ⚠ 화면 개발·시험용 목 — 사건함(case 0.4.0, 백엔드 요청 backoffice/2026-11-16-request-case-inbox-and-pending-work §1). 실제 서버 동작이 아니다.
// 규칙(계약 설명 그대로 흉내): OPERATOR_ADMIN 은 모든 사건(0.5.0 사가·결제 이상 포함), RIDER_OPS·CS_AGENT 는 배송 쪽 사건만(CS_AGENT 는 보기 + 오배송 열기만).
// 집기: 팀 직원은 자기 자신으로만·아무도 안 집은 것만(다른 사람이 집었으면 409), 관리자는 누구에게나. 닫기: 배송 팀(RIDER_OPS)·관리자, 다른 사람이 집은 것은 관리자만.
// 직원이 여는 종류는 MISDELIVERY 하나(그 밖 422 UNSUPPORTED_KIND), 같은 배송의 열린 오배송이 있으면 409 CASE_ALREADY_OPEN.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components as CaseC } from '../api/generated/case';
import { idempotent, operator, problem, unauthorized } from './support';

type Case = CaseC['schemas']['Case'];
type Summary = CaseC['schemas']['CaseSummary'];
type Kind = CaseC['schemas']['CaseKind'];

const DELIVERY_KINDS: readonly Kind[] = ['RIDER_HELP', 'DELIVERY_INCIDENT', 'RIDER_LOCATION_STALE', 'MISDELIVERY', 'DISPATCH_FAILED'];
const HOUR = 3_600_000;
const at = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();
const PRIORITY_ORDER = { P1: 1, P2: 2, P3: 3, P4: 4 } as const;

function seed(): Case[] {
  const base = (c: Partial<Case> & Pick<Case, 'caseId' | 'kind' | 'priority' | 'summary'>): Case => ({
    state: 'OPEN',
    openedAt: at(-2),
    assigneeId: null,
    overdue: false,
    openObligationCount: 0,
    version: 1,
    history: [{ action: 'OPENED', at: at(-2), toState: 'OPEN', actorId: 'SYSTEM' }],
    ...c,
  });
  return [
    base({
      caseId: 'CASE-MOCK-1',
      kind: 'RIDER_HELP',
      priority: 'P1',
      summary: '[목] 라이더 도움요청 — 건물 출입 불가',
      subjectType: 'DELIVERY',
      subjectRef: 'DLV-MOCK-1',
      refs: [{ refType: 'deliveryId', refId: 'DLV-MOCK-1' }, { refType: 'orderId', refId: 'ORD-MOCK-1001' }, { refType: 'riderId', refId: 'RID-MOCK-1' }, { refType: 'incidentId', refId: 'DLV-MOCK-1:HLP-MOCK-1' }],
      slaDueAt: at(-0.5),
      overdue: true,
    }),
    base({
      caseId: 'CASE-MOCK-2',
      kind: 'DELIVERY_INCIDENT',
      priority: 'P2',
      summary: '[목] 전달 실패 — 고객 연락 안 됨',
      subjectType: 'DELIVERY',
      subjectRef: 'DLV-MOCK-2',
      refs: [{ refType: 'deliveryId', refId: 'DLV-MOCK-2' }, { refType: 'orderId', refId: 'ORD-MOCK-1002' }, { refType: 'riderId', refId: 'RID-MOCK-2' }],
      slaDueAt: at(3),
    }),
    base({
      caseId: 'CASE-MOCK-3',
      kind: 'RIDER_LOCATION_STALE',
      priority: 'P2',
      summary: '[목] 배달 중 위치 끊김 10분',
      subjectType: 'DELIVERY',
      subjectRef: 'DLV-MOCK-3',
      refs: [{ refType: 'deliveryId', refId: 'DLV-MOCK-3' }, { refType: 'riderId', refId: 'RID-MOCK-1' }],
      state: 'ASSIGNED',
      assigneeId: 'op-rider-ops-1',
      slaDueAt: at(1),
      history: [
        { action: 'OPENED', at: at(-2), toState: 'OPEN', actorId: 'SYSTEM' },
        { action: 'ASSIGNED', at: at(-1), fromState: 'OPEN', toState: 'ASSIGNED', actorId: 'op-rider-ops-1' },
      ],
    }),
    base({
      caseId: 'CASE-MOCK-4',
      kind: 'MISDELIVERY',
      priority: 'P3',
      summary: '[목] 옆 동으로 오배송 확인',
      subjectType: 'DELIVERY',
      subjectRef: 'DLV-MOCK-4',
      refs: [{ refType: 'deliveryId', refId: 'DLV-MOCK-4' }, { refType: 'orderId', refId: 'ORD-MOCK-1003' }],
      state: 'CLOSED',
      closure: { closedAt: at(-1), closedBy: 'op-admin-1', resolution: 'RESOLVED', summary: '[목] 회수 배차 완료' },
    }),
    // case 0.5.0(R-3) 사가·결제 이상 — 관리자만 보인다(sees). 서버 모양: 팀 ORDER_OPS, 기한 1시간, refs 만
    base({
      caseId: 'CASE-MOCK-5',
      kind: 'RECONCILIATION',
      priority: 'P2',
      summary: '[목] 보상 해제 실패 — INVENTORY_RESERVATION',
      subjectType: 'ORDER',
      subjectRef: 'ORD-MOCK-1004',
      assigneeGroup: 'ORDER_OPS',
      refs: [{ refType: 'orderId', refId: 'ORD-MOCK-1004' }, { refType: 'sagaId', refId: 'SAGA-MOCK-1' }, { refType: 'resourceId', refId: 'RSV-MOCK-1' }],
      slaDueAt: at(0.5),
    }),
    // case 0.5.0 배차 실패 — 배송 쪽(DELIVERY_OPS, 모든 역할이 본다). refs deliveryId·orderId(incidentId 없음), 그 뒤 실패는 이력 RECURRED
    base({
      caseId: 'CASE-MOCK-6',
      kind: 'DISPATCH_FAILED',
      priority: 'P2',
      summary: '[목] 배차 실패 2번째 — 응답 만료 (10분마다 자동 재배차 중)',
      subjectType: 'DELIVERY',
      subjectRef: 'DLV-MOCK-6',
      assigneeGroup: 'DELIVERY_OPS',
      refs: [{ refType: 'deliveryId', refId: 'DLV-MOCK-6' }, { refType: 'orderId', refId: 'ORD-MOCK-1006' }],
      slaDueAt: at(0.1),
      history: [
        { action: 'OPENED', at: at(-0.3), toState: 'OPEN', actorId: 'SYSTEM' },
        { action: 'RECURRED', at: at(-0.1), actorId: 'SYSTEM', note: '3번째 — NO_RIDER' },
      ],
    }),
  ];
}

let cases = seed();
let seq = 100;

/** 시험 사이에 목 상태를 처음으로 돌린다. */
export function resetMockCases(): void {
  cases = seed();
  seq = 100;
}

/** 목록 항목(CaseSummary) — 상세에만 있는 이력·종결은 뺀다 */
const summaryOf = (c: Case): Summary => {
  const out: Case = { ...c };
  delete out.history;
  delete out.closure;
  return out;
};

function viewer(request: Request) {
  const who = operator(request);
  if (!who) return { denied: unauthorized() } as const;
  const admin = who.roles.includes('OPERATOR_ADMIN');
  const team = who.roles.includes('RIDER_OPS');
  const cs = who.roles.includes('CS_AGENT');
  if (!admin && !team && !cs) return { denied: problem(403, 'FORBIDDEN') } as const;
  return { who, admin, team, cs, sees: (c: Case) => admin || DELIVERY_KINDS.includes(c.kind ?? 'OTHER') } as const;
}

function log(c: Case, action: string, actorId: string, toState: NonNullable<Case['state']>, note?: string) {
  c.history = [...(c.history ?? []), { action, at: new Date().toISOString(), actorId, ...(c.state ? { fromState: c.state } : {}), toState, ...(note ? { note } : {}) }];
  c.state = toState;
  c.version = (c.version ?? 0) + 1;
}

export const caseHandlers = [
  http.get(`${API_BASE}/cases`, ({ request }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const q = new URL(request.url).searchParams;
    const state = q.get('state');
    const items = cases
      .filter(v.sees)
      .filter((c) => (state ? c.state === state : c.state !== 'CLOSED'))
      .filter((c) => q.get('unassigned') !== 'true' || !c.assigneeId)
      .filter((c) => q.get('overdue') !== 'true' || c.overdue)
      .filter((c) => !q.get('assigneeId') || c.assigneeId === q.get('assigneeId'))
      .filter((c) => !q.get('kind') || c.kind === q.get('kind'))
      .sort((a, b) => PRIORITY_ORDER[a.priority ?? 'P4'] - PRIORITY_ORDER[b.priority ?? 'P4'] || (a.slaDueAt ?? '').localeCompare(b.slaDueAt ?? ''))
      .map(summaryOf);
    return HttpResponse.json({ items, page: { nextCursor: null, size: items.length } });
  }),

  http.get(`${API_BASE}/cases/:caseId`, ({ request, params }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const c = cases.find((x) => x.caseId === params['caseId']);
    return c && v.sees(c) ? HttpResponse.json(c) : problem(404, 'NOT_FOUND');
  }),

  http.post(`${API_BASE}/cases`, async ({ request }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const body = (await request.clone().json()) as { kind?: Kind; subjectType?: string; subjectRef?: string; summary?: string };
    return idempotent(request, () => {
      if (body.kind !== 'MISDELIVERY') return problem(422, 'UNSUPPORTED_KIND');
      if (body.subjectType !== 'DELIVERY' || !body.subjectRef || !(body.summary ?? '').trim()) return problem(400, 'VALIDATION_FAILED');
      if (cases.some((c) => c.kind === 'MISDELIVERY' && c.subjectRef === body.subjectRef && c.state !== 'CLOSED')) return problem(409, 'CASE_ALREADY_OPEN');
      seq += 1;
      const c: Case = {
        caseId: `CASE-MOCK-${seq}`,
        kind: 'MISDELIVERY',
        priority: 'P2',
        state: 'OPEN',
        summary: (body.summary ?? '').trim(),
        subjectType: 'DELIVERY',
        subjectRef: body.subjectRef,
        refs: [{ refType: 'deliveryId', refId: body.subjectRef }],
        openedAt: new Date().toISOString(),
        assigneeId: null,
        overdue: false,
        version: 1,
        history: [{ action: 'OPENED', at: new Date().toISOString(), toState: 'OPEN', actorId: v.who.subject }],
      };
      cases.unshift(c);
      return { status: 201, body: c };
    });
  }),

  http.post(`${API_BASE}/cases/:caseId/assignments`, async ({ request, params }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const body = (await request.clone().json()) as { assigneeId?: string };
    return idempotent(request, () => {
      const c = cases.find((x) => x.caseId === params['caseId']);
      if (!c || !v.sees(c)) return problem(404, 'NOT_FOUND');
      if (!v.admin && !v.team) return problem(403, 'FORBIDDEN');
      if (c.state === 'CLOSED') return problem(409, 'INVALID_STATE');
      if (!body.assigneeId) return problem(400, 'VALIDATION_FAILED');
      if (!v.admin) {
        if (body.assigneeId !== v.who.subject) return problem(403, 'FORBIDDEN');
        if (c.assigneeId && c.assigneeId !== v.who.subject) return problem(409, 'INVALID_STATE');
      }
      c.assigneeId = body.assigneeId;
      log(c, 'ASSIGNED', v.who.subject, 'ASSIGNED', body.assigneeId);
      return { status: 200, body: c };
    });
  }),

  http.post(`${API_BASE}/cases/:caseId/closures`, async ({ request, params }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const body = (await request.clone().json()) as { resolution?: string; summary?: string };
    return idempotent(request, () => {
      const c = cases.find((x) => x.caseId === params['caseId']);
      if (!c || !v.sees(c)) return problem(404, 'NOT_FOUND');
      if (!v.admin && !v.team) return problem(403, 'FORBIDDEN');
      if (!v.admin && c.assigneeId && c.assigneeId !== v.who.subject) return problem(403, 'FORBIDDEN');
      if (c.state === 'CLOSED') return problem(409, 'INVALID_STATE');
      if (!body.resolution || !(body.summary ?? '').trim()) return problem(400, 'VALIDATION_FAILED');
      c.closure = { closedAt: new Date().toISOString(), closedBy: v.who.subject, resolution: body.resolution, summary: (body.summary ?? '').trim() };
      c.overdue = false;
      log(c, 'CLOSED', v.who.subject, 'CLOSED');
      return { status: 200, body: c };
    });
  }),
];
