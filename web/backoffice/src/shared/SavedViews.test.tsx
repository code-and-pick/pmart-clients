// 목록 "내 보기"(2026-11-18) — 지금 주소 조건을 이름 붙여 이 브라우저에 저장, 누르면 그 조건으로, 지우기, 개인정보·쪽 조건은 빼고 저장
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';
import { cleanSearch, loadViews } from './SavedViews';

afterEach(() => window.localStorage.clear());

describe('내 보기', () => {
  it('저장할 조건에서 쪽·개인정보 조건은 빼고 순서를 맞춘다', () => {
    expect(cleanSearch('?type=PRICE&cursor=C2&reviewState=REVIEW_PENDING')).toBe('?reviewState=REVIEW_PENDING&type=PRICE');
    expect(cleanSearch('?phone=01012345678')).toBe('');
    expect(cleanSearch('')).toBe('');
  });

  it('조건이 없으면 저장 버튼이 꺼져 있다', async () => {
    renderAt('/approvals', as.admin);
    const box = await screen.findByTestId('saved-views');
    expect(within(box).getByRole('button', { name: '+ 지금 조건 저장' })).toBeDisabled();
  });

  it('승인함: 조건을 골라 이름 붙여 저장 → 다른 조건으로 갔다가 눌러서 돌아오고, 지우면 사라진다', async () => {
    const user = userEvent.setup();
    renderAt('/approvals', as.admin);
    await user.click(await screen.findByRole('tab', { name: '심사 대기' }));
    await user.click(screen.getByRole('button', { name: '가격' }));
    const box = screen.getByTestId('saved-views');
    await user.click(within(box).getByRole('button', { name: '+ 지금 조건 저장' }));
    await user.type(within(box).getByLabelText('보기 이름'), '가격 심사{Enter}');
    expect(within(box).getByRole('link', { name: '가격 심사' })).toHaveAttribute('aria-current', 'true');
    expect(loadViews('approvals')).toEqual([{ name: '가격 심사', search: '?reviewState=REVIEW_PENDING&type=PRICE' }]);

    // 다른 조건으로
    await user.click(screen.getByRole('tab', { name: '전체' }));
    expect(within(box).getByRole('link', { name: '가격 심사' })).not.toHaveAttribute('aria-current');
    // 저장한 보기로 돌아오기
    await user.click(within(box).getByRole('link', { name: '가격 심사' }));
    expect(await screen.findByRole('tab', { name: '심사 대기' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: '가격' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(box).getByRole('button', { name: '가격 심사 보기 지우기' }));
    expect(within(box).queryByRole('link', { name: '가격 심사' })).not.toBeInTheDocument();
    expect(loadViews('approvals')).toEqual([]);
  });

  it('목록마다 따로 저장된다(승인함 보기는 주문 조회에 없다)', async () => {
    window.localStorage.setItem('pmart.backoffice.views.approvals', JSON.stringify([{ name: '가격 심사', search: '?type=PRICE' }]));
    renderAt('/orders', as.admin);
    const box = await screen.findByTestId('saved-views');
    expect(within(box).queryByRole('link', { name: '가격 심사' })).not.toBeInTheDocument();
  });
});
