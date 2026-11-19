// hr-service 목(계약 hr-service.yaml 0.1.0). 응답 모양은 계약의 Employee·EmployeePage·EmployeeSelf 만 쓴다.
// 409 code 는 계약 info.description(백엔드 회신 2026-11-13 Q5): MAIL_ID_TAKEN, VERSION_CONFLICT, INVALID_STATE. 이미 그 상태인 정지·복귀·퇴사는 바꾸지 않고 200.
//
// 계정 발급 진행(목 규칙): 직원 조회(GET /hr/employees/{id})를 한 번 할 때마다 한 단계씩 나아간다
//   REQUESTED → MAILBOX_CREATED → IAM_CREATED → INVITE_SENT → DONE. 화면이 몇 초마다 다시 조회하는 것을 그대로 따라간다.
//   메일 ID 가 fail 로 시작하면 IAM_CREATED 로 가지 못하고 FAILED(IAM_USERNAME_TAKEN). 다시 시도하면 이어서 끝난다.
// 요청 권한(목 규칙): 발급이 끝나면 PENDING → SUBMITTED, 그 다음 조회에서 소속 센터의 MFC_WORKER 만 APPROVED(자동 승인).
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { Affiliation, Employee, EmployeeRegistration, GrantRequestState, ProvisioningStep } from '../api/models';
import { db, nextSeq, timestamp, type MockEmployee } from './db';
import { expectedVersion, idempotent, operator, problem, unauthorized } from './support';

const ORDER: readonly ProvisioningStep[] = ['REQUESTED', 'MAILBOX_CREATED', 'IAM_CREATED', 'INVITE_SENT', 'DONE'];

function requireHr(request: Request) {
  const who = operator(request);
  if (!who) return unauthorized();
  return who.roles.includes('HR_ADMIN') ? null : problem(403, 'FORBIDDEN');
}

const mailIdOf = (e: Employee) => e.mailAddress.replace(/@pmart\.com$/, '');

function touch(m: MockEmployee, patch: Partial<Employee>): Employee {
  m.employee = { ...m.employee, ...patch, version: m.employee.version + 1, updatedAt: timestamp() };
  return m.employee;
}

/** 조회 한 번 = 발급 한 단계(위 목 규칙). version 은 올리지 않는다(발급 진행은 인사 정보 변경이 아니다). */
function advance(m: MockEmployee): void {
  const e = m.employee;
  const step = e.provisioning.step;
  const i = ORDER.indexOf(step);
  if (i >= 0 && i < ORDER.length - 1 && e.status === 'ACTIVE') {
    const next = ORDER[i + 1]!;
    if (m.failAt === next) {
      m.employee = { ...e, provisioning: { step: 'FAILED', attempts: 8, lastErrorCode: 'IAM_USERNAME_TAKEN', updatedAt: timestamp() } };
      return;
    }
    m.employee = { ...e, provisioning: { step: next, attempts: e.provisioning.attempts, updatedAt: timestamp() } };
    if (next === 'DONE') {
      m.employee = {
        ...m.employee,
        requestedGrants: (e.requestedGrants ?? []).map((g): GrantRequestState => (g.submission === 'PENDING' ? { ...g, submission: 'SUBMITTED' } : g)),
      };
    }
    return;
  }
  if (step === 'DONE') {
    const own = e.affiliation.type === 'CENTER' ? e.affiliation.code : null;
    m.employee = {
      ...e,
      requestedGrants: (e.requestedGrants ?? []).map((g): GrantRequestState => {
        if (!(g.submission === 'SUBMITTED' && g.role === 'MFC_WORKER' && own !== null && g.centers.length === 1 && g.centers[0] === own)) return g;
        const approvalRef = `AP-mock-${nextSeq()}`;
        // 승인되면 employee-auth 가 권한을 적용한다(목: 계정 grants 에 더한다)
        const list = db.accountGrants.get(e.operatorId) ?? [];
        list.push({
          grantId: `${approvalRef}:L1`,
          approvalId: approvalRef,
          approverId: 'RULE:center-worker@v1',
          role: g.role,
          centers: [...g.centers],
          validFrom: `${g.validFrom ?? e.startDate}T00:00:00+09:00`,
          validUntil: g.validTo ? new Date(Date.parse(`${g.validTo}T00:00:00+09:00`) + 86_400_000).toISOString() : null, // 마지막 날 다음 날 0시(서울)부터 무효
          appliedAt: timestamp(),
        });
        db.accountGrants.set(e.operatorId, list);
        return { ...g, submission: 'APPROVED', approvalRef };
      }),
    };
  }
}

function find(request: Request, id: string | readonly string[] | undefined): MockEmployee | HttpResponse<Record<string, unknown>> {
  const denied = requireHr(request);
  if (denied) return denied as HttpResponse<Record<string, unknown>>;
  return db.employees.get(String(id)) ?? problem(404, 'NOT_FOUND');
}

/** X-Expected-Version 이 있고 다르면 409 */
const stale = (request: Request, m: MockEmployee) => {
  const v = expectedVersion(request);
  return v !== undefined && v !== m.employee.version;
};

const validAffiliation = (a: Affiliation | undefined): a is Affiliation =>
  !!a && (a.type === 'HQ_DEPARTMENT' || a.type === 'CENTER') && /^[A-Za-z0-9_.-]{1,64}$/.test(a.code ?? '');

function reasonCommand(
  path: string,
  apply: (m: MockEmployee, body: { reason: string; startDate?: string; endDate?: string; affiliation?: Affiliation }) => Employee | HttpResponse<Record<string, unknown>>,
) {
  return http.post(`${API_BASE}/hr/employees/:operatorId/${path}`, async ({ request, params }) => {
    const m = find(request, params['operatorId']);
    if (m instanceof Response) return m;
    const body = (await request.json()) as { reason?: string; startDate?: string; endDate?: string; affiliation?: Affiliation };
    if (!body.reason?.trim()) return problem(400, 'VALIDATION_FAILED', [{ field: 'reason', reason: 'REQUIRED' }]);
    return idempotent(request, () => {
      if (stale(request, m)) return problem(409, 'VERSION_CONFLICT');
      const result = apply(m, { ...body, reason: body.reason ?? '' });
      return result instanceof Response ? result : { status: 200, body: result };
    });
  });
}

/** hr 0.6.0 센터 지정 역할(목 — 실제는 employee-auth 역할 목록 centerScoped) */
const CENTER_SCOPED = ['MFC_SUPERVISOR', 'MFC_WORKER'];
const KNOWN_ROLES = ['OPERATOR_ADMIN', 'HR_ADMIN', 'MD', 'CS_AGENT', 'RIDER_OPS', 'MFC_SUPERVISOR', 'MFC_WORKER', 'PRODUCT_APPROVER', 'DISPLAY_APPROVER', 'PRICE_APPROVER', 'SCM', 'FINANCE', 'QUALITY'];

/** hr 0.6.0(HR-2) 400 규칙 — 같은 역할 두 줄(목록), 모르는 역할, 센터 규칙 */
function grantRuleProblems(grants: ReadonlyArray<{ role?: string; centers?: string[] }>, list: 'grants' | 'requestedGrants'): Array<{ field: string; reason: string }> {
  const out: Array<{ field: string; reason: string }> = [];
  const roles = grants.map((g) => g.role ?? '');
  if (new Set(roles).size !== roles.length) out.push({ field: list, reason: 'DUPLICATE_ROLE' });
  grants.forEach((g, i) => {
    if (!KNOWN_ROLES.includes(g.role ?? '')) out.push({ field: `${list}[${i}].role`, reason: 'UNKNOWN_ROLE' });
    else if (CENTER_SCOPED.includes(g.role ?? '') !== (g.centers ?? []).length > 0) out.push({ field: `${list}[${i}].centers`, reason: 'CENTER_RULE' });
  });
  return out;
}

/** 계정의 끝나지 않은 권한(목 db.accountGrants) */
const activeAccountGrants = (operatorId: string) => (db.accountGrants.get(operatorId) ?? []).filter((g) => !g.revokedAt && (!g.validUntil || Date.parse(g.validUntil) > Date.now()));

/** 목 오늘(서울) — 계약 종료 임박 시험이 날짜에 흔들리지 않게 고정 */
export const MOCK_TODAY = '2026-11-19';
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const hrHandlers = [
  // hr 0.3.0 권한 추가·변경 요청(BO-01): 재직 중·발급 끝난 직원만(409 INVALID_STATE), 결정 안 된 요청이 있으면 409 GRANT_REQUEST_PENDING, 자기 권한 403.
  // 목 규칙: SUBMITTED 로 붙고, 다음 직원 조회에서 소속 센터 MFC_WORKER 만 자동 승인(등록 때와 같은 advance 규칙).
  http.post(`${API_BASE}/hr/employees/:operatorId/grant-requests`, async ({ request, params }) => {
    const found = find(request, params['operatorId']);
    if (found instanceof Response) return found;
    const who = operator(request);
    const body = (await request.clone().json()) as { grants?: Array<{ role: string; centers?: string[]; validFrom?: string; validTo?: string; reason?: string }>; reason?: string };
    return idempotent(request, () => {
      if (!body.grants || body.grants.length === 0 || !(body.reason ?? '').trim()) return problem(400, 'VALIDATION_FAILED');
      if (who?.subject === found.employee.operatorId) return problem(403, 'FORBIDDEN');
      if (stale(request, found)) return problem(409, 'VERSION_CONFLICT');
      if (found.employee.status !== 'ACTIVE' || found.employee.provisioning.step !== 'DONE') return problem(409, 'INVALID_STATE');
      if ((found.employee.requestedGrants ?? []).some((g) => g.submission === 'PENDING' || g.submission === 'SUBMITTED')) return problem(409, 'GRANT_REQUEST_PENDING');
      // hr 0.6.0(HR-2): 같은 역할 두 줄·모르는 역할·센터 규칙 400, 이미 가진 권한 409 GRANT_ALREADY_ACTIVE(details[i].reason 기계 형식)
      const ruleProblems = grantRuleProblems(body.grants, 'grants');
      if (ruleProblems.length > 0) return problem(400, 'VALIDATION_FAILED', ruleProblems);
      const conflicts = body.grants.flatMap((g, i) =>
        activeAccountGrants(found.employee.operatorId)
          .filter((x) => x.role === g.role && (!CENTER_SCOPED.includes(g.role) || x.centers.some((c) => (g.centers ?? []).includes(c))))
          .filter((x) => !g.validFrom || !x.validUntil || Date.parse(`${g.validFrom}T00:00:00+09:00`) < Date.parse(x.validUntil))
          .map((x) => ({
            field: `grants[${i}]`,
            reason: `existingGrantId=${x.grantId};role=${x.role};centers=${x.centers.join(',')};validFrom=${x.validFrom};validUntil=${x.validUntil ?? 'none'};extension=${Boolean(g.validTo && x.validUntil)}`,
          })),
      );
      // hr 0.7.0 CENTER_ROLE_MIX: 같은 때 유효한 MFC 역할끼리 센터 묶음이 다르면 409(같은 역할끼리는 괜찮다)
      const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((c) => b.includes(c));
      const mixes = body.grants.flatMap((g, i) =>
        !CENTER_SCOPED.includes(g.role)
          ? []
          : activeAccountGrants(found.employee.operatorId)
              .filter((x) => x.role !== g.role && CENTER_SCOPED.includes(x.role) && !sameSet(x.centers, g.centers ?? []))
              .filter((x) => !g.validFrom || !x.validUntil || Date.parse(`${g.validFrom}T00:00:00+09:00`) < Date.parse(x.validUntil))
              .map((x) => ({ field: `grants[${i}]`, reason: `existingGrantId=${x.grantId};role=${x.role};centers=${x.centers.join(',')}` })),
      );
      if (mixes.length > 0)
        return problem(409, 'CENTER_ROLE_MIX', mixes, '[목] 지금 권한(센터 작업자 · MFC-BSN-01)과 센터가 다른 MFC 역할이라 섞입니다. 다른 센터 권한을 먼저 회수하거나 같은 센터로 요청하세요.');
      if (conflicts.length > 0) return problem(409, 'GRANT_ALREADY_ACTIVE', conflicts, '이미 유효하거나 시작 전인 같은 권한이 있습니다(목). 그 권한이 끝난 다음 날부터로 요청하거나, 필요 없으면 먼저 회수하세요.');
      const added: GrantRequestState[] = body.grants.map((g) => ({
        role: g.role,
        centers: g.centers ?? [],
        ...(g.validFrom ? { validFrom: g.validFrom } : {}),
        ...(g.validTo ? { validTo: g.validTo } : {}),
        reason: g.reason ?? (body.reason ?? '').trim(),
        submission: 'SUBMITTED',
      }));
      return { status: 200, body: touch(found, { requestedGrants: [...(found.employee.requestedGrants ?? []), ...added] }) };
    });
  }),

  // hr 0.3.0 본사 부서: 목록 = 이름을 정한 부서 ∪ 직원 소속(HQ_DEPARTMENT) 코드, 코드 오름차순. employeeCount = 퇴사 아닌 소속 직원 수.
  http.get(`${API_BASE}/hr/departments`, ({ request }) => {
    const denied = requireHr(request);
    if (denied) return denied;
    const codes = new Set(db.departments.keys());
    for (const m of db.employees.values()) if (m.employee.affiliation.type === 'HQ_DEPARTMENT') codes.add(m.employee.affiliation.code);
    const items = [...codes].sort().map((code) => {
      const name = db.departments.get(code)?.name;
      const employeeCount = [...db.employees.values()].filter(
        (m) => m.employee.affiliation.type === 'HQ_DEPARTMENT' && m.employee.affiliation.code === code && m.employee.status !== 'LEFT',
      ).length;
      return { code, employeeCount, ...(name ? { name } : {}) };
    });
    return HttpResponse.json({ items });
  }),

  http.put(`${API_BASE}/hr/departments/:code`, async ({ request, params }) => {
    const denied = requireHr(request);
    if (denied) return denied;
    const body = (await request.clone().json()) as { name?: string };
    return idempotent(request, () => {
      const code = String(params['code']);
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(code)) return problem(400, 'VALIDATION_FAILED', [{ field: 'code', reason: 'INVALID_FORMAT' }]);
      const name = (body.name ?? '').trim();
      if (name.length > 60) return problem(400, 'VALIDATION_FAILED', [{ field: 'name', reason: 'INVALID_FORMAT' }]);
      db.departments.set(code, name ? { name } : {});
      const employeeCount = [...db.employees.values()].filter(
        (m) => m.employee.affiliation.type === 'HQ_DEPARTMENT' && m.employee.affiliation.code === code && m.employee.status !== 'LEFT',
      ).length;
      return { status: 200, body: { code, employeeCount, ...(name ? { name } : {}) } };
    });
  }),

  // hr 0.9.0 인원 세기(H-D2) — :id 보다 먼저(같은 모양 경로). 오늘 = 목 고정 서울 날짜
  http.get(`${API_BASE}/hr/employees/counts`, ({ request }) => {
    const denied = requireHr(request);
    if (denied) return denied;
    const days = Number(new URL(request.url).searchParams.get('endingWithinDays') ?? 7);
    if (!Number.isInteger(days) || days < 1 || days > 90) return problem(400, 'VALIDATION_FAILED');
    const today = MOCK_TODAY;
    const to = addDays(today, days - 1);
    const all = [...db.employees.values()].map((m) => m.employee);
    const c = (n: number) => ({ value: n, complete: true });
    return HttpResponse.json({
      asOf: new Date().toISOString(),
      active: c(all.filter((e) => e.status === 'ACTIVE').length),
      suspended: c(all.filter((e) => e.status === 'SUSPENDED').length),
      left: c(all.filter((e) => e.status === 'LEFT').length),
      provisioningFailed: c(all.filter((e) => e.provisioning.step === 'FAILED' || e.provisioning.step === 'COMPENSATED').length),
      grantPendingApproval: c(all.filter((e) => e.status !== 'LEFT' && (e.requestedGrants ?? []).some((g) => g.submission === 'SUBMITTED')).length),
      endingSoon: c(all.filter((e) => e.status === 'ACTIVE' && e.endDate && e.endDate >= today && e.endDate <= to).length),
      endingWithinDays: days,
      endingFrom: today,
      endingTo: to,
    });
  }),

  http.get(`${API_BASE}/hr/employees`, ({ request }) => {
    const denied = requireHr(request);
    if (denied) return denied;
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const affiliationCode = url.searchParams.get('affiliationCode');
    const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
    const size = Number(url.searchParams.get('size') ?? 50);
    const offset = Number(url.searchParams.get('cursor') ?? 0);
    // hr 0.9.0 거르기(H-D1)
    const steps = url.searchParams.get('provisioningStep')?.split(',').filter(Boolean) ?? [];
    const grant = url.searchParams.get('grantSubmission');
    const endFrom = url.searchParams.get('endDateFrom');
    const endTo = url.searchParams.get('endDateTo');
    const sort = url.searchParams.get('sort') ?? 'CREATED_DESC';
    if (endFrom && endTo && endFrom > endTo) return problem(400, 'VALIDATION_FAILED');
    const all = [...db.employees.values()]
      .map((m) => m.employee)
      .filter((e) => !status || e.status === status)
      .filter((e) => !affiliationCode || e.affiliation.code === affiliationCode)
      .filter((e) => !q || e.name.toLowerCase().startsWith(q) || mailIdOf(e).startsWith(q) || e.employeeNo.toLowerCase().startsWith(q))
      .filter((e) => steps.length === 0 || steps.includes(e.provisioning.step))
      .filter((e) => !grant || (e.requestedGrants ?? []).some((g) => g.submission === grant))
      .filter((e) => (!endFrom && !endTo && sort !== 'END_DATE_ASC') || (Boolean(e.endDate) && (!endFrom || (e.endDate ?? '') >= endFrom) && (!endTo || (e.endDate ?? '') <= endTo)))
      .sort((a, b) => (sort === 'END_DATE_ASC' ? (a.endDate ?? '').localeCompare(b.endDate ?? '') || a.employeeNo.localeCompare(b.employeeNo) : b.employeeNo.localeCompare(a.employeeNo)));
    const items = all.slice(offset, offset + size);
    const next = offset + size < all.length ? String(offset + size) : undefined;
    return HttpResponse.json({ items, ...(next ? { nextCursor: next } : {}) });
  }),

  http.post(`${API_BASE}/hr/employees`, async ({ request }) => {
    const denied = requireHr(request);
    if (denied) return denied;
    const body = (await request.json()) as Partial<EmployeeRegistration>;
    const details: Array<{ field: string; reason: string }> = [];
    if (!body.name?.trim()) details.push({ field: 'name', reason: 'REQUIRED' });
    // hr 0.5.1: Keycloak 이름 규칙에 걸리는 문자(대괄호 등) — 발급까지 가지 않고 400
    const prohibitedName = /[<>&"$%!#?§;*~/\\|^=[\]{}()]/.test(body.name ?? '');
    if (prohibitedName) details.push({ field: 'name', reason: 'INVALID_FORMAT' });
    if (!body.mailId || !/^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/.test(body.mailId)) details.push({ field: 'mailId', reason: 'INVALID_FORMAT' });
    if (!validAffiliation(body.affiliation)) details.push({ field: 'affiliation', reason: 'REQUIRED' });
    if (!body.startDate) details.push({ field: 'startDate', reason: 'REQUIRED' });
    if (body.employmentType !== 'REGULAR' && !body.endDate) details.push({ field: 'endDate', reason: 'REQUIRED' });
    if (body.employmentType === 'REGULAR' && body.endDate) details.push({ field: 'endDate', reason: 'NOT_ALLOWED' });
    details.push(...grantRuleProblems(body.requestedGrants ?? [], 'requestedGrants'));
    if (details.length > 0) return problem(400, 'VALIDATION_FAILED', details, prohibitedName ? '[목] 이름에 쓸 수 없는 문자가 있습니다(< > & " $ % ! # ? § ; * ~ / \\ | ^ = [ ] { } ( )).' : undefined);
    const reg = body as EmployeeRegistration;
    return idempotent(request, () => {
      const mailAddress = `${reg.mailId}@pmart.com`;
      if ([...db.employees.values()].some((m) => m.employee.mailAddress === mailAddress)) return problem(409, 'MAIL_ID_TAKEN');
      const seq = nextSeq();
      const now = timestamp();
      const employee: Employee = {
        operatorId: `OP-mock-${seq}`,
        employeeNo: `P${reg.startDate.slice(0, 4)}-${String(seq).padStart(5, '0')}`,
        name: reg.name,
        mailAddress,
        employmentType: reg.employmentType,
        affiliation: reg.affiliation,
        startDate: reg.startDate,
        ...(reg.endDate ? { endDate: reg.endDate } : {}),
        status: 'ACTIVE',
        provisioning: { step: 'REQUESTED', attempts: 0, updatedAt: now },
        requestedGrants: (reg.requestedGrants ?? []).map((g) => ({
          role: g.role,
          centers: g.centers ?? [],
          validFrom: g.validFrom ?? reg.startDate,
          ...((g.validTo ?? reg.endDate) ? { validTo: (g.validTo ?? reg.endDate)! } : {}),
          ...(g.reason ? { reason: g.reason } : {}),
          submission: 'PENDING' as const,
        })),
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      db.employees.set(employee.operatorId, { employee, ...(reg.mailId.startsWith('fail') ? { failAt: 'IAM_CREATED' as const } : {}) });
      return { status: 201, body: employee };
    });
  }),

  // /me 는 /:operatorId 보다 먼저 둔다
  http.get(`${API_BASE}/hr/employees/me`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const e = db.employees.get(who.subject)?.employee;
    if (!e) return problem(404, 'NOT_FOUND');
    return HttpResponse.json({
      operatorId: e.operatorId,
      employeeNo: e.employeeNo,
      name: e.name,
      mailAddress: e.mailAddress,
      employmentType: e.employmentType,
      affiliation: e.affiliation,
      status: e.status,
    });
  }),

  http.get(`${API_BASE}/hr/employees/:operatorId`, ({ request, params }) => {
    const m = find(request, params['operatorId']);
    if (m instanceof Response) return m;
    const shown = m.employee;
    advance(m); // 다음 조회 때 한 단계 나아간 모습이 보인다
    return HttpResponse.json(shown);
  }),

  reasonCommand('affiliation-changes', (m, body) => {
    if (!validAffiliation(body.affiliation)) return problem(400, 'VALIDATION_FAILED', [{ field: 'affiliation', reason: 'REQUIRED' }]);
    if (m.employee.status === 'LEFT') return problem(409, 'INVALID_STATE');
    const before = m.employee.affiliation;
    const changed = before.type !== body.affiliation.type || before.code !== body.affiliation.code;
    // hr 0.4.0: 발급 끝난 직원의 소속이 센터에서 바뀌면 그 센터가 든 권한을 다음 날 00:00(서울)에 끝낸다(목: 계정 grants 의 validUntil)
    if (changed && before.type === 'CENTER' && m.employee.provisioning.step === 'DONE') {
      const seoulToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
      const nextMidnight = new Date(Date.parse(`${seoulToday}T00:00:00+09:00`) + 24 * 3_600_000).toISOString();
      for (const g of db.accountGrants.get(m.employee.operatorId) ?? []) {
        if (!g.revokedAt && g.centers.includes(before.code) && (!g.validUntil || g.validUntil > nextMidnight)) g.validUntil = nextMidnight;
      }
    }
    return changed ? touch(m, { affiliation: body.affiliation }) : m.employee;
  }),

  reasonCommand('suspensions', (m) => {
    if (m.employee.status === 'LEFT') return problem(409, 'INVALID_STATE');
    return m.employee.status === 'SUSPENDED' ? m.employee : touch(m, { status: 'SUSPENDED' });
  }),

  reasonCommand('reinstatements', (m, body) => {
    if (m.employee.status === 'ACTIVE') return m.employee; // 이미 재직 — 바꾸지 않고 200
    // 파트타임·일일크루는 기존 계약 종료일이 지났으면 새 종료일이 필요하다(회신 2026-11-13 3절)
    const nextEnd = body.endDate ?? m.employee.endDate;
    if (m.employee.employmentType !== 'REGULAR' && (!nextEnd || nextEnd < new Date().toISOString().slice(0, 10))) {
      return problem(400, 'VALIDATION_FAILED', [{ field: 'endDate', reason: 'REQUIRED' }]);
    }
    return touch(m, { status: 'ACTIVE', ...(body.startDate ? { startDate: body.startDate } : {}), ...(body.endDate ? { endDate: body.endDate } : {}) });
  }),

  reasonCommand('departures', (m) => (m.employee.status === 'LEFT' ? m.employee : touch(m, { status: 'LEFT' }))),

  http.post(`${API_BASE}/hr/employees/:operatorId/invite-resends`, ({ request, params }) => {
    const m = find(request, params['operatorId']);
    if (m instanceof Response) return m;
    const step = m.employee.provisioning.step;
    if (m.employee.status !== 'ACTIVE' || (step !== 'INVITE_SENT' && step !== 'DONE')) return problem(409, 'INVALID_STATE');
    return new HttpResponse(null, { status: 202 });
  }),

  http.post(`${API_BASE}/hr/employees/:operatorId/provisioning-retries`, ({ request, params }) => {
    const m = find(request, params['operatorId']);
    if (m instanceof Response) return m;
    return idempotent(request, () => {
      const step = m.employee.provisioning.step;
      if (step !== 'FAILED' && step !== 'COMPENSATED') return problem(409, 'INVALID_STATE');
      delete m.failAt;
      m.employee = { ...m.employee, provisioning: { step: 'REQUESTED', attempts: 0, updatedAt: timestamp() } };
      return { status: 202, body: m.employee };
    });
  }),

  // 계약: 같은 Idempotency-Key 재전송도 결과를 재생하지 않는다(새로 발급). 응답은 저장하지 않는다.
  http.post(`${API_BASE}/hr/employees/:operatorId/mailbox-password-resets`, ({ request, params }) => {
    const m = find(request, params['operatorId']);
    if (m instanceof Response) return m;
    if (m.employee.provisioning.step === 'REQUESTED') return problem(409, 'INVALID_STATE'); // 사서함이 아직 없다
    return HttpResponse.json(
      { mailAddress: m.employee.mailAddress, initialPassword: `mock-${nextSeq()}-pw` },
      { headers: { 'cache-control': 'no-store' } },
    );
  }),
];
