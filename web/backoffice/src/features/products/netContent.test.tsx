// 내용량(product 0.4.0 — 2026-11-19 백엔드 알림 notice-sku-net-content, 고객 앱 "100g당 가격")
import { pick } from '../../test/pick';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { ProductDraftInput } from '../../api/models';
import { as, renderAt } from '../../test/render';
import { netContentOf } from './ProductDraftForm';

describe('내용량 바꾸기', () => {
  it('g·mL 는 그대로, kg·L 는 ×1000 — 비면 보내지 않고, 정수가 아니거나 범위 밖이면 잘못', () => {
    expect(netContentOf('500', 'G')).toEqual({ amount: 500, unit: 'G' });
    expect(netContentOf('1.5', 'KG')).toEqual({ amount: 1500, unit: 'G' });
    expect(netContentOf('1,000', 'ML')).toEqual({ amount: 1000, unit: 'ML' });
    expect(netContentOf('0.5', 'L')).toEqual({ amount: 500, unit: 'ML' });
    expect(netContentOf('', 'G')).toBeNull();
    expect(netContentOf('1.5', 'G')).toBe('invalid');
    expect(netContentOf('0', 'G')).toBe('invalid');
    expect(netContentOf('1001', 'KG')).toBe('invalid');
    expect(netContentOf('약 500', 'G')).toBe('invalid');
  });
});

describe('상품 등록 — 내용량', () => {
  it('1.5kg 로 적으면 netContent {1500, G} 를 보낸다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/products/drafts/new', as.md);
    await user.type(await screen.findByLabelText('관리용 명칭'), '사과');
    await pick(user, '대표 카테고리', /^과일·채소$/);
    const sku = within(screen.getByRole('region', { name: 'SKU 1' }));
    await user.type(sku.getByLabelText('중량(g)'), '1600');
    await user.type(sku.getByRole('textbox', { name: '내용량' }), '1.5');
    await user.selectOptions(sku.getByLabelText('내용량 단위'), 'KG');
    await user.click(screen.getByRole('button', { name: '초안 저장' }));
    await screen.findByText('상품 초안');
    const body = (await view.mutations('/product-drafts')[0]!.json()) as ProductDraftInput;
    expect(body.skus[0]?.netContent).toEqual({ amount: 1500, unit: 'G' });
    expect(body.skus[0]?.weightG).toBe(1600); // 포장 무게와 다른 칸
    view.stop();
  });

  it('잘못 적으면 알리고 저장하지 않는다(조용히 빼지 않음)', async () => {
    const user = userEvent.setup();
    const view = renderAt('/products/drafts/new', as.md);
    await user.type(await screen.findByLabelText('관리용 명칭'), '사과');
    const sku = within(screen.getByRole('region', { name: 'SKU 1' }));
    await user.type(sku.getByRole('textbox', { name: '내용량' }), '1.5'); // g 단위에 소수
    expect(sku.getByRole('alert')).toHaveTextContent('정수');
    await user.click(screen.getByRole('button', { name: '초안 저장' }));
    expect(view.mutations('/product-drafts')).toHaveLength(0);
    view.stop();
  });
});

describe('상품 상세·수정 — 내용량', () => {
  it('상세 SKU 표에 내용량(1.5kg), 수정 초안에 현재 값이 들어 있고 지우면 경고', async () => {
    const user = userEvent.setup();
    renderAt('/products/P-00000001', as.md);
    expect(await screen.findByTestId('sku-net-content')).toHaveTextContent('1.5kg');
    await user.click(await screen.findByRole('button', { name: '상품 정보 수정 시작' }));
    const box = await screen.findByRole('textbox', { name: '내용량' });
    await waitFor(() => expect(box).toHaveValue('1500'));
    await user.clear(box);
    expect(await screen.findByTestId('net-content-cleared')).toHaveTextContent('내용량이 없어지고');
  });
});
