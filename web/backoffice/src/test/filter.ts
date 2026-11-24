// 속성 필터 조작(2026-11-25 백오피스 화면 기준 — 찾기 칸 + 필터 팝업, @pmart/web-ui/standard PropertyFilter).
// 값 고르기 속성이면 필터 팝업의 그 속성 묶음(radiogroup)에서 값을 누른다. 글자 값 속성이면 "찾을 항목"을 고르고 찾기 칸에 쳐서 Enter.
import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

export async function filterBy(user: UserEvent, prop: string, value: string) {
  const bar = await screen.findByRole('search', { name: '속성으로 거르기' });
  const group = within(bar).queryByRole('radiogroup', { name: prop });
  if (group) {
    await user.click(within(bar).getByTestId('filter-toggle'));
    await user.click(within(group).getByRole('radio', { name: value }));
    return;
  }
  const field = within(bar).queryByRole('combobox', { name: '찾을 항목' });
  if (field) await user.selectOptions(field, prop);
  const box = within(bar).getByRole('searchbox', { name: '찾기 칸' });
  await user.clear(box);
  await user.type(box, value);
  await user.keyboard('{Enter}');
}
