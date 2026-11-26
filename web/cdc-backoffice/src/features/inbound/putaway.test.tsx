// 보충관리 — 보충 작업(kind=REPLENISHMENT)·칸별 판단 사유 거르기·남은 수량 취소(사유 필수). 입고관리(적치 지시) 메뉴는 뺐다(2026-11-26).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { allMenus } from '../../app/nav';
import { renderAt } from '../../test/render';

describe('보충관리', () => {
  it('보충 작업(kind=REPLENISHMENT)과 칸별 판단 — 사유로 거르기', async () => {
    const view = renderAt('/c/CDC01/replenishment');
    expect(await screen.findAllByTestId('putaway-row')).toHaveLength(1);
    expect(new URL(view.gets('/putaway-tasks')[0]!.url).searchParams.get('kind')).toBe('REPLENISHMENT');
    expect(await screen.findAllByTestId('repl-check-row')).toHaveLength(3);
    await userEvent.click(within(screen.getByTestId('repl-reasons')).getByRole('button', { name: /박스 입수 미등록/ }));
    expect(screen.getAllByTestId('repl-check-row')).toHaveLength(1);
  });

  it('남은 수량 취소는 사유가 있어야', async () => {
    renderAt('/c/CDC01/replenishment');
    await userEvent.click((await screen.findAllByTestId('putaway-row'))[0]!);
    await userEvent.click(await screen.findByTestId('putaway-cancel-open'));
    expect(screen.getByTestId('putaway-cancel-go')).toBeDisabled();
    await userEvent.type(screen.getByTestId('putaway-cancel-reason'), '피킹면 막힘');
    await userEvent.click(screen.getByTestId('putaway-cancel-go'));
    await waitFor(() => expect(within(screen.getAllByTestId('putaway-row')[0]!).getByText('취소')).toBeInTheDocument());
  });

  it('입고관리·상품 발주 메뉴는 없다', () => {
    expect(allMenus.map((x) => x.key)).not.toContain('inbound');
    expect(allMenus.map((x) => x.key)).not.toContain('purchase');
  });
});
