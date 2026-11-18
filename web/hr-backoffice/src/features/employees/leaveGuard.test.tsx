// 직원 등록 떠날 때 경고(2026-11-18 — 백오피스와 같음)
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';

describe('직원 등록 — 떠날 때 경고', () => {
  it('이름을 넣다가 메뉴를 누르면 묻는다 — 계속 작성이면 그대로', async () => {
    const user = userEvent.setup();
    renderAt('/employees/new');
    await user.type(await screen.findByLabelText('이름'), '김신입');
    await user.click(screen.getByRole('link', { name: '직원 목록' }));
    const box = await screen.findByTestId('leave-guard');
    await user.click(within(box).getByRole('button', { name: '계속 작성' }));
    expect(screen.getByLabelText('이름')).toHaveValue('김신입');
  });

  it('아무것도 안 넣었으면 묻지 않는다', async () => {
    const user = userEvent.setup();
    renderAt('/employees/new');
    await screen.findByLabelText('이름');
    await user.click(screen.getByRole('link', { name: '직원 목록' }));
    expect(screen.queryByTestId('leave-guard')).not.toBeInTheDocument();
  });
});
