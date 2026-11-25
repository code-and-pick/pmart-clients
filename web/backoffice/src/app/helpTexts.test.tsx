// 도움말 패널 글(2026-11-20) — 주문 조회·접수 건·고객에서 "정보"를 누르면 그 화면 규칙이 오른쪽에
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('도움말 패널 글', () => {
  it.each([
    ['/orders', as.cs, '기간을 31일 안으로'],
    ['/cases', as.admin, '후속 처리가 남아 있으면 완료 처리할 수 없어요'],
    ['/customers', as.cs, '완전히 같은 것만 찾아요'],
  ] as const)('%s', async (path, token, text) => {
    const user = userEvent.setup();
    renderAt(path, token);
    await user.click(await screen.findByTestId('help-toggle')); // 제목 옆 ⓘ 는 없앰(2026-11-25) — 머리줄 도움 단추
    expect(await screen.findByTestId('help-panel')).toHaveTextContent(text);
  });
});
