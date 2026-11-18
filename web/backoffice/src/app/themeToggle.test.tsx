// 밝은/어두운 테마(2026-11-18)
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';
import { readTheme } from '../shared/theme';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.setAttribute('data-theme', 'pmart');
});

describe('밝은/어두운 테마', () => {
  it('머리줄 단추로 바꾸고, 이 브라우저에 기억한다', async () => {
    const user = userEvent.setup();
    renderAt('/', as.cs);
    await user.click(await screen.findByRole('button', { name: '어두운 화면으로' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'pmart-dark');
    expect(readTheme()).toBe('pmart-dark');

    await user.click(screen.getByRole('button', { name: '밝은 화면으로' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'pmart');
    expect(readTheme()).toBe('pmart');
  });

  it('기억한 값이 없거나 이상하면 밝은 테마', () => {
    expect(readTheme()).toBe('pmart');
    window.localStorage.setItem('pmart.backoffice.theme', 'neon');
    expect(readTheme()).toBe('pmart');
  });
});
