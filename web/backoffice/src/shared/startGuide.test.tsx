// 찾기 전 빈 화면 안내(2026-11-18 — Shopify 빈 화면 참고)
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

beforeEach(() => window.localStorage.clear());

describe('찾기 전 안내', () => {
  it('배송 확인: 넣을 번호 모양(누르지 않는 예시) + 최근 본 배송을 바로 열기', async () => {
    const user = userEvent.setup();
    renderAt('/deliveries/DLV-MOCK-1', as.csRider);
    await screen.findByTestId('execution-panel');
    await user.click(screen.getByRole('link', { name: '배송 번호 다시 넣기' }));
    const guide = await screen.findByTestId('start-guide');
    const formats = within(guide).getByRole('list', { name: '넣을 수 있는 번호' });
    expect(formats).toHaveTextContent('주문번호숫자 8자리');
    expect(within(formats).queryByRole('link')).not.toBeInTheDocument();
    expect(within(guide).getByRole('link', { name: /배송.*74939001-1/ })).toHaveAttribute('href', '/deliveries/DLV-MOCK-1');
  });

  it('통합 조회: 본 것이 없으면 최근 줄 없이 모양만', async () => {
    renderAt('/lookup', as.cs);
    const guide = await screen.findByTestId('start-guide');
    expect(guide).toHaveTextContent('배송 번호숫자 8자리-순번');
    expect(within(guide).queryByText('최근 본 것 바로 열기')).not.toBeInTheDocument();
  });
});
