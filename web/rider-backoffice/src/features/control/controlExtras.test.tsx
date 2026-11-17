// 관제 보탬 — 거르기(배송 중·위치 끊김)·지도 자리 — 목(MSW) 기준. 실서버 확인은 아니다.
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

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
    await userEvent.click(screen.getByRole('tab', { name: '배송 중' }));
    expect(screen.getAllByTestId('control-row').map((r) => r.id)).toEqual(['control-RD-7']);
    await userEvent.click(screen.getByRole('tab', { name: '위치 끊김·없음' }));
    expect(screen.getAllByTestId('control-row').map((r) => r.id)).toEqual(['control-RD-8', 'control-RD-9']);
    expect(screen.getByRole('tab', { name: '위치 끊김·없음' })).toHaveAttribute('aria-selected', 'true');
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
