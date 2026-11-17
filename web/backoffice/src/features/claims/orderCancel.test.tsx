// 고객센터 주문 취소(상품준비 전) — claim 0.4.0, 백엔드 요청 backoffice/2026-11-18-request-cs-order-cancel
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

async function openAndFill() {
  await userEvent.click(await screen.findByRole('button', { name: '주문 취소' }));
  await userEvent.selectOptions(screen.getByLabelText('취소 사유(필수)'), '단순 변심');
  await userEvent.click(screen.getByLabelText('주문 내용 대조'));
}

describe('고객센터 주문 취소', () => {
  it('CONFIRMED 주문: 전체 행 × 미이행 수량으로 POST /claims(CANCEL·CS·본인 확인) → 서버 상태(출고 중지 대기)만 보인다', async () => {
    const view = renderAt('/orders/ORD-MOCK-1005', as.cs);
    await openAndFill();
    expect(screen.getByText(/주문 전체가 취소되고 결제가 전액 환불돼요/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('메모'), '고객 전화 — 다른 데서 샀음');
    await userEvent.click(screen.getByRole('button', { name: '주문 취소 접수' }));
    expect(await screen.findByTestId('order-cancel-created')).toHaveTextContent('출고 중지 대기');
    const post = view.mutations('/claims')[0]!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await post.json()).toEqual({
      orderId: 'ORD-MOCK-1005',
      type: 'CANCEL',
      channel: 'CS',
      lines: [{ orderLineId: 'ORD-MOCK-1005-L1', qty: 2 }],
      reason: 'CHANGE_OF_MIND',
      reasonDetail: '고객 전화 — 다른 데서 샀음',
      identityCheck: { method: 'ORDER_DETAILS_MATCH' },
    });
  });

  it('사유·본인 확인이 없으면 못 보내고, "기타" 확인은 메모가 있어야 한다', async () => {
    renderAt('/orders/ORD-MOCK-1005', as.cs);
    await userEvent.click(await screen.findByRole('button', { name: '주문 취소' }));
    expect(screen.getByRole('button', { name: '주문 취소 접수' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('취소 사유(필수)'), '단순 변심');
    await userEvent.click(screen.getByLabelText('기타'));
    expect(screen.getByRole('button', { name: '주문 취소 접수' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('어떻게 확인했는지(필수, 200자)'), '주문 시각·금액 대조');
    expect(screen.getByRole('button', { name: '주문 취소 접수' })).toBeEnabled();
  });

  it('누른 사이 상품 준비가 시작되면 422 ORDER_NOT_CANCELLABLE — 서버 detail 을 그대로, 성공으로 보이지 않음', async () => {
    server.use(
      http.post(`${API_BASE}/claims`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'ORDER_NOT_CANCELLABLE', status: 422, code: 'ORDER_NOT_CANCELLABLE', traceId: 't', detail: '서버 문구 — 받으신 뒤 반품으로 안내' },
          { status: 422, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    renderAt('/orders/ORD-MOCK-1005', as.cs);
    await openAndFill();
    await userEvent.click(screen.getByRole('button', { name: '주문 취소 접수' }));
    expect(await screen.findByTestId('order-cancel-not-cancellable')).toHaveTextContent('서버 문구 — 받으신 뒤 반품으로 안내');
    expect(screen.queryByTestId('order-cancel-created')).not.toBeInTheDocument();
  });

  it('상품 준비가 시작된 주문은 버튼 대신 반품 안내', async () => {
    renderAt('/orders/ORD-MOCK-1003', as.cs);
    expect(await screen.findByTestId('order-cancel-closed')).toHaveTextContent('받으신 뒤 반품으로 안내');
    expect(screen.queryByRole('button', { name: '주문 취소' })).not.toBeInTheDocument();
  });

  it('고객센터·관리자가 아니면 버튼이 없다(라이더 운영)', async () => {
    renderAt('/orders/ORD-MOCK-1005', as.riderOps);
    expect(await screen.findByTestId('order-status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '주문 취소' })).not.toBeInTheDocument();
  });
});
