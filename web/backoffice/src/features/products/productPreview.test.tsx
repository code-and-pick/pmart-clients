// 상품 조회 오른쪽 미리보기(2026-11-20 사용자 "어떤 건 미리보기, 어떤 건 상세 — 일관성 없고, SKU·바코드·버전을 안 보여 준다")
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('상품 조회 미리보기', () => {
  it('이름을 눌러도 상세로 가지 않고 미리보기가 열린다 — SKU·단위·중량·보관·바코드·가격·버전', async () => {
    const user = userEvent.setup();
    renderAt('/products', as.md);
    const apple = await screen.findByText('사과 1.5kg', { selector: '[data-testid="product-name"]' });
    await user.click(apple);
    const preview = await screen.findByTestId('product-preview');
    expect(screen.getByRole('heading', { level: 1, name: '상품 조회' })).toBeInTheDocument(); // 상세로 넘어가지 않음
    const sku = within(preview).getByTestId('preview-sku');
    expect(sku).toHaveTextContent('E-00000001');
    expect(sku).toHaveTextContent('낱개(E) × 1');
    expect(sku).toHaveTextContent('300g');
    expect(sku).toHaveTextContent('1.5kg'); // 내용량
    expect(sku).toHaveTextContent('냉장');
    expect(within(sku).getByTestId('preview-sku-barcodes')).toHaveTextContent('880000000001');
    await waitFor(() => expect(within(sku).getByTestId('preview-sku-price')).toHaveTextContent('4,500원'));
    expect(preview).toHaveTextContent('v1');
  });

  it('가격이 없는 SKU 는 0원이 아니라 "가격 미설정"', async () => {
    const user = userEvent.setup();
    renderAt('/products', as.md);
    await user.click(await screen.findByText('소고기 미역국 500g', { selector: '[data-testid="product-name"]' }));
    const preview = await screen.findByTestId('product-preview');
    await waitFor(() => expect(within(preview).getByTestId('preview-sku-price')).toHaveTextContent('가격 미설정'));
  });
});
