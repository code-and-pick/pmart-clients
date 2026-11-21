// 처리 대기 "결과 확인"(bff 0.12.0 GET /commands/{ts}/{cmd}/{requestId}?targetRef=, 백엔드 알림 notice-command-result)
// - 결과 불명일 때만, 누를 때만. 200 APPLIED·REJECTED(사가 FAILED) 만 확정 — 중지 REJECTED + FIX_AND_RETRY 는 원인 고친 뒤 새 요청. ACCEPTED·UNKNOWN_RESULT·503 = 모름(잠시 뒤 다시).
// - 404 = 명령이 원천에 닿지 않음 → 같은 키로 다시 보내기 안내. handover-retry 는 버튼 없음(422).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { BFF_BASE } from '../../api/client';
import { problem } from '../../mocks/support';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const rowOf = async (ref: string) => (await screen.findAllByTestId('pending-item')).find((r) => r.textContent?.includes(ref))!;
const source = (confidence: string) => ({ system: 'mfc-fulfillment-service', confidence, asOf: { asOf: '2026-11-17T00:00:00Z', freshness: 'CURRENT' } });
const unknownStop = () =>
  server.use(
    http.post(`${BFF_BASE}/commands/mfc-fulfillment-service/stop-retry`, () =>
      HttpResponse.json({ requestId: 'RQ-1', status: 'UNKNOWN_RESULT', nextAction: 'QUERY_RESULT', occurredAt: '2026-11-17T00:00:00Z' }, { status: 202 }),
    ),
  );

async function retryStop() {
  const row = await rowOf('예약 상태가 바뀜');
  await userEvent.click(within(row).getByRole('button', { name: '다시 시도' }));
  await userEvent.type(within(row).getByLabelText('다시 시도 사유(필수)'), 'PDA 재부팅 확인');
  await userEvent.click(within(row).getByRole('button', { name: '보내기' }));
  expect(await within(row).findByText(/"결과 확인"으로 가져온 곳을 다시 읽어/)).toBeInTheDocument();
  return row;
}

describe('처리 대기 — 결과 확인', () => {
  it('중지 다시 시도 결과 모름 → 결과 확인(requestId·targetRef) → APPLIED 면 반영, 결과 불명 안내가 내려가고 닫을 수 있다', async () => {
    unknownStop();
    server.use(
      http.get(`${BFF_BASE}/commands/mfc-fulfillment-service/stop-retry/:requestId`, () =>
        HttpResponse.json({ requestId: 'RQ-1', status: 'APPLIED', resultId: 'STOP-MOCK-1', nextAction: null, source: source('DIRECT'), detail: { state: 'RESOLVED' } }),
      ),
    );
    const view = renderAt('/pending', as.admin);
    const row = await retryStop();
    await userEvent.click(within(row).getByRole('button', { name: '결과 확인' }));
    expect(await within(row).findByTestId('result-check-outcome')).toHaveAttribute('data-outcome', 'applied');
    const get = view.sent.find((r) => r.method === 'GET' && new URL(r.url).pathname.endsWith('/commands/mfc-fulfillment-service/stop-retry/RQ-1'))!;
    expect(new URL(get.url).searchParams.get('targetRef')).toBe('STOP-MOCK-1');
    expect(within(row).queryByText(/반영됐는지 아직 확인하지 못했어요/)).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: '결과 확인' })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: '취소' })).toBeEnabled();
  });

  it('중지 REJECTED + FIX_AND_RETRY(원천 아직 PENDING + lastError)는 실패 확정 아님 — 마지막 오류와 "원인 고친 뒤 다시 보내기"(새 키)', async () => {
    unknownStop();
    server.use(
      http.get(`${BFF_BASE}/commands/mfc-fulfillment-service/stop-retry/:requestId`, () =>
        HttpResponse.json({ requestId: 'RQ-1', status: 'REJECTED', resultId: 'STOP-MOCK-1', nextAction: 'FIX_AND_RETRY', source: source('DIRECT'), detail: { state: 'PENDING', lastError: 'RECORD_MISMATCH: 집품 수량 다름' } }),
      ),
    );
    const view = renderAt('/pending', as.admin);
    const row = await retryStop();
    await userEvent.click(within(row).getByRole('button', { name: '결과 확인' }));
    const out = await within(row).findByTestId('result-check-outcome');
    expect(out).toHaveAttribute('data-outcome', 'fixAndRetry');
    expect(out).toHaveTextContent('실패 확정 아님');
    expect(within(row).getByTestId('result-check-last-error')).toHaveTextContent('집품·포장 기록 안 맞음 — 집품 수량 다름');
    expect(within(row).queryByText(/반영됐어요/)).not.toBeInTheDocument();
    // 다시 보내기 = 새 폼(새 키)
    await userEvent.click(within(row).getByRole('button', { name: '원인 고친 뒤 다시 보내기' }));
    expect(within(row).queryByTestId('result-check')).not.toBeInTheDocument();
    await userEvent.type(within(row).getByLabelText('다시 시도 사유(필수)'), 'PDA 교체함');
    await userEvent.click(within(row).getByRole('button', { name: '보내기' }));
    await waitFor(() => expect(view.mutations('/stop-retry')).toHaveLength(2));
    const [first, second] = view.mutations('/stop-retry');
    expect(second!.headers.get('Idempotency-Key')).not.toBe(first!.headers.get('Idempotency-Key'));
  });

  it('사가 REJECTED(nextAction 없음 — 원천 FAILED)는 실패 확정, 다시 보내기 버튼 없음', async () => {
    server.use(
      http.post(`${BFF_BASE}/commands/:ts/:cmd`, ({ request }) =>
        HttpResponse.json({ status: 'ACCEPTED', requestId: request.headers.get('Idempotency-Key'), occurredAt: '2026-11-17T01:00:00.000Z' }, { status: 202 }),
      ),
      http.get(`${BFF_BASE}/commands/order-orchestration-service/saga-requery/:requestId`, ({ params }) =>
        HttpResponse.json({ requestId: params['requestId'], status: 'REJECTED', resultId: 'SAGA-1', nextAction: null, source: { ...source('DIRECT'), system: 'order-orchestration-service' }, detail: { state: 'FAILED' } }),
      ),
    );
    renderAt('/pending', as.admin);
    const row = (await screen.findAllByTestId('pending-item')).find((r) => r.textContent?.includes('PG 승인 결과'))!;
    await userEvent.click(within(row).getByRole('button', { name: '결제 결과 다시 확인' }));
    await userEvent.click(within(row).getByRole('button', { name: '보내기' }));
    await userEvent.click(await within(row).findByRole('button', { name: '결과 확인' }));
    const out = await within(row).findByTestId('result-check-outcome');
    expect(out).toHaveAttribute('data-outcome', 'rejected');
    expect(out).toHaveTextContent('실패로 확인');
    expect(within(row).queryByRole('button', { name: '원인 고친 뒤 다시 보내기' })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: '취소' })).toBeEnabled();
  });

  it('200 UNKNOWN_RESULT(원천 시간 초과 — confidence UNKNOWN)·ACCEPTED·503 은 모름 — 버튼이 남아 다시 확인', async () => {
    unknownStop();
    const replies = [
      () => HttpResponse.json({ requestId: 'RQ-1', status: 'UNKNOWN_RESULT', resultId: null, nextAction: 'QUERY_RESULT', source: source('UNKNOWN'), detail: {} }),
      () => HttpResponse.json({ requestId: 'RQ-1', status: 'ACCEPTED', resultId: 'STOP-MOCK-1', nextAction: 'QUERY_RESULT', source: source('DIRECT'), detail: { state: 'PENDING' } }),
      () => problem(503, 'DEPENDENCY_UNAVAILABLE'),
    ];
    let n = 0;
    server.use(http.get(`${BFF_BASE}/commands/mfc-fulfillment-service/stop-retry/:requestId`, () => replies[n++]!()));
    renderAt('/pending', as.admin);
    const row = await retryStop();
    for (const [outcome, text] of [
      ['unknown', '가져온 곳이 답하지 않아 아직 몰라요'],
      ['accepted', '아직 처리 중이에요'],
      ['unavailable', '가져온 곳에 연결하지 못해 아직 몰라요'],
    ] as const) {
      await userEvent.click(within(row).getByRole('button', { name: '결과 확인' }));
      await waitFor(() => expect(within(row).getByTestId('result-check-outcome')).toHaveAttribute('data-outcome', outcome));
      expect(within(row).getByTestId('result-check-outcome')).toHaveTextContent(text);
      expect(within(row).getByText(/반영됐는지 아직 확인하지 못했어요/)).toBeInTheDocument();
    }
    expect(n).toBe(3); // 자동 반복 없음 — 누른 만큼만
  });

  it('404(명령이 원천에 닿지 않음) → 같은 요청으로 다시 보내라는 안내, 다시 보내면 같은 키', async () => {
    let posts = 0;
    server.use(
      http.post(`${BFF_BASE}/commands/:ts/:cmd`, ({ request }) => {
        posts += 1;
        return HttpResponse.json({ status: 'ACCEPTED', requestId: request.headers.get('Idempotency-Key'), occurredAt: '2026-11-17T01:00:00.000Z' }, { status: 202 });
      }),
    );
    const view = renderAt('/pending', as.admin);
    const row = (await screen.findAllByTestId('pending-item')).find((r) => r.textContent?.includes('PG 승인 결과'))!;
    await userEvent.click(within(row).getByRole('button', { name: '결제 결과 다시 확인' }));
    await userEvent.click(within(row).getByRole('button', { name: '보내기' }));
    await userEvent.click(await within(row).findByRole('button', { name: '결과 확인' }));
    const out = await within(row).findByTestId('result-check-outcome');
    expect(out).toHaveAttribute('data-outcome', 'notReached');
    expect(out).toHaveTextContent('요청이 가져온 곳에 닿지 않았어요');
    const [post] = view.mutations('/saga-requery');
    const get = view.sent.find((r) => r.method === 'GET' && /\/commands\/order-orchestration-service\/saga-requery\/[^/]+$/.test(new URL(r.url).pathname))!;
    expect(new URL(get.url).pathname.endsWith(`/${post!.headers.get('Idempotency-Key')}`)).toBe(true);
    await userEvent.click(within(row).getByRole('button', { name: '같은 요청으로 결과 확인' }));
    await waitFor(() => expect(posts).toBe(2));
    const [a, b] = view.mutations('/saga-requery');
    expect(b!.headers.get('Idempotency-Key')).toBe(a!.headers.get('Idempotency-Key'));
  });

  it('인계 다시 보내기는 결과 조회가 없어(422) "결과 확인" 버튼 없이 같은 요청 재전송만', async () => {
    server.use(
      http.post(`${BFF_BASE}/commands/mfc-fulfillment-service/handover-retry`, () =>
        HttpResponse.json({ requestId: 'RQ-2', status: 'UNKNOWN_RESULT', nextAction: 'QUERY_RESULT', occurredAt: '2026-11-17T00:00:00Z' }, { status: 202 }),
      ),
    );
    const view = renderAt('/pending', as.admin);
    const row = await rowOf('재고와 인계 수량이 다름');
    await userEvent.click(within(row).getByRole('button', { name: '다시 시도' }));
    await userEvent.type(within(row).getByLabelText('다시 시도 사유(필수)'), '재고 정정함');
    await userEvent.click(within(row).getByRole('button', { name: '보내기' }));
    expect(await within(row).findByText(/그대로면 "같은 요청으로 결과 확인"을 눌러/)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: '결과 확인' })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: '같은 요청으로 결과 확인' })).toBeInTheDocument();
    expect(view.sent.some((r) => r.method === 'GET' && /\/commands\/[^/]+\/[^/]+\/[^/]+$/.test(new URL(r.url).pathname))).toBe(false);
  });
});
