// 시험 도우미 — 쳐서 찾는 고르기 칸(SearchSelect)에서 고르기. 칸 이름으로 찾아 글자를 넣고 맞는 항목을 누른다.
import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

export async function pick(user: UserEvent, label: string, optionText: string | RegExp, typed?: string) {
  const box = await screen.findByRole('combobox', { name: label });
  await user.click(box);
  if (typed !== undefined) await user.type(box, typed);
  const list = await screen.findByRole('listbox', { name: label });
  await user.click(within(list).getByRole('option', { name: optionText }));
}
