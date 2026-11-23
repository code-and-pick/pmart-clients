// 좁은 화면 머리줄(2026-11-23 — 390px 에서 710px 로 넘침): 640px 미만에서 통합 찾기는 돋보기 단추로 접고 누르면 연다.
// jsdom 은 CSS 를 그리지 않아 폭은 재지 못한다 — 단추·펼침 상태만 본다(폭은 실제 브라우저에서 확인).
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('좁은 화면 머리줄', () => {
  it('통합 찾기 돋보기 단추가 찾기 칸을 열고 닫는다', async () => {
    renderAt('/dashboard', as.riderOps);
    const toggle = await screen.findByTestId('header-search-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('search', { name: '통합 찾기' }).className).toContain('absolute');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
