// ⚠ 화면 개발용 목(브라우저 목 서버에만 — 시험은 기본 handlers 를 그대로 쓴다): 대시보드 분석 구역이 그림을 그릴 수 있게
// 지금 시각 기준 최근 7일에 걸친 배송 몇십 건을 지어 execution 직원 배송 목록(GET /deliveries)에 더한다. 실제 서버 동작이 아니다.
// 거르기(주문·라이더·상태·묶음 ID 등)가 붙은 요청은 기본 목 핸들러로 넘긴다 — 배송 찾기 등 다른 화면 목은 그대로.
// (2026-11-21 더함) 지은 배송의 상세(GET /deliveries/{id})도 준다 — 단계 이력(가게 도착·고객 도착, 일부는 자동 완료)·주문 요약. 지은 배송이 아니면 기본 목으로.
// (2026-11-21 0.34.0) 목록 줄에 firstAssignedAt·arrivedAtStoreAt·arrivedAtCustomerAt·promisedAt·completionMethod — 이틀보다 오래된 배송은 null(배포 전 배정), 가게 도착을 안 누른 배송·고객 확인·자동 완료도 섞는다.
import { http, HttpResponse } from 'msw';

import type { components as ExecC } from '../api/generated/delivery-execution';
import { API_BASE } from '../api/client';
import { mockDeliveries, created, summary } from './deliveryHandlers';
import { operator, unauthorized } from './support';

type Summary = ExecC['schemas']['StaffDeliverySummary'];
type State = Summary['state'];
type Detail = ExecC['schemas']['DeliveryExecution'];
type History = ExecC['schemas']['StatusHistoryEntry'];

const PRODUCTS: ReadonlyArray<readonly [string, string | null, number]> = [
  ['그릭요거트 플레인 400g', null, 5980],
  ['유기농 바나나', '1송이', 4290],
  ['서울우유 1L', null, 2980],
  ['한돈 삼겹살 구이용', '500g', 15900],
  ['제주 감귤', '2kg', 12900],
  ['두부 찌개용 300g', null, 1980],
  ['계란 대란 15구', null, 6480],
];

/** 배송 상세(GET /deliveries/{id}) — 단계 이력(가게 도착·고객 도착 포함)과 주문 요약. 목록 줄에서 짓는다 */
const details = new Map<string, Detail>();

const MIN = 60_000;
const HOUR = 60 * MIN;

/** 정해진 씨앗의 가짜 난수(새로 고쳐도 같은 그림) */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function generate(now: number): Summary[] {
  const rand = rng(20261121);
  const riders = ['RD-7', 'RD-8'];
  const out: Summary[] = [];
  for (let i = 0; i < 64; i++) {
    // 앞쪽은 최근 몇 시간에 몰리게(최근 2시간 칸이 비지 않게), 나머지는 7일에 흩뿌림
    const ago = i < 12 ? rand() * 2.5 * HOUR : i < 26 ? rand() * 20 * HOUR : rand() * 6.8 * 24 * HOUR;
    const createdAt = now - ago;
    const findMs = (1 + rand() * 6) * MIN;
    const storeMs = (6 + rand() * 14) * MIN;
    const custMs = (8 + rand() * 22) * MIN;
    const r = rand();
    const recent = ago < 50 * MIN;
    let state: State = r < 0.78 ? 'COMPLETED' : r < 0.86 ? 'FAILED' : r < 0.9 ? 'CANCELLED' : 'FAILURE_REPORTED';
    if (recent) state = ago < findMs ? 'UNASSIGNED' : ago < findMs + storeMs ? 'ASSIGNED' : ago < findMs + storeMs + custMs ? 'PICKED_UP' : state;
    const assigned = state === 'UNASSIGNED' || state === 'CANCELLED' ? null : createdAt + findMs;
    const picked = assigned !== null && state !== 'ASSIGNED' ? assigned + storeMs : null;
    const done = state === 'COMPLETED' || state === 'FAILED' ? (picked ?? createdAt) + custMs : null;
    const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
    const orderNumber = String(70000000 + Math.floor(rand() * 9999999));
    // 0.34.0 필드: 이틀보다 오래된 배송은 배포 전 배정이라 모두 null. 그 뒤로도 가게 도착을 안 누른 배송(i%5===2) 몇 건, 재배정(i%13===3 — 첫 배정이 3분 앞)
    const fresh = ago < 2 * 24 * HOUR;
    const arrStoreRaw = picked !== null ? picked - (3 + rand() * 3) * MIN : state === 'ASSIGNED' && assigned !== null && ago > findMs + 4 * MIN ? assigned + 4 * MIN : null;
    const arrStore = i % 5 === 2 ? null : arrStoreRaw;
    const arrCust = picked !== null && done !== null ? done - (1 + rand() * 3) * MIN : null;
    const first = assigned !== null && i % 13 === 3 ? assigned - 3 * MIN : assigned;
    const method: Summary['completionMethod'] = state !== 'COMPLETED' ? null : i % 9 === 4 ? 'AUTO_COMPLETED' : i % 11 === 7 ? 'CUSTOMER_CONFIRMED' : i % 2 ? 'FACE' : 'CONTACTLESS';
    const row: Summary = {
      deliveryId: `DLV-AN-${i + 1}`,
      orderId: `ORD-AN-${i + 1}`,
      orderNumber: assigned !== null ? orderNumber : null,
      deliveryNumber: assigned !== null ? `${orderNumber}-1` : null,
      type: 'FORWARD',
      state,
      riderId: assigned !== null ? (riders[Math.floor(rand() * riders.length)] ?? 'RD-7') : null,
      mfcId: 'MFC-BSJ-01',
      createdAt: new Date(createdAt).toISOString(),
      assignedAt: iso(assigned),
      pickedUpAt: iso(picked),
      completedAt: iso(done),
      firstAssignedAt: fresh ? iso(first) : null,
      arrivedAtStoreAt: fresh ? iso(arrStore) : null,
      arrivedAtCustomerAt: fresh ? iso(arrCust) : null,
      // 약속 = 배정 시 확정 + 50분(한집·알뜰) — 배정 전·배포 전 null
      promisedAt: fresh && assigned !== null ? iso(createdAt + 50 * MIN) : null,
      completionMethod: method,
      version: 1,
    };
    out.push(row);
    // 이력: 배정 → 가게 도착(픽업 3~6분 전) → 픽업 → 고객 도착(끝 1~4분 전) → 완료/실패 등록·확정. 완료 몇 건은 자동 완료(SYSTEM_EVENT)
    const h: History[] = [];
    const add = (st: NonNullable<History['state']>, at: number | null, actor: NonNullable<History['actor']> = 'RIDER') => {
      if (at !== null && at <= now) h.push({ state: st, actor, occurredAt: new Date(at).toISOString(), recordedAt: new Date(at + 2_000).toISOString() });
    };
    add('ASSIGNED', first, 'SYSTEM_EVENT');
    add('ARRIVED_AT_STORE', arrStore);
    add('PICKED_UP', picked);
    add('ARRIVED_AT_CUSTOMER', arrCust);
    if (state === 'COMPLETED') add('COMPLETED', done, method === 'AUTO_COMPLETED' ? 'SYSTEM_EVENT' : method === 'CUSTOMER_CONFIRMED' ? 'CUSTOMER' : 'RIDER');
    if (state === 'FAILED') {
      add('FAILURE_REPORTED', done);
      add('FAILED', done === null ? null : done + 6 * MIN, 'OPERATOR');
    }
    if (state === 'FAILURE_REPORTED') add('FAILURE_REPORTED', (picked ?? createdAt) + custMs);
    if (state === 'CANCELLED') add('CANCELLED', createdAt + 12 * MIN, 'SYSTEM_EVENT');
    const lines = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, k) => {
      const [name, optionLabel, price] = PRODUCTS[(i + k * 3) % PRODUCTS.length] ?? ['상품', null, 1000];
      const qty = 1 + Math.floor(rand() * 3);
      return { orderLineId: `OL-AN-${i + 1}-${k + 1}`, name, optionLabel, qty, lineAmount: price * qty };
    });
    details.set(row.deliveryId ?? '', {
      deliveryId: row.deliveryId ?? '',
      orderId: row.orderId ?? '',
      orderNumber: row.orderNumber ?? null,
      deliveryNumber: row.deliveryNumber ?? null,
      type: 'FORWARD',
      purpose: 'DELIVERY',
      state,
      ...(row.riderId ? { riderId: row.riderId } : {}),
      mfcId: 'MFC-BSJ-01',
      mfcName: 'PMart 부산진구지점',
      ...(row.assignedAt ? { assignedAt: row.assignedAt } : {}),
      ...(row.completedAt ? { completedAt: row.completedAt } : {}),
      orderSummary: { orderNumber, itemAmount: lines.reduce((a, l) => a + l.lineAmount, 0), deliveryNote: i % 3 === 0 ? '문 앞에 두고 벨 눌러 주세요' : null, items: lines },
      history: h,
      version: 1,
    });
  }
  return out;
}

const generated = generate(Date.now());
const FILTERS = ['deliveryIds', 'orderId', 'orderNumber', 'riderId', 'state', 'type'];

export const analysisHandlers = [
  http.get(`${API_BASE}/deliveries`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    const q = new URL(request.url).searchParams;
    if (FILTERS.some((k) => q.get(k))) return undefined; // 기본 목으로
    const size = Number(q.get('size') ?? '20') || 20;
    const skip = Number(q.get('cursor') ?? '0') || 0;
    const oldest = q.get('sort') === 'OLDEST';
    const rows = [...mockDeliveries.map((d) => ({ ...summary(d), createdAt: created(d) })), ...generated].sort((a, b) => (oldest ? 1 : -1) * (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    const items = rows.slice(skip, skip + size);
    const nextCursor = skip + size < rows.length ? String(skip + size) : null;
    return HttpResponse.json({ items, page: { nextCursor, size } });
  }),
  http.get(`${API_BASE}/deliveries/:deliveryId`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const d = details.get(String(params['deliveryId']));
    return d ? HttpResponse.json(d) : undefined; // 지은 배송이 아니면 기본 목으로
  }),
];
