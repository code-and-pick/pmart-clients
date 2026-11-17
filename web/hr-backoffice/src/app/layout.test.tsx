// 메뉴 레이아웃 — 메뉴는 화면 높이에 고정·따로 스크롤, 다른 화면으로 가면 맨 위부터(사용자 2026-11-17)
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../test/render';

describe('메뉴 레이아웃', () => {
  it('메뉴는 화면 높이에 붙어 따로 스크롤된다', async () => {
    renderAt('/employees');
    const menu = await screen.findByTestId('side-menu');
    expect(menu.className).toContain('sticky');
    expect(menu.className).toContain('overflow-y-auto');
  });

  it('메뉴로 다른 화면에 가면 스크롤이 맨 위로', async () => {
    renderAt('/employees');
    await screen.findByTestId('side-menu');
    const root = document.scrollingElement ?? document.documentElement;
    root.scrollTop = 800;
    await userEvent.click(screen.getByRole('link', { name: '권한 관리' }));
    expect(root.scrollTop).toBe(0);
  });
});
