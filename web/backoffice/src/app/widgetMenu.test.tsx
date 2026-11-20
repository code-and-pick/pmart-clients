// 대시보드 위젯 메뉴(2026-11-20 AWS 개편) — ⋮ 로 숨기고, "기본 배치로"로 되돌린다. 숨김은 이 브라우저에만.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('대시보드 위젯 메뉴', () => {
  beforeEach(() => window.localStorage.removeItem('pmart.backoffice.dashboard.hidden'));

  it('⋮ → 이 위젯 숨기기 → 사라지고, 기본 배치로 → 다시 보인다', async () => {
    const user = userEvent.setup();
    renderAt('/?tab=ops', as.admin);
    await user.click(await screen.findByTestId('widget-menu-approval-types'));
    await user.click(screen.getByRole('menuitem', { name: '이 위젯 숨기기' }));
    await waitFor(() => expect(screen.queryByTestId('widget-menu-approval-types')).not.toBeInTheDocument());
    expect(screen.getByTestId('dash-layout-reset')).toHaveTextContent('숨긴 위젯 1개');
    expect(window.localStorage.getItem('pmart.backoffice.dashboard.hidden')).toBe('["approval-types"]');
    await user.click(screen.getByRole('button', { name: '기본 배치로' }));
    expect(await screen.findByTestId('widget-menu-approval-types')).toBeInTheDocument();
    expect(screen.queryByTestId('dash-layout-reset')).not.toBeInTheDocument();
  });

  it('상세 화면의 구역 상자에는 ⋮ 가 없다', async () => {
    renderAt('/orders/ORD-MOCK-1005', as.admin);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: '위젯 메뉴' })).not.toBeInTheDocument();
  });
});
