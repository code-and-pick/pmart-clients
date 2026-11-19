import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MockAccountPicker } from './MockAccountPicker';

describe('목 시험 계정 고르기', () => {
  it('검색은 이름·역할(한글·코드)로 거르고, 역할 탭은 그 묶음만 남긴다', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<MockAccountPicker disabled={false} onPick={onPick} />);
    expect(screen.getAllByRole('button', { name: / · / })).toHaveLength(7);

    await user.type(screen.getByRole('searchbox', { name: '시험 계정 찾기' }), '상담원');
    expect(screen.getAllByRole('button', { name: / · / }).map((b) => b.getAttribute('aria-label'))).toEqual([
      '상담원 최 · CS_AGENT',
      '상담·라이더운영 한 · CS_AGENT, RIDER_OPS',
    ]);

    await user.clear(screen.getByRole('searchbox', { name: '시험 계정 찾기' }));
    await user.click(screen.getByRole('tab', { name: /상품·전시·가격/ }));
    expect(screen.getAllByRole('button', { name: / · / })).toHaveLength(2);

    await user.type(screen.getByRole('searchbox', { name: '시험 계정 찾기' }), '없는사람');
    expect(screen.getByText('맞는 시험 계정이 없어요')).toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox', { name: '시험 계정 찾기' }));
    await user.click(screen.getByRole('button', { name: /승인자 이/ }));
    expect(onPick).toHaveBeenCalledWith('op-approver-1');
  });
});
