// 처리 대기(bff 0.2.0 pending-work, BO-12) — 멈춘 주문 처리·이행 확인 필요 한 목록, allowedActions 버튼만, 명령은 bff 프록시(짝 조회까지).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { BFF_BASE } from '../../api/client';
import { problem } from '../../mocks/support';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const rowOf = async (ref: string) => (await screen.findAllByTestId('pending-item')).find((r) => r.textContent?.includes(ref))!;

describe('처리 대기', () => {
  it('멈춘 주문·이행 확인 필요를 오래된 것부터 한 목록으로, 버튼은 allowedActions 만', async () => {
    renderAt('/pending', as.admin);
    const rows = await screen.findAllByTestId('pending-item');
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual(['STUCK_SAGA', 'FULFILLMENT_ISSUE', 'FULFILLMENT_ISSUE', 'STUCK_SAGA']);
    const payment = await rowOf('ORD-MOCK-1001');
    const saga1 = (await screen.findAllByTestId('pending-item')).find((r) => r.textContent?.includes('PG 승인 결과'))!;
    expect(within(saga1).getByRole('button', { name: '결제 결과 다시 확인' })).toBeInTheDocument();
    expect(within(saga1).getByRole('button', { name: '처리 완료(밖에서 해결)' })).toBeInTheDocument();
    const saga2 = (await screen.findAllByTestId('pending-item')).find((r) => r.textContent?.includes('MFC 예약 거절'))!;
    expect(within(saga2).queryByRole('button', { name: '결제 결과 다시 확인' })).not.toBeInTheDocument(); // 허락되지 않은 조치
    expect(payment).toBeTruthy();
    expect(screen.getByTestId('pending-not-yet')).toHaveTextContent('MFC 인계 거절');
  });

  it('처리 완료: 경고 + 사유 필수 → bff saga-resolve(키·targetRef·reason) → 목록에서 빠진다', async () => {
    const view = renderAt('/pending', as.admin);
    const row = (await screen.findAllByTestId('pending-item')).find((r) => r.textContent?.includes('MFC 예약 거절'))!;
    await userEvent.click(within(row).getByRole('button', { name: '처리 완료(밖에서 해결)' }));
    expect(within(row).getByRole('alert')).toHaveTextContent('주문·재고는 바뀌지 않으니');
    expect(within(row).getByRole('button', { name: '보내기' })).toBeDisabled();
    await userEvent.type(within(row).getByLabelText('처리 사유'), 'MFC 재예약으로 해결');
    await userEvent.click(within(row).getByRole('button', { name: '보내기' }));
    await waitFor(() => expect(screen.queryByText(/MFC 예약 거절/)).not.toBeInTheDocument());
    const sent = view.mutations('/commands/order-orchestration-service/saga-resolve')[0]!;
    expect(sent.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await sent.json()).toEqual({ targetRef: 'SAGA-MOCK-2', payload: {}, reason: 'MFC 재예약으로 해결' });
  });

  it('결제 결과 다시 확인은 메모 없이도 보낼 수 있다 → saga-requery', async () => {
    const view = renderAt('/pending', as.admin);
    const row = (await screen.findAllByTestId('pending-item')).find((r) => r.textContent?.includes('PG 승인 결과'))!;
    await userEvent.click(within(row).getByRole('button', { name: '결제 결과 다시 확인' }));
    await userEvent.click(within(row).getByRole('button', { name: '보내기' }));
    await waitFor(() => expect(screen.queryByText(/PG 승인 결과/)).not.toBeInTheDocument());
    expect(await view.mutations('/saga-requery')[0]!.json()).toEqual({ targetRef: 'SAGA-MOCK-1', payload: {} });
  });

  it('이미 바뀌었으면(422 NOT_RESOLVABLE) 새로고침 안내', async () => {
    server.use(http.post(`${BFF_BASE}/commands/:ts/:cmd`, () => problem(422, 'NOT_RESOLVABLE')));
    renderAt('/pending', as.admin);
    const row = (await screen.findAllByTestId('pending-item')).find((r) => r.textContent?.includes('MFC 예약 거절'))!;
    await userEvent.click(within(row).getByRole('button', { name: '처리 완료(밖에서 해결)' }));
    await userEvent.type(within(row).getByLabelText('처리 사유'), '해결');
    await userEvent.click(within(row).getByRole('button', { name: '보내기' }));
    expect(await within(row).findByText(/이미 상태가 바뀌어 완료 표시할 수 없어요/)).toBeInTheDocument();
  });

  it('확인(이행 확인 필요): 메모 → order-service acknowledgements → 목록에서 빠진다', async () => {
    const view = renderAt('/pending', as.admin);
    const row = await rowOf('품질 격리');
    await userEvent.click(within(row).getByRole('button', { name: '확인' }));
    expect(within(row).getByText(/개인정보는 적지 마세요/)).toBeInTheDocument();
    await userEvent.type(within(row).getByLabelText('처리 메모'), 'MFC 에 재검수 요청');
    await userEvent.click(within(row).getByRole('button', { name: '보내기' }));
    await waitFor(() => expect(screen.getAllByTestId('pending-item')).toHaveLength(3));
    expect(await view.mutations('/fulfillment-issues/FI-MOCK-1/acknowledgements')[0]!.json()).toEqual({ note: 'MFC 에 재검수 요청' });
  });

  it('일부 원천을 못 읽으면 표시한다(빈 목록 아님)', async () => {
    server.use(http.get(`${BFF_BASE}/views/pending-work`, () => HttpResponse.json({ sources: [], unavailableSources: ['order-orchestration-service'], items: [] })));
    renderAt('/pending', as.admin);
    expect((await screen.findAllByText(/order-orchestration-service/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('alert')).toHaveTextContent('조회하지 못한 원천');
    expect(screen.queryByText('처리할 일이 없어요.')).not.toBeInTheDocument();
  });
});
