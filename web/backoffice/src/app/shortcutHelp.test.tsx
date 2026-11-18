// 단축키 안내(2026-11-19)
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('단축키 안내', () => {
  it('머리줄 "?" 단추·? 키로 열고 Esc 로 닫는다', async () => {
    const user = userEvent.setup();
    renderAt('/', as.cs);
    await user.click(await screen.findByRole('button', { name: '단축키 보기' }));
    const box = await screen.findByTestId('shortcut-help');
    expect(within(box).getByText('번호로 바로 찾기')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('shortcut-help')).not.toBeInTheDocument());
    fireEvent.keyDown(window, { key: '?' });
    expect(await screen.findByTestId('shortcut-help')).toBeInTheDocument();
  });

  it('입력 칸에서 누른 ? 는 글자 그대로(안내를 열지 않는다)', async () => {
    const user = userEvent.setup();
    renderAt('/', as.cs);
    const box = await screen.findByRole('textbox', { name: '번호로 바로 찾기' });
    await user.type(box, '?');
    expect(box).toHaveValue('?');
    expect(screen.queryByTestId('shortcut-help')).not.toBeInTheDocument();
  });
});
