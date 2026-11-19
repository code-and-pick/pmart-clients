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

  // 2026-11-20 가격 흐름 다시 짬 — "가격 변경"을 누르면 화면을 옮기거나 맨 아래로 가지 않고, 오른쪽 서랍에서 지금 가격 옆에 새 가격
  it('줄의 "가격 변경" → 오른쪽 서랍에 그 SKU 의 바꾸기(지금 가격·상품 이름), 다른 화면으로 가지 않는다', async () => {
    const user = userEvent.setup();
    renderAt('/prices', as.md);
    await waitFor(() => expect(screen.getAllByTestId('price-row')).toHaveLength(2));
    await user.click(within(rowOf('소고기 미역국')).getByTestId('price-row-change'));
    const drawer = await screen.findByTestId('preview-drawer');
    const row = await within(drawer).findByTestId('price-form-row');
    expect(row).toHaveTextContent('E-00000002');
    await waitFor(() => expect(row).toHaveTextContent('소고기 미역국 500g'));
    await waitFor(() => expect(within(row).getByTestId('price-form-now')).toHaveTextContent('미설정'));
    expect(screen.getByRole('heading', { level: 1, name: '가격 관리' })).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: '상품 가격 탭' })).toHaveAttribute('href', '/products/P-00000002?tab=price');
  });

  it('여러 개 골라 "선택한 SKU 가격 변경" → 같은 서랍에 그 SKU 들', async () => {
    const user = userEvent.setup();
    renderAt('/prices', as.md);
    await waitFor(() => expect(screen.getAllByTestId('price-row')).toHaveLength(2));
    await user.click(screen.getByRole('checkbox', { name: '보이는 SKU 모두 고르기' }));
    await user.click(screen.getByTestId('price-bulk-change'));
    const drawer = await screen.findByTestId('preview-drawer');
    expect(within(drawer).getByRole('heading', { name: '선택한 2개 가격 바꾸기' })).toBeInTheDocument();
    expect(within(drawer).getAllByTestId('price-form-row')).toHaveLength(2);
  });

  it('새 가격을 넣고 한 번 누르면 승인 요청까지 — 바뀌는 금액이 보이고, 끝나면 승인 진행으로 갈 수 있다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/prices', as.md);
    await waitFor(() => expect(screen.getAllByTestId('price-row')).toHaveLength(2));
    await user.click(rowOf('사과 1.5kg'));
    const drawer = await screen.findByTestId('preview-drawer');
    await waitFor(() => expect(within(drawer).getByTestId('price-form-now')).toHaveTextContent('4,500원'));
    await user.type(within(drawer).getByRole('textbox', { name: 'E-00000001 새 가격' }), '5000');
    expect(within(drawer).getByTestId('price-form-diff')).toHaveTextContent('+500원');
    await user.click(within(drawer).getByTestId('price-form-submit'));
    expect(await within(drawer).findByTestId('price-form-done')).toHaveTextContent('1개 SKU 가격 변경을 승인 요청했어요.');
    expect(within(drawer).getByTestId('price-form-approval').getAttribute('href')).toMatch(/^\/approvals\//);
    const body = (await view.mutations('/change-requests')[0]!.clone().json()) as { type: string; lines: Array<{ lineKey: string; requestedAmount: number }> };
    expect(body.type).toBe('PRICE');
    expect(body.lines).toEqual([expect.objectContaining({ lineKey: 'E-00000001', requestedAmount: 5000 })]);
    view.stop();
  });

  it('줄을 누르면 오른쪽 서랍에 현재 기본가·이력 — 상품 시스템 ID 는 보이지 않는다', async () => {
    const user = userEvent.setup();
    renderAt('/prices', as.md);
    await waitFor(() => expect(screen.getAllByTestId('price-row')).toHaveLength(2));
    await user.click(rowOf('사과 1.5kg'));
    expect(await screen.findByTestId('base-price')).toHaveTextContent('4,500원');
    const row = await screen.findByTestId('price-form-row');
    await waitFor(() => expect(row).toHaveTextContent('사과 1.5kg'));
    expect(screen.getByTestId('preview-drawer')).not.toHaveTextContent('P-00000001');
  });
});
