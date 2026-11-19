// 일괄 등록 한 메뉴·상품 메뉴 5개(2026-11-19 상품 묶음 합치기 — 메뉴 정리)
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { messages } from '../../shared/messages';
import { as, renderAt } from '../../test/render';

describe('일괄 등록 한 메뉴', () => {
  it('상품·콘텐츠·가격 탭과 올리는 순서 — 탭을 바꾸면 주소 ?tab=', async () => {
    const user = userEvent.setup();
    renderAt('/imports', as.md);
    expect(await screen.findByTestId('imports-order')).toHaveTextContent(/상품.*→.*콘텐츠.*→.*가격/);
    expect(screen.getByRole('tab', { name: '상품' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: '가격' }));
    expect(screen.getByRole('tab', { name: '가격' })).toHaveAttribute('aria-selected', 'true');
  });

  it('상품 관리 메뉴는 5개, 옛 주소 /prices/import 에서도 "일괄 등록"이 켜진다', async () => {
    renderAt('/prices/import', as.md);
    const nav = await screen.findByRole('navigation');
    await waitFor(() => expect(within(nav).getByRole('link', { name: '일괄 등록' })).toHaveAttribute('data-active', 'alias'));
    for (const gone of ['콘텐츠 등록', '콘텐츠 일괄 등록', '가격 일괄 등록', '상품 일괄 등록']) expect(within(nav).queryByRole('link', { name: gone })).toBeNull();
  });
});

// 2026-11-19 사용자 "상품 등록할 때 사진 등록하던 게 없어졌다" — 메뉴 정리 뒤에도 상품 등록에서 사진 등록으로
describe('상품 등록 — 사진·설명 입구', () => {
  it('등록 방식 고르기에 "사진·설명 등록" 카드 → 콘텐츠 등록 화면', async () => {
    const user = userEvent.setup();
    renderAt('/products/drafts/new', as.md);
    expect(await screen.findByTestId('draft-after')).toHaveTextContent('사진·설명 → 가격');
    await user.click(await screen.findByTestId('start-photo'));
    expect(await screen.findByRole('heading', { name: messages.contents.draftTitle })).toBeInTheDocument();
  });
});
