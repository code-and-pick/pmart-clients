// 왼쪽 메뉴 접기(2026-11-19 — 좁은 화면에서 본문이 답답하다)
import { screen, waitFor, within } from '@testing-library/react';
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
    // 2026-11-19 관제 형식: 아이콘 + 글자, 누르면 하위 메뉴 판 → 메뉴를 누르면 이동하고 판은 닫힘
    const rail = screen.getByTestId('nav-rail-cs');
    expect(rail).toHaveAttribute('title', '고객센터');
    expect(rail).toHaveTextContent('고객센터');
    await user.click(rail);
    const panel = screen.getByTestId('nav-rail-panel');
    expect(rail).toHaveAttribute('aria-expanded', 'true');
    const items = within(panel).getAllByRole('menuitem');
    expect(items.length).toBeGreaterThan(1);
    await user.click(items[0]!);
    await waitFor(() => expect(screen.getByTestId('page-title')).not.toHaveTextContent(/^$/));
    expect(screen.queryByTestId('nav-rail-panel')).not.toBeInTheDocument();
    first.unmount();

    renderAt('/', as.cs);
    expect(await screen.findByTestId('side-menu')).toHaveAttribute('data-collapsed', 'true'); // 기억
    await user.click(screen.getByRole('button', { name: '메뉴 펴기' }));
    expect(screen.getByTestId('side-menu')).toHaveAttribute('data-collapsed', 'false');
  });

  it('하위 메뉴 판은 Esc 로 닫힌다', async () => {
    window.localStorage.setItem('pmart.backoffice.menu', 'collapsed');
    const user = userEvent.setup();
    renderAt('/', as.cs);
    await user.click(await screen.findByTestId('nav-rail-cs'));
    expect(screen.getByTestId('nav-rail-panel')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('nav-rail-panel')).not.toBeInTheDocument();
  });

  it('머리줄 맥락: 내 역할 꼬리표(한글)와 시계', async () => {
    renderAt('/', as.admin);
    expect(await screen.findByTestId('header-roles')).toHaveTextContent('운영 관리자');
    expect(screen.getByTestId('header-clock')).toHaveTextContent(/\d{2}:\d{2}:\d{2}/);
  });

  it('고른 적이 없으면 좁은 화면(1280px 미만)은 접어서 시작', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true, configurable: true });
    renderAt('/', as.cs);
    expect(await screen.findByTestId('side-menu')).toHaveAttribute('data-collapsed', 'true');
  });
});
