// 목록 미리보기 칸(2026-11-18). 2026-11-20 사용자 "상세 열기 오른쪽 탭 필요 없는 곳도 계속 나와서 터치 2번" —
// 미리보기 안에서 일을 끝낼 수 있는 곳(상품 조회·가격 관리)만 남기고, 나머지 목록은 줄을 누르면 바로 상세.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('목록 줄 누르기 — 바로 상세(미리보기 없음)', () => {
  it('주문: 줄을 누르면 바로 주문 상세, 미리보기 칸 없음', async () => {
    const user = userEvent.setup();
    renderAt('/orders', as.cs);
    const row = (await screen.findAllByTestId('order-row'))[0]!;
    await user.click(within(row).getByTestId('order-number'));
    expect(await screen.findByTestId('order-head-number')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-drawer')).not.toBeInTheDocument();
  });

  it('접수 건·배송: 줄을 누르면 바로 상세', async () => {
    const user = userEvent.setup();
    const one = renderAt('/cases', as.riderOps);
    await user.click((await screen.findAllByTestId('case-row'))[0]!);
    await waitFor(() => expect(screen.queryByTestId('case-row')).not.toBeInTheDocument());
    expect(screen.queryByTestId('preview-drawer')).not.toBeInTheDocument();
    one.unmount();
    renderAt('/deliveries?q=1&state=FAILURE_REPORTED', as.riderOps);
    const rows = await screen.findAllByTestId('delivery-row');
    await user.click(rows[0]!);
    expect(await screen.findByTestId('execution-panel')).toBeInTheDocument();
  });
});

describe('미리보기 칸(상품 조회 — 남긴 곳)', () => {
  it('줄을 누르면 목록을 떠나지 않고 오른쪽에 요약 — ↓ 로 다음 줄, Esc 로 닫기', async () => {
    const user = userEvent.setup();
    renderAt('/products', as.md);
    const rows = await screen.findAllByTestId('product-row');
    await user.click(rows[0]!);
    expect(await screen.findByTestId('product-preview')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '상품 조회' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getAllByTestId('product-row')[1]).toHaveAttribute('aria-selected', 'true'));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('preview-drawer')).not.toBeInTheDocument());
  });

  it('주소의 ?preview= 로 열린 채 들어온다 — "상세 열기"는 그 상세로', async () => {
    renderAt('/products?preview=P-00000001', as.md);
    expect(await screen.findByRole('link', { name: '상세 열기' })).toHaveAttribute('href', '/products/P-00000001');
  });

  it('입력 칸에서 누른 Esc·화살표는 가로채지 않는다', async () => {
    const user = userEvent.setup();
    renderAt('/products?preview=P-00000001', as.md);
    await screen.findByTestId('preview-drawer');
    const input = screen.getByRole('textbox', { name: '상품명' });
    await user.click(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByTestId('preview-drawer')).toBeInTheDocument();
  });
});
