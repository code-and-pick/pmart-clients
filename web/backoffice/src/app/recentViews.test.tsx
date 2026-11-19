// 최근 본 항목(2026-11-18). 2026-11-20 사용자 "대시보드가 메인인데 최근 본 항목이 없어 보이게 떠 있어야 하니" —
// 대시보드 줄은 뺐고, 찾기 전 빈 화면(통합 조회·배송 확인)에서만 보인다. 남기는 규칙(직원마다·못 읽으면 안 남김)은 그대로.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { server } from '../test/server';
import { as, renderAt } from '../test/render';

beforeEach(() => window.localStorage.clear());

describe('최근 본 항목', () => {
  it('대시보드에는 최근 본 줄이 없다', async () => {
    const user = userEvent.setup();
    renderAt('/deliveries/DLV-MOCK-1', as.csRider);
    await screen.findByTestId('execution-panel');
    await user.click(screen.getByTestId('nav-dashboard'));
    await screen.findByTestId('dash-my-work');
    expect(screen.queryByTestId('dash-recent')).not.toBeInTheDocument();
  });

  it('상세를 본 뒤 통합 조회 빈 화면에 화면 번호로 남는다 — 누르면 그 상세로', async () => {
    const user = userEvent.setup();
    renderAt('/deliveries/DLV-MOCK-1', as.csRider);
    await screen.findByTestId('execution-panel');
    await user.click(screen.getByRole('link', { name: '통합 조회' }));
    const guide = await screen.findByTestId('start-guide');
    expect(within(guide).getByRole('link', { name: /배송.*74939001-1/ })).toHaveAttribute('href', '/deliveries/DLV-MOCK-1');
  });

  it('직원마다 따로 — 다른 직원으로 들어오면 남의 목록이 보이지 않는다', async () => {
    const one = renderAt('/deliveries/DLV-MOCK-1', as.csRider);
    await screen.findByTestId('execution-panel');
    one.unmount();
    renderAt('/lookup', as.cs);
    await screen.findByRole('heading', { level: 1, name: '통합 조회' });
    expect(screen.queryByTestId('start-guide')).not.toBeInTheDocument();
  });

  it('상세를 못 읽으면 남기지 않는다', async () => {
    server.use(http.get(`${API_BASE}/deliveries/:deliveryId`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 404, code: 'NOT_FOUND', retryable: false }, { status: 404 })));
    const user = userEvent.setup();
    renderAt('/deliveries/DLV-NOPE', as.csRider);
    await screen.findAllByRole('alert');
    await user.click(screen.getByRole('link', { name: '통합 조회' }));
    await screen.findByRole('heading', { level: 1, name: '통합 조회' });
    expect(screen.queryByTestId('start-guide')).not.toBeInTheDocument();
  });
});
