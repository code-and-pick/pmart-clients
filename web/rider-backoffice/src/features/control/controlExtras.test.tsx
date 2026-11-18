// 관제 보탬 — 거르기(배송 중·위치 끊김)·지도 자리 — 목(MSW) 기준. 실서버 확인은 아니다.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { API_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const at = '2026-11-17T05:00:00.000Z';
const board = {
  asOf: at,
  items: [
    { riderId: 'RD-7', nameMasked: '김*수', location: { lat: 35.15, lng: 129.06, recordedAt: at, receivedAt: at, quality: 'GOOD' }, stale: false, staleSinceSeconds: 5, activeDeliveries: [{ deliveryId: 'DLV-1', stage: 'TO_CUSTOMER' }] },
    { riderId: 'RD-8', nameMasked: '이*희', location: { lat: 35.16, lng: 129.04, recordedAt: at, receivedAt: at, quality: 'GOOD' }, stale: true, staleSinceSeconds: 305, activeDeliveries: [] },
    { riderId: 'RD-9', nameMasked: '박*민', location: null, stale: true, staleSinceSeconds: null, activeDeliveries: [] },
    { riderId: 'RD-10', nameMasked: '최*영', location: { lat: 35.17, lng: 129.05, recordedAt: at, receivedAt: at, quality: 'GOOD' }, stale: false, staleSinceSeconds: 3, activeDeliveries: [] },
  ],
};

describe('관제 — 거르기·지도', () => {
  it('배송 중·위치 끊김(서버 stale 또는 위치 없음)으로 거르고 주소에 남긴다', async () => {
    server.use(http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json(board)));
    renderAt('/control?mfcId=MFC-BSJ-01', as.riderOps);
    expect(await screen.findAllByTestId('control-row')).toHaveLength(4);
    await userEvent.click(screen.getByRole('radio', { name: '배송 중' }));
    expect(screen.getAllByTestId('control-row').map((r) => r.id)).toEqual(['control-RD-7']);
    await userEvent.click(screen.getByRole('radio', { name: '위치 끊김·없음' }));
    expect(screen.getAllByTestId('control-row').map((r) => r.id)).toEqual(['control-RD-8', 'control-RD-9']);
    expect(screen.getByRole('radio', { name: '위치 끊김·없음' })).toHaveAttribute('aria-checked', 'true');
  });

  it('주소의 filter 로 바로 열리고, 맞는 라이더가 없으면 "없어요"', async () => {
    server.use(http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json({ asOf: at, items: [board.items[3]] })));
    renderAt('/control?mfcId=MFC-BSJ-01&filter=delivering', as.riderOps);
    expect(await screen.findByText('조건에 맞는 라이더가 없어요.')).toBeInTheDocument();
  });

  it('지도 키가 없는 환경에서는 지도 대신 안내, 표는 그대로', async () => {
    server.use(http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json(board)));
    renderAt('/control?mfcId=MFC-BSJ-01', as.riderOps);
    expect(await screen.findByTestId('map-unavailable')).toHaveTextContent('카카오 지도 키가 없어');
    expect(screen.getAllByTestId('control-row')).toHaveLength(4);
  });
});

describe('관제 — 처음 열 때', () => {
  it('센터를 안 골랐으면 첫 센터로 열린다', async () => {
    renderAt('/control', as.riderOps);
    expect(await screen.findAllByTestId('control-row')).not.toHaveLength(0);
    expect(screen.queryByText('센터를 고르면 그 센터의 운행 중 라이더가 보여요.')).not.toBeInTheDocument();
  });
});

describe('관제 — 오른쪽 상세 칸', () => {
  it('라이더 줄을 누르면 그 라이더의 진행 중 배송: 픽업지·주문번호·품목·요청사항·도착 예정, 전달지는 백엔드 대기', async () => {
    server.use(http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json(board)));
    const view = renderAt('/control?mfcId=MFC-BSJ-01', as.riderOps);
    expect(await screen.findByTestId('control-panel-empty')).toBeInTheDocument();
    const row = (await screen.findAllByTestId('control-row'))[0]!;
    await userEvent.click(within(row).getByText('김*수'));

    const panel = await screen.findByTestId('control-panel');
    expect(panel).toHaveTextContent('RD-7');
    const order = await within(panel).findByTestId('panel-order');
    expect(order).toHaveTextContent('48213075');
    expect(order).toHaveTextContent('PMart 부산진구지점');
    expect(order).toHaveTextContent('부산 부산진구 중앙대로');
    expect(order).toHaveTextContent('051-000-0000');
    expect(order).toHaveTextContent('그릭요거트 플레인 400g × 3');
    expect(order).toHaveTextContent('문 앞에 두고 벨 눌러 주세요');
    expect(within(panel).getByTestId('panel-drop-pending')).toHaveTextContent('백엔드 대기');
    expect(await within(panel).findByTestId('eta-detail')).toBeInTheDocument();
    expect(row).toHaveAttribute('aria-selected', 'true');
    // 전달지를 추측해 부르지 않는다(drop-info 는 라이더 본인만)
    expect(view.sent.some((r) => new URL(r.url).pathname.endsWith('/drop-info'))).toBe(false);
  });

  it('주소의 rider 로 바로 열리고, 진행 중 배송이 없으면 없다고·닫기', async () => {
    server.use(http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json(board)));
    renderAt('/control?mfcId=MFC-BSJ-01&rider=RD-10', as.riderOps);
    const panel = await screen.findByTestId('control-panel');
    expect(panel).toHaveTextContent('진행 중 배송이 없어요.');
    await userEvent.click(within(panel).getByRole('button', { name: '닫기' }));
    expect(await screen.findByTestId('control-panel-empty')).toBeInTheDocument();
  });

  it('표의 진행 중 배송 칸에 주문번호·픽업 지점·도착 예정이 한눈에', async () => {
    server.use(http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json({ asOf: at, items: [{ ...board.items[0], activeDeliveries: [{ deliveryId: 'DLV-1', stage: 'TO_CUSTOMER', etaDrop: at }] }] })));
    renderAt('/control?mfcId=MFC-BSJ-01', as.riderOps);
    const cell = await screen.findByTestId('row-delivery');
    expect(await within(cell).findByText(/#48213075/)).toHaveTextContent('픽업 PMart 부산진구지점');
    expect(cell).toHaveTextContent('도착 예정');
  });

  it('상세 칸의 배송·도착 예정은 10초마다 다시 불러온다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      server.use(http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json(board)));
      const view = renderAt('/control?mfcId=MFC-BSJ-01&rider=RD-7', as.riderOps);
      await screen.findByTestId('panel-order');
      const count = (suffix: string) => view.sent.filter((r) => new URL(r.url).pathname.endsWith(suffix)).length;
      const [d0, e0] = [count('/deliveries/DLV-1'), count('/deliveries/DLV-1/eta')];
      await vi.advanceTimersByTimeAsync(10_500);
      await waitFor(() => expect(count('/deliveries/DLV-1')).toBeGreaterThan(d0));
      expect(count('/deliveries/DLV-1/eta')).toBeGreaterThan(e0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('배송 내역을 못 읽으면 그 칸만 오류(다시 시도), 빈 값으로 보이지 않는다', async () => {
    server.use(
      http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json(board)),
      http.get(`${API_BASE}/deliveries/:deliveryId`, () => HttpResponse.json({ code: 'INTERNAL_ERROR', status: 500, title: 'x', traceId: 't' }, { status: 500 })),
    );
    renderAt('/control?mfcId=MFC-BSJ-01&rider=RD-7', as.riderOps);
    const card = await screen.findByTestId('panel-delivery');
    expect(await within(card).findAllByRole('button', { name: /다시/ })).not.toHaveLength(0);
    expect(within(card).queryByTestId('panel-order')).not.toBeInTheDocument();
  });
});
