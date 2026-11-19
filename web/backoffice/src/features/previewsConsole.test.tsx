// 오른쪽 미리보기를 더 붙인 목록(2026-11-19 관제 형식) — 상품·클레임·라이더 컴플레인. 줄을 누르면 옆에, ↓ 로 다음 줄, Esc 로 닫기
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('목록 오른쪽 미리보기', () => {
  it('상품 조회: 줄 → 미리보기(판매 상태·버전), ↓ 다음 줄, Esc 닫기', async () => {
    const user = userEvent.setup();
    renderAt('/products', as.md);
    const rows = await screen.findAllByTestId('product-row');
    await user.click(rows[0]!.querySelector('td:nth-child(3)')!);
    const drawer = await screen.findByTestId('preview-drawer');
    expect(within(drawer).getByTestId('product-preview')).toHaveTextContent(/v\d+/);
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    if (rows.length > 1) {
      await user.keyboard('{ArrowDown}');
      expect((await screen.findAllByTestId('product-row'))[1]).toHaveAttribute('aria-selected', 'true');
    }
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('preview-drawer')).not.toBeInTheDocument();
  });

  it('클레임: 줄을 누르면 바로 클레임 상세(미리보기 없음 — 2026-11-20)', async () => {
    const user = userEvent.setup();
    renderAt('/claims', as.admin);
    const row = (await screen.findAllByTestId('claim-row'))[0]!;
    await user.click(row.querySelector('td:nth-child(4)')!);
    expect(await screen.findByTestId('claim-state')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-drawer')).not.toBeInTheDocument();
  });

  it('라이더 컴플레인: 줄을 누르면 바로 상세(미리보기 없음 — 2026-11-20)', async () => {
    const user = userEvent.setup();
    renderAt('/rider-complaints', as.riderOps);
    const row = (await screen.findAllByTestId('complaint-row'))[0]!;
    await user.click(row.querySelector('td:last-child')!);
    await waitFor(() => expect(screen.queryByTestId('complaint-row')).not.toBeInTheDocument());
    expect(screen.queryByTestId('preview-drawer')).not.toBeInTheDocument();
  });
});
