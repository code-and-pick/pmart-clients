// 대시보드 2판(2026-11-18): 한눈에 숫자 카드(어제 대비·추세선)·오늘 주문 상태 도넛·최근 활동 — 서버 값만, 못 읽으면 숨기지 않고 알린다
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../api/client';
import { as, renderAt } from '../test/render';
import { server } from '../test/server';

const forbidden = () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 403, code: 'FORBIDDEN', traceId: 't' }, { status: 403, headers: { 'content-type': 'application/problem+json' } });

describe('대시보드 2판', () => {
  it('관리자: 한눈에 카드 넷(오늘 주문·진행 중 배송·처리 기한 지킴·처리 대기), 오늘 주문은 어제 대비와 7일 추세선', async () => {
    renderAt('/', as.admin);
    const glance = await screen.findByTestId('dash-glance');
    for (const id of ['dash-kpi-orders', 'dash-stat-live', 'dash-stat-sla', 'dash-stat-risk']) expect(within(glance).getByTestId(id)).toBeInTheDocument();
    expect(await within(screen.getByTestId('dash-kpi-orders')).findByText(/어제(보다|와)/)).toBeInTheDocument();
    expect(await within(screen.getByTestId('dash-kpi-orders')).findByTestId('dash-sparkline')).toBeInTheDocument();
    expect(await within(screen.getByTestId('dash-stat-risk')).findByText(/결제 결과 불명 1건/)).toBeInTheDocument();
  });

  it('내 할 일이 한눈에 카드보다 먼저(화면 읽는 순서)', async () => {
    renderAt('/', as.admin);
    const work = await screen.findByTestId('dash-my-work');
    expect(work.compareDocumentPosition(screen.getByTestId('dash-glance')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('오늘 주문 상태 — 상태별 이름과 개수, 합은 오늘 주문 수', async () => {
    renderAt('/', as.admin);
    const legend = await screen.findByTestId('dash-status-legend');
    const counts = within(legend).getAllByRole('listitem').map((li) => Number(li.lastElementChild?.textContent));
    const total = counts.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    expect(within(screen.getByTestId('dash-status-donut')).getByText(String(total))).toBeInTheDocument();
  });

  it('최근 활동 — 승인·접수 건·문의를 시각순으로, 누르면 그 상세', async () => {
    renderAt('/', as.admin);
    // 세 원천이 따로 도착한다. 최근 8건만 — 목 데이터에선 접수 건(2시간 전)·문의(3·4일 전)가 승인(5·19일 전)보다 최근이라 승인은 밀린다
    await waitFor(() => {
      const metas = screen.getAllByTestId('dash-activity-item').map((i) => i.textContent ?? '');
      expect(metas).toHaveLength(8);
      expect(metas.some((t) => t.includes('접수 건'))).toBe(true);
      expect(metas.some((t) => t.includes('고객 문의'))).toBe(true);
      expect(metas.findIndex((t) => t.includes('고객 문의'))).toBeGreaterThan(metas.findLastIndex((t) => t.includes('접수 건'))); // 시각순(최근 먼저)
    });
    expect(screen.getAllByTestId('dash-activity-item')[0]!.querySelector('a')).toHaveAttribute('href', expect.stringMatching(/^\/cases\//));
  });

  it('최근 활동에서 한 원천을 못 읽으면 남은 것은 보이고 빠졌다고 알린다', async () => {
    server.use(http.get(`${API_BASE}/approvals`, () => forbidden()));
    renderAt('/', as.admin);
    expect(await screen.findByTestId('dash-activity-failed')).toHaveTextContent('승인');
    expect((await screen.findAllByTestId('dash-activity-item')).length).toBeGreaterThan(0);
  });

  it('승인자: 한눈에·도넛 없이(보이는 메뉴만), 최근 활동은 승인만', async () => {
    renderAt('/', as.approver);
    const items = await screen.findAllByTestId('dash-activity-item');
    expect(items.every((i) => (i.textContent ?? '').includes('승인 요청'))).toBe(true);
    expect(screen.queryByTestId('dash-glance')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dash-status-donut')).not.toBeInTheDocument();
  });
});
