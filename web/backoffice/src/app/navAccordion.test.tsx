// 왼쪽 메뉴 묶음은 따로 열고 닫는다(2026-11-21 사용자 "내가 클릭해서 연 건 계속 열려있게" — 2026-11-18 의 한 묶음만 펼침을 되돌림)
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

const group = (id: string) => screen.getByTestId<HTMLDetailsElement>(`nav-group-${id}`);
const clickName = (user: ReturnType<typeof userEvent.setup>, id: string) => user.click(group(id).querySelector('[data-group-label]')!);

describe('왼쪽 메뉴 — 묶음마다 따로 펼침', () => {
  it('처음엔 지금 화면의 묶음만 열려 있고, 다른 묶음을 눌러 열어도 앞서 연 묶음은 그대로 열려 있다', async () => {
    const user = userEvent.setup();
    renderAt('/products', as.admin);
    await screen.findByTestId('nav-group-catalog');
    expect(group('catalog').open).toBe(true);
    expect(group('approval').open).toBe(false);

    await clickName(user, 'approval');
    expect(group('approval').open).toBe(true);
    expect(group('catalog').open).toBe(true);

    await clickName(user, 'cs');
    expect(group('cs').open).toBe(true);
    expect(group('approval').open).toBe(true);
    expect(group('catalog').open).toBe(true);
  });

  it('열린 묶음을 다시 누르면 그것만 닫히고, 다른 묶음 화면으로 옮겨도 연 묶음은 닫히지 않는다', async () => {
    const user = userEvent.setup();
    renderAt('/products', as.admin);
    await screen.findByTestId('nav-group-catalog');
    await clickName(user, 'approval');
    await clickName(user, 'catalog');
    expect(group('catalog').open).toBe(false);
    expect(group('approval').open).toBe(true);

    await clickName(user, 'catalog');
    await user.click(within(group('approval')).getByRole('link', { name: '승인함' }));
    expect(await screen.findByRole('heading', { name: '승인함' })).toBeInTheDocument();
    expect(group('approval').open).toBe(true);
    expect(group('catalog').open).toBe(true);
  });
});
