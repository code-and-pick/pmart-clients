// 시뮬레이션 웹과 이어지는 곳 — 머리줄 버튼(목 모드 주소)·시뮬 라이더 꼬리표·관제 "시뮬 라이더만". 목(MSW) 기준.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../api/client';
import { as, renderAt } from '../test/render';
import { server } from '../test/server';
import { isSimRider, simulatorUrl } from './sim';

const at = '2026-11-18T05:00:00.000Z';
const board = {
  asOf: at,
  items: [
    { riderId: 'RD-7', nameMasked: '김*수', location: { lat: 35.15, lng: 129.06, recordedAt: at, receivedAt: at, quality: 'GOOD' }, stale: false, staleSinceSeconds: 5, activeDeliveries: [] },
    { riderId: 'RD-sim-01', nameMasked: '시*1', location: { lat: 35.16, lng: 129.05, recordedAt: at, receivedAt: at, quality: 'GOOD' }, stale: false, staleSinceSeconds: 3, activeDeliveries: [] },
  ],
};

describe('시뮬레이션 웹 연결', () => {
  it('시뮬 라이더는 RD-sim- 로 시작한다', () => {
    expect(isSimRider('RD-sim-01')).toBe(true);
    expect(isSimRider('RD-7')).toBe(false);
    expect(isSimRider(null)).toBe(false);
  });

  it('목 모드 머리줄에 시뮬레이터 버튼 — 새 탭으로 시뮬레이터 MOCK', async () => {
    expect(simulatorUrl()).toBe('http://localhost:5181/');
    renderAt('/deliveries', as.riderOps);
    const link = await screen.findByTestId('simulator-link');
    expect(link).toHaveAttribute('href', 'http://localhost:5181/');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('관제: 시뮬 라이더에 꼬리표, "시뮬 라이더만"으로 거른다', async () => {
    server.use(http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json(board)));
    renderAt('/control?mfcId=MFC-BSJ-01', as.riderOps);
    const rows = await screen.findAllByTestId('control-row');
    expect(rows).toHaveLength(2);
    // 꼬리표 대신 파란 번호(2026-11-24)
    const sim = rows.find((r) => r.id === 'control-RD-sim-01')!;
    expect(sim.querySelector('[data-sim="true"]')).toHaveClass('text-primary');
    expect(within(sim).queryByText('시뮬')).toBeNull();
    expect(rows.find((r) => r.id === 'control-RD-7')!.querySelector('[data-sim="true"]')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: '시험' }));
    expect(screen.getAllByTestId('control-row').map((r) => r.id)).toEqual(['control-RD-sim-01']);
  });
});