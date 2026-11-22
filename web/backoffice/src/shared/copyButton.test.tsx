// 번호 복사 단추(2026-11-18)
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';
import { CopyButton } from './CopyButton';

describe('번호 복사', () => {
  it('배송 상세 제목 옆 — 화면 배송 번호를 복사하고 "복사했어요"', async () => {
    const user = userEvent.setup(); // 시험용 클립보드
    renderAt('/deliveries/DLV-MOCK-1', as.csRider);
    await screen.findByText('D74939001');
    await user.click(screen.getByRole('button', { name: 'D74939001 복사' }));
    expect(await navigator.clipboard.readText()).toBe('D74939001');
    expect(screen.getAllByRole('status').some((s) => s.textContent === '복사했어요')).toBe(true);
  });

  it('시스템 번호 칸 — 줄마다 그 ID 를 복사', async () => {
    const user = userEvent.setup();
    renderAt('/deliveries/DLV-MOCK-1', as.csRider);
    const panel = await screen.findByTestId('system-numbers');
    await user.click(within(panel).getByText('시스템 번호'));
    await user.click(within(panel).getByRole('button', { name: '주문 ORD-MOCK-1001 복사' }));
    expect(await navigator.clipboard.readText()).toBe('ORD-MOCK-1001');
  });

  it('클립보드를 쓸 수 없으면 된 척하지 않는다', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(<CopyButton value="ABC" />);
    await user.click(screen.getByRole('button', { name: 'ABC 복사' }));
    expect(screen.getByRole('status')).toHaveTextContent('복사하지 못했어요');
  });
});
