// ⚠ 화면 개발·시험용 목 — 사건함(case 0.4.0, 백엔드 요청 backoffice/2026-11-16-request-case-inbox-and-pending-work §1). 실제 서버 동작이 아니다.
// 규칙(계약 설명 그대로 흉내): OPERATOR_ADMIN 은 모든 사건(0.5.0 사가·결제 이상 포함), RIDER_OPS·CS_AGENT 는 배송 쪽 사건만(CS_AGENT 는 보기 + 오배송 열기만).
// 집기: 팀 직원은 자기 자신으로만·아무도 안 집은 것만(다른 사람이 집었으면 409), 관리자는 누구에게나. 닫기: 배송 팀(RIDER_OPS)·관리자, 다른 사람이 집은 것은 관리자만.
// 직원이 여는 종류는 MISDELIVERY 하나(그 밖 422 UNSUPPORTED_KIND), 같은 배송의 열린 오배송이 있으면 409 CASE_ALREADY_OPEN.
import { http, HttpResponse } from 'msw';

import { API_BASE, BFF_BASE } from '../api/client';
import type { components as CaseC } from '../api/generated/case';
import { mockAwaitingInquiries } from './inquiryHandlers';
import { markMockHelpPicked } from './opsHandlers';
import { idempotent, operator, problem, unauthorized } from './support';

type Case = CaseC['schemas']['Case'];
type Obligation = CaseC['schemas']['Obligation'];
type Handover = CaseC['schemas']['ShiftHandover'];
type Note = CaseC['schemas']['CaseNote'];
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
    assigneeGroup: 'DELIVERY_OPS', // 배송 쪽 기본 팀(사가·결제 사건은 ORDER_OPS 로 덮어쓴다)
    version: 1,
    history: [{ action: 'OPENED', at: at(-2), toState: 'OPEN', actorId: 'SYSTEM' }],
    ...c,
  });
  return [
    base({
      caseId: 'CASE-MOCK-1',
      openObligationCount: 2,
      obligations: [
        { obligationId: 'OBL-MOCK-1', caseId: 'CASE-MOCK-1', kind: 'CUSTOMER_CONTACT', owner: 'CS', state: 'OPEN', note: '[목] 도착 지연 안내 연락', dueAt: at(1), createdAt: at(-1), version: 1, resolutions: [] },
        { obligationId: 'OBL-MOCK-2', caseId: 'CASE-MOCK-1', kind: 'RETURN_PICKUP', owner: 'DELIVERY_OPS', state: 'OPEN', qty: 1, resolvedQty: 0, createdAt: at(-1), version: 1, resolutions: [] },
      ],
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
      refs: [{ refType: 'deliveryId', refId: 'DLV-MOCK-4' }, { refType: 'orderId', refId: 'ORD-MOCK-1003' }, { refType: 'recoveryDeliveryId', refId: 'DLV-MOCK-R1' }, { refType: 'reshipmentDeliveryId', refId: 'DLV-MOCK-S1' }],
      state: 'CLOSED',
      closure: { closedAt: at(-1), closedBy: 'op-admin-1', resolution: 'RESOLVED', summary: '[목] 회수 배차 완료' },
      history: [
        { action: 'OPENED', at: at(-3), toState: 'OPEN', actorId: 'op-cs-1' },
        { action: 'RECOVERY_CREATED', at: at(-2.5), actorId: 'SYSTEM', note: 'DLV-MOCK-R1' },
        { action: 'RECOVERY_PICKED_UP', at: at(-2), actorId: 'SYSTEM' },
        { action: 'RECOVERY_RETURNED', at: at(-1.5), actorId: 'SYSTEM', note: 'MFC-BSN-01' },
        { action: 'RESHIPMENT_CREATED', at: at(-1.2), actorId: 'SYSTEM', note: 'DLV-MOCK-S1' },
        { action: 'CLOSED', at: at(-1), toState: 'CLOSED', actorId: 'op-admin-1' },
      ],
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
/** case 0.9.0 교대 인계서 */
let handovers: Handover[] = [];
/** case 0.10.0 접수 건 메모 */
let notes: Note[] = [];

export function resetMockCases(): void {
  cases = seed();
  seq = 100;
  handovers = [];
  notes = [];
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

const OPEN_STATES = ['OPEN', 'PARTIALLY_RESOLVED'];
const isOpen = (o: Obligation) => OPEN_STATES.includes(o.state ?? 'OPEN');
const CREATABLE = ['REFUND', 'RETURN_PICKUP', 'REDELIVERY', 'RECONCILIATION', 'CUSTOMER_CONTACT', 'EVIDENCE_COLLECTION', 'COMPENSATION', 'OTHER'];
const countOpen = (c: Case) => {
  c.openObligationCount = (c.obligations ?? []).filter(isOpen).length;
};
const ownerOf = (o: Obligation, c: Case) => o.owner ?? c.assigneeGroup ?? 'DELIVERY_OPS';

function log(c: Case, action: string, actorId: string, toState: NonNullable<Case['state']>, note?: string) {
  c.history = [...(c.history ?? []), { action, at: new Date().toISOString(), actorId, ...(c.state ? { fromState: c.state } : {}), toState, ...(note ? { note } : {}) }];
  c.state = toState;
  c.version = (c.version ?? 0) + 1;
}

/** case 목록 거르기·순서(case /cases 와 bff case-inbox 가 같은 뜻 — bff 는 assigneeId 대신 assignee) */
function listCases(sees: (c: Case) => boolean, q: URLSearchParams): Summary[] {
  const state = q.get('state');
  const assignee = q.get('assigneeId') ?? q.get('assignee');
  return cases
    .filter(sees)
    .filter((c) => (state ? c.state === state : c.state !== 'CLOSED'))
    .filter((c) => q.get('unassigned') !== 'true' || !c.assigneeId)
    .filter((c) => q.get('overdue') !== 'true' || c.overdue)
    .filter((c) => !assignee || c.assigneeId === assignee)
    .filter((c) => !q.get('kind') || c.kind === q.get('kind'))
    .sort((a, b) => PRIORITY_ORDER[a.priority ?? 'P4'] - PRIORITY_ORDER[b.priority ?? 'P4'] || (a.slaDueAt ?? '').localeCompare(b.slaDueAt ?? ''))
    .map(summaryOf);
}

/** bff 0.5.0 연결 상태 목: 배송 = delivery-execution state, 주문 = order status. 표에 없는 ID 는 원천에 없음(state null·DIRECT). */
const LINKED_STATE: Readonly<Record<string, string>> = {
  'DLV-MOCK-1': 'PICKED_UP',
  'DLV-MOCK-2': 'FAILURE_REPORTED',
  'DLV-MOCK-3': 'ASSIGNED',
  'DLV-MOCK-4': 'COMPLETED',
  'DLV-MOCK-R1': 'RETURN_IN_PROGRESS', // 회수 배송(case 0.8.1)
  'DLV-MOCK-S1': 'ASSIGNED', // 재발송 배송(case 0.11.2)
  'ORD-MOCK-1001': 'IN_DELIVERY',
  'ORD-MOCK-1002': 'IN_DELIVERY',
  'ORD-MOCK-1003': 'CANCELLED',
  'ORD-MOCK-1004': 'PAYMENT_PENDING',
};

export const caseHandlers = [
  // bff 0.5.0 사건함 — case 목록 + 연결 배송·주문의 지금 상태. 주문을 못 보는 역할(RIDER_OPS 만)은 주문 칸 UNKNOWN + unavailableSources order-service.
  http.get(`${BFF_BASE}/views/case-inbox`, ({ request }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const q = new URL(request.url).searchParams;
    const now = new Date().toISOString();
    const stamp = (system: string, confidence: 'DIRECT' | 'UNKNOWN' = 'DIRECT') => ({ system, confidence, asOf: { asOf: now, freshness: confidence === 'DIRECT' ? ('CURRENT' as const) : ('UNAVAILABLE' as const) } });
    const seesOrders = v.admin || v.cs;
    const items = listCases(v.sees, q)
      .slice(0, Math.min(Number(q.get('size') ?? 20) || 20, 50))
      .map((c) => {
        const refs = c.refs ?? [];
        const linked = refs
          .filter((r) => r.refType === 'deliveryId' || r.refType === 'recoveryDeliveryId' || r.refType === 'reshipmentDeliveryId' || r.refType === 'orderId')
          .map((r) => {
            const delivery = r.refType === 'deliveryId' || r.refType === 'recoveryDeliveryId' || r.refType === 'reshipmentDeliveryId';
            const id = r.refId ?? '';
            if (!delivery && !seesOrders) return { kind: 'ORDER' as const, id, state: null, version: null, source: stamp('order-service', 'UNKNOWN') };
            return { kind: delivery ? ('DELIVERY' as const) : ('ORDER' as const), id, state: LINKED_STATE[id] ?? null, version: LINKED_STATE[id] ? 3 : null, source: stamp(delivery ? 'delivery-execution-service' : 'order-service') };
          });
        const rest: Partial<Summary> = { ...c };
        delete rest.refs;
        return { ...rest, linkedRefs: refs.map((r) => ({ kind: r.refType ?? '', id: r.refId ?? '' })), linked, source: stamp('case-service') };
      });
    const anyOrder = items.some((i) => i.linked.some((l) => l.kind === 'ORDER'));
    return HttpResponse.json({
      composedAt: now,
      sources: [stamp('case-service'), stamp('delivery-execution-service'), ...(seesOrders ? [stamp('order-service')] : [])],
      unavailableSources: !seesOrders && anyOrder ? ['order-service'] : [],
      items,
      page: { nextCursor: null, size: items.length },
    });
  }),

  http.get(`${API_BASE}/cases`, ({ request }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const q = new URL(request.url).searchParams;
    const items = listCases(v.sees, q);
    return HttpResponse.json({ items, page: { nextCursor: null, size: items.length } });
  }),

  // case 0.18.0 현황 건수 — 관리자만. 0건 종류·팀은 줄 없음. :caseId 보다 먼저(같은 모양 경로)
  http.get(`${API_BASE}/cases/metrics`, ({ request }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    if (!v.admin) return problem(403, 'FORBIDDEN');
    const open = cases.filter((c) => c.state !== 'CLOSED');
    const byKind = new Map<string, { kind: string; open: number; unassigned: number; overdue: number }>();
    for (const c of open) {
      const k = c.kind ?? 'OTHER';
      const row = byKind.get(k) ?? { kind: k, open: 0, unassigned: 0, overdue: 0 };
      row.open += 1;
      if (!c.assigneeId) row.unassigned += 1;
      if (c.overdue) row.overdue += 1;
      byKind.set(k, row);
    }
    const byOwner = new Map<string, { owner: string; open: number; overdue: number }>();
    for (const c of open)
      for (const o of (c.obligations ?? []).filter(isOpen)) {
        const owner = ownerOf(o, c);
        const row = byOwner.get(owner) ?? { owner, open: 0, overdue: 0 };
        row.open += 1;
        if (o.dueAt && Date.parse(o.dueAt) < Date.now()) row.overdue += 1;
        byOwner.set(owner, row);
      }
    return HttpResponse.json({
      asOf: new Date().toISOString(),
      cases: [...byKind.values()],
      obligations: [...byOwner.values()],
      pendingHandovers: handovers.filter((h) => h.state === 'PENDING').length,
      inquiries: mockAwaitingInquiries(),
    });
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
    const body = (await request.clone().json()) as {
      kind?: Kind;
      subjectType?: string;
      subjectRef?: string;
      summary?: string;
      misdelivery?: { fault?: string; resolution?: string; redeliveryDestinationId?: string };
    };
    return idempotent(request, () => {
      if (body.kind !== 'MISDELIVERY') return problem(422, 'UNSUPPORTED_KIND');
      if (body.subjectType !== 'DELIVERY' || !body.subjectRef || !(body.summary ?? '').trim()) return problem(400, 'VALIDATION_FAILED');
      // case 0.11.0 귀책·고객 선택(ADR-0065): RIDER·SYSTEM → RESHIP(기본)·REFUND, CUSTOMER → REDELIVER(기본, 실제 주소 ID 필요)·REFUND
      const md = body.misdelivery;
      if (md) {
        const res = md.resolution ?? (md.fault === 'CUSTOMER' ? 'REDELIVER' : 'RESHIP');
        const allowed = md.fault === 'CUSTOMER' ? ['REDELIVER', 'REFUND'] : md.fault === 'RIDER' || md.fault === 'SYSTEM' ? ['RESHIP', 'REFUND'] : [];
        if (!allowed.includes(res)) return problem(422, 'INVALID_MISDELIVERY_RESOLUTION');
        if (md.fault === 'CUSTOMER' && res === 'REDELIVER' && !md.redeliveryDestinationId) return problem(422, 'REDELIVERY_DESTINATION_REQUIRED');
      }
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
        refs: [
          { refType: 'deliveryId', refId: body.subjectRef },
          ...(md?.fault ? [{ refType: 'fault', refId: md.fault }, { refType: 'resolution', refId: md.resolution ?? (md.fault === 'CUSTOMER' ? 'REDELIVER' : 'RESHIP') }] : []),
        ],
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
      if (!v.admin && c.assigneeGroup === 'ORDER_OPS') return problem(403, 'FORBIDDEN');
      if (c.state === 'CLOSED') return problem(409, 'INVALID_STATE');
      if (!body.assigneeId) return problem(400, 'VALIDATION_FAILED');
      if (!v.admin) {
        if (body.assigneeId !== v.who.subject) return problem(403, 'FORBIDDEN');
        if (c.assigneeId && c.assigneeId !== v.who.subject) return problem(409, 'INVALID_STATE');
      }
      c.assigneeId = body.assigneeId;
      log(c, 'ASSIGNED', v.who.subject, 'ASSIGNED', body.assigneeId);
      markMockHelpPicked((c.refs ?? []).find((r) => r.refType === 'incidentId')?.refId ?? '');
      return { status: 200, body: c };
    });
  }),

  // case 0.17.0 행위 요청 기록 — 맡을 수 있는 사람(배송 건 지원센터·관리자, 관리자 팀·주문 건은 관리자), 처리 끝난 건 409, 보상 실행은 승인 번호(422)
  http.post(`${API_BASE}/cases/:caseId/action-requests`, async ({ request, params }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const body = (await request.clone().json()) as { actionType?: string; targetService?: string; command?: string; targetRef?: string; approvalRef?: string };
    return idempotent(request, () => {
      const c = cases.find((x) => x.caseId === params['caseId']);
      if (!c || !v.sees(c)) return problem(404, 'NOT_FOUND');
      if (!v.admin && (!v.team || c.assigneeGroup === 'ORDER_OPS')) return problem(403, 'FORBIDDEN');
      if (c.state === 'CLOSED') return problem(409, 'INVALID_STATE');
      const types = ['REQUERY_RESULT', 'RESEND_UNDELIVERED', 'EXECUTE_APPROVED_COMPENSATION', 'REQUEST_DOMAIN_REVIEW'];
      if (!types.includes(body.actionType ?? '')) return problem(422, 'UNSUPPORTED_ACTION');
      if (!body.targetService || !body.command) return problem(400, 'VALIDATION_FAILED');
      if (body.actionType === 'EXECUTE_APPROVED_COMPENSATION' && !body.approvalRef) return problem(422, 'APPROVAL_REQUIRED');
      const now = new Date().toISOString();
      const ar = {
        actionRequestId: `AR-MOCK-${(c.actionRequests?.length ?? 0) + 1}`,
        caseId: c.caseId ?? '',
        actionType: body.actionType as 'REQUERY_RESULT',
        targetService: body.targetService,
        command: body.command,
        ...(body.targetRef ? { targetRef: body.targetRef } : {}),
        ...(body.approvalRef ? { approvalRef: body.approvalRef } : {}),
        state: 'REQUESTED' as const,
        requestedBy: v.who.subject,
        requestedAt: now,
        resultAt: null,
        resultBy: null,
        resultNote: null,
        version: 1,
      };
      c.actionRequests = [...(c.actionRequests ?? []), ar];
      log(c, 'ACTION_REQUESTED', v.who.subject, c.state ?? 'OPEN', `${ar.actionType} ${ar.targetService}`);
      return { status: 201, body: ar };
    });
  }),
  http.post(`${API_BASE}/cases/:caseId/action-requests/:arId/results`, async ({ request, params }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const body = (await request.clone().json()) as { state?: string; resultSystem?: string; resultRef?: string; resultKind?: string; note?: string };
    return idempotent(request, () => {
      const c = cases.find((x) => x.caseId === params['caseId']);
      const ar = c?.actionRequests?.find((x) => x.actionRequestId === params['arId']);
      if (!c || !ar || !v.sees(c)) return problem(404, 'NOT_FOUND');
      if (!v.admin && (!v.team || c.assigneeGroup === 'ORDER_OPS')) return problem(403, 'FORBIDDEN');
      if (ar.state === 'APPLIED' || ar.state === 'REJECTED') return problem(409, 'INVALID_STATE');
      if (Boolean(body.resultSystem) !== Boolean(body.resultRef)) return problem(400, 'VALIDATION_FAILED');
      const now = new Date().toISOString();
      Object.assign(ar, {
        state: body.state,
        resultAt: now,
        resultBy: v.who.subject,
        resultNote: body.note ?? null,
        ...(body.resultSystem ? { resultRef: { system: body.resultSystem, ref: body.resultRef, ...(body.resultKind ? { kind: body.resultKind } : {}), asOf: now } } : {}),
        version: (ar.version ?? 1) + 1,
      });
      log(c, 'ACTION_RESULT_RECORDED', v.who.subject, c.state ?? 'OPEN', `${ar.actionRequestId} ${body.state ?? ''}`);
      return { status: 200, body: ar };
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
      if (!v.admin && c.assigneeGroup === 'ORDER_OPS') return problem(403, 'FORBIDDEN');
      if (c.state === 'CLOSED') return problem(409, 'INVALID_STATE');
      if (!body.resolution || !(body.summary ?? '').trim()) return problem(400, 'VALIDATION_FAILED');
      if ((c.obligations ?? []).some(isOpen)) return problem(409, 'OPEN_OBLIGATIONS');
      c.closure = { closedAt: new Date().toISOString(), closedBy: v.who.subject, resolution: body.resolution, summary: (body.summary ?? '').trim() };
      c.overdue = false;
      log(c, 'CLOSED', v.who.subject, 'CLOSED');
      return { status: 200, body: c };
    });
  }),

  // case 0.6.0 다시 열기: 닫기와 같은 사람(배송 쪽 = 지원센터·관리자, 관리자 팀 사건 = 관리자). 사유 필수. 닫히지 않음 409 INVALID_STATE,
  // 같은 종류·대상으로 열린 사건이 있으면 409 CASE_ALREADY_OPEN. 담당 비우고 기한 새로(10분 — 목).
  http.post(`${API_BASE}/cases/:caseId/reopenings`, async ({ request, params }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const body = (await request.clone().json()) as { reason?: string };
    return idempotent(request, () => {
      const c = cases.find((x) => x.caseId === params['caseId']);
      if (!c || !v.sees(c)) return problem(404, 'NOT_FOUND');
      if (!v.admin && !(v.team && c.assigneeGroup !== 'ORDER_OPS')) return problem(403, 'FORBIDDEN');
      if (!(body.reason ?? '').trim()) return problem(400, 'VALIDATION_FAILED', [{ field: 'reason', reason: 'REQUIRED' }]);
      if (c.state !== 'CLOSED') return problem(409, 'INVALID_STATE');
      if (cases.some((x) => x !== c && x.kind === c.kind && x.subjectRef === c.subjectRef && x.state !== 'CLOSED')) return problem(409, 'CASE_ALREADY_OPEN');
      c.assigneeId = null;
      c.slaDueAt = at(10 / 60);
      c.overdue = false;
      log(c, 'REOPENED', v.who.subject, 'REOPENED', (body.reason ?? '').trim());
      return { status: 200, body: c };
    });
  }),

  // case 0.7.0 넘기기: 배송 쪽 사건만 DELIVERY_OPS ↔ ORDER_OPS. 사유 필수. 담당 비움(집은 상태 → 열림), 기한 그대로.
  // 지원센터는 자기 팀 사건(안 집었거나 자기가 집은 것)을 관리자 팀으로만. 되돌리기·남이 맡은 사건은 관리자만. 상담원 403.
  http.post(`${API_BASE}/cases/:caseId/transfers`, async ({ request, params }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const body = (await request.clone().json()) as { toGroup?: string; reason?: string };
    return idempotent(request, () => {
      const c = cases.find((x) => x.caseId === params['caseId']);
      if (!c || !v.sees(c)) return problem(404, 'NOT_FOUND');
      if (!v.admin && !v.team) return problem(403, 'FORBIDDEN');
      if (!(body.reason ?? '').trim() || !body.toGroup) return problem(400, 'VALIDATION_FAILED');
      if (!DELIVERY_KINDS.includes(c.kind ?? 'OTHER') || (body.toGroup !== 'DELIVERY_OPS' && body.toGroup !== 'ORDER_OPS')) return problem(422, 'UNSUPPORTED_ACTION');
      if (c.state === 'CLOSED' || c.assigneeGroup === body.toGroup) return problem(409, 'INVALID_STATE');
      if (!v.admin && (c.assigneeGroup === 'ORDER_OPS' || (c.assigneeId && c.assigneeId !== v.who.subject))) return problem(403, 'FORBIDDEN');
      const from = c.assigneeGroup ?? 'DELIVERY_OPS';
      c.assigneeGroup = body.toGroup;
      c.assigneeId = null;
      log(c, 'TRANSFERRED', v.who.subject, 'OPEN', `${from} → ${body.toGroup}: ${(body.reason ?? '').trim()}`);
      return { status: 200, body: c };
    });
  }),

  // case 0.8.0 후속 처리(의무) 등록 — 접수 건을 다룰 수 있는 사람. 8종 밖 422 UNSUPPORTED_KIND, 사가·결제 접수 건에 지원센터·고객센터 몫 422 OWNER_CANNOT_SEE_CASE.
  http.post(`${API_BASE}/cases/:caseId/obligations`, async ({ request, params }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const body = (await request.clone().json()) as Partial<Obligation>;
    return idempotent(request, () => {
      const c = cases.find((x) => x.caseId === params['caseId']);
      if (!c || !v.sees(c)) return problem(404, 'NOT_FOUND');
      if (!v.admin && !(v.team && c.assigneeGroup !== 'ORDER_OPS')) return problem(403, 'FORBIDDEN');
      if (c.state === 'CLOSED') return problem(409, 'INVALID_STATE');
      if (!body.kind || !CREATABLE.includes(body.kind)) return problem(422, 'UNSUPPORTED_KIND');
      if (!DELIVERY_KINDS.includes(c.kind ?? 'OTHER') && (body.owner === 'DELIVERY_OPS' || body.owner === 'CS')) return problem(422, 'OWNER_CANNOT_SEE_CASE');
      seq += 1;
      const o: Obligation = {
        obligationId: `OBL-MOCK-${seq}`,
        caseId: c.caseId ?? '',
        kind: body.kind,
        state: 'OPEN',
        createdAt: new Date().toISOString(),
        version: 1,
        resolutions: [],
        ...(body.owner ? { owner: body.owner } : {}),
        ...(body.qty !== undefined ? { qty: body.qty, resolvedQty: 0 } : {}),
        ...(body.amount !== undefined ? { amount: body.amount, resolvedAmount: 0 } : {}),
        ...(body.dueAt ? { dueAt: body.dueAt } : {}),
        ...(body.note ? { note: body.note } : {}),
      };
      c.obligations = [...(c.obligations ?? []), o];
      countOpen(c);
      return { status: 201, body: o };
    });
  }),

  // 결과: 완료(수량·금액 일부 가능)·시도 기록(상태 그대로, 메모 필수)·면제·실패(관리자만, 사유 필수). 근거 필수.
  http.post(`${API_BASE}/obligations/:obligationId/resolutions`, async ({ request, params }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const body = (await request.clone().json()) as { outcome?: string; resolvedQty?: number; resolvedAmount?: number; evidence?: { system?: string; ref?: string }; note?: string };
    return idempotent(request, () => {
      const c = cases.find((x) => (x.obligations ?? []).some((o) => o.obligationId === params['obligationId']));
      const o = c?.obligations?.find((x) => x.obligationId === params['obligationId']);
      if (!c || !o || !v.sees(c)) return problem(404, 'NOT_FOUND');
      const owner = ownerOf(o, c);
      if (!v.admin && !((owner === 'DELIVERY_OPS' && v.team) || (owner === 'CS' && v.cs))) return problem(403, 'FORBIDDEN');
      if ((body.outcome === 'WAIVED' || body.outcome === 'FAILED') && !v.admin) return problem(403, 'FORBIDDEN');
      if (!body.evidence?.system || !body.evidence.ref) return problem(400, 'VALIDATION_FAILED', [{ field: 'evidence', reason: 'REQUIRED' }]);
      if (body.outcome !== 'FULFILLED' && !(body.note ?? '').trim()) return problem(400, 'VALIDATION_FAILED', [{ field: 'note', reason: 'REQUIRED' }]);
      if (!isOpen(o)) return problem(409, 'INVALID_STATE');
      const at_ = new Date().toISOString();
      const res: NonNullable<Obligation['resolutions']>[number] = { outcome: body.outcome ?? '', resolvedAt: at_, resolvedBy: v.who.subject, evidence: { system: body.evidence.system, ref: body.evidence.ref }, ...(body.note ? { note: body.note } : {}) };
      if (body.outcome === 'FULFILLED') {
        let done = true;
        if (o.qty !== undefined) {
          const add = body.resolvedQty ?? 0;
          if (add < 1) return problem(400, 'VALIDATION_FAILED');
          if ((o.resolvedQty ?? 0) + add > o.qty) return problem(409, 'QTY_EXCEEDS_OBLIGATION');
          o.resolvedQty = (o.resolvedQty ?? 0) + add;
          res.qty = add;
          done &&= o.resolvedQty >= o.qty;
        }
        if (o.amount !== undefined) {
          const add = body.resolvedAmount ?? 0;
          o.resolvedAmount = (o.resolvedAmount ?? 0) + add;
          res.amount = add;
          done &&= o.resolvedAmount >= o.amount;
        }
        o.state = done ? 'RESOLVED' : 'PARTIALLY_RESOLVED';
      } else if (body.outcome === 'WAIVED' || body.outcome === 'FAILED') {
        o.state = body.outcome;
      } else if (body.outcome !== 'ATTEMPTED') return problem(400, 'VALIDATION_FAILED');
      o.resolutions = [...(o.resolutions ?? []), res];
      o.version = (o.version ?? 1) + 1;
      countOpen(c);
      return { status: 200, body: o };
    });
  }),

  // 목록: owner(비우면 접수 건 팀으로 본다)·state(기본 처리 중)·caseId
  http.get(`${API_BASE}/obligations`, ({ request }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const q = new URL(request.url).searchParams;
    const state = q.get('state');
    const items = cases
      .filter(v.sees)
      .flatMap((c) => (c.obligations ?? []).map((o) => ({ o, c })))
      .filter(({ o, c }) => !q.get('owner') || ownerOf(o, c) === q.get('owner'))
      .filter(({ o }) => (state ? o.state === state : isOpen(o)))
      .filter(({ c }) => !q.get('caseId') || c.caseId === q.get('caseId'))
      .map(({ o }) => o);
    return HttpResponse.json({ items, page: { size: items.length, nextCursor: null } });
  }),

  // case 0.9.0 교대 인계 — 작성(PENDING, 담당 그대로)·수락(후임 본인만, 건별 결과)·취소(수락 전, 전임·관리자)·목록·단건.
  http.post(`${API_BASE}/shift-handovers`, async ({ request }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const body = (await request.clone().json()) as { group?: string; toOperatorId?: string; fromOperatorId?: string; note?: string; items?: Array<{ caseId?: string; nextAction?: string; checkDueAt?: string }> };
    return idempotent(request, () => {
      const from = body.fromOperatorId ?? v.who.subject;
      if (from !== v.who.subject && !v.admin) return problem(403, 'FORBIDDEN');
      // 0.13.1: 지원센터 팀 = RIDER_OPS·관리자, 관리자 팀 = 관리자만
      if (!v.admin && !(body.group === 'DELIVERY_OPS' && v.who.roles.includes('RIDER_OPS'))) return problem(403, 'FORBIDDEN');
      const items = body.items ?? [];
      const ids = items.map((i) => i.caseId ?? '');
      if (!body.toOperatorId || body.toOperatorId === from || items.length === 0 || items.some((i) => !(i.nextAction ?? '').trim()) || new Set(ids).size !== ids.length) return problem(400, 'VALIDATION_FAILED');
      const picked = ids.map((id) => cases.find((c) => c.caseId === id));
      if (picked.some((c) => !c || c.state === 'CLOSED' || c.assigneeId !== from || (c.assigneeGroup ?? 'DELIVERY_OPS') !== body.group)) return problem(422, 'NOT_HANDOVERABLE');
      if (handovers.some((h) => h.state === 'PENDING' && (h.items ?? []).some((i) => ids.includes(i.caseId ?? '')))) return problem(409, 'CASE_IN_HANDOVER');
      seq += 1;
      const now = new Date().toISOString();
      const h: Handover = {
        shiftHandoverId: `SH-MOCK-${seq}`,
        group: body.group ?? 'DELIVERY_OPS',
        fromOperatorId: from,
        toOperatorId: body.toOperatorId,
        createdBy: v.who.subject,
        createdAt: now,
        state: 'PENDING',
        unreceived: true,
        note: body.note ?? null,
        items: items.map((i, k) => ({ caseId: i.caseId ?? '', nextAction: i.nextAction ?? '', checkDueAt: i.checkDueAt ?? null, outcome: 'PENDING', caseStateAt: picked[k]?.state ?? 'OPEN', priorityAt: picked[k]?.priority ?? null, openObligationsAt: picked[k]?.openObligationCount ?? 0 })),
        teamSnapshot: cases
          .filter((c) => c.state !== 'CLOSED' && (c.assigneeGroup ?? 'DELIVERY_OPS') === body.group)
          .map((c) => ({ caseId: c.caseId ?? '', kind: c.kind ?? '', state: c.state ?? 'OPEN', priority: c.priority ?? null, assigneeId: c.assigneeId ?? null, openObligationCount: c.openObligationCount ?? 0 })),
      };
      for (const c of picked) if (c) log(c, 'HANDOVER_REQUESTED', v.who.subject, c.state ?? 'ASSIGNED');
      handovers.unshift(h);
      return { status: 201, body: h };
    });
  }),

  http.post(`${API_BASE}/shift-handovers/:id/acceptances`, async ({ request, params }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const body = (await request.clone().json()) as { excludedCaseIds?: string[] };
    return idempotent(request, () => {
      const h = handovers.find((x) => x.shiftHandoverId === params['id']);
      if (!h) return problem(404, 'NOT_FOUND');
      if (h.toOperatorId !== v.who.subject) return problem(403, 'FORBIDDEN'); // 관리자도 대신 받지 못한다
      if (h.state !== 'PENDING') return problem(409, 'INVALID_STATE');
      // 0.13.1: 후임에게 그 팀 역할이 없으면 403(인계서는 PENDING 그대로)
      if (!v.admin && !(h.group === 'DELIVERY_OPS' && v.who.roles.includes('RIDER_OPS'))) return problem(403, 'FORBIDDEN');
      const excluded = new Set(body.excludedCaseIds ?? []);
      h.items = (h.items ?? []).map((it) => {
        const c = cases.find((x) => x.caseId === it.caseId);
        if (excluded.has(it.caseId ?? '')) return { ...it, outcome: 'EXCLUDED' as const };
        if (!c || c.state === 'CLOSED' || c.assigneeId !== h.fromOperatorId) return { ...it, outcome: 'SKIPPED_CHANGED' as const };
        c.assigneeId = h.toOperatorId ?? null;
        log(c, 'HANDED_OVER', v.who.subject, c.state ?? 'ASSIGNED', `${h.fromOperatorId ?? ''} → ${h.toOperatorId ?? ''}: ${it.nextAction ?? ''}`);
        return { ...it, outcome: 'ACCEPTED' as const, resolvedAt: new Date().toISOString() };
      });
      h.state = 'COMPLETED';
      h.completedAt = new Date().toISOString();
      h.unreceived = (h.items ?? []).some((i) => i.outcome === 'EXCLUDED');
      return { status: 200, body: h };
    });
  }),

  http.post(`${API_BASE}/shift-handovers/:id/cancellations`, ({ request, params }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    return idempotent(request, () => {
      const h = handovers.find((x) => x.shiftHandoverId === params['id']);
      if (!h) return problem(404, 'NOT_FOUND');
      if (!v.admin && h.fromOperatorId !== v.who.subject && h.createdBy !== v.who.subject) return problem(403, 'FORBIDDEN');
      if (h.state !== 'PENDING') return problem(409, 'INVALID_STATE');
      h.state = 'CANCELLED';
      h.cancelledAt = new Date().toISOString();
      h.unreceived = false;
      h.items = (h.items ?? []).map((i) => ({ ...i, outcome: 'CANCELLED' as const }));
      return { status: 200, body: h };
    });
  }),

  http.get(`${API_BASE}/shift-handovers`, ({ request }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const q = new URL(request.url).searchParams;
    const items = handovers
      .filter((h) => v.admin || h.fromOperatorId === v.who.subject || h.toOperatorId === v.who.subject || h.createdBy === v.who.subject)
      .filter((h) => !q.get('state') || h.state === q.get('state'))
      .filter((h) => q.get('unreceived') !== 'true' || h.state === 'PENDING' || (h.items ?? []).some((i) => i.outcome === 'EXCLUDED'));
    return HttpResponse.json({ items, page: { size: items.length, nextCursor: null } });
  }),

  http.get(`${API_BASE}/shift-handovers/:id`, ({ request, params }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const h = handovers.find((x) => x.shiftHandoverId === params['id']);
    return h ? HttpResponse.json(h) : problem(404, 'NOT_FOUND');
  }),

  // case 0.10.0 메모 — 덧붙이기만(처리 끝난 건에도), 가림은 관리자만(가린 메모는 text null·masked true)
  http.get(`${API_BASE}/cases/:caseId/notes`, ({ request, params }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const c = cases.find((x) => x.caseId === params['caseId']);
    if (!c || !v.sees(c)) return problem(404, 'NOT_FOUND');
    const items = notes.filter((n) => n.caseId === c.caseId).map((n) => (n.masked ? { ...n, text: null } : n));
    return HttpResponse.json({ items, page: { size: items.length, nextCursor: null } });
  }),
  http.post(`${API_BASE}/cases/:caseId/notes`, async ({ request, params }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const body = (await request.clone().json()) as { text?: string };
    return idempotent(request, () => {
      const c = cases.find((x) => x.caseId === params['caseId']);
      if (!c || !v.sees(c)) return problem(404, 'NOT_FOUND');
      const t = (body.text ?? '').trim();
      if (t.length < 1 || t.length > 500) return problem(400, 'VALIDATION_FAILED');
      seq += 1;
      const n: Note = { noteId: `NOTE-MOCK-${seq}`, caseId: c.caseId ?? '', authorId: v.who.subject, createdAt: new Date().toISOString(), text: t, masked: false };
      notes.push(n);
      return { status: 201, body: n };
    });
  }),
  http.post(`${API_BASE}/cases/:caseId/notes/:noteId/maskings`, async ({ request, params }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const body = (await request.clone().json()) as { reason?: string };
    return idempotent(request, () => {
      if (!v.admin) return problem(403, 'FORBIDDEN');
      const n = notes.find((x) => x.noteId === params['noteId'] && x.caseId === params['caseId']);
      if (!n) return problem(404, 'NOT_FOUND');
      if (!(body.reason ?? '').trim()) return problem(400, 'VALIDATION_FAILED');
      n.masked = true;
      n.maskedBy = v.who.subject;
      n.maskedAt = new Date().toISOString();
      n.maskReason = (body.reason ?? '').trim();
      return { status: 200, body: { ...n, text: null } };
    });
  }),

  // order 0.9.0 오배송 다시 배송 실제 주소 기록(ADR-0065) — OPERATOR_ADMIN·CS_AGENT·RIDER_OPS. 주소는 돌려주지 않는다(내부 조회에만)
  http.post(`${API_BASE}/orders/lookups/:orderId/redelivery-destinations`, async ({ request, params }) => {
    const v = viewer(request);
    if ('denied' in v) return v.denied;
    const body = (await request.clone().json()) as { deliveryId?: string; roadAddress?: string; reason?: string };
    return idempotent(request, () => {
      if (!body.deliveryId || !(body.roadAddress ?? '').trim() || (body.reason ?? '').trim().length < 2) return problem(400, 'VALIDATION_FAILED');
      seq += 1;
      return { status: 201, body: { destinationId: `RDD-MOCK-${seq}`, orderId: String(params['orderId']), deliveryId: body.deliveryId, recordedAt: new Date().toISOString() } };
    });
  }),
];
