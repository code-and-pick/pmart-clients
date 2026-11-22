// 관제 지연 표시(2026-11-23 — tracking 0.14.0 activeDeliveries.delayed·promisedAt). 목(MSW) 기준: RD-7 의 DLV-1 이 약속 + 20분을 넘김.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('관제 — 지연', () => {
  it('약속 + 20분을 넘긴 배송은 라이더 줄과 패널에 "지연"', async () => {
    renderAt('/control?mfcId=MFC-BSJ-01', as.riderOps);
    const badge = await screen.findByTestId('row-delayed');
    expect(badge).toHaveTextContent('지연');
    expect(badge.getAttribute('title')).toMatch(/\+ 20분/);
    const row = screen.getAllByTestId('control-row').find((r) => within(r).queryByTestId('row-delayed'))!;
    await userEvent.click(row);
    expect(await screen.findByTestId('panel-delayed')).toHaveTextContent('지연');
  });
});
