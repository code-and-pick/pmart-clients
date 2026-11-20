// 입력 화면 오른쪽 요약(2026-11-20 AWS 만들기 화면) — 반품 접수·콘텐츠 새 초안. 고른 값과 빠진 것, 저장·접수 단추는 요약 안에.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('입력 화면 요약', () => {
  it('반품 접수: 처음엔 빠진 것 안내, 품목·사유·본인 확인을 고르면 요약이 따라 바뀌고 접수 단추가 켜진다', async () => {
    const user = userEvent.setup();
    renderAt('/return-intake?orderId=ORD-MOCK-1001', as.cs);
    const box = await screen.findByTestId('return-summary');
    expect(within(box).getByTestId('return-missing')).toHaveTextContent('반품할 품목');
    const submit = within(box).getByRole('button', { name: /접수/ });
    expect(submit).toBeDisabled();
    const qty = (await screen.findAllByRole('spinbutton')).find((x) => !(x as HTMLInputElement).disabled)!;
    await user.clear(qty);
    await user.type(qty, '1');
    await user.selectOptions(screen.getAllByRole('combobox')[0]!, screen.getAllByRole('combobox')[0]!.querySelectorAll('option')[1]!);
    await user.click(screen.getAllByRole('radio')[0]!);
    await waitFor(() => expect(within(box).queryByTestId('return-missing')).not.toBeInTheDocument());
    expect(box).toHaveTextContent('1가지 · 1개');
    expect(submit).toBeEnabled();
  });

  it('콘텐츠 새 초안: 오른쪽 요약에 상품명·고시 줄 수, 저장 단추가 요약 안에', async () => {
    const user = userEvent.setup();
    renderAt('/contents/drafts/new', as.md);
    const box = await screen.findByTestId('content-summary');
    expect(within(box).getByRole('button', { name: '초안 저장' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('고객용 상품명'), '사과 1.5kg');
    expect(box).toHaveTextContent('사과 1.5kg');
  });
});
