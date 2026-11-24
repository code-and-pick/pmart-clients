// pricing-service·센터 취급(mfc/cdc-inventory) 목.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { SkuHandling } from '../api/models';
import { db, timestamp } from './db';
import { expectedVersion, idempotent, keyOf, operator, problem, unauthorized } from './support';

// 센터별 품절 수 — 목 화면(개발 서버)에서는 부산진구가 12초마다 9 ↔ 10(시각으로 정해 연결이 둘이어도 같은 값), 시험은 늘 9·3
const DEMO = import.meta.env.MODE !== 'test';
const DEMO_TICK_MS = 12_000;
const soldOutOf = (mfcId: string) => (mfcId === 'MFC-BSN-01' ? 9 + (DEMO ? Math.floor(Date.now() / DEMO_TICK_MS) % 2 : 0) : 3);

/** SSE 한 이벤트 글 */
const NL = String.fromCharCode(10);
export const sseEvent = (event: string, data: unknown, id?: string) => [...(id ? [`id: ${id}`] : []), `event: ${event}`, `data: ${JSON.stringify(data)}`, '', ''].join(NL);

function current(sku: string) {
  const list = db.prices.get(sku) ?? [];
  const effective = list.find((v) => v.state === 'EFFECTIVE');
  if (!effective) return null;
  const next = list.filter((v) => v.state === 'SCHEDULED').sort((a, b) => (a.effectiveFrom ?? '').localeCompare(b.effectiveFrom ?? ''))[0];
  return {
    sku,
    basePrice: effective.basePrice ?? 0,
    priceVersion: effective.priceVersion ?? 0,
    effectiveFrom: effective.effectiveFrom ?? '',
    ...(next ? { nextChange: { ...(next.basePrice === undefined ? {} : { basePrice: next.basePrice }), ...(next.effectiveFrom ? { effectiveFrom: next.effectiveFrom } : {}) } } : {}),
  };
}

const allSkus = () => [...db.products.values()].flatMap((p) => (p.skus ?? []).map((s) => ({ sku: s.sku, productId: p.productId ?? null })));

function handlingTable(centerId: string) {
  let t = db.handlings.get(centerId);
  if (!t) {
    t = new Map();
    db.handlings.set(centerId, t);
  }
  return t;
}

function viewHandling(centerId: string, sku: string, productId: string | null): SkuHandling {
  return handlingTable(centerId).get(sku) ?? { sku, handlingEnabled: false, version: 0, skuState: 'ACTIVE', productId, changedBy: null, reason: null, updatedAt: null };
}

function handlingHandlers(prefix: 'mfcs' | 'cdcs') {
  const allowed = (request: Request, centerId: string) => operator(request)?.centers.includes(centerId) ?? false;
  return [
    http.get(`${API_BASE}/${prefix}/:center/sku-handlings`, ({ request, params }) => {
      if (!operator(request)) return unauthorized();
      const centerId = String(params['center']);
      if (!allowed(request, centerId)) return problem(403, 'FORBIDDEN');
      const enabled = new URL(request.url).searchParams.get('enabled');
      const items = allSkus()
        .map((s) => viewHandling(centerId, s.sku, s.productId))
        .filter((h) => enabled === null || String(h.handlingEnabled) === enabled)
        .sort((a, b) => a.sku.localeCompare(b.sku));
      return HttpResponse.json({ centerId, items, page: { nextCursor: null, size: items.length } });
    }),
    http.post(`${API_BASE}/${prefix}/:center/sku-handlings`, async ({ request, params }) => {
      const who = operator(request);
      if (!who) return unauthorized();
      const body = (await request.json()) as { sku: string; enabled: boolean; reason?: string };
      return idempotent(request, () => {
        const centerId = String(params['center']);
        if (!allowed(request, centerId)) return problem(403, 'FORBIDDEN');
        const s = allSkus().find((x) => x.sku === body.sku);
        if (!s) return problem(404, 'SKU_NOT_FOUND');
        const cur = viewHandling(centerId, s.sku, s.productId);
        if (expectedVersion(request) !== undefined && expectedVersion(request) !== cur.version) return problem(409, 'VERSION_CONFLICT');
        const changed = cur.handlingEnabled !== body.enabled;
        const handling = changed
          ? { ...cur, handlingEnabled: body.enabled, version: cur.version + 1, changedBy: who.subject, reason: body.reason ?? null, updatedAt: timestamp() }
          : cur;
        if (changed) handlingTable(centerId).set(s.sku, handling);
        return { status: 200, body: { status: 'APPLIED', requestId: keyOf(request), changed, occurredAt: timestamp(), handling } };
      });
    }),
    http.post(`${API_BASE}/${prefix}/:center/sku-handling-batches`, async ({ request, params }) => {
      const who = operator(request);
      if (!who) return unauthorized();
      const body = (await request.json()) as { reason?: string; items: Array<{ sku: string; enabled: boolean; expectedVersion?: number }> };
      return idempotent(request, () => {
        const centerId = String(params['center']);
        if (!allowed(request, centerId)) return problem(403, 'FORBIDDEN');
        const skus = allSkus();
        const details = body.items.flatMap((it, i) => {
          const s = skus.find((x) => x.sku === it.sku);
          if (!s) return [{ field: `items[${i}]`, reason: 'SKU_NOT_FOUND' }];
          const cur = viewHandling(centerId, s.sku, s.productId);
          return it.expectedVersion !== undefined && it.expectedVersion !== cur.version ? [{ field: `items[${i}]`, reason: 'VERSION_CONFLICT' }] : [];
        });
        if (details.length > 0) return problem(422, 'SKU_HANDLING_BATCH_REJECTED', details);
        let changedCount = 0;
        const items = body.items.map((it) => {
          const s = skus.find((x) => x.sku === it.sku);
          const cur = viewHandling(centerId, it.sku, s?.productId ?? null);
          if (cur.handlingEnabled === it.enabled) return cur;
          changedCount++;
          const next = { ...cur, handlingEnabled: it.enabled, version: cur.version + 1, changedBy: who.subject, reason: body.reason ?? null, updatedAt: timestamp() };
          handlingTable(centerId).set(it.sku, next);
          return next;
        });
        return { status: 200, body: { status: 'APPLIED', requestId: keyOf(request), changedCount, occurredAt: timestamp(), items } };
      });
    }),
  ];
}

export const pricingHandlers = [
  // mfc-inventory 0.28.0 센터별 품절 상품 수(IV-5) — OPERATOR 만, 관리자는 모든 센터
  http.get(`${API_BASE}/stock-summaries`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const mfcId = new URL(request.url).searchParams.get('mfcId');
    const items = [
      { mfcId: 'MFC-BSN-01', handledSkuCount: 412, soldOutSkuCount: soldOutOf('MFC-BSN-01') },
      { mfcId: 'MFC-BSN-02', handledSkuCount: 388, soldOutSkuCount: soldOutOf('MFC-BSN-02') },
    ].filter((i) => !mfcId || i.mfcId === mfcId);
    return HttpResponse.json({ items, asOf: new Date().toISOString() });
  }),
  // mfc-inventory 0.46.0 재고 실시간 스트림(SSE) — 접속하면 ready, 5초마다 ": hb".
  // 목 화면(개발 서버)만: 12초마다 부산진구 품절 수를 9 ↔ 10 으로 바꾸고 summary-changed 를 보낸다(시험 모드는 ready 만 — 시험은 스트림을 직접 만든다).
  http.get(`${API_BASE}/stock-stream`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const asked = new URL(request.url).searchParams.getAll('mfcId');
    let seq = 0;
    const timers: ReturnType<typeof setInterval>[] = [];
    const stop = () => timers.splice(0).forEach(clearInterval);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        const send = (text: string) => {
          try {
            controller.enqueue(enc.encode(text));
          } catch {
            stop();
          }
        };
        send(sseEvent('ready', { type: 'ready', resumed: false, mfcIds: asked }));
        if (!DEMO) return;
        timers.push(setInterval(() => send(`: hb${NL}${NL}`), 5_000));
        timers.push(
          setInterval(() => {
            const mfcId = 'MFC-BSN-01';
            if (asked.length > 0 && !asked.includes(mfcId)) return;
            seq += 1;
            send(sseEvent('summary-changed', { type: 'summary-changed', eventId: `EV-MOCK-${seq}`, mfcId, skus: ['E-MILK-1L'], occurredAt: new Date().toISOString() }, `EV-MOCK-${seq}`));
          }, DEMO_TICK_MS),
        );
      },
      cancel: stop,
    });
    request.signal.addEventListener('abort', stop);
    return new HttpResponse(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
  }),
  // SKU 일괄 가격 조회(최대 100건, 계약 listPrices) — 가격 미설정 SKU 는 items 에서 빼고 notSet 에(2026-11-19 가격 관리 목록)
  http.get(`${API_BASE}/prices`, ({ request }) => {
    const skus = new URL(request.url).searchParams.getAll('skus').flatMap((s) => s.split(',')).filter(Boolean);
    if (skus.length > 100) return problem(400, 'VALIDATION_FAILED');
    const items = skus.flatMap((s) => {
      const p = current(s);
      return p ? [p] : [];
    });
    return HttpResponse.json({ asOf: timestamp(), items, notSet: skus.filter((s) => !current(s)) });
  }),
  http.get(`${API_BASE}/prices/:sku`, ({ params }) => {
    const p = current(String(params['sku']));
    return p ? HttpResponse.json(p) : problem(404, 'PRICE_NOT_SET');
  }),
  http.get(`${API_BASE}/price-versions/:sku`, ({ params }) => {
    const items = db.prices.get(String(params['sku'])) ?? [];
    return HttpResponse.json({ items, page: { nextCursor: null, size: items.length } });
  }),
  http.post(`${API_BASE}/price-version-applications`, async ({ request }) => {
    if (!operator(request)) return unauthorized();
    const body = (await request.json()) as { approvalId: string; items: Array<{ sku: string; basePrice: number; effectiveFrom: string }> };
    return idempotent(request, () => {
      const a = db.approvals.get(body.approvalId);
      if (!a || a.type !== 'PRICE' || a.reviewState !== 'APPROVED') return problem(422, 'APPROVAL_REQUIRED');
      const mismatch = body.items.flatMap((it, i) => {
        const line = (a.lines ?? []).find((l) => l.lineKey === it.sku);
        return !line || line.requestedAmount !== it.basePrice ? [{ field: `items[${i}]`, reason: 'APPROVAL_SCOPE_MISMATCH' }] : [];
      });
      if (mismatch.length > 0) return problem(422, 'APPROVAL_SCOPE_MISMATCH', mismatch);
      const requestId = keyOf(request);
      db.commandResults.set(requestId, {
        requestId,
        status: 'APPLIED',
        approvalId: a.approvalId,
        items: body.items.map((it) => {
          const v = (db.prices.get(it.sku) ?? []).find((x) => x.approvalId === a.approvalId);
          return v ? { sku: it.sku, priceVersion: v.priceVersion, state: v.state } : { sku: it.sku, state: 'REJECTED' };
        }),
      });
      return { status: 202, body: { status: 'ACCEPTED', requestId, occurredAt: timestamp() } };
    });
  }),
  http.get(`${API_BASE}/price-version-applications/:rid`, ({ params }) => {
    const r = db.commandResults.get(String(params['rid']));
    return r ? HttpResponse.json(r as Record<string, unknown>) : problem(404, 'NOT_FOUND');
  }),
  ...handlingHandlers('mfcs'),
  ...handlingHandlers('cdcs'),
];
