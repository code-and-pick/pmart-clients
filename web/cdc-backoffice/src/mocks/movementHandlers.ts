// cdc-inventory 0.20.0 목 — 재고 이동 이력 `GET /cdcs/{cdcId}/stock-movements`(LG-1). 시각은 지금 기준 최근 며칠로 만든다.
// 서버 규칙 흉내: sku 또는 locationCode 필수(400), 기간 31일 넘으면 400, sku·lot 거르기에 맞는 증감만, locationCode 로 거르면 그 칸에 증감 있는 SKU·LOT 의 다른 칸도.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components } from '../api/generated/cdc-inventory';
import { operator, problem, unauthorized } from './support';

type Movement = components['schemas']['StockMovement'];

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const A1 = { sku: 'SKU-1001', lot: 'LOT-A1' };
const PF = 'CDC01-A-5-63-01-2-1';
const RK = 'CDC01-A-5-03-02-1-1';

function seed(): Movement[] {
  return [
    { commitId: 'CM-910', postingKind: 'TOUT', appliedAt: ago(1), requestId: 'RQ-910', sourceSystem: 'cdc-outbound-service', sourceRef: 'DEP-0001', actorId: 'cdc-outbound-service', deltas: [{ ...A1, locationCode: PF, bucket: 'ON_HAND', delta: -30 }, { ...A1, locationCode: PF, bucket: 'RESERVED', delta: -30 }, { ...A1, locationCode: null, bucket: 'TRANSIT', delta: 30 }] },
    { commitId: 'CM-905', postingKind: 'MOVE', appliedAt: ago(3), requestId: 'RQ-905', sourceSystem: 'cdc-inbound-service', sourceRef: 'REPLENISHMENT_MOVE:PT-0002', actorId: 'SYSTEM', deltas: [{ ...A1, locationCode: RK, bucket: 'ON_HAND', delta: -24 }, { ...A1, locationCode: PF, bucket: 'ON_HAND', delta: 24 }] },
    { commitId: 'CM-900', postingKind: 'ALLOCATION', appliedAt: ago(5), requestId: 'RQ-900', sourceSystem: 'cdc-outbound-service', sourceRef: 'TRF-20261126-0001', actorId: 'cdc-outbound-service', deltas: [{ ...A1, locationCode: PF, bucket: 'RESERVED', delta: 40 }, { ...A1, locationCode: RK, bucket: 'RESERVED', delta: 30 }] },
    { commitId: 'CM-880', postingKind: 'CNT', appliedAt: ago(20), requestId: 'RQ-880', sourceSystem: 'cdc-backoffice-web', sourceRef: 'COUNT:CS-0001', actorId: 'OP-cdc-sup', deltas: [{ sku: 'SKU-1002', lot: 'LOT-B7', locationCode: 'CDC01-B-6-67-01-1-1', bucket: 'ON_HAND', delta: -2 }] },
    { commitId: 'CM-870', postingKind: 'QUALITY_HOLD', appliedAt: ago(30), requestId: 'RQ-870', sourceSystem: 'cdc-quality-service', sourceRef: 'HOLD:QH-0001', actorId: 'OP-cdc-sup', deltas: [{ sku: 'SKU-1001', lot: 'LOT-A2', locationCode: 'CDC01-A-5-04-02-1-1', bucket: 'HELD', delta: 20 }] },
    { commitId: 'CM-860', postingKind: 'TIN_ACK', appliedAt: ago(40), requestId: 'RQ-860', sourceSystem: 'mfc-inventory', sourceRef: 'RCP-0009', actorId: null, deltas: [{ ...A1, locationCode: null, bucket: 'TRANSIT', delta: -12 }] },
    { commitId: 'CM-800', postingKind: 'INITIAL_BALANCE', appliedAt: ago(100), requestId: 'RQ-800', sourceSystem: 'cdc-backoffice-web', sourceRef: 'APR-1', actorId: null, deltas: [{ ...A1, locationCode: RK, bucket: 'ON_HAND', delta: 700 }, { ...A1, locationCode: PF, bucket: 'ON_HAND', delta: 106 }, { sku: 'SKU-1002', lot: 'LOT-B7', locationCode: 'CDC01-B-6-67-01-1-1', bucket: 'ON_HAND', delta: 50 }] },
  ];
}

let rows = seed();
export function resetMovements() {
  rows = seed();
}

export const movementHandlers = [
  http.get(`${API_BASE}/cdcs/:cdcId/stock-movements`, ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!who.centers.includes(String(params.cdcId))) return problem(403, 'FORBIDDEN');
    const q = new URL(request.url).searchParams;
    const sku = q.get('sku');
    const lot = q.get('lot');
    const loc = q.get('locationCode');
    const kind = q.get('kind');
    if (!sku && !loc) return problem(400, 'VALIDATION_FAILED', [{ field: 'sku', reason: 'sku 또는 locationCode 필요' }]);
    const to = q.get('to') ? new Date(q.get('to')!) : new Date();
    const from = q.get('from') ? new Date(q.get('from')!) : new Date(to.getTime() - 7 * 86_400_000);
    if (to.getTime() - from.getTime() > 31 * 86_400_000) return problem(400, 'VALIDATION_FAILED', [{ field: 'from', reason: '최대 31일' }]);
    const match = (d: Movement['deltas'][number]) => (!sku || d.sku === sku) && (!lot || d.lot === lot);
    const items = rows
      .filter((m) => (!kind || m.postingKind === kind) && new Date(m.appliedAt) >= from && new Date(m.appliedAt) <= to)
      .map((m) => {
        const keep = m.deltas.filter(match);
        if (!loc) return keep.length ? { ...m, deltas: keep } : null;
        const here = keep.filter((d) => d.locationCode === loc);
        if (!here.length) return null;
        const keys = new Set(here.map((d) => `${d.sku}|${d.lot}`));
        return { ...m, deltas: keep.filter((d) => keys.has(`${d.sku}|${d.lot}`)) };
      })
      .filter((m): m is Movement => m !== null);
    const page = Number(q.get('page') ?? '0');
    const size = Number(q.get('size') ?? '50');
    return HttpResponse.json({ from: from.toISOString(), to: to.toISOString(), items: items.slice(page * size, page * size + size), page, size, hasNext: (page + 1) * size < items.length });
  }),
];
