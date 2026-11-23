// 고객 계정 제한(customer 0.16.0 CU-7) — 지금 상태·7일 제한 걸기(한 번 더 묻기)·풀기·이력, 탈퇴 완료는 보기만.
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

const posts = (sent: readonly Request[], tail: string) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith(tail));

describe('고객 계정 제한', () => {
  it('제한 없음 → 정지 고르고 사유 → 한 번 더 묻고 멱등키로 걸면 "정지 … 까지"·이력에 남음', async () => {
    const user = userEvent.setup();
    const view = renderAt('/customers/CUS-1001', as.cs);
    const box = await screen.findByTestId('customer-restriction');
    expect(await within(box).findByTestId('customer-restriction-now')).toHaveTextContent('제한 없음');
    const form = within(box).getByRole('form', { name: '7일 제한 걸기' });
    await user.click(within(form).getByRole('radio', { name: /정지/ }));
    const next = within(form).getByRole('button', { name: '다음' });
    expect(next).toBeDisabled(); // 사유 2자 이상
    await user.type(within(form).getByLabelText(/사유/), '상담원에게 반복 욕설');
    await user.click(next);
    const ask = within(form).getByRole('group', { name: '제한 확인' });
    expect(ask).toHaveTextContent('7일 정지');
    await user.click(within(ask).getByRole('button', { name: '정지 걸기' }));
    await waitFor(() => expect(within(box).getByTestId('customer-restriction-now')).toHaveTextContent('정지'));
    expect(within(box).getByTestId('customer-restriction-now')).toHaveTextContent('자동으로 풀려요');
    expect(within(box).getByTestId('customer-restriction-row')).toHaveTextContent('제한 없음 → 정지');
    const post = posts(view.sent, '/customers/CUS-1001/restrictions')[0]!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await post.clone().json()).toEqual({ restriction: 'SUSPENDED', reason: '상담원에게 반복 욕설' });
  });

  it('자동 정지(문의 위협·거친 말)는 "자동"으로 보이고, 오인식이면 사유 적고 풀기', async () => {
    const user = userEvent.setup();
    const view = renderAt('/customers/CUS-1005', as.admin);
    const box = await screen.findByTestId('customer-restriction');
    expect(await within(box).findByTestId('customer-restriction-now')).toHaveTextContent('정지');
    expect(within(box).getByTestId('customer-restriction-row')).toHaveTextContent('자동(문의 위협·거친 말)');
    const form = within(box).getByRole('form', { name: '제한 풀기' });
    await user.type(within(form).getByLabelText(/사유/), '자동 정지 오인식');
    await user.click(within(form).getByRole('button', { name: '풀기' }));
    await waitFor(() => expect(within(box).getByTestId('customer-restriction-now')).toHaveTextContent('제한 없음'));
    expect(within(box).queryByRole('form', { name: '제한 풀기' })).not.toBeInTheDocument();
    expect(await posts(view.sent, '/customers/CUS-1005/restriction-releases')[0]!.clone().json()).toEqual({ reason: '자동 정지 오인식' });
  });

  it('탈퇴 완료 고객은 걸기·풀기 없이 안내만', async () => {
    renderAt('/customers/CUS-1009', as.cs);
    const box = await screen.findByTestId('customer-restriction');
    expect(await within(box).findByText(/탈퇴를 마친 고객이라/)).toBeInTheDocument();
    expect(within(box).queryByRole('form', { name: '7일 제한 걸기' })).not.toBeInTheDocument();
  });

  it('bff 0.28.0 — 찾기 줄·상세 머리에 정지 꼬리표, 풀면 머리 꼬리표도 사라짐', async () => {
    const user = userEvent.setup();
    renderAt('/customers?orderNumber=74939005', as.cs);
    const row = await screen.findByTestId('customer-row');
    expect(within(row).getByTestId('restriction-badge')).toHaveTextContent('정지');
    cleanup();
    renderAt('/customers/CUS-1005', as.admin);
    const head = await screen.findByTestId('customer-detail');
    await waitFor(() => expect(within(head).getAllByTestId('restriction-badge')[0]).toHaveTextContent('정지'));
    const form = await screen.findByRole('form', { name: '제한 풀기' });
    await user.type(within(form).getByLabelText(/사유/), '자동 정지 오인식');
    await user.click(within(form).getByRole('button', { name: '풀기' }));
    await waitFor(() => expect(screen.queryByTestId('restriction-badge')).not.toBeInTheDocument());
  });

  it('제한 없는 고객은 꼬리표 없음', async () => {
    renderAt('/customers/CUS-1001', as.cs);
    await screen.findByTestId('customer-restriction-now');
    expect(screen.queryByTestId('restriction-badge')).not.toBeInTheDocument();
  });
});
