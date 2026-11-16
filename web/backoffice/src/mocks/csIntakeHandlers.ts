// ⚠ 화면 개발·시험용 목(case-service 0.12.0 cs-intakes). 실제 서버 동작이 아니다.
// 계약의 뜻만 흉내 낸다: 상담원·관리자만(그 밖 403), 경로 PHONE·CHAT·EMAIL 만, 분류 RIDER 400, 본인 확인 규칙(주문 대조 = 주문 필요·앱 로그인 채팅 = CHAT 만·기타 = 메모 필수) 400,
// 주문은 목 규칙으로 확인 — `ORD-MOCK-NNNN` 의 주인은 `CUS-NNNN`(opsHandlers 주문과 같음), 다른 모양은 422 ORDER_NOT_FOUND, 다른 고객 422 CUSTOMER_ORDER_MISMATCH.
// 연결(linkCaseId)이 없으면 상담원 문의(STAFF_INTAKE)를 만든다. 같은 Idempotency-Key 재전송은 같은 접수.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components } from '../api/generated/case';
import { addStaffInquiry } from './inquiryHandlers';
import { operator, problem, unauthorized } from './support';

type Intake = components['schemas']['Intake'];

interface Body {
  channel?: string;
  category?: string;
  customerRef?: string;
  subjectRef?: string;
  summary?: string;
  identityCheck?: { method?: string; note?: string };
  callerRelation?: string;
  consent?: { consentType?: string; given?: boolean; detail?: string };
  linkCaseId?: string;
}

let intakes: Intake[] = [];
const byKey = new Map<string, Intake>();
let seq = 0;

/** 시험 사이에 목 상태를 처음으로 돌린다. */
export function resetMockCsIntakes(): void {
  intakes = [];
  byKey.clear();
  seq = 0;
}

const allowed = (request: Request) => {
  const who = operator(request);
  if (!who) return { denied: unauthorized() };
  if (!who.roles.includes('CS_AGENT') && !who.roles.includes('OPERATOR_ADMIN')) return { denied: problem(403, 'FORBIDDEN') };
  return { who };
};

const ORDER = /^ORD-MOCK-(\d{4})$/;

export const csIntakeHandlers = [
  http.post(`${API_BASE}/cs-intakes`, async ({ request }) => {
    const { denied, who } = allowed(request);
    if (denied) return denied;
    const key = request.headers.get('Idempotency-Key') ?? '';
    const saved = byKey.get(key);
    if (saved) return HttpResponse.json(saved, { status: 201 });
    const b = (await request.json()) as Body;
    const method = b.identityCheck?.method;
    if (!['PHONE', 'CHAT', 'EMAIL'].includes(b.channel ?? '')) return problem(400, 'VALIDATION_FAILED');
    if (!b.category || b.category === 'RIDER') return problem(400, 'VALIDATION_FAILED');
    if (!b.customerRef || !b.summary?.trim() || !b.callerRelation || !method) return problem(400, 'VALIDATION_FAILED');
    if (method === 'ORDER_DETAILS_MATCH' && !b.subjectRef) return problem(400, 'VALIDATION_FAILED');
    if (method === 'APP_SIGNED_IN_CHAT' && b.channel !== 'CHAT') return problem(400, 'VALIDATION_FAILED');
    if (method === 'OTHER' && !b.identityCheck?.note?.trim()) return problem(400, 'VALIDATION_FAILED');
    if (b.subjectRef) {
      const hit = ORDER.exec(b.subjectRef);
      if (!hit) return problem(422, 'ORDER_NOT_FOUND');
      if (`CUS-${hit[1]}` !== b.customerRef) return problem(422, 'CUSTOMER_ORDER_MISMATCH');
    }
    if (b.linkCaseId && !b.linkCaseId.startsWith('CASE-')) return problem(404, 'NOT_FOUND');
    seq += 1;
    const at = new Date().toISOString();
    const caseId = b.linkCaseId ?? `CASE-MOCK-INT-${seq}`;
    const inquiryId = b.linkCaseId
      ? null
      : addStaffInquiry({
          category: b.category,
          customerId: b.customerRef,
          orderId: b.subjectRef ?? null,
          body: b.summary,
          channel: b.channel ?? null,
          callerRelation: b.callerRelation,
          createdAt: at,
          caseId,
        });
    const intake: Intake = {
      intakeId: `INT-MOCK-${seq}`,
      intakeType: 'CS',
      caseId,
      channel: b.channel ?? '',
      category: b.category,
      subjectRef: b.subjectRef ?? null,
      summary: b.summary,
      consentRecorded: Boolean(b.consent),
      receivedBy: who?.subject ?? '',
      receivedAt: at,
      inquiryId,
      linked: Boolean(b.linkCaseId),
      customerRef: b.customerRef,
      callerRelation: b.callerRelation === 'PROXY' ? 'PROXY' : 'SELF',
      identityCheck: { method: method as 'ORDER_DETAILS_MATCH' | 'APP_SIGNED_IN_CHAT' | 'OTHER', note: b.identityCheck?.note ?? null },
      consent: b.consent ? { consentType: b.consent.consentType ?? '', given: b.consent.given === true } : null,
    };
    intakes = [intake, ...intakes];
    byKey.set(key, intake);
    return HttpResponse.json(intake, { status: 201 });
  }),

  http.get(`${API_BASE}/cs-intakes`, ({ request }) => {
    const { denied } = allowed(request);
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const caseId = q.get('caseId');
    const customerRef = q.get('customerRef');
    const subjectRef = q.get('subjectRef');
    if (!caseId && !customerRef && !subjectRef) return problem(400, 'VALIDATION_FAILED');
    const items = intakes.filter(
      (x) => (!caseId || x.caseId === caseId) && (!customerRef || x.customerRef === customerRef) && (!subjectRef || x.subjectRef === subjectRef),
    );
    return HttpResponse.json({ items, page: { nextCursor: null, size: 20 } });
  }),

  http.get(`${API_BASE}/cs-intakes/:intakeId`, ({ request, params }) => {
    const { denied } = allowed(request);
    if (denied) return denied;
    const found = intakes.find((x) => x.intakeId === params.intakeId);
    return found ? HttpResponse.json(found) : problem(404, 'NOT_FOUND');
  }),
];
