// 라이더 도움요청 대화(execution 0.6.0) — 접수 건 상세 "라이더와 대화"
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';

const MESSAGES = `${API_BASE}/deliveries/DLV-MOCK-1/help-requests/HLP-MOCK-1/messages`;

describe('라이더 도움요청 대화', () => {
  it('라이더 메시지(사진 번호)를 보이고, 답장은 같은 줄기에 지원센터로 붙는다', async () => {
    const view = renderAt('/cases/CASE-MOCK-1', as.riderOps);
    const chat = await screen.findByTestId('help-chat');
    const first = within(chat).getByTestId('help-message');
    expect(first).toHaveAttribute('data-sender', 'RIDER');
    expect(first).toHaveTextContent('문 앞에 두고 가도 될까요?');
    expect(first).toHaveTextContent('사진 PHOTO-MOCK-1');

    await userEvent.type(screen.getByLabelText('라이더에게 답장(1~1,000자)'), '문 앞에 두고 사진 남겨 주세요.');
    await userEvent.click(screen.getByRole('button', { name: '답장 보내기' }));
    expect(await screen.findByText('보냈어요.')).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByTestId('help-chat')).getAllByTestId('help-message')).toHaveLength(2));
    const reply = within(screen.getByTestId('help-chat')).getAllByTestId('help-message')[1]!;
    expect(reply).toHaveAttribute('data-sender', 'SUPPORT');
    expect(reply).toHaveTextContent('지원센터');
    expect(reply).toHaveTextContent('문 앞에 두고 사진 남겨 주세요.');

    const sent = view.mutations('/messages');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await sent[0]!.json()).toEqual({ body: '문 앞에 두고 사진 남겨 주세요.' });
    // 다시 읽기는 마지막 seq 뒤만
    const reads = view.sent.filter((r) => r.method === 'GET' && new URL(r.url).pathname.endsWith('/messages'));
    expect(reads.some((r) => new URL(r.url).searchParams.get('after') === '1')).toBe(true);
  });

  it('처리 끝난 도움요청은 답장 칸 대신 "다시 처리하면 이어서" 안내', async () => {
    server.use(http.get(MESSAGES, () => HttpResponse.json({ items: [], helpState: 'RESOLVED' })));
    renderAt('/cases/CASE-MOCK-1', as.riderOps);
    expect(await screen.findByTestId('help-chat-closed')).toHaveTextContent('다시 처리하면 이어서 쓸 수 있어요');
    expect(screen.queryByRole('button', { name: '답장 보내기' })).not.toBeInTheDocument();
    expect(screen.getByText('아직 주고받은 메시지가 없어요.')).toBeInTheDocument();
  });

  it('보내는 사이 닫혔으면(409 HELP_REQUEST_CLOSED) 코드 문구를 보인다', async () => {
    server.use(
      http.post(MESSAGES, () =>
        HttpResponse.json({ type: 'about:blank', title: 'x', status: 409, code: 'HELP_REQUEST_CLOSED' }, { status: 409, headers: { 'content-type': 'application/problem+json' } }),
      ),
    );
    renderAt('/cases/CASE-MOCK-1', as.riderOps);
    await userEvent.type(await screen.findByLabelText('라이더에게 답장(1~1,000자)'), '확인했어요');
    await userEvent.click(screen.getByRole('button', { name: '답장 보내기' }));
    expect(await screen.findByText(/처리가 끝난 도움요청이라 더 쓸 수 없어요/)).toBeInTheDocument();
  });

  it('대화 조회 실패는 빈 대화로 보이지 않는다', async () => {
    server.use(http.get(MESSAGES, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 503, code: 'DEPENDENCY_UNAVAILABLE' }, { status: 503, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/cases/CASE-MOCK-1', as.riderOps);
    const section = await screen.findByRole('region', { name: '라이더와 대화' });
    await waitFor(() => expect(within(section).queryByText('아직 주고받은 메시지가 없어요.')).not.toBeInTheDocument());
    expect(await within(section).findByRole('button', { name: /다시/ })).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: '답장 보내기' })).toBeDisabled();
  });
});
