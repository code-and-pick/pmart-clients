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
    renderAt('/claims', as.cs);
    const box = await screen.findByTestId('saved-views');
    await userEvent.click(within(box).getByTestId('saved-views-toggle')); // 2026-11-20 고르기 칸으로 — 펼쳐서
    expect(within(box).getByRole('button', { name: '+ 지금 조건 저장' })).toBeDisabled();
  });

  // 승인함은 2026-11-20 "내가 심사할 것·내가 올린 것·모두"로 다시 짜며 내 보기를 뺐다 — 클레임 목록으로 확인
  it('클레임: 조건이 걸린 채 이름 붙여 저장 → 지금 보기로 표시, 지우면 사라진다', async () => {
    const user = userEvent.setup();
    renderAt('/claims?type=CANCEL', as.cs);
    const box = await screen.findByTestId('saved-views');
    await userEvent.click(within(box).getByTestId('saved-views-toggle')); // 2026-11-20 고르기 칸으로 — 펼쳐서
    await user.click(within(box).getByRole('button', { name: '+ 지금 조건 저장' }));
    await user.type(within(box).getByLabelText('보기 이름'), '취소 건{Enter}');
    expect(within(box).getByRole('link', { name: '취소 건' })).toHaveAttribute('aria-current', 'true');
    expect(loadViews('claims')).toEqual([{ name: '취소 건', search: '?type=CANCEL' }]);
    await user.click(within(box).getByRole('button', { name: '취소 건 보기 지우기' }));
    expect(within(box).queryByRole('link', { name: '취소 건' })).not.toBeInTheDocument();
    expect(loadViews('claims')).toEqual([]);
  });
});
