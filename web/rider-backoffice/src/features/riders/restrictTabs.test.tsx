// 계정 제한 메뉴(옛 "제한 검토 대기") 탭 — 검토 대기·제한 중·검토 완료(2026-11-24 사용자). 목(MSW) 기준.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('계정 제한 탭', () => {
  it('제한 중 탭: 지금 제한된 라이더가 보이고, 줄을 펼치면 그 자리에서 바꾸기·이력', async () => {
    renderAt('/restriction-reviews', as.riderOps);
    await userEvent.click(within(await screen.findByRole('radiogroup', { name: '계정 제한' })).getByRole('radio', { name: '제한 중' }));
    const rows = await screen.findAllByTestId('restricted-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveTextContent('일시 중지');
    await userEvent.click(rows[0]!);
    const inline = await screen.findByTestId('restricted-inline');
    expect(within(inline).getByRole('form', { name: '계정 제한 걸기·풀기' })).toBeInTheDocument();
  });

  it('검토 대기 줄에서 "계정 제한 걸기"를 누르면 그 자리에 제한 칸이 열린다(라이더 상세로 가지 않음)', async () => {
    renderAt('/restriction-reviews', as.riderOps);
    const row = (await screen.findAllByTestId('review-row'))[0]!;
    await userEvent.click(within(row).getByTestId('review-restrict-toggle'));
    expect(within(row).getByTestId('review-restrict')).toBeInTheDocument();
  });
});
