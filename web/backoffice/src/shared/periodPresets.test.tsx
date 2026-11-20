// 기간 빠른 고르기·작은 쪽 넘기기(2026-11-20 AWS) — 단추가 서울 날짜로 두 칸을 채우고 주소에 들어간다, 쪽 넘기기는 필터 줄 오른쪽
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { addSeoulDays, seoulToday } from './ops';
import { as, renderAt } from '../test/render';

describe('기간 빠른 고르기', () => {
  it('주문 조회: "30일"을 누르면 오늘부터 29일 전 ~ 오늘, 주소에 들어가고 그 단추가 눌려 보인다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/orders', as.cs);
    const presets = await screen.findByTestId('period-presets');
    await user.click(within(presets).getByRole('radio', { name: '30일' }));
    const today = seoulToday();
    await waitFor(() => expect(screen.getByLabelText('확정일 시작')).toHaveValue(addSeoulDays(today, -29)));
    expect(within(presets).getByRole('radio', { name: '30일' })).toHaveAttribute('aria-checked', 'true');
    expect(view.sent.some((r) => r.url.includes('/orders/lookups'))).toBe(true);
  });

  it('주문 조회 쪽 넘기기는 필터 줄 오른쪽(‹ 1쪽 ›) — 첫 쪽에선 이전이 꺼져 있다', async () => {
    renderAt('/orders', as.cs);
    const pager = await screen.findByTestId('pager-mini');
    expect(within(pager).getByRole('button', { name: '이전' })).toBeDisabled();
    expect(pager).toHaveTextContent('1쪽');
  });
});

describe('칸 정렬(받은 쪽 안에서만)', () => {
  it('주문 조회: 결제 금액 머리를 누르면 ▲ 오름 → ▼ 내림 → 처음 순서, 정렬 중엔 "이 쪽 안에서만" 표시', async () => {
    const user = userEvent.setup();
    renderAt('/orders', as.cs);
    await screen.findAllByTestId('order-row');
    const th = screen.getByRole('columnheader', { name: /결제 금액/ });
    await user.click(within(th).getByRole('button'));
    expect(th).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByTestId('sort-note')).toHaveTextContent('이 쪽 안에서만');
    await user.click(within(th).getByRole('button'));
    expect(th).toHaveAttribute('aria-sort', 'descending');
    await user.click(within(th).getByRole('button'));
    expect(th).toHaveAttribute('aria-sort', 'none');
  });
});
