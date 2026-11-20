// 대시보드 숫자 띠·이상 한 줄·오른쪽 패널(2026-11-19 사용자가 보여 준 배송 관제 화면 참고 — 지도는 뺌)
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/server';
import { API_BASE, BFF_BASE } from '../api/client';
import { as, renderAt } from '../test/render';

describe('대시보드 숫자 띠·이상 한 줄', () => {
  it('지원센터: 기한 지난 접수 건이 있으면 "이상 1" + 그 목록 링크, 띠 카드는 색 막대(빨강 = 기한 지남)', async () => {
    renderAt('/', as.riderOps);
    const status = await screen.findByTestId('dash-status');
    await within(status).findByText(/^이상 \d+$/);
    expect(status).toHaveAttribute('data-tone', 'error');
    expect(within(status).getByRole('link', { name: /기한 지난 접수 건/ })).toHaveAttribute('href', '/cases?tab=overdue');
    const overdue = screen.getByTestId('dash-kpi-casesOverdue');
    expect(overdue).toHaveAttribute('data-tone', 'error');
    expect(overdue.querySelector('.text-error')).not.toBeNull(); // 2026-11-20 AWS 개편: 색은 숫자에(왼쪽 색 막대 없음)
  });

  it('숫자를 못 읽으면 "이상 없음"이 아니라 "확인 못 함"', async () => {
    const forbidden = () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 403, code: 'FORBIDDEN', traceId: 't' }, { status: 403, headers: { 'content-type': 'application/problem+json' } });
    // 접수 건·지금 배송 둘 다 못 읽음(하나라도 이상이 보이면 "이상 N"이 먼저라 따로 본다)
    server.use(http.get(`${API_BASE}/cases`, forbidden), http.get(`${BFF_BASE}/views/live-delivery`, forbidden));
    renderAt('/', as.riderOps);
    const status = await screen.findByTestId('dash-status');
    await within(status).findByText('확인 못 함');
    expect(status).not.toHaveTextContent('이상 없음');
    expect(status).toHaveTextContent('0 이 아니에요');
  });

  it('볼 수 있는 이상 원천이 없는 역할(승인자)은 이상 한 줄을 그리지 않는다', async () => {
    renderAt('/', as.approver);
    await screen.findByTestId('dash-my-work');
    expect(screen.queryByTestId('dash-status')).not.toBeInTheDocument();
  });
});
