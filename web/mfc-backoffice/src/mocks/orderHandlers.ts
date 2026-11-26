// 센터 주문 지표 목 — order-service 0.20.0(O-11) `GET /orders/metrics/series`·`/top-products`, product `GET /categories/tree`,
// 상품 이름은 mfc-inventory `GET /mfcs/{mfcId}/stocks?sku=`(CenterStock.productName). 값은 orderSim(결정적).
// 서버 규칙 중 화면이 보여 줄 것만: MFC_SUPERVISOR 는 mfcId 필수(400)·토큰 센터만(403), 기간 상한(HOUR·DAY 93일·WEEKDAY_HOUR 366일),
// 0건 칸 없음, 칸 오름차순, sku·categoryId 로 거르면 approvedAmount null. 목 주문은 부산(MFC-BJG-01)에만 있다.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { db } from './db';
import { SIM_CATEGORIES, SIM_PRODUCTS, simAt } from './orderSim';
import { operator, problem, unauthorized } from './support';
import { DEMO_HOME, demoScale, hasDemoData, scaled } from './demoCenters';

// 다른 센터(브라우저 목)는 부산진구 식에 센터 규모를 곱한다(demoCenters)
const scaleSim = (v: { orders: number; amount: number; qty: number }, mfcId: string | null) =>
  mfcId === null || mfcId === DEMO_HOME ? v : { orders: scaled(v.orders, mfcId), amount: Math.round(v.amount * demoScale(mfcId)), qty: scaled(v.qty, mfcId) };
const seoulNow = () => {
  const now = new Date();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hourCycle: 'h23' }).format(now));
  return { day, hour };
};
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const span = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
const iso = /^\d{4}-\d{2}-\d{2}$/;

/** 권한·센터·기간 검사 — 통과하면 null */
function guard(request: Request, q: URLSearchParams, maxDays: number) {
  const op = operator(request);
  if (!op) return unauthorized();
  const mfcId = q.get('mfcId');
  if (!op.roles.includes('OPERATOR_ADMIN')) {
    if (!op.roles.includes('MFC_SUPERVISOR')) return problem(403, 'FORBIDDEN');
    if (!mfcId) return problem(400, 'VALIDATION_FAILED');
    if (!op.centers.includes(mfcId)) return problem(403, 'FORBIDDEN');
  }
  const from = q.get('from') ?? '';
  const to = q.get('to') ?? '';
  if (!iso.test(from) || !iso.test(to) || from > to || span(from, to) > maxDays) return problem(400, 'VALIDATION_FAILED');
  return null;
}

/** 그 날의 시각들 — 오늘은 지금 시각까지 */
const hoursOf = (d: string) => {
  const now = seoulNow();
  if (d > now.day) return [];
  return Array.from({ length: d === now.day ? now.hour + 1 : 24 }, (_, h) => h);
};

const filterOf = (q: URLSearchParams) => ({ sku: q.get('sku'), category: q.get('categoryId') });

export const orderHandlers = [
  http.get(`${API_BASE}/orders/metrics/series`, ({ request }) => {
    const q = new URL(request.url).searchParams;
    const bucket = q.get('bucket') ?? '';
    if (!['HOUR', 'DAY', 'WEEKDAY_HOUR'].includes(bucket)) return problem(400, 'VALIDATION_FAILED');
    const bad = guard(request, q, bucket === 'WEEKDAY_HOUR' ? 366 : 93);
    if (bad) return bad;
    const from = q.get('from')!;
    const to = q.get('to')!;
    const f = filterOf(q);
    const filtered = !!(f.sku || f.category);
    const mfcId = q.get('mfcId');
    const base = { from, to, mfcId, bucket, sku: f.sku, categoryId: f.category };
    if (mfcId && !hasDemoData(mfcId)) return HttpResponse.json({ ...base, items: [] });
    type Acc = { orderCount: number; amount: number; qty: number };
    const acc = new Map<string, Acc & { days?: number; weekday?: number; hour?: number }>();
    const add = (key: string, v: { orders: number; amount: number; qty: number }, extra: { weekday?: number; hour?: number } = {}) => {
      const a = acc.get(key) ?? { orderCount: 0, amount: 0, qty: 0, ...extra };
      a.orderCount += v.orders;
      a.amount += v.amount;
      a.qty += v.qty;
      acc.set(key, a);
    };
    // 요일 × 시각의 분모 — 그 요일이 기간에 든 날 수
    const weekdayDays = [0, 0, 0, 0, 0, 0, 0];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const wd = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7; // 월 0
      weekdayDays[wd]! += 1;
      for (const h of hoursOf(d)) {
        const v = scaleSim(simAt(d, h, f), mfcId);
        const hh = String(h).padStart(2, '0');
        if (bucket === 'HOUR') add(`${d}T${hh}:00:00+09:00`, v);
        else if (bucket === 'DAY') add(`${d}T00:00:00+09:00`, v);
        else add(`${wd + 1}-${hh}`, v, { weekday: wd + 1, hour: h });
      }
    }
    const items = [...acc.entries()]
      .filter(([, a]) => a.orderCount > 0 || a.qty > 0)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, a]) => {
        const days = a.weekday ? weekdayDays[a.weekday - 1]! : null;
        const round2 = (n: number) => Math.round(n * 100) / 100;
        return {
          start: bucket === 'WEEKDAY_HOUR' ? null : key,
          weekday: a.weekday ?? null,
          hour: a.hour ?? null,
          days,
          orderCount: a.orderCount,
          approvedAmount: filtered ? null : a.amount,
          qty: a.qty,
          lineAmount: a.amount,
          avgOrderCount: days ? round2(a.orderCount / days) : null,
          avgLineAmount: days ? round2(a.amount / days) : null,
        };
      });
    return HttpResponse.json({ ...base, items });
  }),

  http.get(`${API_BASE}/orders/metrics/top-products`, ({ request }) => {
    const q = new URL(request.url).searchParams;
    const bad = guard(request, q, 93);
    if (bad) return bad;
    const from = q.get('from')!;
    const to = q.get('to')!;
    const mfcId = q.get('mfcId');
    const limit = Math.min(50, Math.max(1, Number(q.get('limit') ?? 10)));
    const category = q.get('categoryId');
    const base = { from, to, mfcId, limit };
    if (mfcId && !hasDemoData(mfcId)) return HttpResponse.json({ ...base, items: [] });
    const items = SIM_PRODUCTS.filter((p) => !category || p.category === category)
      .map((p) => {
        let qty = 0;
        let amount = 0;
        for (let d = from; d <= to; d = addDays(d, 1))
          for (const h of hoursOf(d)) {
            const v = scaleSim(simAt(d, h, { sku: p.sku }), mfcId);
            qty += v.qty;
            amount += v.amount;
          }
        const c = SIM_CATEGORIES.find((x) => x.id === p.category);
        return { sku: p.sku, productId: `PRD-${p.sku}`, qty, amount, categoryId: p.category, categoryName: c?.name ?? null };
      })
      .filter((x) => x.qty > 0)
      .sort((a, b) => b.amount - a.amount || b.qty - a.qty || a.sku.localeCompare(b.sku))
      .slice(0, limit);
    return HttpResponse.json({ ...base, items });
  }),

  // 공개 — 비회원도(security: [])
  http.get(`${API_BASE}/categories/tree`, () =>
    HttpResponse.json({
      version: 1,
      effectiveFrom: '2026-11-01T00:00:00Z',
      nodes: SIM_CATEGORIES.map((c, i) => ({ categoryId: c.id, parentId: null, level: 'TOP', section: null, name: c.name, path: c.name, sortOrder: i, exposed: true })),
    }),
  ),

  // 센터 재고 묶음 — 목은 주문 시뮬레이션 상품 이름만(다른 SKU 는 이름 없음)
  http.get(`${API_BASE}/mfcs/:mfcId/stocks`, ({ request, params }) => {
    const op = operator(request);
    if (!op) return unauthorized();
    const mfcId = String(params.mfcId);
    if (!op.centers.includes(mfcId)) return problem(403, 'FORBIDDEN');
    const skus = [...new Set(new URL(request.url).searchParams.getAll('sku'))];
    if (skus.length < 1 || skus.length > 100) return problem(400, 'VALIDATION_FAILED');
    // LOT 요약은 목 센터 재고(db.stockUnits)에서 — 단건 /stock 목과 같은 계산(목록의 보유·가용·격리 칸)
    const items = skus.map((sku) => {
      const units = db.stockUnits
        .filter((u) => u.mfcId === mfcId && u.sku === sku)
        .map((u) => ({ locationCode: u.locationCode, lotId: u.lotId, qualityState: u.qualityState, workState: u.workState, qty: u.qty }));
      const lots = [...new Set(units.map((u) => u.lotId))].map((lotId) => {
        const of = units.filter((u) => u.lotId === lotId);
        const onHand = of.reduce((n, u) => n + u.qty, 0);
        const quarantined = of.filter((u) => u.qualityState === 'QUARANTINED').reduce((n, u) => n + u.qty, 0);
        const sellable = onHand - quarantined;
        return { lotId, tracking: 'TRACKED', expiryDate: null, manufactureDate: null, onHand, quarantined, sellable, reserved: 0, available: sellable };
      });
      const name = SIM_PRODUCTS.find((p) => p.sku === sku)?.name ?? db.stockUnits.find((u) => u.sku === sku)?.productName ?? null;
      return { mfcId, sku, productName: name, barcodes: [], lots, units };
    });
    return HttpResponse.json({ mfcId, items, asOf: new Date().toISOString() });
  }),
];
