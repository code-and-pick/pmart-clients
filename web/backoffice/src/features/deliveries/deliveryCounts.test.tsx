// 배송 상태별 수 띠(execution 0.33.0 `GET /deliveries/counts`, DE-7 — 2026-11-20): 모든 직원, 목록과 같은 조건, 칸을 누르면 그 상태로
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';

describe('배송 상태별 수 띠', () => {
  it('진행 중·끝남 두 줄에 모든 상태 수(0 포함), 칸을 누르면 그 상태로 거르고 다시 누르면 풀린다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/deliveries', as.riderOps);
    const strip = await screen.findByTestId('delivery-counts');
    expect(strip).toHaveTextContent('진행 중');
    expect(strip).toHaveTextContent('끝남');
    const unassigned = within(strip).getByTestId('delivery-count-UNASSIGNED');
    await waitFor(() => expect(unassigned).toHaveTextContent(/미배정\d+/));
    expect(within(strip).getByTestId('delivery-count-CANCELLED')).toHaveTextContent(/취소\d+/);
    expect(view.sent.some((r) => new URL(r.url).pathname.endsWith('/deliveries/counts'))).toBe(true);

    await user.click(unassigned);
    await waitFor(() => expect(within(screen.getByTestId('delivery-counts')).getByTestId('delivery-count-UNASSIGNED')).toHaveAttribute('aria-current', 'true'));
    expect(view.sent.some((r) => new URL(r.url).pathname.endsWith('/deliveries') && new URL(r.url).searchParams.get('state') === 'UNASSIGNED')).toBe(true);
    await user.click(within(screen.getByTestId('delivery-counts')).getByTestId('delivery-count-UNASSIGNED'));
    await waitFor(() => expect(within(screen.getByTestId('delivery-counts')).getByTestId('delivery-count-UNASSIGNED')).not.toHaveAttribute('aria-current'));
  });

  it('못 읽으면 칸마다 "?"·"0 건이 아니에요"(0 으로 보이지 않는다)', async () => {
    server.use(http.get(`${API_BASE}/deliveries/counts`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 503, code: 'DEPENDENCY_UNAVAILABLE' }, { status: 503, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/deliveries', as.riderOps);
    expect(await screen.findByTestId('delivery-counts-failed')).toHaveTextContent('0 건이 아니에요');
    expect(screen.getByTestId('delivery-count-UNASSIGNED')).toHaveTextContent('?');
  });
});
