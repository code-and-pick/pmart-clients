// 왼쪽 메뉴 접기(2026-11-19 — 좁은 화면에서 본문이 답답하다)
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

beforeEach(() => window.localStorage.clear());
afterEach(() => Object.defineProperty(window, 'innerWidth', { value: 1440, writable: true, configurable: true }));

describe('왼쪽 메뉴 접기', () => {
  it('접기 단추 → 묶음 아이콘만(이름은 마우스를 올리면), 누르면 그 묶음 첫 화면 — 고른 것은 기억', async () => {
    const user = userEvent.setup();
    const first = renderAt('/', as.cs);
    expect(await screen.findByTestId('side-menu')).toHaveAttribute('data-collapsed', 'false');
    await user.click(screen.getByRole('button', { name: '메뉴 접기' }));
    expect(screen.getByTestId('side-menu')).toHaveAttribute('data-collapsed', 'true');
    const rail = screen.getByTestId('nav-rail-cs');
    expect(rail).toHaveAttribute('title');
    await user.click(rail);
    expect(screen.getByTestId('page-title')).not.toHaveTextContent(/^$/);
    first.unmount();

    renderAt('/', as.cs);
    expect(await screen.findByTestId('side-menu')).toHaveAttribute('data-collapsed', 'true'); // 기억
    await user.click(screen.getByRole('button', { name: '메뉴 펴기' }));
    expect(screen.getByTestId('side-menu')).toHaveAttribute('data-collapsed', 'false');
  });

  it('고른 적이 없으면 좁은 화면(1280px 미만)은 접어서 시작', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true, configurable: true });
    renderAt('/', as.cs);
    expect(await screen.findByTestId('side-menu')).toHaveAttribute('data-collapsed', 'true');
  });
});
