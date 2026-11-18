// 왼쪽 메뉴는 한 번에 한 묶음만 펼친다(2026-11-18 사용자 "다른 묶음 열면 전 묶음이 안 닫혀 밑으로 줄줄 흐른다")
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

const group = (id: string) => screen.getByTestId<HTMLDetailsElement>(`nav-group-${id}`);
const clickName = (user: ReturnType<typeof userEvent.setup>, id: string) => user.click(group(id).querySelector('[data-group-label]')!);

describe('왼쪽 메뉴 — 한 묶음만 펼침', () => {
  it('지금 화면의 묶음만 열려 있고, 다른 묶음 이름을 누르면 그것만 열린다', async () => {
    const user = userEvent.setup();
    renderAt('/products', as.admin);
    await screen.findByTestId('nav-group-catalog');
    expect(group('catalog').open).toBe(true);
    expect(group('approval').open).toBe(false);

    await clickName(user, 'approval');
    expect(group('approval').open).toBe(true);
    expect(group('catalog').open).toBe(false);

    await clickName(user, 'cs');
    expect(group('cs').open).toBe(true);
    expect(group('approval').open).toBe(false);
  });

  it('열린 묶음을 다시 누르면 닫히고, 다른 묶음 화면으로 옮기면 그 묶음이 열린다', async () => {
    const user = userEvent.setup();
    renderAt('/products', as.admin);
    await screen.findByTestId('nav-group-catalog');
    await clickName(user, 'catalog');
    expect(group('catalog').open).toBe(false);

    await clickName(user, 'approval');
    await user.click(within(group('approval')).getByRole('link', { name: '승인함' }));
    expect(await screen.findByRole('heading', { name: '승인함' })).toBeInTheDocument();
    expect(group('approval').open).toBe(true);
    expect(group('catalog').open).toBe(false);
  });
});
