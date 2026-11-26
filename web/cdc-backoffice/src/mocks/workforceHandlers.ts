// cdc-outbound 0.27.0~0.29.0 목 — 일별 출고 집계(KP-2)·작업자 실적(WF-1)·운영 확인 기준(KP-1)·근무(WF-2).
// 근무조·계획 인원은 백엔드 회신(시뮬레이터 값)을 그대로 옮겼다. 계산은 서버 — 목은 고정 값만 돌려준다.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components } from '../api/generated/cdc-outbound';
import { idempotent, operator, problem } from './support';
import { guard } from './transportHandlers';

type S = components['schemas'];
type Assignment = S['ShiftAssignment'];
type Cell = S['StaffingCell'];
type Role = S['WorkRole'];

const DAY = 86_400_000;
const seoulDate = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(t));
const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let t = new Date(`${from}T00:00:00+09:00`).getTime(); t <= new Date(`${to}T00:00:00+09:00`).getTime(); t += DAY) out.push(seoulDate(t));
  return out;
};
function range(q: URLSearchParams, required: boolean) {
  const today = seoulDate(Date.now());
  const from = q.get('from') ?? (required ? null : today);
  const to = q.get('to') ?? (required ? null : today);
  if (!from || !to) return problem(400, 'VALIDATION_FAILED', [{ field: from ? 'to' : 'from', reason: '필수' }]);
  const n = days(from, to).length;
  if (n === 0 || n > 31) return problem(400, 'VALIDATION_FAILED', [{ field: 'from', reason: '최대 31일' }]);
  return { from, to };
}

const SHIFTS = [
  { shiftCode: 'DAY', name: '주간조', startTime: '08:00', endTime: '17:00', breaks: [], source: '시뮬레이터 설정 [가정]' },
  { shiftCode: 'EVENING', name: '석간조', startTime: '13:00', endTime: '22:00', breaks: ['15:30-15:45', '18:00-19:00', '20:30-20:45'], source: '시뮬레이터 설정 [가정]' },
  { shiftCode: 'NIGHT_DOCK', name: '야간 도크', startTime: '22:00', endTime: '04:30', breaks: [], source: '시뮬레이터 설정 [가정]' },
];
function plan(): Cell[] {
  const cells: Cell[] = [];
  const add = (shiftCode: string, floor: string, role: Role, planned: number) => cells.push({ shiftCode, floor, role, planned });
  const per: Record<string, Partial<Record<Role, number>>> = {
    '5': { FC: 11, SORT: 13, JOCKEY: 8, DPS: 15, INSPECTOR: 4 },
    '6': { FC: 14, SORT: 9, JOCKEY: 4, INSPECTOR: 4 },
    '7': { FC: 19, SORT: 6, JOCKEY: 7, INSPECTOR: 4 },
  };
  const replDay: Record<string, number> = { '5': 20, '6': 14, '7': 16 };
  for (const f of ['5', '6', '7']) {
    add('DAY', f, 'REPLENISH', replDay[f]!);
    for (const [role, n] of Object.entries(per[f]!)) add('EVENING', f, role as Role, n);
    add('EVENING', f, 'REPLENISH', 3);
    add('NIGHT_DOCK', f, 'NIGHT_JOCKEY', 4);
  }
  add('NIGHT_DOCK', 'ALL', 'LOADER', 22);
  return cells;
}

function seed() {
  const d = seoulDate(Date.now());
  const a = (id: number, shiftCode: string, workerId: string, floor: string, role: Role, inAt: string | null, outAt: string | null = null): Assignment => ({
    assignmentId: `SA-${id}`, workDate: d, shiftCode, workerId, floor, role, assignedBy: 'OP-cdc-sup', checkInAt: inAt, checkOutAt: outAt,
  });
  const at = (h: number, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`).toISOString();
  return {
    seq: 4,
    assignments: [
      a(1, 'DAY', 'OP-cdc-worker-1', '5', 'REPLENISH', at(7, 55)),
      a(2, 'EVENING', 'OP-cdc-worker-2', '5', 'FC', at(12, 50)),
      a(3, 'EVENING', 'OP-cdc-worker-3', '6', 'FC', null),
      a(4, 'DAY', 'OP-cdc-sup', '7', 'INSPECTOR', at(8), at(17, 5)),
    ],
  };
}
let store = seed();
export function resetWorkforce() {
  store = seed();
}

function staffing(date: string): Cell[] {
  const cells = plan().map((c) => ({ ...c, assigned: 0, checkedIn: 0 }));
  for (const x of store.assignments.filter((v) => v.workDate === date)) {
    let c = cells.find((v) => v.shiftCode === x.shiftCode && v.floor === x.floor && v.role === x.role);
    if (!c) {
      c = { shiftCode: x.shiftCode ?? '', floor: x.floor ?? '', role: x.role ?? 'FC', planned: 0, assigned: 0, checkedIn: 0 };
      cells.push(c);
    }
    c.assigned = (c.assigned ?? 0) + 1;
    if (x.checkInAt && !x.checkOutAt) c.checkedIn = (c.checkedIn ?? 0) + 1;
  }
  return cells;
}

/** 날짜마다 조금씩 다른 고정 값(시연) */
function summary(cdcId: string, date: string, i: number): S['OutboundSummary'] {
  const approved = 1200 + ((i * 137) % 400);
  const picked = Math.round(approved * (0.82 + ((i * 7) % 15) / 100));
  return {
    cdcId, date, transferCount: 18 + (i % 5), approvedQty: approved, allocatedQty: approved - 20, pickedQty: picked, shortQty: 6 + (i % 4), progress: picked / approved,
    transfersByState: [{ key: 'DEPARTED', count: 14 + (i % 4) }, { key: 'PICKING', count: 3 }], wavesByState: [{ key: 'CLOSED', count: 4 }], tasksByKindState: [{ key: 'PICK:DONE', count: 40 + i }],
    byMfc: [
      { mfcId: 'MFC-BJG-01', transferCount: 6, approvedQty: Math.round(approved * 0.4), allocatedQty: Math.round(approved * 0.4) - 8, pickedQty: Math.round(picked * 0.4), shortQty: 3 },
      { mfcId: 'MFC-BNG-01', transferCount: 5, approvedQty: Math.round(approved * 0.3), allocatedQty: Math.round(approved * 0.3) - 6, pickedQty: Math.round(picked * 0.3), shortQty: 2 },
      { mfcId: 'MFC-SEJ-01', transferCount: 4, approvedQty: Math.round(approved * 0.3), allocatedQty: Math.round(approved * 0.3) - 6, pickedQty: Math.round(picked * 0.3), shortQty: 1 + (i % 4) },
    ],
    asOf: new Date().toISOString(),
  };
}

export const workforceHandlers = [
  http.get(`${API_BASE}/cdcs/:cdcId/outbound-summary/daily`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const r = range(new URL(request.url).searchParams, true);
    if (r instanceof Response) return r;
    return HttpResponse.json({ items: days(r.from, r.to).map((d, i) => summary(String(params.cdcId), d, i)) });
  }),
  http.get(`${API_BASE}/cdcs/:cdcId/worker-throughput`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const r = range(new URL(request.url).searchParams, false);
    if (r instanceof Response) return r;
    const n = days(r.from, r.to).length;
    const at = (h: number, m = 0) => new Date(`${r.to}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`).toISOString();
    return HttpResponse.json({
      from: r.from,
      to: r.to,
      items: [
        { workerId: 'OP-cdc-worker-1', tasks: 12 * n, tasksByKind: [{ key: 'PICK', count: 12 * n }], pickedLines: 58 * n, pickedQty: 640 * n, shortLines: 2, shortQty: 5, firstStartedAt: at(13, 5), lastCompletedAt: at(21, 40), mainFloor: '5', mainZone: 'A' },
        { workerId: 'OP-cdc-worker-2', tasks: 9 * n, tasksByKind: [{ key: 'PICK', count: 9 * n }], pickedLines: 41 * n, pickedQty: 455 * n, shortLines: 0, shortQty: 0, firstStartedAt: at(13, 20), lastCompletedAt: at(21, 55), mainFloor: '6', mainZone: 'B' },
        { workerId: 'OP-cdc-worker-3', tasks: 3 * n, tasksByKind: [{ key: 'PICK', count: 3 * n }], pickedLines: 11 * n, pickedQty: 90 * n, shortLines: 1, shortQty: 2, firstStartedAt: at(18, 0), lastCompletedAt: at(20, 10), mainFloor: '7', mainZone: 'E' },
      ],
    });
  }),
  http.get(`${API_BASE}/cdcs/:cdcId/operating-metrics`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const r = range(q, true);
    if (r instanceof Response) return r;
    const na = (key: string, label: string, reasons: string[]) => ({ key, label, status: 'NA', numerator: null, denominator: null, value: null, unit: 'EA_MIXED_SKU', provisional: false, reasons, components: [], sources: [] });
    return HttpResponse.json({
      from: r.from, to: r.to, mfcId: q.get('mfcId'), definitionVersion: 'CDC-F-034/v1-provisional', asOf: new Date().toISOString(), evaluatedTrfCount: 24,
      items: [
        { key: 'APPROVED_DEMAND_FULFILLMENT', label: '승인 수요 충족률', status: 'VALUE', numerator: 1840, denominator: 2400, value: 1840 / 2400, unit: 'EA_MIXED_SKU', provisional: true, reasons: ['MIXED_SKU', 'OPEN_RECEIPTS'], components: [], sources: ['TRF-20261126-0001', 'TRF-20261126-0002', 'TRF-20261126-0003'] },
        na('ORIGINAL_DEMAND_FULFILLMENT', '원수요 충족률', ['SOURCE_UNAVAILABLE']),
        { key: 'NORMAL_RECEIPT_RATE', label: '정상 수령률', status: 'VALUE', numerator: 1810, denominator: 1840, value: 1810 / 1840, unit: 'EA_MIXED_SKU', provisional: true, reasons: ['MIXED_SKU', 'PENDING_QUALITY'], components: [], sources: ['TRF-20261126-0001', 'TRF-20261126-0002'] },
        na('READY_TIME', '사용 준비 시간', ['SOURCE_UNAVAILABLE']),
        na('PROMISE_COMPLIANCE', '약속 준수', ['SOURCE_UNAVAILABLE']),
        {
          key: 'EXCEPTION_VOLUME', label: '예외 운영량', status: 'VALUE', numerator: null, denominator: null, value: 7, unit: 'COUNT', provisional: false, reasons: [],
          components: [{ key: 'DEPARTURE_MISMATCH', count: 2, status: 'VALUE' }, { key: 'PICK_SHORTAGE', count: 4, status: 'VALUE' }, { key: 'TRANSIT_UNRECONCILED', count: 1, status: 'VALUE' }, { key: 'DEADLINE_LOSS', count: null, status: 'NA' }, { key: 'URGENT_SHARE', count: null, status: 'NA' }],
          sources: ['TRF-20261126-0002'],
        },
      ],
    });
  }),
  http.get(`${API_BASE}/cdcs/:cdcId/shifts`, ({ request, params }) => guard(request, String(params.cdcId)) ?? HttpResponse.json({ shifts: SHIFTS, plan: plan() })),
  http.get(`${API_BASE}/cdcs/:cdcId/staffing`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const date = new URL(request.url).searchParams.get('date') ?? seoulDate(Date.now());
    return HttpResponse.json({ date, cells: staffing(date) });
  }),
  http.get(`${API_BASE}/cdcs/:cdcId/shift-assignments`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const order = SHIFTS.map((s) => s.shiftCode);
    const items = store.assignments
      .filter((x) => x.workDate === q.get('date') && (!q.get('shiftCode') || x.shiftCode === q.get('shiftCode')))
      .sort((a, b) => order.indexOf(a.shiftCode ?? '') - order.indexOf(b.shiftCode ?? '') || (a.floor ?? '').localeCompare(b.floor ?? '') || (a.workerId ?? '').localeCompare(b.workerId ?? ''));
    return HttpResponse.json({ items });
  }),
  http.post(`${API_BASE}/cdcs/:cdcId/shift-assignments`, async ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const body = (await request.json()) as { workDate: string; shiftCode: string; workerId: string; floor: string; role: Role };
    return idempotent(request, () => {
      if (!SHIFTS.some((s) => s.shiftCode === body.shiftCode)) return problem(400, 'UNKNOWN_SHIFT');
      const same = store.assignments.find((x) => x.workDate === body.workDate && x.shiftCode === body.shiftCode && x.workerId === body.workerId);
      if (same) {
        if (same.checkInAt) return problem(409, 'CHECKED_IN');
        same.floor = body.floor;
        same.role = body.role;
        return { status: 200, body: same };
      }
      store.seq += 1;
      const x: Assignment = { assignmentId: `SA-${store.seq}`, ...body, assignedBy: operator(request)?.subject ?? '', checkInAt: null, checkOutAt: null };
      store.assignments.push(x);
      return { status: 200, body: x };
    });
  }),
  http.post(`${API_BASE}/cdcs/:cdcId/shift-assignments/:id/check-ins`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const x = store.assignments.find((v) => v.assignmentId === params.id);
    if (!x) return problem(404, 'NOT_FOUND');
    return idempotent(request, () => {
      x.checkInAt ??= new Date().toISOString();
      return { status: 200, body: x };
    });
  }),
  http.post(`${API_BASE}/cdcs/:cdcId/shift-assignments/:id/check-outs`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const x = store.assignments.find((v) => v.assignmentId === params.id);
    if (!x) return problem(404, 'NOT_FOUND');
    return idempotent(request, () => {
      if (!x.checkInAt) return problem(409, 'NOT_CHECKED_IN');
      x.checkOutAt ??= new Date().toISOString();
      return { status: 200, body: x };
    });
  }),
];
