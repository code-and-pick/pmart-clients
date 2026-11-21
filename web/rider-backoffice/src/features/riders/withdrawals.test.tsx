// 라이더 탈퇴 신청 목록(rider 0.19.0 `GET /riders/withdrawals`, 2026-11-20). 목(MSW) 기준 — 실서버 확인은 아니다.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('탈퇴 — 신청 목록', () => {
  it('완료·거절 모두 상세로 간다 — 거절은 막은 이유와 함께', async () => {
    renderAt('/withdrawals', as.riderOps);
    const rows = await screen.findAllByTestId('withdrawal-row');
    expect(rows).toHaveLength(3);
    const done = rows.find((r) => r.textContent?.includes('615204'))!;
    expect(done).toHaveTextContent('탈퇴 완료');
    expect(done).toHaveTextContent('다른 일을 하게 됐어요');
    expect(within(done).getByRole('link')).toHaveAttribute('href', '/riders/RD-W1');
    const rejected = rows.find((r) => r.textContent?.includes('482913'))!;
    expect(rejected).toHaveTextContent('진행 중 배송, 확정 전 수행료');
    expect(within(rejected).getByRole('link')).toHaveAttribute('href', '/riders/RD-7');
  });

  it('결과 칩·라이더 번호로 좁혀 서버에 보낸다', async () => {
    const view = renderAt('/withdrawals', as.riderOps);
    await screen.findAllByTestId('withdrawal-row');
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '결과' })).getByRole('radio', { name: '거절' }));
    expect(await screen.findAllByTestId('withdrawal-row')).toHaveLength(1);
    expect(view.sent.some((r) => new URL(r.url).searchParams.get('state') === 'REJECTED')).toBe(true);
    await userEvent.type(screen.getByLabelText('라이더 번호(6자리)'), '61-5204');
    await userEvent.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findByText('탈퇴 신청이 없어요.')).toBeInTheDocument();
    expect(view.sent.some((r) => new URL(r.url).searchParams.get('riderNumber') === '615204')).toBe(true);
  });

  it('라이더 메뉴 묶음에 "탈퇴"가 보인다', async () => {
    renderAt('/withdrawals', as.riderOps);
    expect(await screen.findByRole('heading', { name: '탈퇴' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /탈퇴/ }).length).toBeGreaterThan(0);
  });
});
