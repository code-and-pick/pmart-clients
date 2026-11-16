// 통합 조회 — bff 0.3.0 views/unified-lookup 목(백엔드 PR #25).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { BFF_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const section = (name: string) => screen.getByRole('region', { name });

async function search(q: string) {
  await userEvent.type(await screen.findByRole('textbox', { name: '찾을 번호' }), q);
  await userEvent.click(screen.getByRole('button', { name: '찾기' }));
}

describe('통합 조회', () => {
  it('고객센터·라이더 운영 묶음 모두에 메뉴가 있다', async () => {
    renderAt('/lookup', as.cs);
    expect(await screen.findByRole('link', { name: '통합 조회' })).toHaveAttribute('href', '/lookup');
  });

  it('배송 번호로 찾으면 그 주문으로 이어 원천별 칸에 나눠 보이고, 각 항목은 기존 상세로', async () => {
    const view = renderAt('/lookup', as.riderOps);
    await search('DLV-MOCK-1');
    expect(await screen.findByText('배송로 찾음 → 주문 ORD-MOCK-1001')).toBeInTheDocument();
    expect(within(section('주문')).getByRole('link', { name: '상세 보기' })).toHaveAttribute('href', '/orders/ORD-MOCK-1001');
    expect(within(section('배송(수행)')).getByText('IN_TRANSIT')).toBeInTheDocument();
    expect(within(section('배차')).getByText('ASSIGNED')).toBeInTheDocument();
    expect(within(section('배차')).getByRole('link', { name: '상세 보기' })).toHaveAttribute('href', '/deliveries/DLV-MOCK-1');
    expect(within(section('클레임')).getByRole('link', { name: '상세 보기' })).toHaveAttribute('href', '/claims/CLM-MOCK-1');
    // 사건은 열린 것·닫힌 것을 상태로 나눠
    expect(within(screen.getByTestId('cases-open')).getByRole('link', { name: '상세 보기' })).toHaveAttribute('href', '/cases/CASE-MOCK-1');
    expect(within(screen.getByTestId('cases-closed')).getByRole('link', { name: '상세 보기' })).toHaveAttribute('href', '/cases/CASE-MOCK-0');
    // 고객 문의는 라이더 운영에게 "권한 없음" — 0건이 아니다
    expect(within(section('고객 문의')).getByRole('alert')).toHaveTextContent('조회 실패 또는 볼 권한 없음');
    // 금액은 원천 값 그대로(계산하지 않음)
    expect(within(section('주문')).getByText(/total 24800/)).toBeInTheDocument();
    const sent = view.sent.find((r) => new URL(r.url).pathname.endsWith('/views/unified-lookup'))!;
    expect([new URL(sent.url).searchParams.get('q'), new URL(sent.url).searchParams.get('kind')]).toEqual(['DLV-MOCK-1', null]);
  });

  it('상담원은 그 주문의 고객 문의를 보고, 문의 답변 화면으로 간다', async () => {
    renderAt('/lookup?q=ORD-MOCK-1001', as.cs);
    const inquiry = await waitFor(() => section('고객 문의'));
    expect(within(inquiry).getByTestId('match-INQUIRY')).toHaveTextContent('INQ-MOCK-1');
    expect(within(inquiry).getByRole('link', { name: '상세 보기' })).toHaveAttribute('href', '/inquiries/INQ-MOCK-1');
    expect(within(inquiry).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('실패한 원천은 칸에 "조회 실패"로 — 0건(없음)으로 보이지 않는다', async () => {
    renderAt('/lookup?q=ORD-MOCK-FAIL', as.admin);
    const claim = await waitFor(() => section('클레임'));
    expect(within(claim).getByRole('alert')).toHaveTextContent('조회 실패 또는 볼 권한 없음');
    expect(within(claim).queryByText('없음')).not.toBeInTheDocument();
    // 원천 표시 줄에도 실패 원천이 따로 보인다
    expect(within(screen.getByRole('region', { name: '원천' })).getByText('조회하지 못한 원천: claim-service')).toBeInTheDocument();
  });

  it('고객 번호면 주문 목록만 — 누르면 그 주문으로 다시 조회(주소에 남는다)', async () => {
    const view = renderAt('/lookup', as.cs);
    await search('CU-MOCK-1');
    const orders = await screen.findAllByTestId('customer-order');
    expect(orders).toHaveLength(2);
    await userEvent.click(within(orders[0]!).getByRole('button', { name: '이 주문으로 다시 조회' }));
    expect(await screen.findByText('주문로 찾음 → 주문 ORD-MOCK-1001')).toBeInTheDocument();
    const last = view.sent.filter((r) => new URL(r.url).pathname.endsWith('/views/unified-lookup')).at(-1)!;
    expect([new URL(last.url).searchParams.get('q'), new URL(last.url).searchParams.get('kind')]).toEqual(['ORD-MOCK-1001', 'ORDER']);
  });

  it('없는 대상은 "찾는 대상이 없어요"(오류 아님)', async () => {
    renderAt('/lookup?q=ORD-NONE', as.cs);
    expect(await screen.findByText('찾는 대상이 없어요.')).toBeInTheDocument();
  });

  it('전화번호처럼 모르는 값은 422 UNSUPPORTED_LOOKUP 문구', async () => {
    renderAt('/lookup', as.cs);
    await search('01012345678');
    expect(await screen.findByText(/그 번호로는 찾을 수 없어요/)).toBeInTheDocument();
  });

  it('조회 실패(5xx)는 빈 결과가 아니라 오류', async () => {
    server.use(http.get(`${BFF_BASE}/views/unified-lookup`, () => new HttpResponse(null, { status: 500 })));
    renderAt('/lookup?q=ORD-MOCK-1001', as.cs);
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).not.toBeNull());
    expect(screen.queryByText('찾는 대상이 없어요.')).not.toBeInTheDocument();
  });

  it('역할이 없으면 서버 403 — 권한 없음 화면', async () => {
    renderAt('/lookup?q=ORD-MOCK-1001', as.md);
    await waitFor(() => expect(document.querySelector('[data-state="forbidden"]')).not.toBeNull());
  });
});
