// 업무 도우미 실서버 어댑터(ai-assistant-service 1.3.0) — 게이트웨이 응답을 MSW 로 흉내 낸다. 실서버 확인은 아니다.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { ContractViolationFailure, ProblemFailure, UnknownResultFailure } from '@pmart/web-core';
import { api, tokens } from '../../api/client';
import { IdempotencyKey } from '../../api/command';
import { App } from '../../app/App';
import { problem } from '../../mocks/support';
import { as } from '../../test/render';
import { server } from '../../test/server';
import { createHttpAssistant } from './httpAssistant';
import type { AnswerWire } from './wire';

const ASK = '*/api/v1/assistant/policy-questions';
const AS_OF = { snapshotId: 'IDX-20261109-0700', sourceRevision: 'b409385', sourceDirty: false, indexedAt: '2026-11-09T07:00:00Z' };

const answered = (over: Partial<AnswerWire> = {}): AnswerWire => ({
  answerId: 'ANS-1',
  requestId: 'key-1',
  state: 'ANSWERED',
  answer: '결품이면 대체 없이 부분 취소합니다.',
  citations: [
    {
      chunkId: 'c1',
      documentId: 'docs/adr/0049.md',
      path: 'docs/adr/0049.md',
      section: '결정',
      authority: 'CONFIRMED',
      lifecycleStatus: 'ACTIVE',
      supersededBy: null,
      proposedSupersededBy: [],
      implementationEvidence: null,
      documentVersion: null,
      effectiveDate: null,
      asOf: AS_OF,
      excerpt: '결품은 …',
    },
  ],
  answerMode: 'GENERATIVE',
  retrievalMode: 'SEMANTIC',
  indexSnapshotId: AS_OF.snapshotId,
  askedAt: '2026-11-09T07:10:00Z',
  ...over,
});

const processing = (): AnswerWire =>
  answered({ state: 'PROCESSING', answer: '', citations: [], answerMode: 'NONE', retrievalMode: 'NONE', indexSnapshotId: null });

interface Sent {
  readonly headers: Headers;
  readonly body: unknown;
}

/** 질의 요청을 모으고 차례로 답한다(마지막 답은 되풀이). */
function askHandler(...replies: Array<() => Response>) {
  const sent: Sent[] = [];
  server.use(
    http.post(ASK, async ({ request }) => {
      sent.push({ headers: request.headers, body: await request.json() });
      return (replies[Math.min(sent.length, replies.length) - 1] as () => Response)();
    }),
  );
  return sent;
}

const port = () => {
  tokens.accessToken = as.md;
  return createHttpAssistant(api);
};

describe('업무 도우미 실서버 어댑터', () => {
  it('질의: POST /assistant/policy-questions — Idempotency-Key·X-Source-System·Bearer, 본문은 question 만', async () => {
    const sent = askHandler(() => HttpResponse.json(answered()));
    const key = IdempotencyKey.generate();
    const a = await port().ask('결품이면 어떻게 하나요?', key);
    expect(a.state).toBe('ANSWERED');
    expect(a.answerMode).toBe('GENERATIVE');
    expect(a.citations).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers.get('Idempotency-Key')).toBe(key.value);
    expect(sent[0]!.headers.get('X-Source-System')).toBe('backoffice-web');
    expect(sent[0]!.headers.get('Authorization')).toBe(`Bearer ${as.md}`);
    expect(sent[0]!.body).toEqual({ question: '결품이면 어떻게 하나요?' }); // 새 채팅 = sessionId 없이
  });

  it('이어 묻기: 본문에 sessionId 를 넣는다(1.3.0)', async () => {
    const sent = askHandler(() => HttpResponse.json(answered({ sessionId: 'S-1', question: '그럼 반품은?' })));
    const a = await port().ask('그럼 반품은?', IdempotencyKey.generate(), 'S-1');
    expect(sent[0]!.body).toEqual({ question: '그럼 반품은?', sessionId: 'S-1' });
    expect(a).toMatchObject({ sessionId: 'S-1', question: '그럼 반품은?' });
  });

  it('202 처리 중은 PROCESSING 으로 돌려준다(결과가 아니다)', async () => {
    askHandler(() => HttpResponse.json(processing(), { status: 202, headers: { 'Retry-After': '3' } }));
    expect((await port().ask('q', IdempotencyKey.generate())).state).toBe('PROCESSING');
  });

  it('403·409·422 는 거절(ProblemFailure), 응답 유실은 결과 불명(UnknownResultFailure)', async () => {
    for (const [status, code] of [
      [403, 'FORBIDDEN'],
      [409, 'IDEMPOTENCY_CONFLICT'],
      [422, 'CONFIG_REQUIRED'],
    ] as const) {
      askHandler(() => problem(status, code));
      const e = await port()
        .ask('q', IdempotencyKey.generate())
        .catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ProblemFailure);
      expect((e as ProblemFailure).problem.code).toBe(code);
    }
    askHandler(() => HttpResponse.error());
    await expect(port().ask('q', IdempotencyKey.generate())).rejects.toBeInstanceOf(UnknownResultFailure);
  });

  it('계약 밖 응답(state 이상)은 빈 답으로 메우지 않고 계약 위반으로 던진다', async () => {
    askHandler(() => HttpResponse.json({ ...answered(), state: 'DONE' }));
    await expect(port().ask('q', IdempotencyKey.generate())).rejects.toBeInstanceOf(ContractViolationFailure);
  });

  it('다시 보기 GET /assistant/policy-questions/{answerId}, 없으면 404 NOT_FOUND', async () => {
    server.use(
      http.get(`${ASK}/:answerId`, ({ params }) => (params.answerId === 'ANS-1' ? HttpResponse.json(answered()) : problem(404, 'NOT_FOUND'))),
    );
    expect((await port().get('ANS-1')).answerId).toBe('ANS-1');
    const e = await port()
      .get('ANS-X')
      .catch((x: unknown) => x);
    expect((e as ProblemFailure).problem.code).toBe('NOT_FOUND');
  });

  it('내 채팅 목록 GET /assistant/chat-sessions — X-Source-System, cursor 는 있을 때만', async () => {
    const seen: Array<{ cursor: string | null; source: string | null }> = [];
    server.use(
      http.get('*/api/v1/assistant/chat-sessions', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        seen.push({ cursor, source: request.headers.get('X-Source-System') });
        return HttpResponse.json({
          items: [{ sessionId: cursor ? 'S-2' : 'S-1', title: null, questionCount: 3, createdAt: '2026-11-21T01:00:00Z', lastAskedAt: '2026-11-21T02:00:00Z' }],
          page: { nextCursor: cursor ? null : 'c2', size: 1 },
        });
      }),
    );
    const first = await port().chats();
    expect(first.nextCursor).toBe('c2');
    const second = await port().chats('c2');
    expect(second.items[0]).toMatchObject({ sessionId: 'S-2', questionCount: 3, title: null });
    expect(second.nextCursor).toBeNull();
    expect(seen).toEqual([
      { cursor: null, source: 'backoffice-web' },
      { cursor: 'c2', source: 'backoffice-web' },
    ]);
  });

  it('채팅 하나 GET /assistant/chat-sessions/{id} — messages 를 질문 순 답변으로, 없으면 404 NOT_FOUND', async () => {
    server.use(
      http.get('*/api/v1/assistant/chat-sessions/:sessionId', ({ params }) =>
        params.sessionId === 'S-1'
          ? HttpResponse.json({
              sessionId: 'S-1',
              createdAt: '2026-11-21T01:00:00Z',
              lastAskedAt: '2026-11-21T02:00:00Z',
              messages: [answered({ answerId: 'A-1', sessionId: 'S-1' }), processing()],
            })
          : problem(404, 'NOT_FOUND'),
      ),
    );
    const s = await port().chat('S-1');
    expect(s.messages.map((x) => x.state)).toEqual(['ANSWERED', 'PROCESSING']);
    const e = await port()
      .chat('S-X')
      .catch((x: unknown) => x);
    expect((e as ProblemFailure).problem.code).toBe('NOT_FOUND');
  });

  it('채팅 지우기 DELETE /assistant/chat-sessions/{id} — Idempotency-Key·X-Source-System, 204 는 성공', async () => {
    const sent: Headers[] = [];
    server.use(
      http.delete('*/api/v1/assistant/chat-sessions/:sessionId', ({ request }) => {
        sent.push(request.headers);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const key = IdempotencyKey.generate();
    await expect(port().deleteChat('S-1', key)).resolves.toBeUndefined();
    expect(sent[0]!.get('Idempotency-Key')).toBe(key.value);
    expect(sent[0]!.get('X-Source-System')).toBe('backoffice-web');
  });
});

describe('업무 도우미 화면 + 실서버 어댑터', () => {
  const history = () =>
    server.use(http.get('*/api/v1/assistant/chat-sessions', () => HttpResponse.json({ items: [], page: { nextCursor: null, size: 20 } })));

  it('생성 답변: 목 표시 없이 답·근거를 보이고 "근거를 꼭 확인" 안내를 붙인다(기준선 안내는 없음)', async () => {
    history();
    askHandler(() => HttpResponse.json(answered()));
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={createHttpAssistant(api)} />);
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: '질문' }), '결품이면 어떻게 하나요?');
    await user.click(screen.getByRole('button', { name: '질문 보내기' }));
    expect(await screen.findByTestId('answer-text')).toHaveTextContent('결품이면 대체 없이 부분 취소합니다.');
    expect(screen.getByTestId('generative')).toHaveTextContent('근거 문서를 꼭 확인');
    expect(screen.queryByTestId('baseline')).not.toBeInTheDocument();
    expect(screen.queryByText('목 답변(실제 서버 답이 아님)')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('citation')).toHaveLength(1);
  });

  it('202 처리 중 → "같은 요청으로 결과 확인"은 같은 키·같은 질문으로 POST 를 다시 보낸다(새 질의 아님)', async () => {
    history();
    const sent = askHandler(
      () => HttpResponse.json(processing(), { status: 202, headers: { 'Retry-After': '3' } }),
      () => HttpResponse.json(answered()),
    );
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={createHttpAssistant(api)} />);
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: '질문' }), '결품이면 어떻게 하나요?');
    await user.click(screen.getByRole('button', { name: '질문 보내기' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(screen.queryByTestId('answer-text')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '같은 요청으로 결과 확인' }));
    expect(await screen.findByTestId('answer-text')).toBeInTheDocument();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.headers.get('Idempotency-Key')).toBe(sent[0]!.headers.get('Idempotency-Key'));
    expect(sent[1]!.body).toEqual(sent[0]!.body);
  });
});
