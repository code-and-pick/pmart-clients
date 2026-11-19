import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MockAccountPicker } from './MockAccountPicker';

const accounts = () => screen.queryAllByRole('button', { name: / · / });

describe('목 시험 계정 고르기', () => {
  it('처음엔 역할 목록만 — 역할을 누르면 그 역할 계정이 나오고, 안에서 사번으로 찾는다', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<MockAccountPicker disabled={false} onPick={onPick} />);
    expect(accounts()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /고객센터·라이더/ }));
    expect(screen.getByRole('heading', { name: /고객센터·라이더/ })).toBeInTheDocument();
    expect(accounts()).toHaveLength(3);

    await user.type(screen.getByRole('searchbox', { name: '시험 계정 찾기' }), '00006');
    expect(accounts().map((b) => b.getAttribute('aria-label'))).toEqual(['라이더 운영 정 · RIDER_OPS']);
    await user.click(accounts()[0]!);
    expect(onPick).toHaveBeenCalledWith('op-rider-ops-1');

    await user.click(screen.getByRole('button', { name: /역할 목록/ }));
    expect(accounts()).toHaveLength(0);
  });

  it('역할 목록 위 검색은 전체에서 이름·사번·역할로 바로 찾고, 없으면 안내', async () => {
    const user = userEvent.setup();
    render(<MockAccountPicker disabled={false} onPick={vi.fn()} />);
    await user.type(screen.getByRole('searchbox', { name: '시험 계정 찾기' }), '상담원');
    expect(accounts()).toHaveLength(2);
    await user.clear(screen.getByRole('searchbox', { name: '시험 계정 찾기' }));
    await user.type(screen.getByRole('searchbox', { name: '시험 계정 찾기' }), 'P2026-00003');
    expect(accounts().map((b) => b.getAttribute('aria-label'))).toEqual(['승인자 이 · PRODUCT_APPROVER, DISPLAY_APPROVER, PRICE_APPROVER']);
    await user.type(screen.getByRole('searchbox', { name: '시험 계정 찾기' }), 'x');
    expect(screen.getByText('맞는 시험 계정이 없어요')).toBeInTheDocument();
  });
});
