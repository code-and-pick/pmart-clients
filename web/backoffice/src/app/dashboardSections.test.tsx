// 대시보드 보강(2026-11-18): 운영 위험·지금 배송·심사 대기 유형별·처리 기한 지킴 날짜별 — 서버 값만, 못 읽으면 "?"(0 아님)
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE, BFF_BASE } from '../api/client';
import { as, renderAt } from '../test/render';
import { server } from '../test/server';

const forbidden = () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 403, code: 'FORBIDDEN', traceId: 't' }, { status: 403, headers: { 'content-type': 'application/problem+json' } });

describe('대시보드 보강', () => {
  it('관리자: 운영 위험을 종류별로 — 결제 결과 불명은 따로', async () => {
    renderAt('/?tab=ops', as.admin);
    expect(await within(await screen.findByTestId('dash-risk-payment')).findByText('1')).toBeInTheDocument(); // 목 SAGA-MOCK-1
    expect(within(screen.getByTestId('dash-risk-stuck')).getByText('1')).toBeInTheDocument(); // 목 SAGA-MOCK-2
    expect(within(screen.getByTestId('dash-risk-issue')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('dash-risk-handover')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('dash-risk-stop')).getByText('1')).toBeInTheDocument();
  });

  it('처리 대기를 못 읽으면 칸마다 "?" — 0 으로 보이지 않는다', async () => {
    server.use(http.get(`${BFF_BASE}/views/pending-work`, () => forbidden()));
    renderAt('/?tab=ops', as.admin);
    expect(await within(await screen.findByTestId('dash-risk-payment')).findByText('?')).toBeInTheDocument();
    expect(within(screen.getByTestId('dash-risk-issue')).queryByText('0')).not.toBeInTheDocument();
  });

  it('못 읽은 원천이 있으면 숨기지 않고 알린다', async () => {
    server.use(http.get(`${BFF_BASE}/views/pending-work`, () => HttpResponse.json({ composedAt: new Date().toISOString(), sources: [], unavailableSources: ['mfc-fulfillment-service'], items: [] })));
    renderAt('/?tab=ops', as.admin);
    expect(await screen.findByTestId('dash-risk-missing')).toHaveTextContent('센터 작업');
  });

  it('심사 대기 유형별 — 유형마다 서버 조회 수, 누르면 그 유형만 걸러 둔 승인함', async () => {
    renderAt('/?tab=ops', as.admin);
    expect(await within(await screen.findByTestId('dash-approval-GRANT')).findByText('2')).toBeInTheDocument();
    expect(await within(screen.getByTestId('dash-approval-PRICE')).findByText('1')).toBeInTheDocument();
    expect(screen.getByTestId('dash-approval-PRICE')).toHaveAttribute('href', '/approvals?reviewState=REVIEW_PENDING&type=PRICE');
  });

  it('승인 조회를 못 읽으면 유형 칸은 "?"', async () => {
    server.use(http.get(`${API_BASE}/approvals`, () => forbidden()));
    renderAt('/?tab=ops', as.admin);
    expect(await within(await screen.findByTestId('dash-approval-PRODUCT')).findByText('?')).toBeInTheDocument();
  });

  it('지금 배송 — 읽은 줄 기준임을 적고 숫자 칸 셋', async () => {
    renderAt('/?tab=ops', as.admin);
    const live = await screen.findByTestId('dash-live');
    expect(await within(live).findByText(/진행 중 배송 \d+건/)).toBeInTheDocument();
    for (const id of ['dash-live-late', 'dash-live-norider', 'dash-live-failure']) expect(within(live).getByTestId(id)).toBeInTheDocument();
  });

  it('처리 기한 지킴 날짜별 막대 7개(닫힌 건 없는 날은 "—")', async () => {
    renderAt('/?tab=ops', as.admin);
    expect(await screen.findByTestId('dash-sla-trend')).toBeInTheDocument();
    expect(screen.getAllByTestId('dash-sla-day')).toHaveLength(7);
  });

  it('승인자는 운영 위험·지금 배송 없이 심사 대기 유형별만', async () => {
    renderAt('/?tab=ops', as.approver);
    expect(await screen.findByTestId('dash-approval-types')).toBeInTheDocument();
    expect(screen.queryByTestId('dash-risk')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dash-live')).not.toBeInTheDocument();
  });
});
