// 입력 중 떠날 때 경고(2026-11-18)
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('입력 중 떠날 때 경고', () => {
  it('상품 초안에 쓰다가 메뉴를 누르면 묻는다 — 계속 작성이면 그대로, 나가기면 이동', async () => {
    const user = userEvent.setup();
    renderAt('/products/drafts/new', as.md);
    await user.type(await screen.findByLabelText('관리용 명칭'), '사과');
    await user.click(screen.getByRole('link', { name: '상품 조회' }));

    const box = await screen.findByTestId('leave-guard');
    expect(box).toHaveTextContent('작성한 내용이 사라져요');
    await user.click(within(box).getByRole('button', { name: '계속 작성' }));
    expect(screen.queryByTestId('leave-guard')).not.toBeInTheDocument();
    expect(screen.getByLabelText('관리용 명칭')).toHaveValue('사과');

    await user.click(screen.getByRole('link', { name: '상품 조회' }));
    await user.click(within(await screen.findByTestId('leave-guard')).getByRole('button', { name: '나가기' }));
    await waitFor(() => expect(screen.queryByLabelText('관리용 명칭')).not.toBeInTheDocument());
  });

  it('아무것도 안 썼으면 묻지 않는다', async () => {
    const user = userEvent.setup();
    renderAt('/products/drafts/new', as.md);
    await screen.findByLabelText('관리용 명칭');
    await user.click(screen.getByRole('link', { name: '상품 조회' }));
    expect(screen.queryByTestId('leave-guard')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('관리용 명칭')).not.toBeInTheDocument();
  });

  it('저장하면 그 뒤 이동(초안 화면으로)은 막지 않는다', async () => {
    const user = userEvent.setup();
    renderAt('/products/drafts/new', as.md);
    await user.type(await screen.findByLabelText('관리용 명칭'), '사과');
    await user.click(screen.getByRole('button', { name: '초안 저장' }));
    expect(await screen.findByText(/상품 초안 pd-/)).toBeInTheDocument();
    expect(screen.queryByTestId('leave-guard')).not.toBeInTheDocument();
  });

  it('문의 답변을 쓰다 만 채로 나가면 묻는다', async () => {
    const user = userEvent.setup();
    renderAt('/inquiries/INQ-MOCK-1', as.cs);
    await user.type(await screen.findByRole('textbox', { name: /답변/ }), '확인해 볼게요');
    await user.click(screen.getByRole('link', { name: '대시보드' }));
    expect(await screen.findByTestId('leave-guard')).toBeInTheDocument();
  });
});
