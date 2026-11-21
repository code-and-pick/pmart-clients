// 대시보드 분석 구역(2026-11-21) — 목(MSW) 기준. 셈(타일)·막대 누르면 목록·배송 번호 누르면 같은 자리 흐름·읽기 상한 알림.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';
import { ANALYSIS_MAX_PAGES } from './AnalysisSection';
import { dur, metrics, onTimeTotals, type Summary } from './analysisData';

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
  return [
    base(1, 'COMPLETED', { assignedAt: iso(now - 38 * MIN), pickedUpAt: iso(now - 30 * MIN), completedAt: iso(now - 20 * MIN) }),
    base(2, 'COMPLETED', { assignedAt: iso(now - 36 * MIN), pickedUpAt: iso(now - 28 * MIN), completedAt: iso(now - 10 * MIN) }),
    base(3, 'FAILED', { assignedAt: iso(now - 37 * MIN), pickedUpAt: iso(now - 30 * MIN), completedAt: iso(now - 15 * MIN) }),
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
    expect(m.phases?.segments.map((s) => s.key)).toEqual(['find', 'store', 'customer']);
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
