// 첫 화면 대시보드(2026-11-18 사용자 — 참고 관리자 화면의 메인처럼). 숫자는 서버 조회에서만, 실패는 0 이 아니라 "?".
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE, BFF_BASE } from '../api/client';
import { as, renderAt } from '../test/render';
import { server } from '../test/server';

const forbidden = () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 403, code: 'FORBIDDEN', traceId: 't' }, { status: 403, headers: { 'content-type': 'application/problem+json' } });

describe('대시보드', () => {
  it('관리자: 숫자 카드(오늘 주문·처리 대기·기한 지난 접수 건·답변 대기·심사 대기), 7일 주문 막대, 처리 기한 지킴, 최근 주문', async () => {
    renderAt('/', as.admin);
    expect(await screen.findByRole('heading', { name: /좋은 아침이에요|오늘도 수고 많아요|오늘 하루 고생 많았어요/ })).toBeInTheDocument();
    for (const id of ['orders', 'pending', 'casesOverdue', 'inquiries', 'riderInquiries', 'approvals']) expect(screen.getByTestId(`dash-kpi-${id}`)).toBeInTheDocument();
    expect(await within(screen.getByTestId('dash-kpi-approvals')).findByText('3')).toBeInTheDocument(); // 목 심사 대기 3
    expect(screen.getAllByTestId('dash-day')).toHaveLength(7);
    expect(within(screen.getAllByTestId('dash-day').at(-1)!).getByText('오늘')).toBeInTheDocument();
    expect(await screen.findByTestId('dash-sla-ratio')).toBeInTheDocument();
    expect(await screen.findAllByTestId('dash-order-row')).not.toHaveLength(0);
    expect(screen.getByTestId('nav-dashboard')).toHaveAttribute('aria-current', 'page');
  });

  it('숫자 카드를 누르면 그 화면으로', async () => {
    const user = userEvent.setup();
    renderAt('/', as.admin);
    await user.click(await screen.findByTestId('dash-kpi-approvals'));
    expect(await screen.findByRole('heading', { name: '승인함' })).toBeInTheDocument();
  });

  it('주문을 못 읽으면 0 이 아니라 "?" — 막대도 0 으로 그리지 않는다, 최근 주문은 "불러오지 못했어요"', async () => {
    server.use(http.get(`${API_BASE}/orders/lookups`, () => forbidden()));
    renderAt('/', as.admin);
    expect(await within(await screen.findByTestId('dash-kpi-orders')).findByText('?')).toBeInTheDocument();
    expect(await within(screen.getAllByTestId('dash-day')[0]!).findByText('?')).toBeInTheDocument();
    // 최근 주문·오늘 주문 상태(2026-11-18 2판) 둘 다 "불러오지 못했어요"(0 건·빈 도넛 아님)
    expect(await within(screen.getByTestId('dash-recent-orders')).findByText(/주문을 불러오지 못했어요/)).toBeInTheDocument();
    expect(await within(screen.getByTestId('dash-status-donut')).findByText(/주문을 불러오지 못했어요/)).toBeInTheDocument();
    expect(within(screen.getByTestId('dash-kpi-orders')).queryByTestId('dash-sparkline')).not.toBeInTheDocument(); // 못 읽은 날을 0 으로 잇지 않는다
  });

  it('처리 기한 지킴을 못 읽으면 "불러오지 못했어요"(0% 아님)', async () => {
    server.use(http.get(`${BFF_BASE}/views/metrics`, () => forbidden()));
    renderAt('/', as.admin);
    expect(await screen.findByTestId('dash-sla-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('dash-sla-ratio')).not.toBeInTheDocument();
  });

  it('승인자는 승인 카드만 — 주문·처리 기한 지킴 없음', async () => {
    renderAt('/', as.approver);
    expect(await screen.findByTestId('dash-kpi-approvals')).toBeInTheDocument();
    expect(screen.queryByTestId('dash-kpi-orders')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dash-sla')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dash-orders-week')).not.toBeInTheDocument();
  });
});
