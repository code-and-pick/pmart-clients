// 목록 숫자 띠(2026-11-19 관제 형식 2단계) — 서버 개수만, 누르면 그 거르기, 지금 거르기는 강조
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('목록 숫자 띠', () => {
  it('접수 건: 안 맡음·기한 지남 — 기본 탭(안 맡음)이 강조, 기한 지남 카드를 누르면 그 탭', async () => {
    const user = userEvent.setup();
    renderAt('/cases', as.riderOps);
    const strip = await screen.findByTestId('case-strip');
    const overdue = within(strip).getByTestId('case-strip-overdue');
    expect(await within(overdue).findByText(/^\d+\+?$/)).toBeInTheDocument();
    expect(within(strip).getByTestId('case-strip-unassigned')).toHaveAttribute('aria-current', 'true');
    await user.click(overdue);
    expect(await screen.findByRole('tab', { name: /기한 넘김/, selected: true })).toBeInTheDocument();
    expect(screen.getByTestId('case-strip-overdue')).toHaveAttribute('aria-current', 'true');
  });

  it('처리 대기: 종류별 5칸(결제 결과 불명은 따로), 숫자는 이 화면이 읽은 목록', async () => {
    renderAt('/pending', as.admin);
    const strip = await screen.findByTestId('pending-strip');
    expect(within(strip).getByTestId('pending-strip-payment')).toHaveTextContent('결제 결과 불명');
    for (const id of ['payment', 'stuck', 'issue', 'handover', 'stop']) expect(within(strip).getByTestId(`pending-strip-${id}`)).toHaveTextContent(/\d/);
  });
});
