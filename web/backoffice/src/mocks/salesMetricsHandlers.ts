// ⚠ 화면 개발·시험용 목 — 대시보드 D2·D3(백엔드 PC 1 배포 2026-11-18):
//   order 0.13.0 `GET /orders/metrics/summary`·`GET /orders/metrics/top-products`, claim 0.5.0 `GET /claims/metrics/refunds`. 관리자만(그 밖 403).
// 주문 쪽은 같은 목 주문 조회(`/orders/lookups`·`/orders/{id}`)를 안에서 불러 세어 다른 화면과 숫자가 맞게. 환불은 고정 목 값.
// 기간 93일 넘으면 400(계약).
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { operator, problem, unauthorized } from './support';

const MAX_DAYS = 93;

function guard(request: Request) {
  const who = operator(request);
  if (!who) return unauthorized();
  if (!who.roles.includes('OPERATOR_ADMIN')) return problem(403, 'FORBIDDEN');
  const q = new URL(request.url).searchParams;
  const from = q.get('from');
  const to = q.get('to');
  if (!from || !to || to < from) return problem(400, 'VALIDATION_FAILED');
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > MAX_DAYS) return problem(400, 'VALIDATION_FAILED');
  return { from, to, mfcId: q.get('mfcId') };
}

async function ordersIn(request: Request, from: string, to: string, mfcId: string | null) {
  const qs = new URLSearchParams({ createdFrom: `${from}T00:00:00+09:00`, createdTo: `${to}T23:59:59.999+09:00`, page: '0', size: '100' });
  if (mfcId) qs.set('mfcId', mfcId);
  const r = await fetch(`${API_BASE}/orders/lookups?${qs.toString()}`, { headers: { Authorization: request.headers.get('Authorization') ?? '' } });
  if (!r.ok) return null;
  const body = (await r.json()) as { items: Array<{ orderId: string; status: string; approvedAmount: number }> };
  return body.items;
}

export const salesMetricsHandlers = [
  http.get(`${API_BASE}/orders/metrics/summary`, async ({ request }) => {
    const g = guard(request);
    if (g instanceof Response) return g;
    const items = await ordersIn(request, g.from, g.to, g.mfcId);
    if (!items) return problem(503, 'DEPENDENCY_UNAVAILABLE');
    const byStatus = new Map<string, number>();
    for (const o of items) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
    return HttpResponse.json({
      from: g.from,
      to: g.to,
      mfcId: g.mfcId,
      orderCount: items.length,
      statusCounts: [...byStatus.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([status, count]) => ({ status, count })),
      approvedAmount: items.reduce((n, o) => n + o.approvedAmount, 0),
      approvedOrderCount: items.length,
    });
  }),

  http.get(`${API_BASE}/orders/metrics/top-products`, async ({ request }) => {
    const g = guard(request);
    if (g instanceof Response) return g;
    const limit = Math.min(50, Math.max(1, Number(new URL(request.url).searchParams.get('limit') ?? '10') || 10));
    const items = await ordersIn(request, g.from, g.to, g.mfcId);
    if (!items) return problem(503, 'DEPENDENCY_UNAVAILABLE');
    const bySku = new Map<string, { sku: string; productId: string | null; qty: number; amount: number }>();
    for (const o of items) {
      const r = await fetch(`${API_BASE}/orders/lookups/${encodeURIComponent(o.orderId)}`, { headers: { Authorization: request.headers.get('Authorization') ?? '' } });
      if (!r.ok) continue;
      const d = (await r.json()) as { lines?: Array<{ sku: string; productId?: string; lineAmount: number; originalQty: number; cancelledBeforeShipQty?: number }> };
      for (const l of d.lines ?? []) {
        const left = l.originalQty - (l.cancelledBeforeShipQty ?? 0);
        if (left <= 0) continue;
        const cur = bySku.get(l.sku) ?? { sku: l.sku, productId: l.productId ?? null, qty: 0, amount: 0 };
        cur.qty += left;
        cur.amount += Math.floor((l.lineAmount * left) / Math.max(1, l.originalQty));
        bySku.set(l.sku, cur);
      }
    }
    const top = [...bySku.values()].sort((a, b) => b.qty - a.qty || b.amount - a.amount).slice(0, limit);
    // 목 주문 줄에 productId 가 없으면 SKU 로 상품을 찾아 채운다(실서버 주문 줄에는 productId 가 있다)
    for (const t of top)
      if (!t.productId) {
        const r = await fetch(`${API_BASE}/skus/${encodeURIComponent(t.sku)}`, { headers: { Authorization: request.headers.get('Authorization') ?? '' } });
        if (r.ok) t.productId = ((await r.json()) as { productId?: string }).productId ?? null;
      }
    return HttpResponse.json({ from: g.from, to: g.to, mfcId: g.mfcId, limit, items: top });
  }),

  http.get(`${API_BASE}/claims/metrics/refunds`, ({ request }) => {
    const g = guard(request);
    if (g instanceof Response) return g;
    // 고정 목 값 — 늘 다섯 줄(CANCEL·SHORTAGE·RETURN·RETURN_FEE·OTHER 순, 0 포함)
    const byReason = [
      { reason: 'CANCEL', amount: 15100, count: 1 },
      { reason: 'SHORTAGE', amount: 4500, count: 1 },
      { reason: 'RETURN', amount: 12000, count: 1 },
      { reason: 'RETURN_FEE', amount: 0, count: 0 },
      { reason: 'OTHER', amount: 0, count: 0 },
    ];
    return HttpResponse.json({ from: g.from, to: g.to, totalAmount: byReason.reduce((n, r) => n + r.amount, 0), totalCount: byReason.reduce((n, r) => n + r.count, 0), byReason });
  }),
];
