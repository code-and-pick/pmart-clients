// 찾기 전 빈 화면(2026-11-18 — Shopify 빈 화면 참고). 2026-11-20 사용자 "쓸데없는 말 다 지워" — 설명 문장·번호 형식 표는 빼고 최근 본 것만
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

beforeEach(() => window.localStorage.clear());

describe('찾기 전 빈 화면', () => {
  it('배송 확인: 최근 본 배송을 바로 열기(형식 표·설명 없음)', async () => {
    const user = userEvent.setup();
    renderAt('/deliveries/DLV-MOCK-1', as.csRider);
    await screen.findByTestId('execution-panel');
    await user.click(screen.getByRole('link', { name: '배송 번호 다시 넣기' }));
    const guide = await screen.findByTestId('start-guide');
    expect(within(guide).queryByRole('list', { name: '넣을 수 있는 번호' })).not.toBeInTheDocument();
    expect(within(guide).getByRole('link', { name: /배송.*D74939001/ })).toHaveAttribute('href', '/deliveries/DLV-MOCK-1');
  });

  it('통합 조회: 본 것이 없으면 빈 상자도 그리지 않는다', async () => {
    renderAt('/lookup', as.cs);
    await screen.findByRole('heading', { level: 1, name: '통합 조회' });
    expect(screen.queryByTestId('start-guide')).not.toBeInTheDocument();
  });
});
