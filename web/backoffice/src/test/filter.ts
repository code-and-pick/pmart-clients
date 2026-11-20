// 속성 필터 조작(2026-11-20 AWS 개편 — 목록 검색 상자를 속성 필터로 바꾼 뒤 시험이 같은 동작을 한 줄로).
// 속성을 고르고, 값 목록에 그 값이 있으면 고르고, 없으면(글자 값 속성) 쳐서 Enter.
import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

export async function filterBy(user: UserEvent, prop: string, value: string) {
  const box = await screen.findByRole('combobox', { name: '속성으로 거르기' });
  await user.click(box);
  await user.click(screen.getByRole('option', { name: prop }));
  const opt = screen.queryByRole('option', { name: value });
  if (opt) {
    await user.click(opt);
    return;
  }
  await user.type(box, value);
  await user.keyboard('{Enter}');
}
