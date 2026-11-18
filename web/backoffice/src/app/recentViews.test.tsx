// 대시보드 최근 본 항목(2026-11-18)
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { server } from '../test/server';
import { as, renderAt } from '../test/render';

beforeEach(() => window.localStorage.clear());

describe('최근 본 항목', () => {
  it('상세를 본 뒤 대시보드에 화면 번호로 남는다 — 누르면 그 상세로', async () => {
    const user = userEvent.setup();
    renderAt('/deliveries/DLV-MOCK-1', as.csRider);
    await screen.findByTestId('execution-panel');
    await user.click(screen.getByTestId('nav-dashboard'));
    const strip = await screen.findByTestId('dash-recent');
    const link = within(strip).getByRole('link', { name: /배송.*74939001-1/ });
    expect(link).toHaveAttribute('href', '/deliveries/DLV-MOCK-1');
  });

  it('본 것이 없으면 줄이 없다, 지우기를 누르면 사라진다', async () => {
    const user = userEvent.setup();
    const first = renderAt('/', as.csRider);
    await screen.findByTestId('dash-my-work');
    expect(screen.queryByTestId('dash-recent')).not.toBeInTheDocument();
    first.unmount();

    renderAt('/claims/CLM-MOCK-1', as.cs);
    await screen.findAllByText(/CLM-MOCK-1/);
    await user.click(screen.getByTestId('nav-dashboard'));
    await user.click(within(await screen.findByTestId('dash-recent')).getByRole('button', { name: '지우기' }));
    expect(screen.queryByTestId('dash-recent')).not.toBeInTheDocument();
  });

  it('직원마다 따로 — 다른 직원으로 들어오면 남의 목록이 보이지 않는다', async () => {
    const one = renderAt('/claims/CLM-MOCK-1', as.cs);
    await screen.findAllByText(/CLM-MOCK-1/);
    one.unmount();
    renderAt('/', as.csRider);
    await screen.findByTestId('dash-my-work');
    expect(screen.queryByTestId('dash-recent')).not.toBeInTheDocument();
  });

  it('상세를 못 읽으면 남기지 않는다', async () => {
    server.use(http.get(`${API_BASE}/claims/:claimId`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 404, code: 'NOT_FOUND', retryable: false }, { status: 404 })));
    const user = userEvent.setup();
    renderAt('/claims/CLM-NOPE', as.cs);
    await screen.findByRole('alert');
    await user.click(screen.getByTestId('nav-dashboard'));
    await screen.findByTestId('dash-my-work');
    expect(screen.queryByTestId('dash-recent')).not.toBeInTheDocument();
  });
});
