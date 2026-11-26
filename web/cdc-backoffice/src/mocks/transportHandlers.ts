// transport-planning 0.2.0·transport-execution 0.2.0 목 — 노선·운송지시서(배차)·이관요청서(잔여 물량)·운행(TMS 1단계).
// 출고일은 오늘(Asia/Seoul) 로 만든다. 상태 전이는 계약 설명 그대로(입차 → 상차완료 → 출차 → 정차 도착·인계·출발 → 복귀).
// 지연(delayed)·인계 대조(MATCHED/MISMATCHED)는 서버 판정 — 목은 간단히 흉내만 낸다.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components as Exec } from '../api/generated/transport-execution';
import type { components as Plan } from '../api/generated/transport-planning';
import { expectedVersion, idempotent, operator, problem, unauthorized } from './support';

type Trip = Exec['schemas']['Trip'];
type Order = Plan['schemas']['TransportOrder'];
type Req = Plan['schemas']['TransportRequest'];
type Route = Plan['schemas']['Route'];

export const mockShipDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

/** 출고일 D 의 서울 시각(day=1 이면 D+1) → ISO */
function kst(d: string, h: number, min = 0, day = 0) {
  const base = new Date(`${d}T00:00:00+09:00`).getTime();
  return new Date(base + ((day * 24 + h) * 60 + min) * 60_000).toISOString();
}

function seed() {
  const d = mockShipDate();
  const n = d.replaceAll('-', '');
  const id = (i: number) => `TO-${n}-00${i}`;
  const routes: Route[] = [
    { routeId: 'RT-01', cdcId: 'CDC01', name: '북부 1', departureTime: '22:00', returnMinutes: 90, active: true, version: 1, stops: [{ seq: 1, mfcId: 'MFC-BJG-01', legMinutes: 60, plannedArrivalOffsetMinutes: 60 }, { seq: 2, mfcId: 'MFC-BNG-01', legMinutes: 40, plannedArrivalOffsetMinutes: 130 }], regularVehicles: [{ tempClass: 'CHILLED', vehicleId: 'VH-11', driverId: 'DR-11', maxRt: 12, maxWeightKg: 2500 }, { tempClass: 'AMBIENT', vehicleId: 'VH-12', driverId: 'DR-12', maxRt: 14, maxWeightKg: 3000 }] },
    { routeId: 'RT-02', cdcId: 'CDC01', name: '세종·충청', departureTime: '23:00', returnMinutes: 120, active: true, version: 1, stops: [{ seq: 1, mfcId: 'MFC-SEJ-01', legMinutes: 90, plannedArrivalOffsetMinutes: 90 }, { seq: 2, mfcId: 'MFC-CHC-01', legMinutes: 60, plannedArrivalOffsetMinutes: 180 }], regularVehicles: [{ tempClass: 'FROZEN', vehicleId: 'VH-21', driverId: 'DR-21', maxRt: 10, maxWeightKg: 2500 }, { tempClass: 'CHILLED', vehicleId: 'VH-22', driverId: 'DR-22', maxRt: 12, maxWeightKg: 2500 }] },
    { routeId: 'RT-03', cdcId: 'CDC01', name: '남부', departureTime: '00:30', returnMinutes: 200, active: true, version: 1, stops: [{ seq: 1, mfcId: 'MFC-MOKPO-01', legMinutes: 240, plannedArrivalOffsetMinutes: 240 }], regularVehicles: [{ tempClass: 'AMBIENT', vehicleId: 'VH-31', driverId: 'DR-31', maxRt: 10, maxWeightKg: 2500 }, { tempClass: 'CHILLED', vehicleId: 'VH-32', driverId: 'DR-32', maxRt: 10, maxWeightKg: 2500 }] },
  ];
  const ho = (shipped: number, missing: string[] = []) => ({ handoverId: `HO-${Math.round(shipped * 7)}`, result: missing.length ? ('MISMATCHED' as const) : ('MATCHED' as const), shippedBoxes: shipped, receivedBoxes: shipped - missing.length, missingLpns: missing, extraLpns: [], damagedLpns: [], receiverId: 'OP-mfc-1', receiverName: '김인수' });
  const trips: Trip[] = [
    {
      tripId: id(1), cdcId: 'CDC01', shipDate: d, routeId: 'RT-01', tempClass: 'CHILLED', vehicleId: 'VH-11', plateNo: '경기 81바 1101', driverId: 'DR-11', driverName: '박기사', state: 'DEPARTED', delayed: true,
      plannedLoadingStartAt: kst(d, 21, 30), plannedDepartureAt: kst(d, 22), plannedReturnAt: kst(d, 2, 0, 1), checkedInAt: kst(d, 21, 20), loadedAt: kst(d, 21, 55), departedAt: kst(d, 22, 5), endedAt: null,
      departureId: 'DEP-0001', outboundLinkage: 'ACKNOWLEDGED', outboundResult: 'MATCHED', trfCount: 2, boxCount: 14, rtCount: 6,
      stops: [
        { seq: 1, mfcId: 'MFC-BJG-01', state: 'DEPARTED', trfIds: ['TRF-20261126-0001'], plannedArrivalAt: kst(d, 23), estimatedArrivalAt: kst(d, 23, 5), arrivedAt: kst(d, 23, 5), handedOverAt: kst(d, 23, 25), departedAt: kst(d, 23, 35), delayed: false, handover: ho(8) },
        { seq: 2, mfcId: 'MFC-BNG-01', state: 'PLANNED', trfIds: ['TRF-20261126-0002'], plannedArrivalAt: kst(d, 0, 10, 1), estimatedArrivalAt: kst(d, 0, 50, 1), arrivedAt: null, handedOverAt: null, departedAt: null, delayed: true, handover: null },
      ],
      transfers: [
        { trfId: 'TRF-20261126-0001', stopSeq: 1, loaded: true, lpns: ['LPN-A01', 'LPN-A02', 'LPN-A03', 'LPN-A04', 'LPN-A05', 'LPN-A06', 'LPN-A07', 'LPN-A08'], rtCount: 3 },
        { trfId: 'TRF-20261126-0002', stopSeq: 2, loaded: true, lpns: ['LPN-B01', 'LPN-B02', 'LPN-B03', 'LPN-B04', 'LPN-B05', 'LPN-B06'], rtCount: 3 },
      ],
      events: [
        { at: kst(d, 21, 20), type: 'CHECKED_IN', stopSeq: null, location: 'DC 정문', temperatureC: 3.1, actorId: 'OP-cdc-sup', source: 'REAL' },
        { at: kst(d, 22, 5), type: 'DEPARTED', stopSeq: null, location: null, temperatureC: 2.8, actorId: 'OP-cdc-sup', source: 'REAL' },
        { at: kst(d, 23, 5), type: 'STOP_ARRIVED', stopSeq: 1, location: null, temperatureC: null, actorId: null, source: 'SIMULATED' },
      ],
      incidents: [{ incidentId: 'INC-1', type: 'DELAY', stopSeq: 2, state: 'OPEN', description: '고속도로 정체', resolution: null, raisedAt: kst(d, 23, 40), resolvedAt: null }],
      version: 6,
    },
    {
      tripId: id(2), cdcId: 'CDC01', shipDate: d, routeId: 'RT-01', tempClass: 'AMBIENT', vehicleId: 'VH-12', plateNo: '경기 81바 1102', driverId: 'DR-12', driverName: '이기사', state: 'CHECKED_IN', delayed: false,
      plannedLoadingStartAt: kst(d, 21, 30), plannedDepartureAt: kst(d, 22), plannedReturnAt: kst(d, 2, 0, 1), checkedInAt: kst(d, 21, 25), loadedAt: null, departedAt: null, endedAt: null,
      departureId: null, outboundLinkage: null, outboundResult: null, trfCount: 1, boxCount: 0, rtCount: 0,
      stops: [{ seq: 1, mfcId: 'MFC-BJG-01', state: 'PLANNED', trfIds: ['TRF-20261126-0003'], plannedArrivalAt: kst(d, 23), estimatedArrivalAt: null, arrivedAt: null, handedOverAt: null, departedAt: null, delayed: false, handover: null }],
      transfers: [{ trfId: 'TRF-20261126-0003', stopSeq: 1, loaded: false, lpns: [], rtCount: null }],
      events: [{ at: kst(d, 21, 25), type: 'CHECKED_IN', stopSeq: null, location: null, temperatureC: null, actorId: 'OP-cdc-sup', source: 'REAL' }],
      incidents: [],
      version: 2,
    },
    {
      tripId: id(3), cdcId: 'CDC01', shipDate: d, routeId: 'RT-02', tempClass: 'FROZEN', vehicleId: 'VH-21', plateNo: '경기 82사 2101', driverId: 'DR-21', driverName: '최기사', state: 'SCHEDULED', delayed: false,
      plannedLoadingStartAt: kst(d, 22, 30), plannedDepartureAt: kst(d, 23), plannedReturnAt: kst(d, 4, 0, 1), checkedInAt: null, loadedAt: null, departedAt: null, endedAt: null,
      departureId: null, outboundLinkage: null, outboundResult: null, trfCount: 2, boxCount: 0, rtCount: 0,
      stops: [
        { seq: 1, mfcId: 'MFC-SEJ-01', state: 'PLANNED', trfIds: ['TRF-20261126-0004'], plannedArrivalAt: kst(d, 0, 30, 1), estimatedArrivalAt: null, arrivedAt: null, handedOverAt: null, departedAt: null, delayed: false, handover: null },
        { seq: 2, mfcId: 'MFC-CHC-01', state: 'PLANNED', trfIds: ['TRF-20261126-0005'], plannedArrivalAt: kst(d, 2, 0, 1), estimatedArrivalAt: null, arrivedAt: null, handedOverAt: null, departedAt: null, delayed: false, handover: null },
      ],
      transfers: [
        { trfId: 'TRF-20261126-0004', stopSeq: 1, loaded: false, lpns: [], rtCount: null },
        { trfId: 'TRF-20261126-0005', stopSeq: 2, loaded: false, lpns: [], rtCount: null },
      ],
      events: [],
      incidents: [],
      version: 1,
    },
    {
      tripId: id(4), cdcId: 'CDC01', shipDate: d, routeId: 'RT-02', tempClass: 'CHILLED', vehicleId: 'VH-22', plateNo: '경기 82사 2102', driverId: 'DR-22', driverName: '정기사', state: 'COMPLETED', delayed: false,
      plannedLoadingStartAt: kst(d, 18, 30), plannedDepartureAt: kst(d, 19), plannedReturnAt: kst(d, 23, 30), checkedInAt: kst(d, 18, 20), loadedAt: kst(d, 18, 50), departedAt: kst(d, 19), endedAt: kst(d, 23, 10),
      departureId: 'DEP-0000', outboundLinkage: 'ACKNOWLEDGED', outboundResult: 'MATCHED', trfCount: 1, boxCount: 5, rtCount: 2,
      stops: [{ seq: 1, mfcId: 'MFC-SEJ-01', state: 'DEPARTED', trfIds: ['TRF-20261125-0009'], plannedArrivalAt: kst(d, 20, 30), estimatedArrivalAt: kst(d, 20, 35), arrivedAt: kst(d, 20, 35), handedOverAt: kst(d, 20, 55), departedAt: kst(d, 21), delayed: false, handover: ho(5, ['LPN-C05']) }],
      transfers: [{ trfId: 'TRF-20261125-0009', stopSeq: 1, loaded: true, lpns: ['LPN-C01', 'LPN-C02', 'LPN-C03', 'LPN-C04', 'LPN-C05'], rtCount: 2 }],
      events: [],
      incidents: [{ incidentId: 'INC-0', type: 'QTY_MISMATCH', stopSeq: 1, state: 'OPEN', description: '부족 1박스(LPN-C05)', resolution: null, raisedAt: kst(d, 20, 55), resolvedAt: null }],
      version: 9,
    },
  ];
  const fromTrip = (x: Trip, loadRt: number, maxRt: number): Order => ({
    orderId: x.tripId, cdcId: 'CDC01', shipDate: d, routeId: x.routeId, tempClass: x.tempClass, contractType: 'REGULAR', vehicleId: x.vehicleId ?? null, driverId: x.driverId ?? null,
    maxRt, maxWeightKg: 2500, loadRt, loadWeightKg: loadRt * 80, loadRatio: loadRt / maxRt,
    ...(x.plannedLoadingStartAt ? { plannedLoadingStartAt: x.plannedLoadingStartAt } : {}),
    ...(x.plannedDepartureAt ? { plannedDepartureAt: x.plannedDepartureAt } : {}),
    ...(x.plannedReturnAt ? { plannedReturnAt: x.plannedReturnAt } : {}),
    stops: x.stops.map((s) => ({ seq: s.seq ?? 0, mfcId: s.mfcId ?? '', ...(s.plannedArrivalAt ? { plannedArrivalAt: s.plannedArrivalAt } : {}), trfIds: s.trfIds ?? [], boxCount: 0, rtCount: 0 })),
    trfIds: x.stops.flatMap((s) => s.trfIds ?? []), cancelCandidate: false, flags: [], state: 'DISPATCHED', reservationId: `RSV-${x.vehicleId}`, tripState: x.state, reason: null, version: 3,
    history: [{ at: kst(d, 20), action: 'GENERATED', actorId: 'OP-cdc-sup', detail: null, version: 1 }, { at: kst(d, 20, 30), action: 'CONFIRMED', actorId: 'OP-cdc-sup', detail: null, version: 3 }],
    createdAt: kst(d, 20), updatedAt: kst(d, 20, 30),
  });
  const planning = (i: number, routeId: string, tempClass: Order['tempClass'], dep: string, mfcId: string, trfIds: string[], loadRt: number, maxRt: number, vehicleId: string): Order => ({
    orderId: id(i), cdcId: 'CDC01', shipDate: d, routeId, tempClass, contractType: 'REGULAR', vehicleId, driverId: vehicleId.replace('VH', 'DR'), maxRt, maxWeightKg: 2500, loadRt, loadWeightKg: loadRt * 80, loadRatio: loadRt / maxRt,
    plannedLoadingStartAt: kst(d, 0, 0, 1), plannedDepartureAt: dep, plannedReturnAt: kst(d, 8, 0, 1),
    stops: [{ seq: 1, mfcId, plannedArrivalAt: kst(d, 4, 30, 1), trfIds, boxCount: loadRt * 2, rtCount: loadRt }],
    trfIds, cancelCandidate: trfIds.length === 0, flags: loadRt > maxRt ? ['OVER_CAPACITY'] : [], state: 'PLANNING', reservationId: null, tripState: null, reason: null, version: 1,
    history: [{ at: kst(d, 20), action: 'GENERATED', actorId: 'OP-cdc-sup', detail: null, version: 1 }], createdAt: kst(d, 20), updatedAt: kst(d, 20),
  });
  const orders: Order[] = [
    fromTrip(trips[3]!, 2, 12),
    fromTrip(trips[0]!, 6, 12),
    fromTrip(trips[1]!, 4, 14),
    fromTrip(trips[2]!, 7, 10),
    planning(5, 'RT-03', 'AMBIENT', kst(d, 0, 30, 1), 'MFC-MOKPO-01', ['TRF-20261126-0006'], 6, 10, 'VH-31'),
    planning(6, 'RT-03', 'CHILLED', kst(d, 0, 30, 1), 'MFC-MOKPO-01', ['TRF-20261126-0007', 'TRF-20261126-0008'], 13, 10, 'VH-32'),
  ];
  const req = (trfId: string, mfcId: string, state: Req['state'], reason: string | null, orderId: string | null, extra: Partial<Req> = {}): Req => ({
    trfId, trfNumber: `T+${trfId.slice(-2)}`, trfVersion: 1, cdcId: 'CDC01', mfcId, shipDate: d, dueAt: kst(d, 9, 0, 1), tempClass: 'AMBIENT', tempClasses: ['AMBIENT'], allocationState: 'ALLOCATED',
    approvedQty: 120, acceptedQty: 120, boxCount: 12, rtCount: 4, weightKg: 320, state, reason, lateReceipt: false, orderId, receivedAt: kst(d, 20), updatedAt: kst(d, 20), ...extra,
  });
  const requests: Req[] = [
    req('TRF-20261126-0006', 'MFC-MOKPO-01', 'ACCEPTED', null, id(5)),
    req('TRF-20261126-0007', 'MFC-MOKPO-01', 'ACCEPTED', null, id(6), { tempClass: 'CHILLED', tempClasses: ['CHILLED'] }),
    req('TRF-20261126-0008', 'MFC-MOKPO-01', 'ACCEPTED', null, id(6), { tempClass: 'CHILLED', tempClasses: ['CHILLED'] }),
    req('TRF-20261126-0010', 'MFC-GANG-01', 'HELD', 'NO_ROUTE', null),
    req('TRF-20261126-0011', 'MFC-BJG-01', 'HELD', 'MIXED_TEMPERATURE', null, { tempClass: null, tempClasses: ['AMBIENT', 'CHILLED'] }),
    req('TRF-20261126-0012', 'MFC-BNG-01', 'HELD', 'ALLOCATION_PENDING', null, { allocationState: 'ALLOCATING', acceptedQty: 0, rtCount: null, lateReceipt: true }),
  ];
  return { routes, trips, orders, requests, seq: 6 };
}

let store = seed();
/** 노선 등록·정규차 지정 목(fleetHandlers)이 같은 노선 목록을 쓴다 */
export const transportRoutes = () => store.routes;

export function resetTransport() {
  store = seed();
}

export function guard(request: Request, cdcId: string) {
  const who = operator(request);
  if (!who) return unauthorized();
  if (!who.centers.includes(cdcId)) return problem(403, 'FORBIDDEN');
  return null;
}

const page = <T,>(rows: T[], q: URLSearchParams) => {
  const p = Number(q.get('page') ?? '0');
  const size = Number(q.get('size') ?? '50');
  return { items: rows.slice(p * size, p * size + size), page: p, size, hasNext: (p + 1) * size < rows.length };
};

const byDeparture = (a: { plannedDepartureAt?: string; routeId: string }, b: { plannedDepartureAt?: string; routeId: string }) =>
  (a.plannedDepartureAt ?? '').localeCompare(b.plannedDepartureAt ?? '') || a.routeId.localeCompare(b.routeId);

const now = () => new Date().toISOString();

function tripOp(path: string, run: (x: Trip, body: Record<string, unknown>, stopSeq: number) => Trip | HttpResponse<Record<string, unknown>>) {
  return http.post(`${API_BASE}/trips/:tripId${path}`, async ({ request, params }) => {
    const x = store.trips.find((t) => t.tripId === params.tripId);
    if (!x) return problem(404, 'NOT_FOUND');
    const denied = guard(request, x.cdcId);
    if (denied) return denied;
    const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    return idempotent(request, () => {
      const r = run(x, body, Number(params.stopSeq ?? 0));
      if (r instanceof Response) return r;
      r.version = (r.version ?? 0) + 1;
      const o = store.orders.find((o2) => o2.orderId === r.tripId);
      if (o) o.tripState = r.state;
      return { status: 200, body: r };
    });
  });
}

const event = (x: Trip, type: string, stopSeq: number | null = null) => (x.events ??= []).push({ at: now(), type, stopSeq, location: null, temperatureC: null, actorId: 'OP-cdc-sup', source: 'REAL' });

function orderOp(path: string, run: (o: Order, body: Record<string, unknown>, request: Request) => Order | HttpResponse<Record<string, unknown>>) {
  return http.post(`${API_BASE}/cdcs/:cdcId/transport-orders/:orderId${path}`, async ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const o = store.orders.find((x) => x.orderId === params.orderId);
    if (!o) return problem(404, 'NOT_FOUND');
    const body = (await request.json()) as Record<string, unknown>;
    return idempotent(request, () => {
      const v = expectedVersion(request);
      if (v !== undefined && v !== o.version) return problem(409, 'VERSION_CONFLICT');
      const r = run(o, body, request);
      if (r instanceof Response) return r;
      r.version += 1;
      r.updatedAt = now();
      (r.history ??= []).push({ at: now(), action: path.slice(1).toUpperCase(), actorId: operator(request)?.subject ?? null, detail: (body.reason as string | undefined) ?? null, version: r.version });
      return { status: 200, body: r };
    });
  });
}

export const transportHandlers = [
  // ---- execution
  http.get(`${API_BASE}/cdcs/:cdcId/trips`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const shipDate = q.get('shipDate');
    const state = q.get('state');
    const delayed = q.get('delayed');
    const rows = store.trips
      .filter((t) => t.cdcId === params.cdcId && (!shipDate || t.shipDate === shipDate) && (!state || t.state === state) && (delayed === null || String(Boolean(t.delayed)) === delayed))
      .sort(byDeparture);
    return HttpResponse.json(page(rows, q));
  }),
  http.get(`${API_BASE}/trips/:tripId`, ({ request, params }) => {
    const x = store.trips.find((t) => t.tripId === params.tripId);
    if (!x) return problem(404, 'NOT_FOUND');
    return guard(request, x.cdcId) ?? HttpResponse.json(x);
  }),
  tripOp('/check-ins', (x) => {
    if (x.state !== 'SCHEDULED') return problem(409, 'INVALID_STATE');
    x.state = 'CHECKED_IN';
    x.checkedInAt = now();
    event(x, 'CHECKED_IN');
    return x;
  }),
  tripOp('/loading-completions', (x, body) => {
    if (x.state !== 'CHECKED_IN' && x.state !== 'LOADED') return problem(409, 'INVALID_STATE');
    const sent = (body.transfers as { trfId: string; lpns: string[]; rtCount?: number }[] | undefined) ?? [];
    const known = new Set((x.transfers ?? []).map((t) => t.trfId));
    if (sent.some((s) => !known.has(s.trfId))) return problem(400, 'UNKNOWN_TRF');
    if (!sent.some((s) => s.lpns.length > 0)) return problem(409, 'NOTHING_LOADED');
    for (const t of x.transfers ?? []) {
      const s = sent.find((v) => v.trfId === t.trfId);
      t.lpns = s?.lpns ?? [];
      t.loaded = t.lpns.length > 0;
      t.rtCount = s?.rtCount ?? null;
      if (!t.loaded) (x.incidents ??= []).push({ incidentId: `INC-${Date.now()}-${t.trfId}`, type: 'NOT_LOADED', stopSeq: t.stopSeq ?? null, state: 'OPEN', description: `${t.trfId} 미상차`, resolution: null, raisedAt: now(), resolvedAt: null });
    }
    x.boxCount = (x.transfers ?? []).reduce((a, t) => a + (t.lpns?.length ?? 0), 0);
    x.rtCount = (x.transfers ?? []).reduce((a, t) => a + (t.rtCount ?? 0), 0);
    x.state = 'LOADED';
    x.loadedAt = now();
    event(x, 'LOADED');
    return x;
  }),
  tripOp('/departures', (x) => {
    if (x.state === 'DEPARTED') return x;
    if (x.state !== 'LOADED') return problem(409, 'INVALID_STATE');
    x.state = 'DEPARTED';
    x.departedAt = now();
    x.departureId = `DEP-${Date.now()}`;
    x.outboundLinkage = 'ACKNOWLEDGED';
    x.outboundResult = 'MATCHED';
    event(x, 'DEPARTED');
    return x;
  }),
  tripOp('/physical-ends', (x) => {
    if (x.state !== 'DEPARTED') return problem(409, 'INVALID_STATE');
    if (x.stops.some((s) => s.state !== 'DEPARTED' && s.state !== 'HANDED_OVER')) return problem(409, 'STOPS_OPEN');
    x.state = 'COMPLETED';
    x.endedAt = now();
    event(x, 'ENDED');
    return x;
  }),
  tripOp('/stops/:stopSeq/arrivals', (x, _b, seq) => {
    const s = x.stops.find((v) => v.seq === seq);
    if (!s) return problem(404, 'NOT_FOUND');
    if (x.state !== 'DEPARTED' || s.state !== 'PLANNED') return problem(409, 'INVALID_STATE');
    if (x.stops.some((v) => (v.seq ?? 0) < seq && v.state !== 'DEPARTED')) return problem(409, 'PREVIOUS_STOP_OPEN');
    s.state = 'ARRIVED';
    s.arrivedAt = now();
    event(x, 'STOP_ARRIVED', seq);
    return x;
  }),
  tripOp('/stops/:stopSeq/handovers', (x, body, seq) => {
    const s = x.stops.find((v) => v.seq === seq);
    if (!s) return problem(404, 'NOT_FOUND');
    if (s.state !== 'ARRIVED') return problem(409, 'INVALID_STATE');
    const sent = (body.transfers as { trfId: string; receivedLpns: string[]; damagedLpns?: string[] }[] | undefined) ?? [];
    if (sent.some((v) => !(s.trfIds ?? []).includes(v.trfId))) return problem(400, 'UNKNOWN_TRF');
    const shipped = (x.transfers ?? []).filter((t) => t.stopSeq === seq).flatMap((t) => t.lpns ?? []);
    const got = sent.flatMap((v) => v.receivedLpns);
    const missing = shipped.filter((l) => !got.includes(l));
    const extra = got.filter((l) => !shipped.includes(l));
    const damaged = sent.flatMap((v) => v.damagedLpns ?? []);
    const bad = missing.length + extra.length + damaged.length > 0;
    s.handover = { handoverId: `HO-${Date.now()}`, result: bad ? 'MISMATCHED' : 'MATCHED', shippedBoxes: shipped.length, receivedBoxes: got.length, missingLpns: missing, extraLpns: extra, damagedLpns: damaged, receiverId: 'OP-mfc-1', receiverName: (body.receiverName as string | undefined) ?? null };
    if (bad) (x.incidents ??= []).push({ incidentId: `INC-${Date.now()}`, type: 'QTY_MISMATCH', stopSeq: seq, state: 'OPEN', description: `부족 ${missing.length}·초과 ${extra.length}·파손 ${damaged.length}`, resolution: null, raisedAt: now(), resolvedAt: null });
    s.state = 'HANDED_OVER';
    s.handedOverAt = now();
    event(x, 'HANDED_OVER', seq);
    return x;
  }),
  tripOp('/stops/:stopSeq/departures', (x, _b, seq) => {
    const s = x.stops.find((v) => v.seq === seq);
    if (!s) return problem(404, 'NOT_FOUND');
    if (s.state !== 'HANDED_OVER') return problem(409, 'HANDOVER_REQUIRED');
    s.state = 'DEPARTED';
    s.departedAt = now();
    event(x, 'STOP_DEPARTED', seq);
    return x;
  }),
  tripOp('/incidents', (x, body) => {
    (x.incidents ??= []).push({ incidentId: `INC-${Date.now()}`, type: body.type as Exec['schemas']['IncidentType'], stopSeq: (body.stopSeq as number | undefined) ?? null, state: 'OPEN', description: (body.description as string | undefined) ?? '', resolution: null, raisedAt: now(), resolvedAt: null });
    return x;
  }),
  http.post(`${API_BASE}/trips/:tripId/incidents/:incidentId/resolutions`, async ({ request, params }) => {
    const x = store.trips.find((t) => t.tripId === params.tripId);
    if (!x) return problem(404, 'NOT_FOUND');
    const denied = guard(request, x.cdcId);
    if (denied) return denied;
    const body = (await request.json()) as { resolution: string };
    return idempotent(request, () => {
      const inc = x.incidents?.find((i) => i.incidentId === params.incidentId);
      if (!inc) return problem(404, 'NOT_FOUND');
      if (inc.state === 'RESOLVED') return problem(409, 'INVALID_STATE');
      inc.state = 'RESOLVED';
      inc.resolution = body.resolution;
      inc.resolvedAt = now();
      x.version += 1;
      return { status: 200, body: x };
    });
  }),
  // ---- planning
  http.get(`${API_BASE}/cdcs/:cdcId/routes`, ({ request, params }) => guard(request, String(params.cdcId)) ?? HttpResponse.json({ items: store.routes })),
  http.get(`${API_BASE}/cdcs/:cdcId/transport-requests`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const shipDate = q.get('shipDate');
    const state = q.get('state');
    const mfcId = q.get('mfcId');
    const rows = store.requests.filter((r) => (!shipDate || r.shipDate === shipDate) && (!state || r.state === state) && (!mfcId || r.mfcId === mfcId));
    return HttpResponse.json(page(rows, q));
  }),
  http.get(`${API_BASE}/cdcs/:cdcId/transport-orders`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const shipDate = q.get('shipDate');
    const state = q.get('state');
    const rows = store.orders.filter((o) => (!shipDate || o.shipDate === shipDate) && (!state || o.state === state)).sort(byDeparture);
    return HttpResponse.json(page(rows, q));
  }),
  http.post(`${API_BASE}/cdcs/:cdcId/transport-orders/generations`, async ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const body = (await request.json()) as { shipDate: string };
    return idempotent(request, () => ({
      status: 200,
      body: { shipDate: body.shipDate, orders: store.orders.filter((o) => o.shipDate === body.shipDate), requests: { ACCEPTED: 3, HELD: 3 }, unplannedReasons: [{ routeId: 'RT-03', tempClass: 'FROZEN', reason: 'NO_REGULAR_VEHICLE' }] },
    }));
  }),
  orderOp('/confirmations', (o) => {
    if (o.state !== 'PLANNING') return problem(409, 'INVALID_STATE');
    if (o.trfIds?.length === 0) return problem(409, 'NO_REQUESTS');
    if (o.flags?.includes('OVER_CAPACITY')) return problem(409, 'OVER_CAPACITY');
    o.state = 'DISPATCHED';
    o.tripState = 'SCHEDULED';
    o.reservationId = `RSV-${o.vehicleId}`;
    for (const r of store.requests) if (r.orderId === o.orderId) r.state = 'ASSIGNED';
    store.trips.push({
      tripId: o.orderId, cdcId: o.cdcId, shipDate: o.shipDate, routeId: o.routeId, tempClass: o.tempClass, vehicleId: o.vehicleId ?? '', plateNo: null, driverId: o.driverId ?? '', driverName: null, state: 'SCHEDULED', delayed: false,
      ...(o.plannedLoadingStartAt ? { plannedLoadingStartAt: o.plannedLoadingStartAt } : {}), ...(o.plannedDepartureAt ? { plannedDepartureAt: o.plannedDepartureAt } : {}), ...(o.plannedReturnAt ? { plannedReturnAt: o.plannedReturnAt } : {}),
      checkedInAt: null, loadedAt: null, departedAt: null, endedAt: null, departureId: null, outboundLinkage: null, outboundResult: null, trfCount: o.trfIds?.length ?? 0, boxCount: 0, rtCount: 0,
      stops: (o.stops ?? []).map((s) => ({ seq: s.seq ?? 1, mfcId: s.mfcId ?? '', state: 'PLANNED', trfIds: s.trfIds ?? [], ...(s.plannedArrivalAt ? { plannedArrivalAt: s.plannedArrivalAt } : {}), estimatedArrivalAt: null, arrivedAt: null, handedOverAt: null, departedAt: null, delayed: false, handover: null })),
      transfers: (o.stops ?? []).flatMap((s) => (s.trfIds ?? []).map((trfId) => ({ trfId, stopSeq: s.seq ?? 1, loaded: false, lpns: [], rtCount: null }))),
      events: [], incidents: [], version: 1,
    });
    return o;
  }),
  orderOp('/skips', (o) => {
    if (o.state !== 'PLANNING') return problem(409, 'INVALID_STATE');
    if ((o.trfIds?.length ?? 0) > 0) return problem(409, 'HAS_REQUESTS');
    o.state = 'SKIPPED';
    return o;
  }),
  orderOp('/cancellations', (o, body) => {
    if (o.state !== 'PLANNING' && o.state !== 'DISPATCHED') return problem(409, 'INVALID_STATE');
    const trip = store.trips.find((t) => t.tripId === o.orderId);
    if (trip && ['DEPARTED', 'COMPLETED'].includes(trip.state)) return problem(409, 'ALREADY_DEPARTED');
    if (trip) trip.state = 'CANCELLED';
    o.state = 'CANCELLED';
    o.reason = (body.reason as string | undefined) ?? '';
    for (const r of store.requests) if (r.orderId === o.orderId) {
      r.state = 'ACCEPTED';
      r.orderId = null;
    }
    o.trfIds = [];
    return o;
  }),
  orderOp('/request-moves', (o, body) => {
    const to = store.orders.find((x) => x.orderId === body.toOrderId);
    if (!to || o.state !== 'PLANNING' || to.state !== 'PLANNING') return problem(409, 'INVALID_STATE');
    if (to.tempClass !== o.tempClass) return problem(409, 'TEMP_MISMATCH');
    const trfId = String(body.trfId);
    if (!o.trfIds?.includes(trfId)) return problem(409, 'INVALID_STATE');
    o.trfIds = o.trfIds.filter((t) => t !== trfId);
    for (const s of o.stops ?? []) s.trfIds = (s.trfIds ?? []).filter((t) => t !== trfId);
    (to.trfIds ??= []).push(trfId);
    const moved = store.requests.find((r) => r.trfId === trfId);
    const rt = moved?.rtCount ?? 0;
    o.loadRt = (o.loadRt ?? 0) - rt;
    to.loadRt = (to.loadRt ?? 0) + rt;
    for (const x of [o, to]) {
      x.loadRatio = (x.loadRt ?? 0) / (x.maxRt ?? 1);
      x.flags = (x.loadRt ?? 0) > (x.maxRt ?? 0) ? ['OVER_CAPACITY'] : [];
      x.cancelCandidate = (x.trfIds?.length ?? 0) === 0;
    }
    if (moved) moved.orderId = to.orderId;
    o.version += 1;
    return to;
  }),
];
