// 주문 화면 화면 번호(ADR-0070, 2026-11-18 — 다른 화면은 다 번호인데 주문만 시스템 ID 였다)
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('주문 화면 번호', () => {
  it('주문번호 8자리로 찾으면 orderNumber 로 묻고, 목록 첫 칸은 주문번호 — 링크는 시스템 ID', async () => {
    const user = userEvent.setup();
    const view = renderAt('/orders', as.cs);
    await user.type(await screen.findByLabelText('주문번호 또는 주문 ID'), '74939003');
    await user.click(screen.getByRole('button', { name: '찾기' }));
    const row = (await screen.findAllByTestId('order-row'))[0]!;
    const link = within(row).getByTestId('order-number');
    expect(link).toHaveTextContent('74939003');
    expect(link).toHaveAttribute('href', '/orders/ORD-MOCK-1003');
    // 화면을 열면 기간 목록을 먼저 묻는다 — 찾기를 누른 뒤 마지막 요청을 본다
    const get = view.sent.filter((r) => new URL(r.url).pathname.endsWith('/orders/lookups')).at(-1)!;
    expect(new URL(get.url).searchParams.get('orderNumber')).toBe('74939003');
    expect(new URL(get.url).searchParams.has('orderId')).toBe(false);
  });

  it('주문 상세 제목 옆은 주문번호, 시스템 ID 는 "시스템 번호" 칸에', async () => {
    renderAt('/orders/ORD-MOCK-1003', as.cs);
    expect(await screen.findByTestId('order-head-number')).toHaveTextContent('74939003');
    expect(within(screen.getByTestId('system-numbers')).getByText('ORD-MOCK-1003')).toBeInTheDocument();
  });
});
