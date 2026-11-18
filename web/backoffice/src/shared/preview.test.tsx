// 목록 미리보기 칸(2026-11-18 — Shopify·Medusa 목록, Refine 옆 패널 참고)
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('목록 미리보기 칸', () => {
  it('주문 줄을 누르면 목록을 떠나지 않고 오른쪽에 요약 — ↓ 로 다음 줄, Esc 로 닫기', async () => {
    const user = userEvent.setup();
    renderAt('/orders', as.cs);
    const rows = await screen.findAllByTestId('order-row');
    await user.click(within(rows[0]!).getAllByRole('cell')[1]!); // 번호 링크가 아닌 칸
    const drawer = await screen.findByTestId('preview-drawer');
    expect(await within(drawer).findByTestId('order-preview')).toBeInTheDocument();
    expect(within(drawer).getByText(`${rows.length}줄 중 1번째 · ↑↓ 로 넘기기`)).toBeInTheDocument();
    expect(screen.getAllByTestId('order-row')).toHaveLength(rows.length); // 목록은 그대로
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(await within(drawer).findByText(`${rows.length}줄 중 2번째 · ↑↓ 로 넘기기`)).toBeInTheDocument();
    expect(screen.getAllByTestId('order-row')[1]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('preview-drawer')).not.toBeInTheDocument());
  });

  it('줄 안의 번호 링크는 그대로 상세로 간다', async () => {
    const user = userEvent.setup();
    renderAt('/orders', as.cs);
    const row = (await screen.findAllByTestId('order-row'))[0]!;
    await user.click(within(row).getByTestId('order-number'));
    expect(await screen.findByTestId('order-head-number')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-drawer')).not.toBeInTheDocument();
  });

  it('주소의 ?preview= 로 열린 채 들어온다 — "상세 열기"는 그 상세로', async () => {
    renderAt('/inquiries?preview=INQ-MOCK-1', as.cs);
    const drawer = await screen.findByTestId('preview-drawer');
    expect(await within(drawer).findByTestId('inquiry-preview')).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: '상세 열기' })).toHaveAttribute('href', '/inquiries/INQ-MOCK-1');
  });

  it('접수 건·배송 목록에도 같은 칸', async () => {
    const user = userEvent.setup();
    const first = renderAt('/cases?tab=all', as.riderOps);
    await user.click(within((await screen.findAllByTestId('case-row'))[0]!).getAllByRole('cell')[1]!);
    expect(await within(await screen.findByTestId('preview-drawer')).findByTestId('case-preview')).toBeInTheDocument();
    first.unmount();

    renderAt('/deliveries?q=1', as.csRider);
    await user.click(within((await screen.findAllByTestId('delivery-row'))[0]!).getAllByRole('cell')[1]!);
    expect(await within(await screen.findByTestId('preview-drawer')).findByTestId('delivery-preview')).toBeInTheDocument();
  });

  it('입력 칸에서 누른 Esc·화살표는 가로채지 않는다', async () => {
    renderAt('/inquiries?preview=INQ-MOCK-1', as.cs);
    await screen.findByTestId('preview-drawer');
    const box = screen.getByRole('textbox', { name: '번호로 바로 찾기' });
    box.focus();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.getByTestId('preview-drawer')).toBeInTheDocument();
  });
});
