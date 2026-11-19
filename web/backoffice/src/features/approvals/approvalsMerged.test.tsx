// "모든 승인 한눈에"를 승인함으로 합침(2026-11-20 사용자 "왜 굳이 나눠져 있어") + 반영 칸이 화면 밖으로 나가지 않게
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('승인함 하나로', () => {
  it('예전 주소는 승인함으로 가고, 메뉴에는 승인함만', async () => {
    renderAt('/views/approval-inbox', as.admin);
    expect(await screen.findByRole('heading', { level: 1, name: '승인함' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '모든 승인 한눈에' })).not.toBeInTheDocument();
  });

  it('표는 칸 너비를 고정하고(table-fixed), 반영 상태는 짧은 이름', async () => {
    renderAt('/approvals', as.admin);
    const rows = await screen.findAllByTestId('approval-row');
    expect(rows[0].closest('table')).toHaveClass('table-fixed');
    expect(rows[0]).toHaveTextContent('반영 전');
  });
});
