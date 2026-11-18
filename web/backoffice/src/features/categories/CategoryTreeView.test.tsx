// 카테고리 트리 화면(2026-11-18 — 참고 사이트처럼): 숫자 카드, 접고 펴기, 찾기, 고른 분류 상세(경로·단계·하위)
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('카테고리 트리 화면', () => {
  it('위 숫자 카드는 트리에서 센 대·중·소분류 개수', async () => {
    renderAt('/categories', as.md);
    const stats = await screen.findByTestId('category-stats');
    expect(stats).toHaveTextContent('대분류2');
    expect(stats).toHaveTextContent('중분류2');
    expect(stats).toHaveTextContent('소분류1');
  });

  it('▸ 로 접으면 하위가 숨고, 모두 펼치기로 다시 보인다', async () => {
    const user = userEvent.setup();
    renderAt('/categories', as.md);
    const tree = await screen.findByTestId('category-tree');
    expect(within(tree).getByRole('button', { name: '과일 (p01-c01)' })).toBeInTheDocument();
    await user.click(within(tree).getByRole('button', { name: '접기 과일·채소' }));
    expect(within(tree).queryByRole('button', { name: '과일 (p01-c01)' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '모두 펼치기' }));
    expect(within(tree).getByRole('button', { name: '과일 (p01-c01)' })).toBeInTheDocument();
  });

  it('찾기: 맞는 분류와 그 위 경로만, 없으면 안내', async () => {
    const user = userEvent.setup();
    renderAt('/categories', as.md);
    const tree = await screen.findByTestId('category-tree');
    await user.type(screen.getByLabelText('분류 찾기'), '국밥');
    expect(within(tree).getByRole('button', { name: '국·국밥 (p03-c01)' })).toBeInTheDocument();
    expect(within(tree).getByRole('button', { name: '국·탕·찌개 (p03)' })).toBeInTheDocument();
    expect(within(tree).queryByRole('button', { name: '과일 (p01-c01)' })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('분류 찾기'));
    await user.type(screen.getByLabelText('분류 찾기'), '없는분류');
    expect(within(tree).getByText('맞는 분류가 없어요.')).toBeInTheDocument();
  });

  it('고르면 오른쪽에 경로·단계·노출·하위 분류', async () => {
    const user = userEvent.setup();
    renderAt('/categories', as.md);
    await user.click(await screen.findByRole('button', { name: '과일 (p01-c01)' }));
    const detail = screen.getByTestId('category-detail');
    expect(detail).toHaveTextContent('과일·채소 › 과일');
    expect(detail).toHaveTextContent('중분류');
    expect(detail).toHaveTextContent('하위 분류 1개');
    await user.click(within(detail).getByRole('button', { name: '사과·배' }));
    expect(screen.getByTestId('category-detail')).toHaveTextContent('과일·채소 › 과일 › 사과·배');
  });
});
