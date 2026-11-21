// ⚠ 화면 개발용 목(브라우저 목 서버에만 — 시험은 기본 handlers 를 그대로 쓴다): 대시보드 분석 구역이 그림을 그릴 수 있게
// 지금 시각 기준 최근 7일에 걸친 배송 몇십 건을 지어 execution 직원 배송 목록(GET /deliveries)에 더한다. 실제 서버 동작이 아니다.
// 거르기(주문·라이더·상태·묶음 ID 등)가 붙은 요청은 기본 목 핸들러로 넘긴다 — 배송 찾기 등 다른 화면 목은 그대로.
import { http, HttpResponse } from 'msw';

import type { components as ExecC } from '../api/generated/delivery-execution';
import { API_BASE } from '../api/client';
import { mockDeliveries, created, summary } from './deliveryHandlers';
import { operator, unauthorized } from './support';

type Summary = ExecC['schemas']['StaffDeliverySummary'];
type State = Summary['state'];

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
    out.push({
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
];
