// 대시보드 분석 구역(2026-11-21) — 목(MSW) 기준. 셈(타일)·막대 누르면 목록·배송 번호 누르면 같은 자리 흐름·읽기 상한 알림.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';
import { ANALYSIS_MAX_PAGES } from './AnalysisSection';
import { dur, flowSteps, isLate, lateness, metrics, onTimeTotals, phasesOf, type Summary } from './analysisData';

const MIN = 60_000;
const iso = (t: number) => new Date(t).toISOString();

function rows(now: number): Summary[] {
  // 지금 1시간 안 — 최근 2시간 틀의 막대에 들어간다
  const base = (i: number, state: Summary['state'], extra: Partial<Summary> = {}): Summary => ({
    deliveryId: `DLV-T${i}`,
    deliveryNumber: `5000000${i}-1`,
    orderNumber: `5000000${i}`,
    version: 1,
    type: 'FORWARD',
    state,
    riderId: 'RD-7',
    mfcId: 'MFC-BSJ-01',
    createdAt: iso(now - 40 * MIN),
    ...extra,
  });
  // 0.34.0 필드: 1 은 도착 시각·약속(지키는 중) 모두 있음, 2 는 도착 시각 없음(합친 구간) · 약속보다 5분 늦게 완료, 3 은 실패(약속 판정 안 함)
  return [
    base(1, 'COMPLETED', {
      assignedAt: iso(now - 38 * MIN),
      firstAssignedAt: iso(now - 38 * MIN),
      arrivedAtStoreAt: iso(now - 33 * MIN),
      pickedUpAt: iso(now - 30 * MIN),
      arrivedAtCustomerAt: iso(now - 22 * MIN),
      completedAt: iso(now - 20 * MIN),
      promisedAt: iso(now + 10 * MIN),
      completionMethod: 'FACE',
    }),
    base(2, 'COMPLETED', {
      assignedAt: iso(now - 36 * MIN),
      firstAssignedAt: null,
      arrivedAtStoreAt: null,
      pickedUpAt: iso(now - 28 * MIN),
      arrivedAtCustomerAt: null,
      completedAt: iso(now - 10 * MIN),
      promisedAt: iso(now - 15 * MIN),
      completionMethod: 'CONTACTLESS',
    }),
    base(3, 'FAILED', { assignedAt: iso(now - 37 * MIN), pickedUpAt: iso(now - 30 * MIN), completedAt: iso(now - 15 * MIN), promisedAt: iso(now - 30 * MIN), completionMethod: null }),
  ];
}

const serve = (items: readonly Summary[]) =>
  server.use(
    http.get(`${API_BASE}/deliveries`, ({ request }) => {
      if (new URL(request.url).searchParams.get('deliveryIds')) return undefined;
      return HttpResponse.json({ items, page: { nextCursor: null, size: 50 } });
    }),
  );

describe('대시보드 분석 셈', () => {
  it('완료율은 완료/(완료+실패), 한 건 평균은 완료 건의 생김 → 완료, 구간 셋', () => {
    const now = Date.now();
    const m = metrics(rows(now), now);
    expect(m.total).toBe(3);
    expect(Math.round((m.rate ?? 0) * 100)).toBe(67);
    expect(dur(m.avgTotalSec)).toBe('25분'); // (20 + 30) / 2
    expect(m.problems).toBe(1);
    // 1 은 도착 시각이 있어 다섯 구간 — 도착 시각을 잰 배송이 있으면 합친 구간(2 의 MFC 이동·대기 등)은 막대에 따로 두지 않는다(많아야 다섯 칸)
    expect(m.phases?.segments.map((s) => [s.key, s.n])).toEqual([
      ['find', 2],
      ['toStore', 1],
      ['atStore', 1],
      ['toCustomer', 1],
      ['atCustomer', 1],
    ]);
  });

  it('구간 다섯 — 첫 배정 우선, 도착 시각이 없거나 앞뒤가 안 맞으면 합친 구간, 고객 확인·자동 완료는 시간 평균에서 뺌', () => {
    const T = Date.UTC(2026, 10, 21, 3, 0, 0);
    const at = (m: number | null) => (m === null ? null : iso(T + m * MIN));
    const row = (id: string, x: { first?: number | null; assigned: number; store: number | null; picked: number; cust: number | null; done: number; method?: Summary['completionMethod'] }): Summary => ({
      deliveryId: id,
      version: 1,
      type: 'FORWARD',
      state: 'COMPLETED',
      createdAt: at(0)!,
      firstAssignedAt: at(x.first ?? null),
      assignedAt: at(x.assigned),
      arrivedAtStoreAt: at(x.store),
      pickedUpAt: at(x.picked),
      arrivedAtCustomerAt: at(x.cust),
      completedAt: at(x.done),
      completionMethod: x.method ?? 'FACE',
    });
    const list = [
      row('A', { first: 2, assigned: 5, store: 10, picked: 14, cust: 30, done: 33 }), // 재배정 — 찾기는 첫 배정(2분)까지
      row('B', { assigned: 4, store: null, picked: 16, cust: 28, done: 30 }), // 가게 도착 없음 → MFC 이동·대기 12분
      row('C', { assigned: 6, store: 12, picked: 18, cust: null, done: 40 }), // 고객 도착 없음 → 고객에게·고객 앞 22분
      row('F', { assigned: 3, store: 1, picked: 13, cust: 20, done: 25 }), // 가게 도착이 배정보다 앞 → 합친 구간
      row('D', { assigned: 1, store: 2, picked: 3, cust: 4, done: 90, method: 'AUTO_COMPLETED' }),
      row('E', { assigned: 1, store: 2, picked: 3, cust: 4, done: 90, method: 'CUSTOMER_CONFIRMED' }),
    ];
    const m = metrics(list, T + 100 * MIN);
    const p = phasesOf(list);
    expect(p?.n).toBe(4);
    expect(p?.excluded).toBe(2);
    const leg = Object.fromEntries((p?.segments ?? []).map((s) => [s.key, s]));
    expect(leg['find']).toMatchObject({ sec: 225, n: 4 }); // (2+4+6+3)/4 분
    expect(leg['toStore']).toMatchObject({ sec: 420, n: 2 }); // (8+6)/2
    expect(leg['atStore']).toMatchObject({ sec: 300, n: 2 }); // (4+6)/2
    expect(leg['store']).toBeUndefined(); // 나눈 구간이 있으면 합친 구간(B·F)은 막대에 없다
    expect(leg['toCustomer']?.n).toBe(3);
    expect(leg['toCustomer']?.sec).toBeCloseTo(700); // (16+12+7)/3 분
    expect(leg['atCustomer']?.sec).toBeCloseTo(200); // (3+2+5)/3 분
    expect(leg['customer']).toBeUndefined();
    expect(p?.totalSec).toBe(32 * 60); // (33+30+40+25)/4
    expect((p?.segments ?? []).reduce((a, s) => a + s.share, 0)).toBeCloseTo(1);
    // 한 건 평균도 고객 확인·자동 완료(90분)를 뺀다 · 라이더 찾기 평균은 완료 방법과 무관(6건, 첫 배정 우선)
    expect(m.avgTotalSec).toBe(32 * 60);
    expect(m.avgFindSec).toBeCloseTo(((2 + 4 + 6 + 3 + 1 + 1) / 6) * 60);
    expect(m.phases?.excluded).toBe(2);
  });

  it('지연 표시 — 약속보다 늦게 끝남·진행 중 약속 넘김만 늦음, 약속 없음·실패·고객 확인/자동 완료는 판정 없음', () => {
    const T = Date.UTC(2026, 10, 21, 3, 0, 0);
    const r = (state: Summary['state'], x: Partial<Summary>): Summary => ({ deliveryId: 'X', version: 1, type: 'FORWARD', state, createdAt: iso(T), ...x });
    const now = T + 60 * MIN;
    const late = lateness(r('COMPLETED', { promisedAt: iso(T + 50 * MIN), completedAt: iso(T + 57 * MIN), completionMethod: 'FACE' }), now);
    expect(late).toEqual({ judged: true, promised: T + 50 * MIN, late: true, lateSec: 420 });
    expect(dur(late.judged ? late.lateSec : null)).toBe('7분');
    expect(lateness(r('COMPLETED', { promisedAt: iso(T + 50 * MIN), completedAt: iso(T + 40 * MIN), completionMethod: 'CONTACTLESS' }), now)).toMatchObject({ judged: true, late: false });
    expect(isLate(r('PICKED_UP', { promisedAt: iso(T + 50 * MIN) }), now)).toBe(true); // 진행 중 — 지금이 약속을 넘음
    expect(isLate(r('PICKED_UP', { promisedAt: iso(T + 70 * MIN) }), now)).toBe(false);
    // 약속이 없으면 판정 없음 — 정시로도 세지 않는다
    expect(lateness(r('COMPLETED', { promisedAt: null, completedAt: iso(T + 90 * MIN), completionMethod: 'FACE' }), now)).toEqual({ judged: false });
    expect(lateness(r('PICKED_UP', {}), now)).toEqual({ judged: false });
    expect(lateness(r('COMPLETED', { promisedAt: iso(T + 50 * MIN), completedAt: iso(T + 90 * MIN), completionMethod: 'AUTO_COMPLETED' }), now)).toEqual({ judged: false });
    expect(lateness(r('COMPLETED', { promisedAt: iso(T + 50 * MIN), completedAt: iso(T + 90 * MIN), completionMethod: 'CUSTOMER_CONFIRMED' }), now)).toEqual({ judged: false });
    expect(lateness(r('FAILED', { promisedAt: iso(T + 50 * MIN), completedAt: iso(T + 90 * MIN) }), now)).toEqual({ judged: false });
  });

  it('흐름 단계 — 상세 이력이 없으면 목록의 첫 배정·가게 도착·고객 도착 시각으로', () => {
    const now = Date.now();
    const steps = flowSteps(rows(now)[0]!, undefined);
    expect(steps.map((s) => s.key)).toEqual(['created', 'ASSIGNED', 'ARRIVED_AT_STORE', 'PICKED_UP', 'ARRIVED_AT_CUSTOMER', 'COMPLETED']);
  });
});

describe('대시보드 분석 구역', () => {
  it('타일 수치 → 막대를 누르면 아래 목록 → 배송 번호를 누르면 같은 자리에 흐름', async () => {
    serve(rows(Date.now()));
    renderAt('/dashboard', as.riderOps);
    const section = await screen.findByTestId('analysis');
    expect(await within(section).findByTestId('an-tile-total')).toHaveTextContent('3건');
    expect(within(section).getByTestId('an-tile-rate')).toHaveTextContent('67%');
    expect(within(section).getByTestId('an-tile-problems')).toHaveTextContent('1건');
    const bar = within(section)
      .getAllByTestId('an-bar')
      .find((b) => /3건$/.test(b.getAttribute('aria-label') ?? ''));
    expect(bar).toBeDefined();
    await userEvent.click(bar!);
    const list = await within(section).findByTestId('an-bin-list');
    expect(within(list).getAllByTestId('an-open-delivery')).toHaveLength(3);
    await userEvent.click(within(list).getAllByTestId('an-open-delivery')[0]!);
    const flow = await within(section).findByTestId('an-flow');
    expect(flow).toHaveTextContent('라이더 배정');
    expect(flow).toHaveTextContent('픽업');
    // 같은 화면 그대로(다른 화면으로 넘어가지 않음)
    expect(screen.getByTestId('todo-strip')).toBeInTheDocument();
  });

  it('라이더별 띠의 표시를 누르면 표 아래에 그 배송 흐름', async () => {
    serve(rows(Date.now()));
    renderAt('/dashboard', as.riderOps);
    const table = await screen.findByTestId('an-riders');
    expect(table).toHaveTextContent('3건');
    await userEvent.click(within(table).getAllByTestId('an-mark')[0]!);
    expect(await screen.findByTestId('an-flow')).toHaveTextContent('배차 요청');
  });

  it('읽기 상한까지 읽어도 7일 앞에 못 닿으면 "일부만"을 알린다(숨기지 않음)', async () => {
    let calls = 0;
    const now = Date.now();
    server.use(
      http.get(`${API_BASE}/deliveries`, ({ request }) => {
        if (new URL(request.url).searchParams.get('deliveryIds')) return undefined;
        calls++;
        return HttpResponse.json({ items: rows(now).map((r) => ({ ...r, deliveryId: `${r.deliveryId}-${calls}` })), page: { nextCursor: `c${calls}`, size: 50 } });
      }),
    );
    renderAt('/dashboard', as.riderOps);
    expect(await screen.findByTestId('analysis-partial', {}, { timeout: 5_000 })).toBeInTheDocument();
    expect(calls).toBe(ANALYSIS_MAX_PAGES);
  });
});

describe('대시보드 분석 — 지연(정시 배송률)·펼친 흐름의 주문 내역·도착 시각', () => {
  it('정시율 셈은 서버 onTime/due 를 더한 것(판정 안 된 것·대기는 빼고)', () => {
    const s = onTimeTotals([
      { due: 10, onTime: 8, late: 2, unjudged: 1, pending: 0 },
      { due: 5, onTime: 5, late: 0, unjudged: 0, pending: 3 },
    ]);
    expect(s.late).toBe(2);
    expect(Math.round((s.rate ?? 0) * 100)).toBe(87);
    expect(onTimeTotals([]).rate).toBeNull();
  });

  it('관리자: 지연 타일 = dispatch 정시 배송률 late, 정시율·지금 배차 지연 — 실패·이상 타일도 그대로', async () => {
    let query = '';
    server.use(
      http.get(`${API_BASE}/metrics/on-time-deliveries`, ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json({
          asOf: new Date().toISOString(),
          items: [
            { date: '2026-11-20', mfcId: 'MFC-BSJ-01', due: 10, onTime: 8, late: 2, unjudged: 1, pending: 0 },
            { date: '2026-11-21', mfcId: 'MFC-BSJ-01', due: 5, onTime: 5, late: 0, unjudged: 0, pending: 3 },
          ],
        });
      }),
    );
    serve(rows(Date.now()));
    renderAt('/dashboard', as.admin);
    const tile = await screen.findByTestId('an-tile-late');
    await waitFor(() => expect(tile).toHaveTextContent('2건'));
    expect(tile).toHaveTextContent('정시율 87%');
    await waitFor(() => expect(tile).toHaveTextContent('지금 배차 지연 1건'));
    expect(tile).toHaveClass('bad');
    expect(query).toMatch(/from=\d{4}-\d{2}-\d{2}/);
    expect(query).not.toMatch(/mfcId/);
    expect(screen.getByTestId('an-tile-problems')).toHaveTextContent('1건');
  });

  it('관리자가 아니고 센터를 안 골랐으면 부르지 않고 "센터를 고르면 보여요"(0 으로 보이지 않음)', async () => {
    let called = false;
    server.use(
      http.get(`${API_BASE}/metrics/on-time-deliveries`, () => {
        called = true;
        return HttpResponse.json({ asOf: new Date().toISOString(), items: [] });
      }),
    );
    serve(rows(Date.now()));
    renderAt('/dashboard', as.riderOps);
    const tile = await screen.findByTestId('an-tile-late');
    expect(tile).toHaveTextContent('센터를 고르면 보여요');
    expect(tile).not.toHaveTextContent('0건');
    expect(called).toBe(false);
  });

  it('정시 배송률을 못 읽으면 "불러오지 못했어요"(0 이 아님)', async () => {
    server.use(http.get(`${API_BASE}/metrics/on-time-deliveries`, () => new HttpResponse(null, { status: 500 })));
    serve(rows(Date.now()));
    renderAt('/dashboard', as.admin);
    const tile = await screen.findByTestId('an-tile-late');
    await waitFor(() => expect(tile).toHaveTextContent('불러오지 못했어요'), { timeout: 5_000 });
    expect(tile).not.toHaveTextContent('0건');
  });

  it('흐름을 펼치면 상세 이력의 가게 도착·고객 도착 시각과 오른쪽 주문 내역(서버 금액 그대로), 자동 완료 표시', async () => {
    const now = Date.now();
    const at = (m: number) => iso(now - m * MIN);
    server.use(
      http.get(`${API_BASE}/deliveries/:deliveryId`, ({ params }) =>
        HttpResponse.json({
          deliveryId: String(params['deliveryId']),
          orderId: 'ORD-T',
          type: 'FORWARD',
          purpose: 'DELIVERY',
          state: 'COMPLETED',
          mfcId: 'MFC-BSJ-01',
          history: [
            { state: 'ASSIGNED', actor: 'SYSTEM_EVENT', occurredAt: at(38) },
            { state: 'ARRIVED_AT_STORE', actor: 'RIDER', occurredAt: at(33) },
            { state: 'PICKED_UP', actor: 'RIDER', occurredAt: at(30) },
            { state: 'ARRIVED_AT_CUSTOMER', actor: 'RIDER', occurredAt: at(22) },
            { state: 'COMPLETED', actor: 'SYSTEM_EVENT', occurredAt: at(20) },
          ],
          orderSummary: {
            orderNumber: '50000001',
            itemAmount: 17940,
            deliveryNote: '문 앞에 두세요',
            items: [{ orderLineId: 'OL-1', name: '그릭요거트 플레인 400g', optionLabel: '무가당', qty: 3, lineAmount: 17940 }],
          },
          version: 3,
        }),
      ),
    );
    serve(rows(now));
    renderAt('/dashboard', as.riderOps);
    const table = await screen.findByTestId('an-riders');
    await userEvent.click(within(table).getAllByTestId('an-mark')[0]!);
    const flow = await screen.findByTestId('an-flow');
    const order = within(flow).getByTestId('an-order');
    expect(await within(order).findByText('그릭요거트 플레인 400g')).toBeInTheDocument();
    expect(order).toHaveTextContent('무가당');
    expect(order).toHaveTextContent('3개');
    expect(order).toHaveTextContent('17,940원');
    expect(order).toHaveTextContent('문 앞에 두세요');
    const steps = within(flow).getByTestId('an-steps');
    expect(steps).toHaveTextContent('가게 도착');
    expect(steps).toHaveTextContent('고객 도착');
    expect(steps).toHaveTextContent('자동 완료');
  });

  it('늦은 배송만 목록·라이더 띠에 주황 고리, 펼치면 약속 시각과 "N분 늦음" · 약속 없는 건은 "판정 없음"', async () => {
    const now = Date.now();
    const list = [...rows(now), { ...rows(now)[0]!, deliveryId: 'DLV-T4', deliveryNumber: 'D50000004', orderNumber: '50000004', promisedAt: null }];
    serve(list);
    renderAt('/dashboard', as.riderOps);
    const section = await screen.findByTestId('analysis');
    const table = await within(section).findByTestId('an-riders');
    // 2 만 늦음(1 은 약속 안, 3 은 실패라 판정 안 함, 4 는 약속 없음)
    expect(within(table).getAllByTestId('an-mark').filter((b) => b.hasAttribute('data-late'))).toHaveLength(1);
    const bar = within(section)
      .getAllByTestId('an-bar')
      .find((b) => /4건$/.test(b.getAttribute('aria-label') ?? ''));
    await userEvent.click(bar!);
    const binList = await within(section).findByTestId('an-bin-list');
    expect(within(binList).getAllByTestId('an-late')).toHaveLength(1);
    const rowOf = (no: string) => within(binList).getAllByTestId('an-open-delivery').find((b) => b.textContent?.includes(no))!;
    await userEvent.click(rowOf('50000002'));
    const flow = await within(section).findByTestId('an-flow');
    expect(within(flow).getByTestId('an-promise')).toHaveTextContent('약속 시각');
    expect(within(flow).getByTestId('an-promise')).toHaveTextContent('5분 늦음');
    await userEvent.click(rowOf('50000004'));
    await waitFor(() => expect(within(section).getByTestId('an-promise')).toHaveTextContent('판정 없음'));
    expect(within(section).getByTestId('an-promise')).not.toHaveTextContent('약속 안에');
  });

  it('구간별 평균 — 구간마다 바탕 건수, 고객 확인·자동 완료는 뺀 건수만 짧게', async () => {
    const now = Date.now();
    const auto = { ...rows(now)[0]!, deliveryId: 'DLV-T5', deliveryNumber: 'D50000005', completedAt: iso(now - 1 * MIN), completionMethod: 'AUTO_COMPLETED' as const };
    serve([...rows(now), auto]);
    renderAt('/dashboard', as.riderOps);
    const journey = await screen.findByTestId('an-journey');
    expect(screen.getByTestId('an-phases-note')).toHaveTextContent('완료 2건 기준 · 고객 확인·자동 완료 1건 뺌');
    expect(within(journey).getByTestId('an-leg-find')).toHaveTextContent('2건');
    expect(within(journey).getByTestId('an-leg-toStore')).toHaveTextContent('MFC 이동');
    expect(within(journey).getByTestId('an-leg-toStore')).toHaveTextContent('1건');
    expect(within(journey).queryByTestId('an-leg-store')).not.toBeInTheDocument(); // 많아야 다섯 칸
    expect(within(journey).getByTestId('an-leg-atCustomer')).toHaveTextContent('고객 앞');
  });

  it('상세를 못 읽으면 주문 내역 자리에 실패 표시(빈 목록 아님), 흐름은 목록 시각으로', async () => {
    server.use(http.get(`${API_BASE}/deliveries/:deliveryId`, () => new HttpResponse(null, { status: 500 })));
    serve(rows(Date.now()));
    renderAt('/dashboard', as.riderOps);
    const table = await screen.findByTestId('an-riders');
    await userEvent.click(within(table).getAllByTestId('an-mark')[0]!);
    const flow = await screen.findByTestId('an-flow');
    await waitFor(() => expect(within(flow).getByTestId('an-order')).toHaveTextContent('불러오지 못했어요'), { timeout: 5_000 });
    expect(within(flow).getByTestId('an-steps')).toHaveTextContent('픽업');
  });
});
