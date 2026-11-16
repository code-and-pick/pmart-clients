// mfc-location-service 목(계약 mfc-location-service.yaml 0.7.1): 위치 목록·조회·등록·속성 변경·상태 변경(+결과 조회)·폐지.
// 서버 규칙 중 화면이 보여 줄 것만 흉내 낸다: 그 센터 권한(centers), 코드 중복·문법(새 등록만), 버전 충돌, 폐지는 CLOSED·재고 0 만.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components } from '../api/generated/mfc-location';
import { db, nextSeq, timestamp, type MockLocation } from './db';
import { expectedVersion, idempotent, operator, problem, unauthorized } from './support';

type LocationBody = components['schemas']['LocationBody'];

/** 선반·피킹 `{A/C/F}-{영문1+숫자1}-{2자리}-{1~9}-{2자리}`, 그 밖 `{접두}-{A/C/F}-{2자리}` (계약 LocationBody.locationCode, ADR-0042) */
const SHELF_CODE = /^([ACF])-([A-Z][0-9])-\d{2}-[1-9]-\d{2}$/;
const OTHER_CODE = /^(RCV|PAK|QRT|DSP|RTN|DSL|CRT)-([ACF])-\d{2}$/;
const TEMP_LETTER = { AMBIENT: 'A', CHILLED: 'C', FROZEN: 'F' } as const;

function codeValid(b: LocationBody): boolean {
  const letter = TEMP_LETTER[b.temperatureZone];
  if (b.zone === 'STORAGE' || b.zone === 'PICKING') {
    const m = SHELF_CODE.exec(b.locationCode);
    return !!m && m[1] === letter && (!b.areaCode || b.areaCode === m[2]);
  }
  const m = OTHER_CODE.exec(b.locationCode);
  return !!m && m[2] === letter;
}

const commandResponse = (requestId: string, loc: MockLocation) => ({
  status: 'APPLIED',
  requestId,
  resultId: loc.locationId,
  version: loc.version,
  occurredAt: loc.updatedAt,
});

/** 센터 권한: 토큰의 centers 에 그 센터가 있어야 한다(OPERATOR_ADMIN 도 따로 통과시키지 않는다 — 요청서 §2-1) */
function canAccess(request: Request, mfcId: string): boolean {
  return operator(request)?.centers.includes(mfcId) ?? false;
}

function found(request: Request, locationId: string): MockLocation | HttpResponse<Record<string, unknown>> {
  const loc = db.locations.get(locationId);
  if (!loc) return problem(404, 'NOT_FOUND');
  if (!canAccess(request, loc.mfcId)) return problem(403, 'FORBIDDEN');
  return loc;
}

export const locationHandlers = [
  http.get(`${API_BASE}/locations`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    const q = new URL(request.url).searchParams;
    const mfcId = q.get('mfcId') ?? '';
    if (!mfcId) return problem(400, 'VALIDATION_FAILED', [{ field: 'mfcId', reason: 'REQUIRED' }]);
    if (!canAccess(request, mfcId)) return problem(403, 'FORBIDDEN');
    const size = Number(q.get('size') ?? 50);
    const start = Number(q.get('cursor') ?? 0);
    const rows = [...db.locations.values()]
      .filter((l) => l.mfcId === mfcId)
      .filter((l) => !q.get('zone') || l.zone === q.get('zone'))
      .filter((l) => !q.get('temperatureZone') || l.temperatureZone === q.get('temperatureZone'))
      .filter((l) => !q.get('state') || l.state === q.get('state'))
      .sort((a, b) => a.locationCode.localeCompare(b.locationCode));
    const items = rows.slice(start, start + size);
    const next = start + size < rows.length ? String(start + size) : null;
    return HttpResponse.json({ items, page: { nextCursor: next, size } });
  }),

  http.post(`${API_BASE}/locations`, async ({ request }) => {
    if (!operator(request)) return unauthorized();
    const body = (await request.json()) as LocationBody;
    if (!canAccess(request, body.mfcId)) return problem(403, 'FORBIDDEN');
    return idempotent(request, () => {
      if ([...db.locations.values()].some((l) => l.mfcId === body.mfcId && l.locationCode === body.locationCode)) {
        return problem(409, 'LOCATION_CODE_DUPLICATE');
      }
      if (!codeValid(body)) return problem(400, 'LOCATION_CODE_INVALID', [{ field: 'locationCode', reason: 'INVALID_FORMAT' }]);
      const shelf = SHELF_CODE.exec(body.locationCode);
      const area = body.areaCode ?? shelf?.[2];
      const loc: MockLocation = {
        ...body,
        ...(area ? { areaCode: area } : {}),
        locationId: `LOC-${nextSeq()}`,
        version: 1,
        state: 'ACTIVE',
        stateReason: null,
        updatedAt: timestamp(),
        stockUnits: 0,
      };
      db.locations.set(loc.locationId, loc);
      return { status: 201, body: loc };
    });
  }),

  http.get(`${API_BASE}/locations/:locationId`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const loc = found(request, String(params.locationId));
    return loc instanceof Response ? loc : HttpResponse.json(loc);
  }),

  // 속성 변경 = 전체 교체(보내지 않은 값은 지워진다). 코드·센터는 바꿀 수 없다.
  http.put(`${API_BASE}/locations/:locationId`, async ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const loc = found(request, String(params.locationId));
    if (loc instanceof Response) return loc;
    const body = (await request.json()) as LocationBody;
    return idempotent(request, () => {
      if (expectedVersion(request) !== loc.version) return problem(409, 'VERSION_CONFLICT');
      if (body.locationCode !== loc.locationCode || body.mfcId !== loc.mfcId) {
        return problem(400, 'VALIDATION_FAILED', [{ field: 'locationCode', reason: 'NOT_ALLOWED' }]);
      }
      const next: MockLocation = {
        mfcId: loc.mfcId,
        locationCode: loc.locationCode,
        zone: body.zone,
        temperatureZone: body.temperatureZone,
        ...(body.areaCode ? { areaCode: body.areaCode } : {}),
        dimensions: body.dimensions ?? {},
        ...(body.pickSequence === undefined ? {} : { pickSequence: body.pickSequence }),
        categoryId: body.categoryId ?? null,
        position: body.position ?? null,
        highTurnover: body.highTurnover ?? false,
        locationId: loc.locationId,
        version: loc.version + 1,
        state: loc.state,
        stateReason: loc.stateReason ?? null,
        updatedAt: timestamp(),
        stockUnits: loc.stockUnits,
      };
      db.locations.set(next.locationId, next);
      return { status: 200, body: next };
    });
  }),

  http.post(`${API_BASE}/locations/:locationId/state-changes`, async ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const loc = found(request, String(params.locationId));
    if (loc instanceof Response) return loc;
    const body = (await request.json()) as { targetState: MockLocation['state']; reason: string };
    const requestId = request.headers.get('Idempotency-Key') ?? '';
    return idempotent(request, () => {
      if (expectedVersion(request) !== loc.version) return problem(409, 'VERSION_CONFLICT');
      if (loc.state === 'RETIRED') return problem(409, 'INVALID_STATE');
      const fromState = loc.state;
      const next: MockLocation = { ...loc, state: body.targetState, stateReason: body.reason, version: loc.version + 1, updatedAt: timestamp() };
      db.locations.set(next.locationId, next);
      db.locationStateChanges.set(`${next.locationId}/${requestId}`, { requestId, status: 'APPLIED', fromState, toState: next.state, newVersion: next.version });
      return { status: 202, body: commandResponse(requestId, next) };
    });
  }),

  http.get(`${API_BASE}/locations/:locationId/state-changes/:requestId`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const loc = found(request, String(params.locationId));
    if (loc instanceof Response) return loc;
    const change = db.locationStateChanges.get(`${loc.locationId}/${String(params.requestId)}`);
    return change ? HttpResponse.json(change) : problem(404, 'NOT_FOUND');
  }),

  // 폐지: CLOSED 만, 재고가 있으면 409 INVALID_STATE, 이미 RETIRED 면 202 지금 상태(계약 retireLocation)
  http.delete(`${API_BASE}/locations/:locationId`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const loc = found(request, String(params.locationId));
    if (loc instanceof Response) return loc;
    const requestId = request.headers.get('Idempotency-Key') ?? '';
    return idempotent(request, () => {
      if (loc.state === 'RETIRED') return { status: 202, body: commandResponse(requestId, loc) };
      if (expectedVersion(request) !== loc.version) return problem(409, 'VERSION_CONFLICT');
      if (loc.state !== 'CLOSED' || loc.stockUnits > 0) return problem(409, 'INVALID_STATE');
      const next: MockLocation = { ...loc, state: 'RETIRED', version: loc.version + 1, updatedAt: timestamp() };
      db.locations.set(next.locationId, next);
      return { status: 202, body: commandResponse(requestId, next) };
    });
  }),
];
