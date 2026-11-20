// 반품 claim 0.3.0(백엔드 요청 all/2026-11-17-request-return-recovery §5) — 반품 기한·회수 3번·회수비 돌려주기·받은 만큼만 끝내기·전달 완료 기준
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { problem } from '../../mocks/support';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
const past = new Date(Date.now() - 3_600_000).toISOString();

/** CLM-MOCK-RF 를 바꿔 돌려준다(조치 POST 는 기본 목) */
const claimAs = (patch: Record<string, unknown>) =>
  server.use(
    http.get(`${API_BASE}/claims/CLM-MOCK-RF`, () =>
      HttpResponse.json({
        claimId: 'CLM-MOCK-RF',
        orderId: 'ORD-MOCK-1002',
        type: 'RETURN',
        state: 'RECOVERY_FAILED',
        version: 5,
        returnDeadlineAt: future,
        feePayment: { amount: 9000, state: 'PAID' },
        pickup: { addressFixedToOrder: true, attempts: 2, failedAttempts: 2, countedFailures: 2, retryAllowed: true },
        lines: [{ claimLineId: 'CL-RF-1', orderLineId: 'ORD-MOCK-1002-L1', requestedQty: 1, approvedQty: 1, pickedUpQty: 0 }],
        ...patch,
      }),
    ),
  );

describe('반품 claim 0.3.0', () => {
  it('진행에 반품 기한·횟수에 드는 실패를 서버 값 그대로', async () => {
    renderAt('/claims/CLM-MOCK-RF', as.cs);
    expect(await screen.findByTestId('return-deadline')).not.toHaveTextContent('—');
    expect(screen.getByTestId('return-attempts')).toHaveTextContent('횟수에 드는 실패 2번');
    expect(screen.queryByText(/다시 회수할 수 없음/)).not.toBeInTheDocument();
  });

  it('시도를 다 쓰면(retryAllowed false) 다시 회수 버튼 없음 — 반품 취소만', async () => {
    claimAs({ pickup: { addressFixedToOrder: true, attempts: 3, failedAttempts: 3, countedFailures: 3, retryAllowed: false } });
    renderAt('/claims/CLM-MOCK-RF', as.cs);
    const box = await screen.findByTestId('recovery-actions');
    expect(within(box).getByTestId('no-more-retry')).toHaveTextContent('반품 취소만');
    expect(within(box).queryByRole('button', { name: '다시 회수 요청' })).not.toBeInTheDocument();
    expect(within(box).getByRole('button', { name: '반품 취소' })).toBeInTheDocument();
    expect(screen.getByTestId('return-attempts')).toHaveTextContent('다시 회수할 수 없음');
  });

  it('반품 기한이 지났으면 다시 회수 버튼 없음', async () => {
    claimAs({ returnDeadlineAt: past });
    renderAt('/claims/CLM-MOCK-RF', as.cs);
    const box = await screen.findByTestId('recovery-actions');
    expect(within(box).queryByRole('button', { name: '다시 회수 요청' })).not.toBeInTheDocument();
    expect(within(box).getByRole('button', { name: '반품 취소' })).toBeInTheDocument();
  });

  it('서버가 409 PICKUP_ATTEMPTS_EXHAUSTED 면 안내(성공 아님)', async () => {
    server.use(http.post(`${API_BASE}/claims/:id/recovery-actions`, () => problem(409, 'PICKUP_ATTEMPTS_EXHAUSTED')));
    renderAt('/claims/CLM-MOCK-RF', as.cs);
    const box = await screen.findByTestId('recovery-actions');
    await userEvent.type(within(box).getByRole('textbox'), '고객 통화');
    await userEvent.click(within(box).getByRole('button', { name: '다시 회수 요청' }));
    expect(await within(box).findByTestId('recovery-rejected')).toHaveTextContent('회수 시도를 모두 썼어요');
    expect(within(box).queryByTestId('recovery-done')).not.toBeInTheDocument();
  });

  it('반품 취소: 낸 회수비 돌려주기를 고르면 feeRefund true → 결정·환불 종류가 보인다', async () => {
    const view = renderAt('/claims/CLM-MOCK-RF', as.cs);
    const box = await screen.findByTestId('recovery-actions');
    await userEvent.type(within(box).getByRole('textbox'), '라이더 파손 — 회수비 돌려줌');
    await userEvent.click(within(box).getByRole('checkbox', { name: /낸 회수비 돌려주기/ }));
    await userEvent.click(within(box).getByRole('button', { name: '반품 취소' }));
    expect(await within(box).findByTestId('recovery-done')).toHaveTextContent('취소');
    expect(await view.mutations('/recovery-actions')[0]!.json()).toEqual({ action: 'CANCEL', note: '라이더 파손 — 회수비 돌려줌', feeRefund: true });
    expect(screen.getByTestId('return-fee')).toHaveTextContent('돌려줌');
    expect(await screen.findByText('회수비 돌려주기', { selector: '.badge' })).toBeInTheDocument();
  });

  it('반품 취소: 고르지 않으면 feeRefund 를 보내지 않는다(서버 규칙대로)', async () => {
    const view = renderAt('/claims/CLM-MOCK-RF', as.cs);
    const box = await screen.findByTestId('recovery-actions');
    await userEvent.type(within(box).getByRole('textbox'), '고객 부재 — 반품 그만');
    await userEvent.click(within(box).getByRole('button', { name: '반품 취소' }));
    await within(box).findByTestId('recovery-done');
    expect(await view.mutations('/recovery-actions')[0]!.json()).toEqual({ action: 'CANCEL', note: '고객 부재 — 반품 그만' });
  });

  it('규칙과 다른 회수비 돌려주기(422 FEE_REFUND_NOT_ALLOWED)는 안내', async () => {
    server.use(http.post(`${API_BASE}/claims/:id/recovery-actions`, () => problem(422, 'FEE_REFUND_NOT_ALLOWED')));
    renderAt('/claims/CLM-MOCK-RF', as.cs);
    const box = await screen.findByTestId('recovery-actions');
    await userEvent.type(within(box).getByRole('textbox'), '돌려주기 시도');
    await userEvent.click(within(box).getByRole('checkbox', { name: /낸 회수비 돌려주기/ }));
    await userEvent.click(within(box).getByRole('button', { name: '반품 취소' }));
    expect(await within(box).findByTestId('recovery-rejected')).toHaveTextContent('끄고 다시 보내');
  });

  // claim 0.12.0 CL-2 — 서버 판정 feeRefundOnCancel
  const pickup = { addressFixedToOrder: true, attempts: 2, failedAttempts: 2, countedFailures: 2, retryAllowed: true };

  it('0.12.0 AGENT_CHOOSES: 돌려주기 고르기와 상담원 판단 안내', async () => {
    claimAs({ pickup: { ...pickup, feeRefundOnCancel: 'AGENT_CHOOSES' } });
    renderAt('/claims/CLM-MOCK-RF', as.cs);
    const box = await screen.findByTestId('recovery-actions');
    expect(within(box).getByRole('checkbox', { name: /낸 회수비 돌려주기/ })).toHaveAccessibleName(/상담원이 정해요/);
    expect(within(box).queryByTestId('fee-on-cancel')).not.toBeInTheDocument();
  });

  it('0.12.0 REFUND: 고르기 없이 자동으로 돌려준다는 안내, feeRefund 는 보내지 않는다', async () => {
    claimAs({ pickup: { ...pickup, feeRefundOnCancel: 'REFUND' } });
    const view = renderAt('/claims/CLM-MOCK-RF', as.cs);
    const box = await screen.findByTestId('recovery-actions');
    expect(within(box).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(box).getByTestId('fee-on-cancel')).toHaveTextContent('취소하면 낸 회수비(9,000원)는 자동으로 돌려줘요');
    await userEvent.type(within(box).getByRole('textbox'), '라이더 사고 — 반품 그만');
    await userEvent.click(within(box).getByRole('button', { name: '반품 취소' }));
    await within(box).findByTestId('recovery-done');
    expect(await view.mutations('/recovery-actions')[0]!.json()).toEqual({ action: 'CANCEL', note: '라이더 사고 — 반품 그만' });
  });

  it('0.12.0 NO_REFUND: 고르기 없이 돌려주지 않는다는 안내', async () => {
    claimAs({ pickup: { ...pickup, feeRefundOnCancel: 'NO_REFUND' } });
    renderAt('/claims/CLM-MOCK-RF', as.cs);
    const box = await screen.findByTestId('recovery-actions');
    expect(within(box).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(box).getByTestId('fee-on-cancel')).toHaveTextContent('돌려주지 않아요');
  });

  it('0.12.0 null(낸 회수비 없음): 고르기도 안내도 없다', async () => {
    claimAs({ pickup: { ...pickup, feeRefundOnCancel: null } });
    renderAt('/claims/CLM-MOCK-RF', as.cs);
    const box = await screen.findByTestId('recovery-actions');
    expect(within(box).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(box).queryByTestId('fee-on-cancel')).not.toBeInTheDocument();
  });

  it('회수비를 내지 않았으면 돌려주기 칸이 없다', async () => {
    claimAs({ feePayment: { amount: 9000, state: 'WAITING' }, state: 'FEE_PENDING' });
    renderAt('/claims/CLM-MOCK-RF', as.cs);
    const box = await screen.findByTestId('recovery-actions');
    expect(within(box).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('덜 받았으면 받은 만큼만 끝내기(남은 수량 환불 없음 경고), 받은 게 있으면 취소 버튼 없음', async () => {
    claimAs({ state: 'IN_PROGRESS', lines: [{ claimLineId: 'CL-RF-1', orderLineId: 'ORD-MOCK-1002-L1', requestedQty: 2, approvedQty: 2, pickedUpQty: 2, receivedQty: 1 }] });
    server.use(
      http.post(`${API_BASE}/claims/CLM-MOCK-RF/recovery-actions`, () =>
        HttpResponse.json({ claimId: 'CLM-MOCK-RF', type: 'RETURN', state: 'IN_PROGRESS', version: 6, lines: [{ claimLineId: 'CL-RF-1', requestedQty: 2, approvedQty: 1, receivedQty: 1 }] }),
      ),
    );
    const view = renderAt('/claims/CLM-MOCK-RF', as.cs);
    const box = await screen.findByTestId('recovery-actions');
    expect(within(box).getByTestId('close-as-received-hint')).toHaveTextContent('남은 수량은 환불이 없고');
    expect(within(box).queryByRole('button', { name: '반품 취소' })).not.toBeInTheDocument();
    expect(within(box).queryByRole('button', { name: '다시 회수 요청' })).not.toBeInTheDocument();
    await userEvent.type(within(box).getByRole('textbox'), '고객이 하나는 이미 썼음');
    await userEvent.click(within(box).getByRole('button', { name: '받은 만큼만 끝내기' }));
    await within(box).findByTestId('recovery-done');
    expect(await view.mutations('/recovery-actions')[0]!.json()).toEqual({ action: 'CLOSE_AS_RECEIVED', note: '고객이 하나는 이미 썼음' });
  });

  it('다 받았거나 받은 게 없으면 받은 만큼만 끝내기 버튼 없음', async () => {
    claimAs({ state: 'IN_PROGRESS', lines: [{ claimLineId: 'CL-RF-1', orderLineId: 'ORD-MOCK-1002-L1', requestedQty: 1, approvedQty: 1, receivedQty: 1 }] });
    renderAt('/claims/CLM-MOCK-RF', as.cs);
    await screen.findByTestId('return-progress');
    expect(screen.queryByRole('button', { name: '받은 만큼만 끝내기' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('recovery-actions')).not.toBeInTheDocument();
  });

  it('접수: 전달 완료 수량 열, 전달 전이면(422 NOT_DELIVERED_YET) 안내', async () => {
    server.use(http.post(`${API_BASE}/claims`, () => problem(422, 'NOT_DELIVERED_YET')));
    renderAt('/return-intake?orderId=ORD-MOCK-1001', as.cs);
    expect(await screen.findByRole('columnheader', { name: '전달 완료' })).toBeInTheDocument();
    const line = (await screen.findAllByTestId('return-line'))[0]!;
    const qty = within(line).getByRole('spinbutton');
    await userEvent.clear(qty);
    await userEvent.type(qty, '1');
    await userEvent.selectOptions(screen.getByLabelText('사유(필수)'), '단순 변심');
    await userEvent.click(screen.getByLabelText('주문 내용 대조'));
    await userEvent.click(screen.getByRole('button', { name: '반품 접수' }));
    expect(await screen.findByText(/배달 중이거나 전달 전에는 반품할 수 없어요/)).toBeInTheDocument();
  });
});
