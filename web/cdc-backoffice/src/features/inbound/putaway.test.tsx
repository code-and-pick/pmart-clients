// 입고관리(적치)·보충관리 — 목록은 kind 로 나눔, 적치 지시(멱등키·서버 상태), 취소는 사유 필수, 보충 판단 사유 거르기.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';

describe('입고관리 — 적치', () => {
  it('적치 작업만(kind=PUTAWAY), 펼치면 설비 결과', async () => {
    const view = renderAt('/c/CDC01/inbound');
    const rows = await screen.findAllByTestId('putaway-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('일부 옮김')).toBeInTheDocument();
    const req = view.gets('/putaway-tasks')[0]!;
    expect(new URL(req.url).searchParams.get('kind')).toBe('PUTAWAY');
    await userEvent.click(rows[0]!);
    expect(await screen.findByTestId('putaway-detail')).toHaveTextContent('FORK-02');
  });

  it('적치 지시 — 출발·목적이 같으면 못 보내고, 보내면 설비 대기로', async () => {
    const view = renderAt('/c/CDC01/inbound');
    await userEvent.click(await screen.findByTestId('putaway-new'));
    await userEvent.type(screen.getByTestId('putaway-sku'), 'SKU-1001');
    await userEvent.type(screen.getByTestId('putaway-lot'), 'LOT-A1');
    await userEvent.type(screen.getByTestId('putaway-from'), 'CDC01-A-5-01-03-2-1');
    await userEvent.type(screen.getByTestId('putaway-to'), 'CDC01-A-5-01-03-2-1');
    await userEvent.type(screen.getByTestId('putaway-qty'), '10');
    expect(screen.getByTestId('putaway-go')).toBeDisabled();
    await userEvent.clear(screen.getByTestId('putaway-to'));
    await userEvent.type(screen.getByTestId('putaway-to'), 'CDC01-A-5-63-01-2-1');
    await userEvent.click(screen.getByTestId('putaway-go'));
    expect(await screen.findByText(/적치 지시 PT-0004 를 만들었어요/)).toBeInTheDocument();
    const post = view.sent.find((r) => r.method === 'POST')!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTestId('putaway-row')).toHaveLength(3));
  });

  it('남은 수량 취소는 사유가 있어야', async () => {
    renderAt('/c/CDC01/inbound');
    await userEvent.click((await screen.findAllByTestId('putaway-row'))[0]!);
    await userEvent.click(await screen.findByTestId('putaway-cancel-open'));
    expect(screen.getByTestId('putaway-cancel-go')).toBeDisabled();
    await userEvent.type(screen.getByTestId('putaway-cancel-reason'), '목적 칸 막힘');
    await userEvent.click(screen.getByTestId('putaway-cancel-go'));
    await waitFor(() => expect(within(screen.getAllByTestId('putaway-row')[0]!).getByText('취소')).toBeInTheDocument());
  });
});

describe('보충관리', () => {
  it('보충 작업(kind=REPLENISHMENT)과 칸별 판단 — 사유로 거르기', async () => {
    renderAt('/c/CDC01/replenishment');
    expect(await screen.findAllByTestId('putaway-row')).toHaveLength(1);
    expect(await screen.findAllByTestId('repl-check-row')).toHaveLength(3);
    await userEvent.click(within(screen.getByTestId('repl-reasons')).getByRole('button', { name: /박스 입수 미등록/ }));
    expect(screen.getAllByTestId('repl-check-row')).toHaveLength(1);
  });
});
