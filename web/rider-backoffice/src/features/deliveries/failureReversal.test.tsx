// 전달 실패 확정 되돌리기(execution 0.32.0 — 백엔드 PR #235, 사용자 2026-11-19 "확정 되돌리기를 만들라고") — 목(MSW) 기준.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { mockDeliveries } from '../../mocks/deliveryHandlers';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const confirmed = (deliveryId: string, reason = 'CUSTOMER_ABSENT') => {
  server.use(
    http.get(`${API_BASE}/deliveries/${deliveryId}`, () =>
      HttpResponse.json({
        ...mockDeliveries[0]!,
        deliveryId,
        state: 'FAILED',
        failure: { ...(mockDeliveries[0]!.failure ?? {}), reason, decision: 'CONFIRM', custody: 'RIDER', decidedAt: '2026-11-19T08:47:00.000Z' },
      }),
    ),
  );
};
const posts = (sent: readonly Request[]) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/failure-reversals'));

describe('전달 실패 확정 되돌리기', () => {
  it('사유와 확인을 넣어야 보낼 수 있고, 멱등 키로 보낸다', async () => {
    confirmed('DLV-1');
    const view = renderAt('/deliveries/DLV-1', as.riderOps);
    const form = await screen.findByRole('form', { name: '확정 되돌리기' });
    const send = within(form).getByRole('button', { name: '확정 되돌리기' });
    expect(send).toBeDisabled();
    await userEvent.type(within(form).getByLabelText('사유(2~300자)'), '반려하려다 확정을 잘못 누름');
    expect(send).toBeDisabled(); // 확인 칸 전
    await userEvent.click(within(form).getByRole('checkbox'));
    await userEvent.click(send);
    expect(await within(form).findByText('되돌렸어요 — 라이더가 전달을 이어가요.')).toBeInTheDocument();
    const post = posts(view.sent)[0]!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect((await post.clone().json()) as unknown).toEqual({ reason: '반려하려다 확정을 잘못 누름', reshipmentStopped: false });
  });

  it('되돌릴 수 없으면(409) 서버가 준 까닭을 그대로 보인다', async () => {
    confirmed('DLV-NOREV');
    renderAt('/deliveries/DLV-NOREV', as.riderOps);
    const form = await screen.findByRole('form', { name: '확정 되돌리기' });
    await userEvent.type(within(form).getByLabelText('사유(2~300자)'), '잘못 누름');
    await userEvent.click(within(form).getByRole('checkbox'));
    await userEvent.click(within(form).getByRole('button', { name: '확정 되돌리기' }));
    expect(await within(form).findByTestId('reverse-not-reversible')).toHaveTextContent('되돌릴 수 없어요 — 확정 뒤 30분이 지났어요.');
  });

  it('사고·파손 확정은 라이더 운영에게는 막히고, 관리자는 재발송을 멈췄다고 확인해야 보낸다', async () => {
    confirmed('DLV-1', 'RIDER_INCIDENT');
    renderAt('/deliveries/DLV-1', as.riderOps);
    const form = await screen.findByRole('form', { name: '확정 되돌리기' });
    expect(within(form).getByText(/관리자\(OPERATOR_ADMIN\)만/)).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText('사유(2~300자)'), '잘못 누름');
    await userEvent.click(within(form).getByRole('checkbox'));
    expect(within(form).getByRole('button', { name: '확정 되돌리기' })).toBeDisabled();
  });

  it('관리자: 사고·파손 확정은 "재발송 멈췄어요"를 확인하면 reshipmentStopped 로 보낸다', async () => {
    confirmed('DLV-1', 'RIDER_INCIDENT');
    const view = renderAt('/deliveries/DLV-1', as.admin);
    const form = await screen.findByRole('form', { name: '확정 되돌리기' });
    await userEvent.type(within(form).getByLabelText('사유(2~300자)'), '잘못 누름');
    const [stopped, sure] = within(form).getAllByRole('checkbox');
    await userEvent.click(sure!);
    expect(within(form).getByRole('button', { name: '확정 되돌리기' })).toBeDisabled();
    await userEvent.click(stopped!);
    await userEvent.click(within(form).getByRole('button', { name: '확정 되돌리기' }));
    await within(form).findByText('되돌렸어요 — 라이더가 전달을 이어가요.');
    expect(((await posts(view.sent)[0]!.clone().json()) as { reshipmentStopped: boolean }).reshipmentStopped).toBe(true);
  });
});
