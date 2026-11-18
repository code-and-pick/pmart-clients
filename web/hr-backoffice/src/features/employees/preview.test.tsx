// 직원 목록 미리보기 칸·내 보기·머리줄 찾기(2026-11-19 — 백오피스와 같은 화면)
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';

describe('직원 목록 — 백오피스와 같은 동작', () => {
  it('줄을 누르면 오른쪽 미리보기, ↓ 다음 줄, Esc 닫기 — 사번 링크는 상세로', async () => {
    const user = userEvent.setup();
    renderAt('/employees');
    const rows = await screen.findAllByTestId('employee-row');
    await user.click(within(rows[0]!).getAllByRole('cell')[1]!);
    const drawer = await screen.findByTestId('preview-drawer');
    expect(await within(drawer).findByTestId('employee-preview')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(await within(drawer).findByText(`${rows.length}줄 중 2번째 · ↑↓ 로 넘기기`)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('preview-drawer')).not.toBeInTheDocument());

    await user.click(within(screen.getAllByTestId('employee-row')[0]!).getByRole('link'));
    expect(await screen.findByText('기본 정보')).toBeInTheDocument();
  });

  it('머리줄 직원 바로 찾기 → 그 말로 찾은 직원 목록', async () => {
    const user = userEvent.setup();
    renderAt('/employees/new');
    await user.type(await screen.findByRole('textbox', { name: '직원 바로 찾기' }), '한인사{Enter}');
    expect(await screen.findByLabelText('검색어')).toHaveValue('한인사');
  });

  it('내 보기 줄이 목록 위에 있다', async () => {
    renderAt('/employees');
    expect(await screen.findByText('내 보기')).toBeInTheDocument();
  });
});
