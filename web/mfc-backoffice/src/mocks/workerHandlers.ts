// 작업자 목: mfc-capacity-service 0.14.0 `/mfcs/{id}/workers*`.
// 서버 규칙 중 화면이 보여 줄 것만: 그 센터 권한, 관리 = MFC_SUPERVISOR(휴게·일일크루 출근은 본인도), 중복 등록 409, 업무는 자격 안(422),
// 업무·자격 버전 409, 상태·업무 변경 시 맞지 않는 ACTIVE 배정 알림, 근무 겹침 409·16시간, 일일크루가 아니면 출근 등록 422.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components } from '../api/generated/mfc-capacity';
import { db, nextSeq, timestamp, type MockAssignment, type MockShift, type MockWorker, type TaskType } from './db';
import { expectedVersion, idempotent, operator, problem, unauthorized } from './support';

type Cap = components['schemas'];

/** 업무 묶음(계약 WorkArea 설명) */
const AREAS: ReadonlyArray<[Cap['WorkArea'], readonly TaskType[]]> = [
  ['INBOUND', ['RECEIVE']],
  ['INSPECTION', ['INSPECT']],
  ['STOCK_MOVE', ['PUTAWAY', 'REPLENISH', 'MOVE', 'RETURN']],
  ['STOCK_COUNT', []],
  ['PICK_PACK', ['PICK', 'PACK']],
];

const expired = (w: MockWorker) => w.qualification.expiresAt !== null && Date.parse(w.qualification.expiresAt) <= Date.now();

/** 지금 배정 조건 = 업무 ∩ 유효 자격(일일크루는 오늘 출근 등록한 날만 — 그날 업무 = 유효 자격 전부) */
function effective(w: MockWorker): TaskType[] {
  const qual = expired(w) ? [] : w.qualification.taskTypes;
  if (w.employmentType === 'DAILY') return w.enrolledToday ? [...qual] : [];
  return w.duties[0]!.taskTypes.filter((t) => qual.includes(t));
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

function toWorker(w: MockWorker): Cap['Worker'] {
  const eff = effective(w);
  return {
    mfcId: w.mfcId,
    workerId: w.workerId,
    displayName: w.displayName,
    state: w.state,
    duty: w.duties[0]!,
    employmentType: w.employmentType,
    qualification: { ...w.qualification, taskTypes: [...w.qualification.taskTypes], expired: expired(w) },
    effectiveTaskTypes: eff,
    workAreas: AREAS.filter(([, types]) => types.some((t) => eff.includes(t))).map(([a]) => a),
    todayEnrollment: w.enrolledToday
      ? { workerId: w.workerId, businessDate: today(), dutyTaskTypes: [...w.qualification.taskTypes], enrolledBy: w.workerId, enrolledAt: timestamp() }
      : null,
    onBreak: w.onBreak,
    speedFactor: w.speedFactor,
    registeredBy: w.registeredBy,
    registeredAt: w.registeredAt,
  };
}

const toDetail = (w: MockWorker): Cap['WorkerDetail'] => ({ ...toWorker(w), dutyHistory: [...w.duties], stateHistory: [...w.stateHistory] });

const key = (mfcId: string, workerId: string) => `${mfcId}/${workerId}`;
const isSupervisor = (request: Request) => operator(request)?.roles.includes('MFC_SUPERVISOR') ?? false;
const canAccess = (request: Request, mfcId: string) => operator(request)?.centers.includes(mfcId) ?? false;

/** 센터 권한 + 작업자 찾기. manage = 관리자만, self = 본인도 */
function found(request: Request, params: Record<string, unknown>, who: 'read' | 'manage' | 'self'): MockWorker | HttpResponse<Record<string, unknown>> {
  const mfcId = String(params.mfcId);
  if (!canAccess(request, mfcId)) return problem(403, 'FORBIDDEN');
  const w = db.workers.get(key(mfcId, String(params.workerId)));
  if (!w) return problem(404, 'NOT_FOUND');
  if (who === 'manage' && !isSupervisor(request)) return problem(403, 'FORBIDDEN');
  if (who === 'self' && !isSupervisor(request) && operator(request)?.subject !== w.workerId) return problem(403, 'FORBIDDEN');
  return w;
}

const save = (w: MockWorker) => db.workers.set(key(w.mfcId, w.workerId), w);
const actor = (request: Request) => operator(request)?.subject ?? '';

/** 새 업무·상태에 맞지 않는 ACTIVE 배정(지우지 않는다) */
function affected(w: MockWorker): MockAssignment[] {
  const eff = effective(w);
  return db.assignments.filter((a) => a.mfcId === w.mfcId && a.workerId === w.workerId && a.state === 'ACTIVE' && (w.state !== 'ACTIVE' || !eff.includes(a.taskType as TaskType)));
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

const base = `${API_BASE}/mfcs/:mfcId/workers`;

export const workerHandlers = [
  http.get(base, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const mfcId = String(params.mfcId);
    if (!canAccess(request, mfcId)) return problem(403, 'FORBIDDEN');
    const state = new URL(request.url).searchParams.get('state');
    const items = [...db.workers.values()]
      .filter((w) => w.mfcId === mfcId && (state ? w.state === state : w.state !== 'LEFT'))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ko'))
      .map(toWorker);
    return HttpResponse.json({ items });
  }),

  http.post(base, async ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const mfcId = String(params.mfcId);
    if (!canAccess(request, mfcId) || !isSupervisor(request)) return problem(403, 'FORBIDDEN');
    const body = (await request.json()) as {
      workerId: string;
      displayName: string;
      employmentType?: Cap['EmploymentType'];
      qualification?: { taskTypes: TaskType[]; expiresAt?: string | null };
      duty: { taskTypes: TaskType[] };
    };
    return idempotent(request, () => {
      if (db.workers.has(key(mfcId, body.workerId))) return problem(409, 'WORKER_ALREADY_REGISTERED');
      const employmentType = body.employmentType ?? 'REGULAR';
      const qual = body.qualification?.taskTypes ?? (employmentType === 'DAILY' ? ['PICK', 'PACK'] : body.duty.taskTypes);
      if (body.duty.taskTypes.some((t) => !qual.includes(t))) return problem(422, 'DUTY_OUTSIDE_QUALIFICATION');
      const at = timestamp();
      const w: MockWorker = {
        mfcId,
        workerId: body.workerId,
        displayName: body.displayName,
        employmentType,
        state: 'ACTIVE',
        duties: [{ dutyVersion: 1, taskTypes: body.duty.taskTypes, changedBy: actor(request), changedAt: at, reason: null }],
        qualification: { qualificationVersion: 1, taskTypes: qual, expiresAt: body.qualification?.expiresAt ?? null, changedBy: actor(request), changedAt: at },
        stateHistory: [{ fromState: null, toState: 'ACTIVE', reason: null, changedBy: actor(request), changedAt: at }],
        speedFactor: 1,
        onBreak: false,
        enrolledToday: false,
        registeredBy: actor(request),
        registeredAt: at,
      };
      save(w);
      return { status: 201, body: toWorker(w) };
    });
  }),

  http.get(`${base}/:workerId`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const w = found(request, params, 'read');
    return w instanceof Response ? w : HttpResponse.json(toDetail(w));
  }),

  http.post(`${base}/:workerId/duty-changes`, async ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const w = found(request, params, 'manage');
    if (w instanceof Response) return w;
    const body = (await request.json()) as { taskTypes: TaskType[]; reason: string };
    return idempotent(request, () => {
      const current = w.duties[0]!;
      if (expectedVersion(request) !== current.dutyVersion) return problem(409, 'VERSION_CONFLICT');
      if (sameSet(current.taskTypes, body.taskTypes)) return { status: 200, body: { worker: toWorker(w), changed: false, affectedAssignments: affected(w) } };
      const next: MockWorker = {
        ...w,
        duties: [{ dutyVersion: current.dutyVersion + 1, taskTypes: body.taskTypes, changedBy: actor(request), changedAt: timestamp(), reason: body.reason }, ...w.duties],
      };
      save(next);
      return { status: 200, body: { worker: toWorker(next), changed: true, affectedAssignments: affected(next) } };
    });
  }),

  http.post(`${base}/:workerId/qualification-changes`, async ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const w = found(request, params, 'manage');
    if (w instanceof Response) return w;
    const body = (await request.json()) as { taskTypes: TaskType[]; expiresAt?: string | null };
    return idempotent(request, () => {
      if (expectedVersion(request) !== w.qualification.qualificationVersion) return problem(409, 'VERSION_CONFLICT');
      const next: MockWorker = {
        ...w,
        qualification: {
          qualificationVersion: w.qualification.qualificationVersion + 1,
          taskTypes: body.taskTypes,
          expiresAt: body.expiresAt ?? null,
          changedBy: actor(request),
          changedAt: timestamp(),
        },
      };
      save(next);
      return { status: 200, body: toWorker(next) };
    });
  }),

  http.post(`${base}/:workerId/state-changes`, async ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const w = found(request, params, 'manage');
    if (w instanceof Response) return w;
    const body = (await request.json()) as { state: Cap['WorkerState']; reason: string };
    return idempotent(request, () => {
      if (w.state === body.state) return { status: 200, body: { worker: toWorker(w), changed: false, affectedAssignments: [] } };
      const next: MockWorker = {
        ...w,
        state: body.state,
        stateHistory: [{ fromState: w.state, toState: body.state, reason: body.reason, changedBy: actor(request), changedAt: timestamp() }, ...w.stateHistory],
      };
      save(next);
      return { status: 200, body: { worker: toWorker(next), changed: true, affectedAssignments: affected(next) } };
    });
  }),

  http.post(`${base}/:workerId/speed-changes`, async ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const w = found(request, params, 'manage');
    if (w instanceof Response) return w;
    const body = (await request.json()) as { speedFactor: number; reason: string };
    if (!(body.speedFactor >= 0.5 && body.speedFactor <= 2)) return problem(400, 'VALIDATION_FAILED', [{ field: 'speedFactor', reason: 'INVALID_FORMAT' }]);
    return idempotent(request, () => {
      const next: MockWorker = { ...w, speedFactor: body.speedFactor };
      save(next);
      return { status: 200, body: toWorker(next) };
    });
  }),

  http.post(`${base}/:workerId/breaks`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const w = found(request, params, 'self');
    if (w instanceof Response) return w;
    return idempotent(request, () => {
      save({ ...w, onBreak: true });
      return { status: 200, body: { breakId: `BRK-${nextSeq()}`, workerId: w.workerId, startedAt: timestamp(), startedBy: actor(request), endedAt: null } };
    });
  }),

  http.post(`${base}/:workerId/breaks/current/end`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const w = found(request, params, 'self');
    if (w instanceof Response) return w;
    return idempotent(request, () => {
      save({ ...w, onBreak: false });
      return { status: 200, body: { breakId: `BRK-${nextSeq()}`, workerId: w.workerId, startedAt: timestamp(), startedBy: w.workerId, endedAt: timestamp() } };
    });
  }),

  http.post(`${base}/:workerId/day-enrollments`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const w = found(request, params, 'self');
    if (w instanceof Response) return w;
    return idempotent(request, () => {
      if (w.employmentType !== 'DAILY') return problem(422, 'NOT_DAILY_CREW');
      if (w.state !== 'ACTIVE') return problem(422, 'WORKER_NOT_ACTIVE');
      const next = { ...w, enrolledToday: true };
      save(next);
      return { status: 200, body: toWorker(next).todayEnrollment };
    });
  }),

  http.get(`${base}/:workerId/shifts`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const w = found(request, params, 'read');
    if (w instanceof Response) return w;
    const items = [...db.shifts.values()]
      .filter((s) => s.mfcId === w.mfcId && s.workerId === w.workerId && s.state === 'PLANNED')
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    return HttpResponse.json({ items });
  }),

  http.post(`${base}/:workerId/shifts`, async ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const w = found(request, params, 'manage');
    if (w instanceof Response) return w;
    const body = (await request.json()) as { startAt: string; endAt: string; note?: string };
    return idempotent(request, () => {
      const start = Date.parse(body.startAt);
      const end = Date.parse(body.endAt);
      if (!(end > start) || end - start > 16 * 3600_000) return problem(400, 'VALIDATION_FAILED', [{ field: 'endAt', reason: 'INVALID_FORMAT' }]);
      const overlap = [...db.shifts.values()].some(
        (s) => s.workerId === w.workerId && s.mfcId === w.mfcId && s.state === 'PLANNED' && Date.parse(s.startAt) < end && start < Date.parse(s.endAt),
      );
      if (overlap) return problem(409, 'SHIFT_OVERLAP');
      const shift: MockShift = {
        shiftId: `SHIFT-${nextSeq()}`,
        mfcId: w.mfcId,
        workerId: w.workerId,
        startAt: new Date(start).toISOString(),
        endAt: new Date(end).toISOString(),
        state: 'PLANNED',
        note: body.note ?? null,
        createdBy: actor(request),
        cancelReason: null,
      };
      db.shifts.set(shift.shiftId, shift);
      return { status: 201, body: shift };
    });
  }),

  http.post(`${base}/:workerId/shifts/:shiftId/cancellations`, async ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const w = found(request, params, 'manage');
    if (w instanceof Response) return w;
    const shift = db.shifts.get(String(params.shiftId));
    if (!shift || shift.workerId !== w.workerId) return problem(404, 'NOT_FOUND');
    const body = (await request.json()) as { reason: string };
    return idempotent(request, () => {
      const next: MockShift = shift.state === 'CANCELLED' ? shift : { ...shift, state: 'CANCELLED', cancelReason: body.reason };
      db.shifts.set(next.shiftId, next);
      return { status: 200, body: next };
    });
  }),
];
