// bff 0.23.0(2026-11-21 LAN 배포) — 고객 상세 클레임 칸, 클레임 목록 고객 조건·순번, 결품 많은 상품(BR-73 SK-2)
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { BFF_BASE } from '../api/client';
import { as, renderAt } from '../test/render';
import { server } from '../test/server';

const unavailable = () => HttpResponse.json({ type: 'about:blank', status: 503, code: 'DEPENDENCY_UNAVAILABLE', retryable: true }, { status: 503, headers: { 'content-type': 'application/problem+json' } });

describe('고객 상세 — 최근 클레임(claim CL-7)', () => {
  it('클레임 줄은 "<주문번호> <종류> <순번>"·상태·환불, 누르면 클레임 상세', async () => {
    renderAt('/customers/CUS-1001', as.cs);
    const box = await screen.findByTestId('customer-claims');
    const rows = await within(box).findAllByTestId('customer-claim-row');
    expect(rows).toHaveLength(2);
    const first = rows.find((r) => r.textContent?.includes('74939002 취소 1'))!;
    expect(within(first).getByRole('link')).toHaveAttribute('href', '/claims/CLM-MOCK-1');
    expect(first).toHaveTextContent('환불 완료');
    expect(within(box).queryByTestId('customer-claims-all')).not.toBeInTheDocument();
  });

  it('원천 실패(claims=null)면 "확인 못 함"(0건 아님), 10건 넘으면 전체 보기 → 클레임 목록 customerId', async () => {
    const detail = (id: string, claims: unknown) => ({
      composedAt: new Date().toISOString(),
      sources: [],
      unavailableSources: claims === null ? ['claim-service'] : [],
      customer: { customerId: id, customerNumber: '482913', nameMasked: '김*객', phoneMasked: '010-****-5678', emailMasked: 'k***@example.com', status: 'ACTIVE', socialProvider: 'KAKAO', phoneVerified: true, joinedAt: '2026-03-02T01:20:00Z' },
      orders: { hasMore: false, items: [] },
      inquiries: { hasMore: false, items: [] },
      csIntakes: { hasMore: false, items: [] },
      claims,
    });
    server.use(
      http.get(`${BFF_BASE}/views/customer/:id`, ({ params }) => {
        const id = String(params['id']);
        return HttpResponse.json(id === 'CUS-1005' ? detail(id, null) : detail(id, { hasMore: true, items: [{ claimId: 'CLM-X', claimSeq: 2, orderId: 'ORD-MOCK-1001', orderNumber: '74939001', type: 'RETURN', state: 'OPENED', channel: 'APP', openedAt: new Date().toISOString(), closedAt: null, refundState: null }] }));
      }),
    );
    const view = renderAt('/customers/CUS-1005', as.cs);
    expect(await screen.findByTestId('customer-claims-failed')).toHaveTextContent('확인 못 함');
    view.unmount();
    renderAt('/customers/CUS-1001', as.cs);
    expect(await screen.findByTestId('customer-claims-all')).toHaveAttribute('href', '/claims?customerId=CUS-1001');
  });
});

describe('클레임 목록 — 고객 조건·순번(bff 0.23.0)', () => {
  it('customerId 를 목록·단계 숫자 둘 다에 걸고, 줄 표기에 서버 순번', async () => {
    const view = renderAt('/claims?customerId=CUS-1001', as.cs);
    await waitFor(() => expect(screen.getAllByTestId('claim-row')).toHaveLength(2));
    expect(screen.getAllByTestId('claim-row').some((r) => r.textContent?.includes('74939002 취소 1'))).toBe(true);
    const list = view.sent.map((r) => new URL(r.url)).filter((u) => u.pathname.endsWith('/views/claims'));
    expect(list.at(-1)!.searchParams.get('customerId')).toBe('CUS-1001');
    const counts = view.sent.map((r) => new URL(r.url)).filter((u) => u.pathname.endsWith('/claims/counts'));
    expect(counts.at(-1)!.searchParams.get('customerId')).toBe('CUS-1001');
    await waitFor(() => expect(screen.getByTestId('claim-stage-all')).toHaveTextContent('2'));
    expect(screen.getByTestId('claim-filter')).toHaveTextContent('한 고객');
  });
});

describe('대시보드 — 결품 많은 상품(BR-73 SK-2)', () => {
  it('결품 줄 순: 비율은 결품 줄 ÷ 피킹 줄(분모 같이), 이름 없으면 SKU, 사유별 줄', async () => {
    renderAt('/?tab=sales', as.admin);
    const rows = await screen.findAllByTestId('dash-shortage-top-row');
    expect(rows[0]).toHaveTextContent('대추방울토마토');
    expect(rows[0]).toHaveTextContent('7.5%');
    expect(rows[0]).toHaveTextContent('결품 9줄 / 피킹 120줄');
    expect(rows[0]).toHaveTextContent('결품 7 · 파손 3');
    expect(rows.some((r) => r.textContent?.includes('E-00000012'))).toBe(true);
  });

  it('결품률 순으로 바꾸면 sort=shortRate 로 다시 묻고, 원천이 적용한 최소 피킹 줄을 적는다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/?tab=sales', as.admin);
    await screen.findAllByTestId('dash-shortage-top-row');
    await user.click(screen.getByRole('button', { name: '결품률 순' }));
    await waitFor(() => expect(screen.getByTestId('dash-shortage-top-note')).toHaveTextContent('피킹 20줄 이상인 상품만'));
    const calls = view.sent.map((r) => new URL(r.url)).filter((u) => u.pathname.endsWith('/views/metrics/shortage-by-sku'));
    expect(calls.at(-1)!.searchParams.get('sort')).toBe('shortRate');
    // 피킹 8줄인 SKU 는 빠진다(원천 판정)
    expect(screen.getAllByTestId('dash-shortage-top-row').some((r) => r.textContent?.includes('E-00000012'))).toBe(false);
    expect(screen.getAllByTestId('dash-shortage-top-row')[0]).toHaveTextContent('무항생제 계란');
  });

  it('장애(503)면 "확인 못 함" — 0건으로 보이지 않는다', async () => {
    server.use(http.get(`${BFF_BASE}/views/metrics/shortage-by-sku`, unavailable));
    renderAt('/?tab=sales', as.admin);
    expect(await screen.findByTestId('dash-shortage-top-failed', {}, { timeout: 5000 })).toHaveTextContent('확인 못 함');
    expect(screen.queryByText('이 기간에 결품이 보고된 상품이 없어요.')).not.toBeInTheDocument();
  });
});
