// cdc-quality 0.3.0 목 — 품질 보류·해제 요청·결정, 폐기 요청·결정·실행, 리콜(가짜 시연 값).
// 결정은 요청자 본인이면 422 SELF_APPROVAL(서버와 같게). 보류는 만들면 바로 APPLIED(목) — 실서버는 APPLYING·UNKNOWN_RESULT 가 올 수 있다.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components } from '../api/generated/cdc-quality';
import { idempotent, operator, problem, unauthorized } from './support';

type S = components['schemas'];
type Hold = S['Hold'];
type Disposal = S['DisposalApproval'];
type Recall = S['Recall'];
type ExactLine = S['ExactLine'];

function seed() {
  const holds: Hold[] = [
    {
      holdId: 'QH-0001',
      cdcId: 'CDC01',
      reason: 'TEMPERATURE_EXCURSION',
      sourceRef: 'EXC-77',
      evidenceRef: null,
      note: '냉동 통로 온도 -12℃ 20분',
      state: 'APPLIED',
      requestedBy: 'OP-cdc-worker-1',
      rejectReason: null,
      lines: [{ lineNo: 1, sku: 'SKU-1001', lot: 'LOT-A1', locationCode: 'CDC01-A-5-63-01-2-1', requestedQty: null, heldQty: 20, releasedQty: 0, disposedQty: 0, commitId: 'CM-1', state: 'APPLIED' }],
      releases: [
        {
          releaseId: 'QR-0001',
          holdId: 'QH-0001',
          state: 'REQUESTED',
          requestedBy: 'OP-cdc-worker-1',
          note: '온도 기록 정상 복귀',
          decidedBy: null,
          decisionReason: null,
          approvalRef: null,
          commitId: null,
          rejectReason: null,
          lines: [{ sku: 'SKU-1001', lot: 'LOT-A1', locationCode: 'CDC01-A-5-63-01-2-1', qty: 5 }],
          createdAt: '2026-11-26T00:10:00Z',
          decidedAt: null,
        },
      ],
      createdAt: '2026-11-25T23:40:00Z',
      updatedAt: '2026-11-26T00:10:00Z',
    },
  ];
  const disposals: Disposal[] = [
    {
      disposalApprovalId: 'QD-0001',
      cdcId: 'CDC01',
      holdId: 'QH-0001',
      reason: 'TEMPERATURE',
      note: null,
      state: 'APPROVED',
      requestedBy: 'OP-cdc-worker-1',
      decidedBy: 'OP-admin-cdc',
      decisionReason: '해동 흔적',
      approvalRef: null,
      lines: [{ sku: 'SKU-1001', lot: 'LOT-A1', locationCode: 'CDC01-A-5-63-01-2-1', approvedQty: 3, executedQty: 0 }],
      executions: [],
      createdAt: '2026-11-26T00:05:00Z',
      decidedAt: '2026-11-26T00:20:00Z',
    },
  ];
  const recalls: Recall[] = [
    {
      recallId: 'RC-0001',
      sku: 'SKU-1002',
      lots: ['LOT-B7'],
      reason: 'SUPPLIER_NOTICE',
      severity: 'CLASS_2',
      approvalRef: 'HQ-2026-118',
      externalRef: 'SUP-RC-9',
      note: null,
      state: 'ISSUED',
      issuedBy: 'OP-admin-cdc',
      centers: [{ cdcId: 'CDC01', lot: 'LOT-B7', holdId: 'QH-0002', holdState: 'APPLIED', heldQty: 14 }],
      departures: [{ cdcId: 'CDC01', lot: 'LOT-B7', trfId: 'TRF-20261126-0001', departureId: 'DEP-1', mfcId: 'MFC-BJG-01', departedAt: '2026-11-25T23:40:00Z', q: 6, received: 4, unreconciled: 2 }],
      traceFreshness: 'CURRENT',
      createdAt: '2026-11-26T00:15:00Z',
    },
  ];
  return { holds, disposals, recalls, seq: 1 };
}

let store = seed();
export function resetQuality() {
  store = seed();
}

function guard(request: Request, cdcId: string) {
  const who = operator(request);
  if (!who) return unauthorized();
  if (!who.centers.includes(cdcId)) return problem(403, 'FORBIDDEN');
  return null;
}
const next = (prefix: string) => {
  store.seq += 1;
  return `${prefix}-${String(store.seq + 100).padStart(4, '0')}`;
};
const now = () => new Date().toISOString();

export const qualityHandlers = [
  http.get(`${API_BASE}/cdcs/:cdcId/quality-holds`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const state = new URL(request.url).searchParams.get('state');
    return HttpResponse.json({ items: store.holds.filter((h) => !state || h.state === state), nextCursor: null });
  }),
  http.get(`${API_BASE}/cdcs/:cdcId/quality-holds/:holdId`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const h = store.holds.find((x) => x.holdId === params.holdId);
    return h ? HttpResponse.json(h) : problem(404, 'NOT_FOUND');
  }),
  http.post(`${API_BASE}/cdcs/:cdcId/quality-holds`, async ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const body = (await request.json()) as S['HoldInput'];
    return idempotent(request, () => {
      const h: Hold = {
        holdId: next('QH'),
        cdcId: String(params.cdcId),
        reason: body.reason,
        sourceRef: body.sourceRef ?? null,
        evidenceRef: body.evidenceRef ?? null,
        note: body.note ?? null,
        state: 'APPLIED',
        requestedBy: operator(request)?.subject ?? '',
        rejectReason: null,
        lines: body.lines.map((l, i) => ({ lineNo: i + 1, sku: l.sku, lot: l.lot, locationCode: l.locationCode ?? null, requestedQty: l.qty ?? null, heldQty: l.qty ?? 10, releasedQty: 0, disposedQty: 0, commitId: `CM-${i}`, state: 'APPLIED' })),
        releases: [],
        createdAt: now(),
        updatedAt: now(),
      };
      store.holds.unshift(h);
      return { status: 201, body: h };
    });
  }),
  http.post(`${API_BASE}/cdcs/:cdcId/quality-holds/:holdId/release-requests`, async ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const h = store.holds.find((x) => x.holdId === params.holdId);
    if (!h) return problem(404, 'NOT_FOUND');
    const body = (await request.json()) as { lines: ExactLine[]; note?: string };
    return idempotent(request, () => {
      const r = { releaseId: next('QR'), holdId: h.holdId ?? '', state: 'REQUESTED' as const, requestedBy: operator(request)?.subject ?? '', note: body.note ?? null, decidedBy: null, decisionReason: null, approvalRef: null, commitId: null, rejectReason: null, lines: body.lines, createdAt: now(), decidedAt: null };
      h.releases = [...(h.releases ?? []), r];
      return { status: 201, body: r };
    });
  }),
  http.post(`${API_BASE}/cdcs/:cdcId/quality-holds/:holdId/release-requests/:releaseId/decisions`, async ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const h = store.holds.find((x) => x.holdId === params.holdId);
    const r = h?.releases?.find((x) => x.releaseId === params.releaseId);
    if (!h || !r) return problem(404, 'NOT_FOUND');
    const body = (await request.json()) as S['DecisionInput'];
    const me = operator(request)?.subject ?? '';
    return idempotent(request, () => {
      if (r.requestedBy === me) return problem(422, 'SELF_APPROVAL');
      if (r.state !== 'REQUESTED') return problem(409, 'INVALID_STATE');
      r.decidedBy = me;
      r.decisionReason = body.reason ?? null;
      r.approvalRef = body.approvalRef ?? null;
      r.decidedAt = now();
      if (body.decision === 'REJECT') r.state = 'DECLINED';
      else {
        r.state = 'APPLIED';
        for (const l of r.lines ?? []) {
          const line = h.lines?.find((x) => x.sku === l.sku && x.lot === l.lot);
          if (line) line.releasedQty = (line.releasedQty ?? 0) + l.qty;
        }
        const left = (h.lines ?? []).reduce((a, l) => a + (l.heldQty ?? 0) - (l.releasedQty ?? 0) - (l.disposedQty ?? 0), 0);
        h.state = left > 0 ? 'PARTIALLY_RELEASED' : 'CLOSED';
      }
      return { status: 200, body: r };
    });
  }),

  http.get(`${API_BASE}/cdcs/:cdcId/disposal-approvals`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const state = new URL(request.url).searchParams.get('state');
    return HttpResponse.json({ items: store.disposals.filter((d) => !state || d.state === state), nextCursor: null });
  }),
  http.get(`${API_BASE}/cdcs/:cdcId/disposal-approvals/:id`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const d = store.disposals.find((x) => x.disposalApprovalId === params.id);
    return d ? HttpResponse.json(d) : problem(404, 'NOT_FOUND');
  }),
  http.post(`${API_BASE}/cdcs/:cdcId/disposal-approvals`, async ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const body = (await request.json()) as { holdId: string; reason: string; note?: string; lines: ExactLine[] };
    return idempotent(request, () => {
      const d: Disposal = {
        disposalApprovalId: next('QD'),
        cdcId: String(params.cdcId),
        holdId: body.holdId,
        reason: body.reason,
        note: body.note ?? null,
        state: 'REQUESTED',
        requestedBy: operator(request)?.subject ?? '',
        decidedBy: null,
        decisionReason: null,
        approvalRef: null,
        lines: body.lines.map((l) => ({ sku: l.sku, lot: l.lot, locationCode: l.locationCode, approvedQty: l.qty, executedQty: 0 })),
        executions: [],
        createdAt: now(),
        decidedAt: null,
      };
      store.disposals.unshift(d);
      return { status: 201, body: d };
    });
  }),
  http.post(`${API_BASE}/cdcs/:cdcId/disposal-approvals/:id/decisions`, async ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const d = store.disposals.find((x) => x.disposalApprovalId === params.id);
    if (!d) return problem(404, 'NOT_FOUND');
    const body = (await request.json()) as S['DecisionInput'];
    const me = operator(request)?.subject ?? '';
    return idempotent(request, () => {
      if (d.requestedBy === me) return problem(422, 'SELF_APPROVAL');
      if (d.state !== 'REQUESTED') return problem(409, 'INVALID_STATE');
      d.state = body.decision === 'APPROVE' ? 'APPROVED' : 'DECLINED';
      d.decidedBy = me;
      d.decisionReason = body.reason ?? null;
      d.approvalRef = body.approvalRef ?? null;
      d.decidedAt = now();
      return { status: 200, body: d };
    });
  }),
  http.post(`${API_BASE}/cdcs/:cdcId/disposal-approvals/:id/executions`, async ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const d = store.disposals.find((x) => x.disposalApprovalId === params.id);
    if (!d) return problem(404, 'NOT_FOUND');
    const body = (await request.json()) as { evidenceRef: string; lines: ExactLine[] };
    return idempotent(request, () => {
      for (const l of body.lines) {
        const line = d.lines?.find((x) => x.sku === l.sku && x.lot === l.lot && x.locationCode === l.locationCode);
        if (!line || (line.executedQty ?? 0) + l.qty > (line.approvedQty ?? 0)) return problem(422, 'QTY_EXCEEDS_APPROVED');
      }
      for (const l of body.lines) {
        const line = d.lines!.find((x) => x.sku === l.sku && x.lot === l.lot && x.locationCode === l.locationCode)!;
        line.executedQty = (line.executedQty ?? 0) + l.qty;
      }
      d.executions = [...(d.executions ?? []), { executionId: next('QE'), state: 'APPLIED', evidenceRef: body.evidenceRef, executedBy: operator(request)?.subject ?? '', commitId: 'CM-x', rejectReason: null, lines: body.lines, createdAt: now() }];
      const done = (d.lines ?? []).every((l) => (l.executedQty ?? 0) >= (l.approvedQty ?? 0));
      d.state = done ? 'COMPLETED' : 'PARTIALLY_EXECUTED';
      return { status: 200, body: d };
    });
  }),

  http.get(`${API_BASE}/cdc-recalls`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    return HttpResponse.json({ items: store.recalls, nextCursor: null });
  }),
  http.get(`${API_BASE}/cdc-recalls/:recallId`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const r = store.recalls.find((x) => x.recallId === params.recallId);
    return r ? HttpResponse.json(r) : problem(404, 'NOT_FOUND');
  }),
  http.post(`${API_BASE}/cdc-recalls`, async ({ request }) => {
    if (!operator(request)) return unauthorized();
    const body = (await request.json()) as { sku: string; lots: string[]; reason: string; severity?: string; approvalRef?: string; externalRef?: string; note?: string };
    return idempotent(request, () => {
      if (!body.approvalRef) return problem(422, 'APPROVAL_REQUIRED');
      const r: Recall = {
        recallId: next('RC'),
        sku: body.sku,
        lots: body.lots,
        reason: body.reason,
        severity: body.severity ?? null,
        approvalRef: body.approvalRef,
        externalRef: body.externalRef ?? null,
        note: body.note ?? null,
        state: 'TRACING',
        issuedBy: operator(request)?.subject ?? '',
        centers: [],
        departures: [],
        traceFreshness: 'CURRENT',
        createdAt: now(),
      };
      store.recalls.unshift(r);
      return { status: 201, body: r };
    });
  }),
];
