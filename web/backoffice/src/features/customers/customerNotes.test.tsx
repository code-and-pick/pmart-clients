// 고객 상담 메모(case 0.34.0 R-13) — 상담원이 쓰고, 고치기·지우기는 쓴 사람 줄에만, 관리자는 보기만.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

const posts = (sent: readonly Request[], tail: string) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith(tail));

describe('고객 상담 메모', () => {
  it('최근 것부터, 고친 메모는 "(고침)" — 내가 쓴 줄에만 고치기·지우기', async () => {
    renderAt('/customers/CUS-1001', as.cs);
    const notes = await screen.findAllByTestId('customer-note');
    expect(notes).toHaveLength(2);
    expect(notes[0]).toHaveTextContent('반품 문의 때 사진 먼저 받기로 안내함');
    expect(notes[0]).toHaveTextContent('(고침)');
    expect(notes[0]).toHaveAttribute('data-mine', 'false'); // 다른 상담원 글
    expect(within(notes[0]!).queryByRole('button', { name: '고치기' })).not.toBeInTheDocument();
    expect(notes[1]).toHaveAttribute('data-mine', 'true');
    expect(within(notes[1]!).getByRole('button', { name: '고치기' })).toBeInTheDocument();
    expect(within(notes[1]!).getByRole('button', { name: '지우기' })).toBeInTheDocument();
  });

  it('남기기 → 멱등키·customerId·글을 보내고 목록 맨 위에', async () => {
    const user = userEvent.setup();
    const view = renderAt('/customers/CUS-1001', as.cs);
    const form = await screen.findByRole('form', { name: '메모 남기기' });
    const btn = within(form).getByRole('button', { name: '메모 남기기' });
    expect(btn).toBeDisabled();
    await user.type(within(form).getByLabelText(/메모 남기기/), '저녁 시간대 통화 선호');
    await user.click(btn);
    await waitFor(() => expect(screen.getAllByTestId('customer-note')[0]).toHaveTextContent('저녁 시간대 통화 선호'));
    const post = posts(view.sent, '/customer-notes')[0]!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(post.headers.get('X-Source-System')).toBeTruthy();
    expect(await post.clone().json()).toEqual({ customerId: 'CUS-1001', text: '저녁 시간대 통화 선호' });
  });

  it('고치기·지우기(줄 안에서 한 번 더 묻기) — 지운 메모는 목록에서 빠짐', async () => {
    const user = userEvent.setup();
    const view = renderAt('/customers/CUS-1001', as.cs);
    const mine = (await screen.findAllByTestId('customer-note')).find((n) => n.dataset['mine'] === 'true')!;
    await user.click(within(mine).getByRole('button', { name: '고치기' }));
    const box = within(mine).getByRole('textbox', { name: '메모 고치기' });
    await user.clear(box);
    await user.type(box, '배송 요청사항 변경 잦음');
    await user.click(within(mine).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.getByText('배송 요청사항 변경 잦음')).toBeInTheDocument());
    expect(await posts(view.sent, '/customer-notes/CN-MOCK-1/revisions')[0]!.clone().json()).toEqual({ text: '배송 요청사항 변경 잦음' });

    const again = screen.getAllByTestId('customer-note').find((n) => n.dataset['mine'] === 'true')!;
    await user.click(within(again).getByRole('button', { name: '지우기' }));
    const ask = within(again).getByRole('group', { name: '지우기' });
    expect(ask).toHaveTextContent('되돌릴 수 없어요');
    await user.click(within(ask).getByRole('button', { name: '지우기' }));
    await waitFor(() => expect(screen.getAllByTestId('customer-note')).toHaveLength(1));
    expect(posts(view.sent, '/customer-notes/CN-MOCK-1/deletions')).toHaveLength(1);
  });

  it('관리자는 보기만 — 입력란·고치기 단추 없음', async () => {
    renderAt('/customers/CUS-1001', as.admin);
    expect(await screen.findAllByTestId('customer-note')).toHaveLength(2);
    expect(screen.queryByRole('form', { name: '메모 남기기' })).not.toBeInTheDocument();
    expect(screen.getByTestId('customer-notes-readonly')).toHaveTextContent('상담원만');
    expect(screen.queryByRole('button', { name: '고치기' })).not.toBeInTheDocument();
  });
});
