// 상품 초안 필수 칸 미리 알림(2026-11-19) — 표시만, 판정·저장 막기는 하지 않는다(초안은 비어도 저장된다)
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('상품 초안 필수 칸', () => {
  it('비어 있는 필수 칸을 저장 단추 옆에 알리고, 채우면 그 이름이 빠진다 — 칸 이름은 그대로', async () => {
    const user = userEvent.setup();
    renderAt('/products/drafts/new', as.md);
    const hint = await screen.findByTestId('draft-missing');
    expect(hint).toHaveTextContent('관리용 명칭');
    expect(hint).toHaveTextContent('중량(g)');
    await user.type(screen.getByLabelText('관리용 명칭'), '사과');
    await user.type(screen.getByLabelText('중량(g)'), '300');
    expect(screen.getByTestId('draft-missing')).not.toHaveTextContent('관리용 명칭');
    expect(screen.getByTestId('draft-missing')).not.toHaveTextContent('중량(g)');
    expect(screen.getByRole('button', { name: '초안 저장' })).toBeEnabled();
  });
});
