// 대시보드 D2·D3(매출·환불·상품별 판매)와 승인 AP-3(보는 사람이 결정할 수 있나) — 백엔드 배포 2026-11-18
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../api/client';
import { as, renderAt } from '../test/render';
import { server } from '../test/server';

const forbidden = () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 403, code: 'FORBIDDEN', traceId: 't' }, { status: 403, headers: { 'content-type': 'application/problem+json' } });

describe('매출·환불·상품별 판매(관리자)', () => {
  it('결제 승인 금액(주문 확정일)과 완료 환불(환불 완료일)을 나란히 — 빼지 않는다', async () => {
    renderAt('/?tab=sales', as.admin);
    const approved = await screen.findByTestId('dash-sales-approved');
    expect(await within(approved).findByText(/원$/)).toBeInTheDocument();
    expect(approved).toHaveTextContent('주문 확정일 기준');
    const refunded = screen.getByTestId('dash-sales-refunded');
    expect(await within(refunded).findByText('31,600원')).toBeInTheDocument(); // 목 15,100 + 4,500 + 12,000
    expect(refunded).toHaveTextContent('환불 완료일 기준 · 3건');
    expect(screen.getByTestId('dash-sales')).toHaveTextContent('서로 빼지 않아요');
  });

  it('상품별 판매 상위 — 상품 이름·수량·금액, "주문 확정 기준" 표시, 누르면 상품', async () => {
    renderAt('/?tab=sales', as.admin);
    const rows = await screen.findAllByTestId('dash-sales-top-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.getByTestId('dash-sales-top-panel')).toHaveTextContent('주문 확정 기준'); // 2026-11-20 상품별 판매는 따로 칸
    expect(await within(rows[0]!).findByRole('link', { name: '사과 1.5kg' })).toHaveAttribute('href', '/products/P-00000001');
  });

  it('못 읽으면 "?"·"불러오지 못했어요"(0원 아님)', async () => {
    server.use(http.get(`${API_BASE}/orders/metrics/summary`, () => forbidden()), http.get(`${API_BASE}/orders/metrics/top-products`, () => forbidden()));
    renderAt('/?tab=sales', as.admin);
    expect(await within(await screen.findByTestId('dash-sales-approved')).findByText('?')).toBeInTheDocument();
    expect(await screen.findByText(/상품별 판매를 불러오지 못했어요/)).toBeInTheDocument();
  });

  it('관리자가 아니면 매출 칸이 없다', async () => {
    renderAt('/', as.riderOps);
    await screen.findByTestId('dash-my-work');
    expect(screen.queryByTestId('dash-sales')).not.toBeInTheDocument();
  });
});

describe('승인 — 서버가 판정한 "결정할 수 있나"(AP-3)', () => {
  it('승인자에게 직원 권한 요청은 NO_ROLE — "다른 승인자가 심사해요", 버튼 꺼짐', async () => {
    renderAt('/approvals/apv-seed-grant-1', as.approver);
    expect(await screen.findByTestId('decide-blocked')).toHaveTextContent('승인 역할이 없어 보기만 해요');
    expect(screen.getByTestId('next-action')).toHaveTextContent('다른 승인자가 심사해요');
    expect(screen.getByRole('button', { name: '승인' })).toBeDisabled();
  });

  it('관리자는 다른 직원의 직원 권한 요청을 심사할 수 있다', async () => {
    renderAt('/approvals/apv-seed-grant-1', as.admin);
    expect(await screen.findByRole('button', { name: '승인' })).toBeEnabled();
    expect(screen.getByTestId('next-action')).toHaveTextContent('심사해 주세요');
  });

  it('메뉴 알림의 심사 대기는 내가 지금 심사할 수 있는 것만(decidableByMe)', async () => {
    const v = renderAt('/approvals', as.approver);
    await screen.findAllByTestId('approval-row');
    expect(v.sent.some((r) => new URL(r.url).searchParams.get('decidableByMe') === 'true')).toBe(true);
  });
});
