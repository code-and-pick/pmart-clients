// 상품 상세 "가격" 탭에서 바로 바꾸기(2026-11-20 사용자 "가격도 여기서 바로 바꿀 수 있게 하던가")
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('상품 상세 가격 탭', () => {
  it('탭 안에서 새 가격 → 승인 요청, 가격 관리 화면으로 보내는 링크는 없다', async () => {
    const user = userEvent.setup();
    renderAt('/products/P-00000001?tab=price', as.md);
    const tab = await screen.findByTestId('tab-price');
    expect(within(tab).queryByRole('link', { name: /가격 화면/ })).not.toBeInTheDocument();
    const form = within(tab).getByTestId('price-form');
    await waitFor(() => expect(within(form).getByTestId('price-form-now')).toHaveTextContent('4,500원'));
    expect(within(form).getByTestId('price-form-row')).toHaveTextContent('낱개(E)');
    await user.type(within(form).getByRole('textbox', { name: 'E-00000001 새 가격' }), '4000');
    expect(within(form).getByTestId('price-form-diff')).toHaveTextContent('-500원');
    await user.click(within(form).getByTestId('price-form-submit'));
    expect(await within(tab).findByTestId('price-form-done')).toHaveTextContent('승인 요청했어요');
    expect(screen.getByRole('heading', { level: 1, name: /사과 1\.5kg/ })).toBeInTheDocument(); // 상품 상세 그대로
  });
});
