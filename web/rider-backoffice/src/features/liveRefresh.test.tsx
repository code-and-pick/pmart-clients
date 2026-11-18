// 화면 자동 새로 고침(2026-11-18 — 백엔드 delivery 요청, 사용자 "배차 받은 라이더 정보가 바로바로 안 뜨는 것 같아"). 목(MSW) 기준.
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { as, renderAt } from '../test/render';

const count = (view: ReturnType<typeof renderAt>, path: string) => view.sent.filter((r) => new URL(r.url).pathname.endsWith(path)).length;

describe('자동 새로 고침', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('진행 중 배송 상세·배차 조회는 10초마다 다시 부른다', async () => {
    const view = renderAt('/deliveries/DLV-1', as.riderOps); // FAILURE_REPORTED — 진행 중
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(count(view, '/deliveries/DLV-1')).toBeGreaterThan(0));
    const [e0, d0] = [count(view, '/deliveries/DLV-1'), count(view, '/deliveries/DLV-1/dispatch')];
    await vi.advanceTimersByTimeAsync(10_500);
    await waitFor(() => expect(count(view, '/deliveries/DLV-1')).toBeGreaterThan(e0));
    expect(count(view, '/deliveries/DLV-1/dispatch')).toBeGreaterThan(d0);
  });

  it('끝난 배송(COMPLETED)은 다시 부르지 않는다', async () => {
    const view = renderAt('/deliveries/DLV-3', as.riderOps);
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(count(view, '/deliveries/DLV-3')).toBeGreaterThan(0));
    const e0 = count(view, '/deliveries/DLV-3');
    await vi.advanceTimersByTimeAsync(31_000);
    expect(count(view, '/deliveries/DLV-3')).toBe(e0);
  });

  it('배송 찾기 목록은 20초마다, 대시보드는 30초마다', async () => {
    const list = renderAt('/deliveries', as.riderOps);
    await waitFor(() => expect(count(list, '/deliveries')).toBeGreaterThan(0));
    const l0 = count(list, '/deliveries');
    await vi.advanceTimersByTimeAsync(20_500);
    await waitFor(() => expect(count(list, '/deliveries')).toBeGreaterThan(l0));
    list.unmount();

    const dash = renderAt('/', as.riderOps);
    await waitFor(() => expect(count(dash, '/delivery-stats')).toBeGreaterThan(0));
    const s0 = count(dash, '/delivery-stats');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(count(dash, '/delivery-stats')).toBe(s0);
    await vi.advanceTimersByTimeAsync(16_000);
    await waitFor(() => expect(count(dash, '/delivery-stats')).toBeGreaterThan(s0));
  });

  // activeDeliveryCount 는 서버가 아직 채우지 않아 운행 상태로 판정(백엔드 확인 2026-11-18)
  it('라이더 상세는 운행 중(ON_DUTY)일 때만 15초마다(RD-7 운행 중 / RD-8 운행 끝)', async () => {
    const busy = renderAt('/riders/RD-7', as.riderOps);
    await waitFor(() => expect(count(busy, '/riders/RD-7')).toBeGreaterThan(0));
    const b0 = count(busy, '/riders/RD-7');
    await vi.advanceTimersByTimeAsync(15_500);
    await waitFor(() => expect(count(busy, '/riders/RD-7')).toBeGreaterThan(b0));
    busy.unmount();

    const idle = renderAt('/riders/RD-8', as.riderOps);
    await waitFor(() => expect(count(idle, '/riders/RD-8')).toBeGreaterThan(0));
    const i0 = count(idle, '/riders/RD-8');
    await vi.advanceTimersByTimeAsync(31_000);
    expect(count(idle, '/riders/RD-8')).toBe(i0);
  });
});
