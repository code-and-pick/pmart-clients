// cdc-inventory 0.22.0 목 — 운송 중 재고 직원 조회 `GET /cdcs/{cdcId}/transits`(MF-1). 출발 최신 순, date·mfcId·state·trfId 거르기, 쪽 나눔.
// 시연 값(가짜): T553019 는 박스 하나가 빠져 8개 안 맞음, TRF-…-0001 은 다 맞음(입고 완료), 0011 은 MFC 입고 전.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components } from '../api/generated/cdc-inventory';
import { operator, problem, unauthorized } from './support';

type CenterTransit = components['schemas']['CenterTransit'];

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const seoulDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(iso));

function seed(): CenterTransit[] {
  return [
    {
      transit: { trfId: 'TRF-20261127-0011', departureId: 'DEP-0003', mfcId: 'MFC-BNG-01', state: 'TRANSIT_OPEN', departedAt: ago(20), reconciledAt: null, receiptIds: [], firstReceiptAt: null, lastReceiptAt: null, lines: [{ sku: 'SKU-2001', lot: 'LOT-B1', q: 18, r: 0, normalQty: 0, quarantinedQty: 0, pendingQty: 0, l: 0, t: 18 }] },
      departureSource: 'REAL',
      totals: { departedQty: 18, receivedQty: 0, receivedNormalQty: 0, quarantinedQty: 0, pendingQty: 0, lossQty: 0, unreconciledQty: 18 },
      closure: null,
    },
    {
      transit: {
        trfId: 'TRF-20261126-0001',
        departureId: 'DEP-0001',
        mfcId: 'MFC-BJG-01',
        state: 'TRANSIT_RECONCILED',
        departedAt: ago(90),
        reconciledAt: ago(15),
        receiptIds: ['RCP-0012'],
        firstReceiptAt: ago(15),
        lastReceiptAt: ago(15),
        lines: [
          { sku: 'SKU-1001', lot: 'LOT-A1', q: 32, r: 32, normalQty: 32, quarantinedQty: 0, pendingQty: 0, l: 0, t: 0 },
          { sku: 'SKU-1002', lot: 'LOT-A2', q: 20, r: 20, normalQty: 18, quarantinedQty: 2, pendingQty: 0, l: 0, t: 0 },
        ],
      },
      departureSource: 'REAL',
      totals: { departedQty: 52, receivedQty: 52, receivedNormalQty: 50, quarantinedQty: 2, pendingQty: 0, lossQty: 0, unreconciledQty: 0 },
      closure: { closedAt: ago(14), sourceRef: 'RCP-0012', sourceSystem: 'mfc-inbound-service' },
    },
    {
      transit: {
        trfId: 'TRF-20261125-0009',
        departureId: 'DEP-0000',
        mfcId: 'MFC-SEJ-01',
        state: 'RECEIPT_POSTED_AWAITING_ACK',
        departedAt: ago(180),
        reconciledAt: null,
        receiptIds: ['RCP-0009'],
        firstReceiptAt: ago(40),
        lastReceiptAt: ago(40),
        lines: [{ sku: 'SKU-1001', lot: 'LOT-A1', q: 40, r: 32, normalQty: 32, quarantinedQty: 0, pendingQty: 0, l: 0, t: 8 }],
      },
      departureSource: 'REAL',
      totals: { departedQty: 40, receivedQty: 32, receivedNormalQty: 32, quarantinedQty: 0, pendingQty: 0, lossQty: 0, unreconciledQty: 8 },
      closure: null,
    },
  ];
}

export const transitHandlers = [
  http.get(`${API_BASE}/cdcs/:cdcId/transits`, ({ request, params }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!who.centers.includes(String(params.cdcId))) return problem(403, 'FORBIDDEN');
    const u = new URL(request.url);
    const date = u.searchParams.get('date');
    const mfcId = u.searchParams.get('mfcId');
    const state = u.searchParams.get('state');
    const trfId = u.searchParams.get('trfId');
    const page = Number(u.searchParams.get('page') ?? '0');
    const size = Number(u.searchParams.get('size') ?? '50');
    const all = seed().filter(
      (x) =>
        (!date || (x.transit.departedAt && seoulDay(x.transit.departedAt) === date)) &&
        (!mfcId || x.transit.mfcId === mfcId) &&
        (!state || x.transit.state === state) &&
        (!trfId || x.transit.trfId === trfId),
    );
    const items = all.slice(page * size, page * size + size);
    return HttpResponse.json({ items, page, size, hasNext: (page + 1) * size < all.length });
  }),
];
