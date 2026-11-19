// 가격 관리 목록(2026-11-19 쿠팡 윙 가격관리 참고)
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

const rowOf = (name: string) => screen.getAllByTestId('price-row').find((r) => r.textContent?.includes(name))!;

describe('가격 관리 목록', () => {
  it('상품·SKU 마다 현재 기본가(서버 값), 미설정은 0원이 아니라 "미설정" — 숫자 카드도 서버 값으로 센다', async () => {
    renderAt('/prices', as.md);
    await waitFor(() => expect(screen.getAllByTestId('price-row')).toHaveLength(2));
    expect(rowOf('사과 1.5kg')).toHaveTextContent('4,500원');
    expect(rowOf('소고기 미역국')).toHaveTextContent('미설정');
    expect(rowOf('소고기 미역국')).not.toHaveTextContent('0원');
    await waitFor(() => expect(screen.getByTestId('price-count-notSet')).toHaveTextContent('1'));
    expect(screen.getByTestId('price-count-all')).toHaveTextContent('2');
  });

  it('"가격 미설정" 카드를 누르면 그 SKU 만', async () => {
    const user = userEvent.setup();
    renderAt('/prices', as.md);
    await waitFor(() => expect(screen.getByTestId('price-count-notSet')).toHaveTextContent('1'));
    await user.click(screen.getByTestId('price-count-notSet'));
    await waitFor(() => expect(screen.getAllByTestId('price-row')).toHaveLength(1));
    expect(screen.getByTestId('price-row')).toHaveTextContent('소고기 미역국');
    expect(screen.getByTestId('price-count-notSet')).toHaveAttribute('aria-current', 'true');
  });

  it('검색어(상품명·SKU)로 바로 좁힌다', async () => {
    const user = userEvent.setup();
    renderAt('/prices', as.md);
    await waitFor(() => expect(screen.getAllByTestId('price-row')).toHaveLength(2));
    await user.type(screen.getByRole('textbox', { name: '검색어' }), 'E-00000001');
    expect(screen.getAllByTestId('price-row')).toHaveLength(1);
    await user.clear(screen.getByRole('textbox', { name: '검색어' }));
    await user.type(screen.getByRole('textbox', { name: '검색어' }), '없는상품');
    expect(screen.getByTestId('price-empty')).toHaveTextContent('해당 SKU 가 없어요.');
  });

  it('줄의 "가격 변경" → 아래 변경 요청에 그 SKU(상품 이름 · 지금 가격과 함께)', async () => {
    const user = userEvent.setup();
    renderAt('/prices', as.md);
    await waitFor(() => expect(screen.getAllByTestId('price-row')).toHaveLength(2));
    await user.click(within(rowOf('소고기 미역국')).getByTestId('price-row-change'));
    expect(await screen.findByRole('textbox', { name: 'SKU 1' })).toHaveValue('E-00000002');
    expect(await screen.findByTestId('line-sku-info')).toHaveTextContent('소고기 미역국 500g');
    await waitFor(() => expect(screen.getByTestId('line-sku-info')).toHaveTextContent('지금 미설정'));
  });

  it('여러 개 골라 "선택한 SKU 가격 변경" → 그 SKU 들이 행으로', async () => {
    const user = userEvent.setup();
    renderAt('/prices', as.md);
    await waitFor(() => expect(screen.getAllByTestId('price-row')).toHaveLength(2));
    await user.click(screen.getByRole('checkbox', { name: '보이는 SKU 모두 고르기' }));
    await user.click(screen.getByTestId('price-bulk-change'));
    expect(await screen.findByRole('textbox', { name: 'SKU 2' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'SKU 1' })).toHaveValue('E-00000001');
  });

  it('줄을 누르면 오른쪽 서랍에 현재 기본가·이력 — 상품 시스템 ID 는 보이지 않는다', async () => {
    const user = userEvent.setup();
    renderAt('/prices', as.md);
    await waitFor(() => expect(screen.getAllByTestId('price-row')).toHaveLength(2));
    await user.click(rowOf('사과 1.5kg'));
    expect(await screen.findByTestId('base-price')).toHaveTextContent('4,500원');
    expect(await screen.findByTestId('sku-product')).not.toHaveTextContent('P-00000001');
  });
});
