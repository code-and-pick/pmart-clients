// 시스템 값은 상세의 접힌 "시스템 번호" 칸에만(2026-11-20 사용자 "pay-…·TEST_AUTO_pay-… 는 상세에만, 들어가자마자 보는 건 공통 규칙값")
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('주문 상세 — 결제 시도·PG 거래 ID', () => {
  it('금액 칸에는 없고, 시스템 번호 칸에만 있다', async () => {
    renderAt('/orders/ORD-MOCK-1005', as.cs);
    const amounts = await screen.findByRole('heading', { name: '금액' }).then((h) => h.closest('section')!);
    expect(amounts).not.toHaveTextContent('PAY-ORD-MOCK-1005');
    expect(amounts).not.toHaveTextContent('PG-ORD-MOCK-1005');
    const sys = screen.getByTestId('system-numbers');
    expect(sys).not.toHaveAttribute('open');
    expect(within(sys).getByText('PAY-ORD-MOCK-1005')).toBeInTheDocument();
    expect(within(sys).getByText('PG-ORD-MOCK-1005')).toBeInTheDocument();
  });
});
