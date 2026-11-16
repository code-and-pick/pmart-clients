// 처리 대기(bff 0.2.0 pending-work, BO-12) — 멈춘 주문 처리·이행 확인 필요 한 목록, allowedActions 버튼만, 명령은 bff 프록시(짝 조회는 501 이라 목록 다시 읽기).
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
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual(['MFC_HANDOVER_REJECTED', 'STUCK_SAGA', 'FULFILLMENT_ISSUE', 'MFC_STOP_FAILED', 'FULFILLMENT_ISSUE', 'STUCK_SAGA']);
    const payment = await rowOf('ORD-MOCK-1001');
    const saga1 = (await screen.findAllByTestId('pending-item')).find((r) => r.textContent?.includes('PG 승인 결과'))!;
    expect(within(saga1).getByRole('button', { name: '결제 결과 다시 확인' })).toBeInTheDocument();
    expect(within(saga1).getByRole('button', { name: '처리 완료(밖에서 해결)' })).toBeInTheDocument();
    const saga2 = (await screen.findAllByTestId('pending-item')).find((r) => r.textContent?.includes('MFC 예약 거절'))!;
    expect(within(saga2).queryByRole('button', { name: '결제 결과 다시 확인' })).not.toBeInTheDocument(); // 허락되지 않은 조치
    expect(payment).toBeTruthy();
    // MFC 원천이 sources 에 있으면 "아직 꺼져 있음" 안내는 없다
    expect(screen.queryByTestId('pending-not-yet')).not.toBeInTheDocument();
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

  it('ACCEPTED 면 결과 조회(501) 대신 목록을 다시 읽고 "목록에서 확인" — 다시 확인은 같은 키', async () => {
    let n = 0;
    server.use(
      http.post(`${BFF_BASE}/commands/:ts/:cmd`, ({ request }) => {
        n += 1;
        return HttpResponse.json({ status: 'ACCEPTED', requestId: request.headers.get('Idempotency-Key'), occurredAt: '2026-11-16T01:00:00.000Z' }, { status: 202 });
      }),
    );
    const view = renderAt('/pending', as.admin);
    const row = (await screen.findAllByTestId('pending-item')).find((r) => r.textContent?.includes('PG 승인 결과'))!;
    const listReads = () => view.sent.filter((r) => new URL(r.url).pathname.endsWith('/views/pending-work')).length;
    const before = listReads();
    await userEvent.click(within(row).getByRole('button', { name: '결제 결과 다시 확인' }));
    await userEvent.click(within(row).getByRole('button', { name: '보내기' }));
    expect(await within(row).findByText(/목록을 다시 읽었으니 이 항목이 바뀌었는지 보세요/)).toBeInTheDocument();
    expect(listReads()).toBeGreaterThan(before);
    // 501 인 결과 조회는 부르지 않는다
    expect(view.sent.some((r) => /\/commands\/[^/]+\/[^/]+\/[^/]+$/.test(new URL(r.url).pathname))).toBe(false);
    // 성공 문구가 아니다
    expect(within(row).queryByText('반영됐어요. 목록을 새로 불러와요.')).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: '같은 요청으로 결과 확인' }));
    await waitFor(() => expect(n).toBe(2));
    const [a, b] = view.mutations('/saga-requery');
    expect(b!.headers.get('Idempotency-Key')).toBe(a!.headers.get('Idempotency-Key'));
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
    await waitFor(() => expect(screen.getAllByTestId('pending-item')).toHaveLength(5));
    expect(await view.mutations('/fulfillment-issues/FI-MOCK-1/acknowledgements')[0]!.json()).toEqual({ note: 'MFC 에 재검수 요청' });
  });

  it('일부 원천을 못 읽으면 표시한다(빈 목록 아님)', async () => {
    server.use(http.get(`${BFF_BASE}/views/pending-work`, () => HttpResponse.json({ sources: [], unavailableSources: ['order-orchestration-service'], items: [] })));
    renderAt('/pending', as.admin);
    expect((await screen.findAllByText(/order-orchestration-service/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('alert')).toHaveTextContent('조회하지 못한 원천');
    expect(screen.queryByText('처리할 일이 없어요.')).not.toBeInTheDocument();
  });
  it('MFC 중지 실패: 다시 시도(메모 필수) → bff mfc-fulfillment-service/stop-retry → 목록에서 빠진다, 처리 완료 버튼은 없다', async () => {
    const view = renderAt('/pending', as.admin);
    const row = await rowOf('PDA 응답 없음');
    expect(within(row).getByText('MFC 중지 실패(취소 멈춤)')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: '처리 완료(밖에서 해결)' })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: '다시 시도' }));
    expect(within(row).getByText(/메모는 아직 MFC 에 저장되지 않아요/)).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: '보내기' })).toBeDisabled();
    await userEvent.type(within(row).getByLabelText('다시 시도 메모(필수)'), 'PDA 재부팅 확인');
    await userEvent.click(within(row).getByRole('button', { name: '보내기' }));
    await waitFor(() => expect(screen.queryByText(/PDA 응답 없음/)).not.toBeInTheDocument());
    const sent = view.mutations('/commands/mfc-fulfillment-service/stop-retry')[0]!;
    expect(sent.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await sent.json()).toEqual({ targetRef: 'STOP-MOCK-1', payload: {}, reason: 'PDA 재부팅 확인' });
    expect(document.body.textContent).not.toContain('기록됨');
  });

  it('MFC 인계 거절: 실물 확인 → 재고 정정 → 다시 시도 안내, 다시 실패(REJECTED)면 목록에 남고 원인 고친 뒤 다시', async () => {
    const view = renderAt('/pending', as.admin);
    const row = await rowOf('재고와 인계 수량이 다름');
    await userEvent.click(within(row).getByRole('button', { name: '다시 시도' }));
    expect(within(row).getByRole('note')).toHaveTextContent('실물을 확인하고 재고를 정정한 뒤');
    await userEvent.type(within(row).getByLabelText('다시 시도 메모(필수)'), '재고 정정함');
    await userEvent.click(within(row).getByRole('button', { name: '보내기' }));
    expect(await within(row).findByTestId('retry-rejected')).toHaveTextContent('다시 실패했어요');
    expect(screen.getByText(/재고와 인계 수량이 다름/)).toBeInTheDocument();
    expect(view.mutations('/commands/mfc-fulfillment-service/handover-retry')).toHaveLength(1);
  });

  it('MFC 원천이 sources 에 없으면(서버 설정으로 꺼짐) 안내 — 장애로 보이지 않는다', async () => {
    server.use(
      http.get(`${BFF_BASE}/views/pending-work`, () =>
        HttpResponse.json({ sources: [{ system: 'order-orchestration-service', confidence: 'DIRECT', asOf: { asOf: '2026-11-16T00:00:00Z', freshness: 'CURRENT' } }], unavailableSources: [], items: [] }),
      ),
    );
    renderAt('/pending', as.admin);
    expect(await screen.findByTestId('pending-not-yet')).toHaveTextContent('서버가 MFC 목록을 켜면');
    expect(screen.getByText('처리할 일이 없어요.')).toBeInTheDocument();
  });
});
