// 표 설정 톱니(2026-11-20 AWS) — 칸 끄기는 그 표에만 CSS 로, 첫 칸은 끌 수 없고, 이 브라우저에 기억
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('표 설정', () => {
  beforeEach(() => window.localStorage.removeItem('pmart.backoffice.table.orders'));

  it('주문 조회: 톱니 → 칸 목록(머리 칸 이름), 첫 칸은 못 끔, 끈 칸은 숨기고 기억, 기본으로', async () => {
    const user = userEvent.setup();
    renderAt('/orders', as.cs);
    await screen.findAllByTestId('order-row');
    await user.click(screen.getByTestId('table-settings-orders'));
    const dialog = screen.getByRole('dialog', { name: '표 설정' });
    expect(within(dialog).getByRole('checkbox', { name: '주문' })).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: '센터' }));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('pmart.backoffice.table.orders') ?? '{}')).toMatchObject({ hidden: [3] }));
    // 실서버 CSP(style-src 'self')가 페이지 안 <style> 을 막는다 — 칸마다 element.style 로 숨긴다(2026-11-20)
    const table = screen.getAllByTestId('order-row')[0]!.closest('table')!;
    await waitFor(() => expect((table.querySelectorAll('thead th')[3] as HTMLElement).style.display).toBe('none'));
    for (const row of screen.getAllByTestId('order-row')) expect((row.children[3] as HTMLElement).style.display).toBe('none');
    expect(table.parentElement?.parentElement?.querySelector('style')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: '기본으로' }));
    expect(JSON.parse(window.localStorage.getItem('pmart.backoffice.table.orders') ?? '{}')).toMatchObject({ hidden: [] });
    await waitFor(() => expect((screen.getAllByTestId('order-row')[0]!.children[3] as HTMLElement).style.display).toBe(''));
  });
});
