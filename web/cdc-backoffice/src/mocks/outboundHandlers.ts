// cdc-outbound 목(계약 0.13.0): TRF 목록·상세, Wave 만들기·조회·릴리스, 작업 목록·상세. 칠곡 DC CDC01 시연 값(가짜 — 실서버는 TRF 0건일 수 있다).
// 판정은 계약 설명대로 흉내 낸다: Wave 에는 확보(ALLOCATED·PARTIALLY_ALLOCATED)되고 다른 Wave 에 없는 TRF 만, 릴리스는 PLANNED·기대 버전이 맞을 때만.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components } from '../api/generated/cdc-outbound';
import { idempotent, operator, problem, unauthorized, expectedVersion } from './support';

type TransferDetail = components['schemas']['TransferDetail'];
type Wave = components['schemas']['Wave'];
type Task = components['schemas']['Task'];

const CDC = 'CDC01';
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 26, h - 9, m)).toISOString(); // 2026-11-26 서울 h:m

function trf(id: string, mfcId: string, state: string, due: string, lines: Array<[string, number, number, number, number]>, waveId: string | null = null, allocationError: string | null = null): TransferDetail {
  const s = (i: number) => lines.reduce((a, l) => a + (l[i] as number), 0);
  return {
    trfId: id,
    trfVersion: 1,
    mfcId,
    state,
    deadlineMeaning: 'ARRIVAL',
    dueAt: due,
    waveId,
    allocationError,
    lineCount: lines.length,
    approvedQty: s(1),
    allocatedQty: s(2),
    pickedQty: s(3),
    shortQty: s(4),
    createdAt: at(6),
    updatedAt: at(7),
    lines: lines.map(([sku, approvedQty, allocatedQty, pickedQty, shortQty]) => ({ sku, approvedQty, allocatedQty, pickedQty, shortQty })),
  };
}

function seed() {
  const transfers: TransferDetail[] = [
    trf('TRF-20261126-0001', 'MFC-BJG-01', 'PICKING', at(9), [['SKU-1001', 40, 40, 32, 0], ['SKU-1002', 24, 24, 20, 2]], 'WAVE-20261126-01'),
    trf('TRF-20261126-0002', 'MFC-BNG-01', 'PICKING', at(9, 30), [['SKU-1001', 30, 30, 10, 0]], 'WAVE-20261126-01'),
    trf('TRF-20261126-0003', 'MFC-MOKPO-01', 'IN_WAVE', at(10), [['SKU-2001', 12, 12, 0, 0]], 'WAVE-20261126-02'),
    trf('TRF-20261126-0004', 'MFC-SEJ-01', 'ALLOCATED', at(11), [['SKU-3001', 20, 20, 0, 0], ['SKU-3002', 8, 8, 0, 0]]),
    trf('TRF-20261126-0005', 'MFC-CHC-01', 'PARTIALLY_ALLOCATED', at(12), [['SKU-3001', 50, 36, 0, 0]]),
    trf('TRF-20261126-0006', 'MFC-BJG-01', 'ALLOCATION_FAILED', at(13), [['SKU-9001', 6, 0, 0, 0]], null, 'NO_ELIGIBLE_STOCK'),
  ];
  const waves: Wave[] = [
    {
      waveId: 'WAVE-20261126-01',
      cdcId: CDC,
      state: 'IN_PROGRESS',
      version: 3,
      trfIds: ['TRF-20261126-0001', 'TRF-20261126-0002'],
      taskSummary: { total: 3, done: 1, exception: 0 },
      createdAt: at(7),
      releasedAt: at(7, 30),
    },
    { waveId: 'WAVE-20261126-02', cdcId: CDC, state: 'PLANNED', version: 1, trfIds: ['TRF-20261126-0003'], taskSummary: { total: 0, done: 0, exception: 0 }, createdAt: at(8) },
  ];
  const tasks: Task[] = [
    {
      taskId: 'TSK-0001',
      waveId: 'WAVE-20261126-01',
      trfId: null,
      trfIds: ['TRF-20261126-0001', 'TRF-20261126-0002'],
      pickMode: 'REGION_BATCH',
      pickMethod: 'FC',
      regionCode: 'BUSAN',
      kind: 'PICK',
      zone: 'A',
      floor: '5',
      dueAt: at(9),
      state: 'IN_PROGRESS',
      version: 2,
      assigneeId: 'cdcw-fc-01',
      lines: [
        {
          sku: 'SKU-1001',
          lot: 'LOT-A1',
          locationCode: 'CDC01-A-5-03-02',
          plannedQty: 70,
          pickedQty: 42,
          shortQty: 0,
          shares: [
            { trfId: 'TRF-20261126-0001', mfcId: 'MFC-BJG-01', dueAt: at(9), plannedQty: 40, pickedQty: 32, shortQty: 0 },
            { trfId: 'TRF-20261126-0002', mfcId: 'MFC-BNG-01', dueAt: at(9, 30), plannedQty: 30, pickedQty: 10, shortQty: 0 },
          ],
        },
      ],
      createdAt: at(7, 30),
    },
    {
      taskId: 'TSK-0002',
      waveId: 'WAVE-20261126-01',
      trfId: 'TRF-20261126-0001',
      trfIds: ['TRF-20261126-0001'],
      pickMode: 'DISCRETE',
      pickMethod: 'DPS',
      aisle: '07',
      kind: 'PICK',
      zone: 'B',
      floor: '6',
      dueAt: at(9),
      state: 'PARTIAL',
      version: 3,
      assigneeId: 'cdcw-dl-02',
      lines: [{ sku: 'SKU-1002', lot: 'LOT-B7', locationCode: 'CDC01-B-6-07-01', plannedQty: 24, pickedQty: 20, shortQty: 2, shortReason: 'NOT_FOUND' }],
      createdAt: at(7, 30),
    },
    {
      taskId: 'TSK-0003',
      waveId: 'WAVE-20261126-01',
      trfId: 'TRF-20261126-0002',
      trfIds: ['TRF-20261126-0002'],
      pickMode: 'DISCRETE',
      kind: 'PICK',
      zone: 'C',
      floor: '7',
      dueAt: at(9, 30),
      state: 'DONE',
      version: 4,
      assigneeId: 'cdcw-fc-03',
      lines: [{ sku: 'SKU-1003', lot: 'LOT-C2', locationCode: 'CDC01-C-7-01-01', plannedQty: 12, pickedQty: 12, shortQty: 0 }],
      createdAt: at(7, 30),
      completedAt: at(8, 10),
    },
  ];
  return { transfers, waves, tasks, seq: 2 };
}

let store = seed();
export const resetOutbound = () => {
  store = seed();
};

const summary = (t: TransferDetail) => {
  const { lines, ...rest } = t;
  void lines;
  return rest;
};
const WAVEABLE = new Set(['ALLOCATED', 'PARTIALLY_ALLOCATED']);

/** 자기 센터 운영자만(토큰 centers 에 cdcId) */
function guard(request: Request, cdcId: string) {
  const who = operator(request);
  if (!who) return unauthorized();
  if (!who.centers.includes(cdcId)) return problem(403, 'FORBIDDEN');
  return null;
}

export const outboundHandlers = [
  http.get(`${API_BASE}/cdcs/:cdcId/transfers`, ({ request, params }) => {
    const cdcId = String(params.cdcId);
    const denied = guard(request, cdcId);
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const state = q.get('state');
    const mfcId = q.get('mfcId');
    const page = Number(q.get('page') ?? '0');
    const size = Number(q.get('size') ?? '50');
    const rows = (cdcId === CDC ? store.transfers : [])
      .filter((t) => (!state || t.state === state) && (!mfcId || t.mfcId === mfcId))
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.trfId.localeCompare(b.trfId));
    return HttpResponse.json({ items: rows.slice(page * size, page * size + size).map(summary), page, size, hasNext: rows.length > (page + 1) * size });
  }),

  http.get(`${API_BASE}/cdcs/:cdcId/transfers/:trfId`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const t = store.transfers.find((x) => x.trfId === params.trfId);
    return t ? HttpResponse.json(t) : problem(404, 'NOT_FOUND');
  }),

  http.post(`${API_BASE}/waves`, async ({ request }) => {
    const body = (await request.json()) as { cdcId: string; trfIds: string[] };
    const denied = guard(request, body.cdcId);
    if (denied) return denied;
    return idempotent(request, () => {
      const picked = body.trfIds.map((id) => store.transfers.find((t) => t.trfId === id));
      if (picked.some((t) => !t)) return problem(409, 'INVALID_STATE');
      if (picked.some((t) => t!.waveId)) return problem(409, 'TRF_ALREADY_IN_WAVE');
      if (picked.some((t) => !WAVEABLE.has(t!.state))) return problem(409, 'INVALID_STATE');
      store.seq += 1;
      const wave: Wave = {
        waveId: `WAVE-20261126-${String(store.seq).padStart(2, '0')}`,
        cdcId: body.cdcId,
        state: 'PLANNED',
        version: 1,
        trfIds: [...body.trfIds],
        taskSummary: { total: 0, done: 0, exception: 0 },
        createdAt: new Date().toISOString(),
      };
      store.waves.push(wave);
      for (const t of picked) {
        t!.waveId = wave.waveId!;
        t!.state = 'IN_WAVE';
      }
      return { status: 201, body: wave };
    });
  }),

  http.get(`${API_BASE}/cdcs/:cdcId/waves`, ({ request, params }) => {
    const cdcId = String(params.cdcId);
    const denied = guard(request, cdcId);
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const state = q.get('state');
    const page = Number(q.get('page') ?? '0');
    const size = Number(q.get('size') ?? '50');
    const rows = store.waves
      .filter((v) => v.cdcId === cdcId && (!state || v.state === state))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || (b.waveId ?? '').localeCompare(a.waveId ?? ''));
    return HttpResponse.json({ items: rows.slice(page * size, page * size + size), page, size, hasNext: rows.length > (page + 1) * size });
  }),

  http.get(`${API_BASE}/waves/:waveId`, ({ request, params }) => {
    const v = store.waves.find((x) => x.waveId === params.waveId);
    if (!v) return operator(request) ? problem(404, 'NOT_FOUND') : unauthorized();
    const denied = guard(request, v.cdcId ?? '');
    return denied ?? HttpResponse.json(v);
  }),

  http.post(`${API_BASE}/waves/:waveId/releases`, ({ request, params }) => {
    const v = store.waves.find((x) => x.waveId === params.waveId);
    if (!v) return operator(request) ? problem(404, 'NOT_FOUND') : unauthorized();
    const denied = guard(request, v.cdcId ?? '');
    if (denied) return denied;
    return idempotent(request, () => {
      if (v.state !== 'PLANNED') return problem(409, 'INVALID_STATE');
      const expected = expectedVersion(request);
      if (expected !== undefined && expected !== v.version) return problem(409, 'VERSION_CONFLICT');
      v.state = 'RELEASED';
      v.version = (v.version ?? 0) + 1;
      v.releasedAt = new Date().toISOString();
      const made: Task[] = (v.trfIds ?? []).map((trfId, i) => {
        const t = store.transfers.find((x) => x.trfId === trfId);
        return {
          taskId: `TSK-${v.waveId}-${i + 1}`,
          waveId: v.waveId!,
          trfId,
          trfIds: [trfId],
          pickMode: 'DISCRETE',
          kind: 'PICK',
          zone: 'A',
          floor: '5',
          dueAt: t?.dueAt ?? new Date().toISOString(),
          state: 'CREATED',
          version: 1,
          lines: (t?.lines ?? []).map((l) => ({ sku: l.sku, lot: 'LOT-NEW', locationCode: 'CDC01-A-5-01-01', plannedQty: l.allocatedQty, pickedQty: 0, shortQty: 0 })),
          createdAt: new Date().toISOString(),
        };
      });
      store.tasks.push(...made);
      v.taskSummary = { total: made.length, done: 0, exception: 0 };
      return { status: 202, body: { status: 'APPLIED', requestId: request.headers.get('Idempotency-Key') ?? '' } };
    });
  }),

  http.get(`${API_BASE}/cdcs/:cdcId/tasks`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const waveId = q.get('waveId');
    if (!waveId) return problem(400, 'VALIDATION_FAILED', [{ field: 'waveId', reason: 'REQUIRED' }]);
    const state = q.get('state');
    const size = Number(q.get('size') ?? '50');
    const from = Number(q.get('cursor') ?? '0');
    const rows = store.tasks.filter((t) => t.waveId === waveId && (!state || t.state === state));
    const next = from + size < rows.length ? String(from + size) : null;
    return HttpResponse.json({ items: rows.slice(from, from + size), page: { nextCursor: next, size } });
  }),

  // 그날 출고 집계 — 목은 날짜와 상관없이 지금 TRF·Wave·작업으로 센다
  http.get(`${API_BASE}/cdcs/:cdcId/outbound-summary`, ({ request, params }) => {
    const cdcId = String(params.cdcId);
    const denied = guard(request, cdcId);
    if (denied) return denied;
    const date = new URL(request.url).searchParams.get('date') ?? '2026-11-26';
    const count = (keys: string[]) => Object.entries(keys.reduce<Record<string, number>>((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {})).map(([key, n]) => ({ key, count: n }));
    const trfs = cdcId === CDC ? store.transfers : [];
    const total = (k: 'approvedQty' | 'allocatedQty' | 'pickedQty' | 'shortQty') => trfs.reduce((a, t) => a + t[k], 0);
    const approved = total('approvedQty');
    return HttpResponse.json({
      cdcId,
      date,
      transferCount: trfs.length,
      transfersByState: count(trfs.map((t) => t.state)),
      approvedQty: approved,
      allocatedQty: total('allocatedQty'),
      pickedQty: total('pickedQty'),
      shortQty: total('shortQty'),
      progress: approved === 0 ? null : total('pickedQty') / approved,
      wavesByState: count(store.waves.map((v) => v.state ?? '')),
      tasksByKindState: count(store.tasks.map((t) => `${t.kind}:${t.state}`)),
      asOf: '2026-11-26T00:30:00Z',
    });
  }),

  http.get(`${API_BASE}/cdcs/:cdcId/tasks/:taskId`,({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const t = store.tasks.find((x) => x.taskId === params.taskId);
    return t ? HttpResponse.json(t) : problem(404, 'NOT_FOUND');
  }),
];
