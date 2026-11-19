// 첫 화면(2026-11-19) — 바로 가기·상태별 목록 연결. 숫자는 계약에 없어 그리지 않는다.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../test/render';

describe('첫 화면', () => {
  it('바로 가기 4개, 상태별 목록은 status 필터로 연다, 인원 숫자는 없다', async () => {
    renderAt('/');
    const shortcuts = await screen.findByTestId('home-shortcuts');
    expect(within(shortcuts).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/employees/new', '/employees', '/permissions', '/departments']);
    const status = screen.getByTestId('home-status');
    expect(within(status).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/employees?status=ACTIVE', '/employees?status=SUSPENDED', '/employees?status=LEFT']);
    expect(status).not.toHaveTextContent(/\d+\s*명/);
    expect(screen.getByTestId('page-title')).toHaveTextContent('첫 화면');
  });

  it('상태 바로 가기를 누르면 그 상태로 거른 직원 목록', async () => {
    renderAt('/');
    await userEvent.click(within(await screen.findByTestId('home-status')).getByRole('link', { name: /정지/ }));
    expect(await screen.findByRole('heading', { name: '직원 목록' })).toBeInTheDocument();
  });
});
