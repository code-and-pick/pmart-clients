// 작업 따라 해 보기(2026-11-18)에서 찾은 것: 첫 화면 "내 할 일", 할 일 → 그 일만 걸러 둔 목록, 줄 전체 누르기, 답한 뒤 다음 문의.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('내 할 일(첫 화면)', () => {
  it('상담원: 내 할 일이 현황보다 먼저 — 답변 대기 문의를 누르면 "접수" 탭이 골라진 목록', async () => {
    const user = userEvent.setup();
    renderAt('/', as.cs);
    const work = await screen.findByTestId('dash-my-work');
    expect(within(work).getByRole('heading', { name: '내 할 일' })).toBeInTheDocument();
    // 내 할 일이 주문 현황보다 위
    const orders = screen.queryByTestId('dash-kpi-orders');
    if (orders) expect(work.compareDocumentPosition(orders) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 상담원은 접수 건을 맡지 않으므로 접수 건 할 일은 없다
    expect(within(work).queryByTestId('dash-kpi-casesOverdue')).not.toBeInTheDocument();
    await user.click(within(work).getByTestId('dash-kpi-inquiries'));
    expect(await screen.findByRole('radio', { name: '접수', checked: true })).toBeInTheDocument();
  });

  it('지원센터: 기한 넘김 → 아무도 안 맡음 순서, 개수는 서버 조회 그대로', async () => {
    renderAt('/', as.riderOps);
    const work = await screen.findByTestId('dash-my-work');
    const ids = [...work.querySelectorAll('[data-testid^="dash-kpi-"]')].map((e) => e.getAttribute('data-testid'));
    expect(ids.slice(0, 2)).toEqual(['dash-kpi-casesOverdue', 'dash-kpi-casesUnassigned']);
    expect(await within(screen.getByTestId('dash-kpi-casesOverdue')).findByText('1')).toBeInTheDocument();
  });
});

describe('목록 줄 전체 누르기', () => {
  it('승인함: 굵은 요약(번호 아닌 곳)을 눌러도 상세로', async () => {
    const user = userEvent.setup();
    renderAt('/approvals', as.admin);
    const row = (await screen.findAllByTestId('approval-row')).find((r) => r.textContent?.includes('기본가 변경 1건'))!;
    await user.click(within(row).getByText('기본가 변경 1건'));
    expect(await screen.findByTestId('next-action')).toBeInTheDocument(); // 승인 상세의 다음 할 일
  });
});
