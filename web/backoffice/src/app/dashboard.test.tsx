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
  it('접수 건을 맡지 않는 역할(센터)은 대시보드에서 접수 건을 묻지 않는다 — 403 을 내지 않게(2026-11-24 점검)', async () => {
    const view = renderAt('/', as.center);
    await screen.findByRole('heading', { level: 1 });
    await new Promise((r) => setTimeout(r, 800));
    expect(view.sent.some((r) => new URL(r.url).pathname.endsWith('/cases'))).toBe(false);
  });

  it('관리자: 한눈에 = 내 할 일 숫자(오늘 주문·처리 대기·기한 지난 접수 건·답변 대기·심사 대기), 매출·통계 탭 = 7일 주문 막대·최근 주문, 운영 탭 = 처리 기한 지킴', async () => {
    const user = userEvent.setup();
    renderAt('/', as.admin);
    expect(await screen.findByRole('heading', { name: /좋은 아침이에요|오늘도 수고 많아요|오늘 하루 고생 많았어요/ })).toBeInTheDocument();
    for (const id of ['orders', 'pending', 'casesOverdue', 'inquiries', 'riderInquiries', 'approvals']) expect(screen.getByTestId(`dash-kpi-${id}`)).toBeInTheDocument();
    expect(await within(screen.getByTestId('dash-kpi-approvals')).findByText('1')).toBeInTheDocument(); // 관리자가 지금 심사할 수 있는 것(bff 0.16.0 DECIDABLE_BY_ME) — 목 심사 대기 3 중 직원 권한 1(자기 권한·가격은 못 함)
    expect(screen.getByTestId('nav-dashboard')).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('tab', { name: '매출·통계' }));
    expect(await screen.findAllByTestId('dash-day')).toHaveLength(7);
    expect(within(screen.getAllByTestId('dash-day').at(-1)!).getByText('오늘')).toBeInTheDocument();
    expect(await screen.findAllByTestId('dash-order-row')).not.toHaveLength(0);

    await user.click(screen.getByRole('tab', { name: '운영' }));
    expect(await screen.findByTestId('dash-sla-ratio')).toBeInTheDocument();
  });

  it('숫자 카드를 누르면 그 화면으로', async () => {
    const user = userEvent.setup();
    renderAt('/', as.admin);
    await user.click(await screen.findByTestId('dash-kpi-approvals'));
    expect(await screen.findByRole('heading', { name: '승인함' })).toBeInTheDocument();
  });

  it('주문을 못 읽으면 0 이 아니라 "?" — 막대도 0 으로 그리지 않는다, 최근 주문은 "불러오지 못했어요"', async () => {
    server.use(http.get(`${API_BASE}/orders/lookups`, () => forbidden()));
    const user = userEvent.setup();
    renderAt('/', as.admin);
    // 한눈에: 오늘 주문 카드 "?"
    expect(await within(await screen.findByTestId('dash-kpi-orders')).findByText('?')).toBeInTheDocument();
    expect(within(screen.getByTestId('dash-kpi-orders')).queryByTestId('dash-sparkline')).not.toBeInTheDocument(); // 못 읽은 날을 0 으로 잇지 않는다
    // 매출·통계: 막대·최근 주문·도넛
    await user.click(screen.getByRole('tab', { name: '매출·통계' }));
    expect(await within((await screen.findAllByTestId('dash-day'))[0]!).findByText('?')).toBeInTheDocument();
    // 최근 주문·오늘 주문 상태(2026-11-18 2판) 둘 다 "불러오지 못했어요"(0 건·빈 도넛 아님)
    expect(await within(screen.getByTestId('dash-recent-orders')).findByText(/주문을 불러오지 못했어요/)).toBeInTheDocument();
    expect(await within(screen.getByTestId('dash-status-donut')).findByText(/주문을 불러오지 못했어요/)).toBeInTheDocument();
  });

  it('처리 기한 지킴을 못 읽으면 "불러오지 못했어요"(0% 아님)', async () => {
    server.use(http.get(`${BFF_BASE}/views/metrics`, () => forbidden()));
    renderAt('/?tab=ops', as.admin);
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
