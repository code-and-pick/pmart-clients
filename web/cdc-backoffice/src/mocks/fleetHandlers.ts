// fleet 0.2.0 목(운송사·차량·기사 — 센터 밖 경로) + transport-planning 노선 등록·정규차 지정.
// 노선 시각 검증(마지막 정차 도착 07:30)·같은 MFC 다른 노선(409 MFC_ALREADY_ROUTED)·차량 적격(409 VEHICLE_NOT_ELIGIBLE)은 간단히 흉내 — 판정은 서버.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components as F } from '../api/generated/fleet';
import type { components as Plan } from '../api/generated/transport-planning';
import { expectedVersion, idempotent, operator, problem, unauthorized } from './support';
import { guard, transportRoutes } from './transportHandlers';

type Fleet = F['schemas'];
type Route = Plan['schemas']['Route'];
type Temp = Fleet['TempClass'];

function seed() {
  const at = '2026-11-20T00:00:00Z';
  const carriers: Fleet['Carrier'][] = [
    { carrierId: 'CR-HANBIT', name: '한빛물류', active: true, createdAt: at },
    { carrierId: 'CR-DAON', name: '다온운송', active: true, createdAt: at },
  ];
  const v = (vehicleId: string, carrierId: string, plateNo: string, tempClass: Temp, maxRt: number, active = true): Fleet['Vehicle'] => ({
    vehicleId, carrierId, plateNo, contractType: 'REGULAR', tempClass, tonnage: 5, maxRt, maxWeightKg: 2500, active, version: 1, createdAt: at, updatedAt: at,
  });
  const vehicles: Fleet['Vehicle'][] = [
    v('VH-11', 'CR-HANBIT', '경기 81바 1101', 'CHILLED', 12),
    v('VH-12', 'CR-HANBIT', '경기 81바 1102', 'AMBIENT', 14),
    v('VH-21', 'CR-DAON', '경기 82사 2101', 'FROZEN', 10),
    v('VH-22', 'CR-DAON', '경기 82사 2102', 'CHILLED', 12),
    v('VH-31', 'CR-HANBIT', '경기 83아 3101', 'AMBIENT', 10),
    v('VH-32', 'CR-HANBIT', '경기 83아 3102', 'CHILLED', 10),
    v('VH-33', 'CR-DAON', '경기 83아 3103', 'FROZEN', 10),
    v('VH-40', 'CR-DAON', '경기 84자 4001', 'CHILLED', 16, false),
  ];
  const d = (driverId: string, carrierId: string, displayName: string, active = true): Fleet['Driver'] => ({ driverId, carrierId, displayName, active, version: 1, createdAt: at });
  const drivers: Fleet['Driver'][] = [
    d('DR-11', 'CR-HANBIT', '박기사'),
    d('DR-12', 'CR-HANBIT', '이기사'),
    d('DR-21', 'CR-DAON', '최기사'),
    d('DR-22', 'CR-DAON', '정기사'),
    d('DR-31', 'CR-HANBIT', '기사 31'),
    d('DR-32', 'CR-HANBIT', '기사 32'),
    d('DR-33', 'CR-DAON', '기사 33', false),
  ];
  return { carriers, vehicles, drivers };
}

let fleet = seed();
export function resetFleet() {
  fleet = seed();
}

const now = () => new Date().toISOString();
const signedIn = (request: Request) => (operator(request) ? null : unauthorized());
const bool = (q: URLSearchParams, k: string, v: boolean) => q.get(k) === null || q.get(k) === String(v);

export const fleetHandlers = [
  http.get(`${API_BASE}/carriers`, ({ request }) => signedIn(request) ?? HttpResponse.json({ items: fleet.carriers })),
  http.post(`${API_BASE}/carriers`, async ({ request }) => {
    const denied = signedIn(request);
    if (denied) return denied;
    const body = (await request.json()) as Fleet['CarrierInput'];
    return idempotent(request, () => {
      if (fleet.carriers.some((c) => c.carrierId === body.carrierId)) return problem(409, 'ALREADY_EXISTS');
      const c: Fleet['Carrier'] = { ...body, active: true, createdAt: now() };
      fleet.carriers.push(c);
      return { status: 201, body: c };
    });
  }),
  http.get(`${API_BASE}/vehicles`, ({ request }) => {
    const denied = signedIn(request);
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const eq = (k: string, v: string) => !q.get(k) || q.get(k) === v;
    return HttpResponse.json({ items: fleet.vehicles.filter((x) => eq('tempClass', x.tempClass) && eq('contractType', x.contractType) && eq('carrierId', x.carrierId) && bool(q, 'active', x.active)) });
  }),
  http.post(`${API_BASE}/vehicles`, async ({ request }) => {
    const denied = signedIn(request);
    if (denied) return denied;
    const body = (await request.json()) as Fleet['VehicleInput'];
    return idempotent(request, () => {
      if (fleet.vehicles.some((x) => x.vehicleId === body.vehicleId)) return problem(409, 'ALREADY_EXISTS');
      if (!fleet.carriers.some((c) => c.carrierId === body.carrierId)) return problem(400, 'VALIDATION_FAILED', [{ field: 'carrierId', reason: '없는 운송사' }]);
      const x: Fleet['Vehicle'] = { ...body, plateNo: body.plateNo ?? null, maxRt: body.maxRt ?? 20, maxWeightKg: body.maxWeightKg ?? 5000, active: true, version: 1, createdAt: now(), updatedAt: now() };
      fleet.vehicles.push(x);
      return { status: 201, body: x };
    });
  }),
  http.post(`${API_BASE}/vehicles/:vehicleId/changes`, async ({ request, params }) => {
    const denied = signedIn(request);
    if (denied) return denied;
    const x = fleet.vehicles.find((v) => v.vehicleId === params.vehicleId);
    if (!x) return problem(404, 'NOT_FOUND');
    const body = (await request.json()) as { plateNo?: string; maxRt?: number; maxWeightKg?: number; active?: boolean };
    return idempotent(request, () => {
      const ev = expectedVersion(request);
      if (ev !== undefined && ev !== x.version) return problem(409, 'VERSION_CONFLICT');
      if (body.plateNo !== undefined) x.plateNo = body.plateNo;
      if (body.maxRt !== undefined) x.maxRt = body.maxRt;
      if (body.maxWeightKg !== undefined) x.maxWeightKg = body.maxWeightKg;
      if (body.active !== undefined) x.active = body.active;
      x.version += 1;
      x.updatedAt = now();
      return { status: 200, body: x };
    });
  }),
  http.get(`${API_BASE}/drivers`, ({ request }) => {
    const denied = signedIn(request);
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    return HttpResponse.json({ items: fleet.drivers.filter((x) => (!q.get('carrierId') || x.carrierId === q.get('carrierId')) && bool(q, 'active', x.active)) });
  }),
  http.post(`${API_BASE}/drivers`, async ({ request }) => {
    const denied = signedIn(request);
    if (denied) return denied;
    const body = (await request.json()) as Fleet['DriverInput'];
    return idempotent(request, () => {
      if (fleet.drivers.some((x) => x.driverId === body.driverId)) return problem(409, 'ALREADY_EXISTS');
      const x: Fleet['Driver'] = { ...body, active: true, version: 1, createdAt: now() };
      fleet.drivers.push(x);
      return { status: 201, body: x };
    });
  }),
  http.post(`${API_BASE}/cdcs/:cdcId/routes`, async ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const body = (await request.json()) as Plan['schemas']['RouteInput'];
    return idempotent(request, () => {
      const routes = transportRoutes();
      if (routes.some((r) => r.routeId === body.routeId)) return problem(409, 'ALREADY_EXISTS');
      const taken = body.stops.find((s) => routes.some((r) => r.active && r.stops.some((x) => x.mfcId === s.mfcId)));
      if (taken) return problem(409, 'MFC_ALREADY_ROUTED', [{ field: 'stops', reason: taken.mfcId }]);
      let offset = 0;
      const stops = body.stops.map((s, i) => {
        offset += (i === 0 ? 0 : 30) + s.legMinutes;
        return { seq: i + 1, mfcId: s.mfcId, legMinutes: s.legMinutes, plannedArrivalOffsetMinutes: offset };
      });
      const [h = 0, m = 0] = body.departureTime.split(':').map(Number);
      const depMin = (h < 12 ? h + 24 : h) * 60 + m;
      if (depMin + offset > (24 + 7) * 60 + 30) return problem(400, 'ROUTE_TIME_INFEASIBLE');
      const r: Route = { routeId: body.routeId, cdcId: String(params.cdcId), name: body.name, departureTime: body.departureTime, returnMinutes: body.returnMinutes, active: true, stops, regularVehicles: [], version: 1 };
      routes.push(r);
      return { status: 201, body: r };
    });
  }),
  http.post(`${API_BASE}/cdcs/:cdcId/routes/:routeId/regular-vehicles`, async ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const r = transportRoutes().find((x) => x.routeId === params.routeId);
    if (!r) return problem(404, 'NOT_FOUND');
    const body = (await request.json()) as { tempClass: Temp; vehicleId: string; driverId: string };
    return idempotent(request, () => {
      const v = fleet.vehicles.find((x) => x.vehicleId === body.vehicleId);
      const dr = fleet.drivers.find((x) => x.driverId === body.driverId);
      if (!v || !v.active || v.contractType !== 'REGULAR' || v.tempClass !== body.tempClass) return problem(409, 'VEHICLE_NOT_ELIGIBLE');
      if (!dr || !dr.active) return problem(409, 'DRIVER_NOT_ELIGIBLE');
      r.regularVehicles = [...r.regularVehicles.filter((x) => x.tempClass !== body.tempClass), { tempClass: body.tempClass, vehicleId: v.vehicleId, driverId: dr.driverId, maxRt: v.maxRt, maxWeightKg: v.maxWeightKg }];
      r.version = (r.version ?? 0) + 1;
      return { status: 200, body: r };
    });
  }),
];
