// 인계 뒤 반품(회수) — claim 0.2.0: 고객센터 접수·회수 조치(백엔드 요청 all/2026-11-17-request-return-recovery §2)
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

async function fillReturn(opts: { fault?: string } = {}) {
  const line = (await screen.findAllByTestId('return-line'))[0]!;
  const qty = within(line).getByRole('spinbutton');
  await userEvent.clear(qty);
  await userEvent.type(qty, '1');
  await userEvent.selectOptions(screen.getByLabelText('사유(필수)'), '단순 변심');
  if (opts.fault) await userEvent.selectOptions(screen.getByLabelText('회사 잘못'), opts.fault);
  await userEvent.click(screen.getByLabelText('주문 내용 대조'));
}

describe('반품 접수', () => {
  it('주문 상세에서 들어와 품목·사유·본인 확인 → POST /claims(RETURN·CS), 고객 사유면 회수비 결제 대기', async () => {
    const view = renderAt('/return-intake?orderId=ORD-MOCK-1001', as.cs);
    await fillReturn();
    expect(screen.getByTestId('return-fee-hint')).toHaveTextContent('회수비를 결제해야');
    await userEvent.click(screen.getByRole('button', { name: '반품 접수' }));
    expect(await screen.findByTestId('return-created')).toHaveTextContent('회수비 결제 대기');
    const post = view.mutations('/claims')[0]!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await post.json()).toEqual({
      orderId: 'ORD-MOCK-1001',
      type: 'RETURN',
      channel: 'CS',
      lines: [{ orderLineId: 'ORD-MOCK-1001-L1', qty: 1 }],
      reason: 'CHANGE_OF_MIND',
      identityCheck: { method: 'ORDER_DETAILS_MATCH' },
    });
  });

  it('회사 잘못을 고르면 회수비 면제 안내, 서버도 바로 처리 중', async () => {
    const view = renderAt('/return-intake?orderId=ORD-MOCK-1001', as.cs);
    await fillReturn({ fault: '오배송' });
    expect(screen.getByTestId('return-fee-hint')).toHaveTextContent('회수비 없이');
    await userEvent.click(screen.getByRole('button', { name: '반품 접수' }));
    expect(await screen.findByTestId('return-created')).toHaveTextContent('처리 중');
    expect(await view.mutations('/claims')[0]!.json()).toMatchObject({ faultCode: 'MISDELIVERY' });
  });

  it('반품 가능 수량을 넘으면(진행 중 반품 포함) 422 안내 — 성공으로 보이지 않음', async () => {
    renderAt('/return-intake?orderId=ORD-MOCK-1002', as.cs); // CLM-MOCK-RF 가 이미 1개 반품 중
    await fillReturn();
    await userEvent.click(screen.getByRole('button', { name: '반품 접수' }));
    expect(await screen.findByText(/반품할 수 있는 수량을 넘었어요/)).toBeInTheDocument();
    expect(screen.queryByTestId('return-created')).not.toBeInTheDocument();
  });

  it('본인 확인 "기타"는 메모가 있어야 보낼 수 있다', async () => {
    renderAt('/return-intake?orderId=ORD-MOCK-1001', as.cs);
    await fillReturn();
    await userEvent.click(screen.getByLabelText('기타'));
    expect(screen.getByRole('button', { name: '반품 접수' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('어떻게 확인했는지(필수, 200자)'), '주문 시각·금액 대조');
    expect(screen.getByRole('button', { name: '반품 접수' })).toBeEnabled();
  });

  it('주문 상세에 "이 주문 반품 접수" 링크', async () => {
    renderAt('/orders/ORD-MOCK-1001', as.cs);
    expect(await screen.findByRole('link', { name: '이 주문 반품 접수' })).toHaveAttribute('href', '/return-intake?orderId=ORD-MOCK-1001');
  });
});

describe('회수 조치', () => {
  it('회수 실패 클레임: 회수 시도·회수비 표시, 사유 + 다시 회수 요청 → 처리 중(X-Expected-Version)', async () => {
    const view = renderAt('/claims/CLM-MOCK-RF', as.cs);
    const box = await screen.findByTestId('recovery-actions');
    expect(screen.getByTestId('claim-state')).toHaveTextContent('회수 실패');
    expect(screen.getByTestId('return-progress')).toHaveTextContent('요청 2번 · 실패 2번');
    const retry = within(box).getByRole('button', { name: '다시 회수 요청' });
    expect(retry).toBeDisabled(); // 사유 전
    await userEvent.type(within(box).getByRole('textbox'), '고객과 통화 — 내일 오전 재방문');
    await userEvent.click(retry);
    expect(await screen.findByTestId('recovery-done')).toHaveTextContent('처리 중');
    const post = view.mutations('/recovery-actions')[0]!;
    expect(post.headers.get('X-Expected-Version')).toBe('5');
    expect(await post.json()).toEqual({ action: 'RETRY_PICKUP', note: '고객과 통화 — 내일 오전 재방문' });
  });

  it('반품 아닌 클레임에는 조치 칸이 없다', async () => {
    renderAt('/claims/CLM-MOCK-1', as.cs);
    await screen.findByTestId('claim-summary');
    expect(screen.queryByTestId('recovery-actions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('return-progress')).not.toBeInTheDocument();
  });
});
