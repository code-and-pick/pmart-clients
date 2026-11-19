import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { tokens } from '../../api/client';
import { App } from '../../app/App';
import { as } from '../../test/render';
import { createDraftAssistantMock, type DraftMockOptions, type DraftScenario } from './draftMock';
import { isDisplayablePath } from './model';
import { notConnectedAssistant, type AssistantPort } from './port';
import { answerFromWire, historyFromWire, type AnswerWire } from './wire';

/** 목 + 보낸 키 기록 */
function setup(opts: DraftMockOptions & { scenario?: DraftScenario } = {}) {
  const mock = createDraftAssistantMock({ ...opts, ...(opts.scenario ? { script: () => opts.scenario as DraftScenario } : {}) });
  const keys: string[] = [];
  const port: AssistantPort = {
    ...mock,
    ask: (q, k) => {
      keys.push(k.value);
      return mock.ask(q, k);
    },
  };
  return { mock, port, keys };
}

async function ask(question: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByRole('textbox', { name: '질문' }), question);
  await user.click(screen.getByRole('button', { name: '질문 보내기' }));
  return user;
}

/** 내 질문 목록 줄의 링크(줄 전체가 링크) — n 줄이 될 때까지 기다린다 */
async function historyHrefs(n = 1) {
  await waitFor(() => expect(screen.getAllByTestId('history-item')).toHaveLength(n));
  return screen.getAllByTestId('history-item').map((li) => li.querySelector('a')?.getAttribute('href'));
}

const wireAnswer = (over: Partial<AnswerWire> = {}): AnswerWire => ({
  answerId: 'a1',
  requestId: 'k1',
  state: 'ANSWERED',
  answer: '답',
  citations: [],
  answerMode: 'GENERATIVE',
  retrievalMode: 'SEMANTIC',
  indexSnapshotId: 'IDX-1',
  askedAt: '2026-11-04T07:10:00Z',
  ...over,
});

const wireCitation = (path: string): AnswerWire['citations'][number] => ({
  chunkId: 'c1',
  documentId: path,
  path,
  section: null,
  authority: 'CONFIRMED',
  lifecycleStatus: 'ACTIVE',
  asOf: { snapshotId: 'IDX-1', indexedAt: '2026-11-04T07:00:00Z' },
  excerpt: '본문',
});

describe('업무 도우미 (계약 1.1.0 목)', () => {
  it('정상 답변: 답변·근거 경로·절·버전·지위·생애·구현 기록·색인 시점을 보이고, 기준선·목 표시를 붙인다', async () => {
    const { port } = setup();
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={port} />);
    await ask('반품 기한은?');

    expect(await screen.findByTestId('answer-text')).toHaveTextContent('[목 답변]');
    expect(screen.getByText('목 답변(실제 서버 답이 아님)')).toBeInTheDocument();
    expect(screen.getByTestId('baseline')).toBeInTheDocument();
    expect(screen.getByText('Q. 반품 기한은?')).toBeInTheDocument();
    const cites = screen.getAllByTestId('citation');
    expect(cites).toHaveLength(3);
    expect(within(cites[0]!).getByText('확정 정책')).toBeInTheDocument();
    expect(within(cites[0]!).getByText('docs/business/overview.md')).toBeInTheDocument();
    expect(within(cites[0]!).getByText('[목] 4. 확정 정책 > 4.9 반품')).toBeInTheDocument();
    expect(within(cites[0]!).getByText('v3')).toBeInTheDocument();
    expect(within(cites[0]!).queryByText('유효')).not.toBeInTheDocument(); // ACTIVE 는 따로 표시하지 않는다
    expect(within(cites[1]!).getByText('설계안')).toBeInTheDocument();
    expect(within(cites[1]!).getByText('대체 제안 있음')).toBeInTheDocument();
    expect(within(cites[1]!).getByText(/2026-11-01 기준 기록/)).toBeInTheDocument();
    expect(within(cites[1]!).getByText('커밋 안 된 변경 포함')).toBeInTheDocument();
    expect(within(cites[2]!).getByText('결정 필요')).toBeInTheDocument();
    expect(within(cites[2]!).getByText('대체됨')).toBeInTheDocument();
    expect(within(cites[2]!).getByText('docs/adr/0036-mock.md')).toBeInTheDocument();
    // 근거 본문은 전문 그대로, 출처는 링크가 아니다(1차에 문서 열람 API 없음)
    expect(within(cites[0]!).getByTestId('excerpt')).toHaveTextContent('[목 청크] 반품 접수 기한');
    expect(within(cites[0]!).queryByRole('link')).not.toBeInTheDocument();
    // 내 질문 목록(서버)에 남고, 답변 번호로 다시 연다
    const row = await screen.findByTestId('history-item');
    expect(within(row).getByRole('link')).toHaveAttribute('href', '/assistant/answers/ans-mock-1'); // 줄 전체가 다시 보기 링크
    expect(within(row).getByText(/\[목 답변\]/)).toBeInTheDocument(); // 질문 원문 대신 답변 앞부분
  });

  it('서버 답변의 HTML 은 실행·해석하지 않고 글자로 보인다', async () => {
    const { port } = setup();
    const { container } = render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={port} />);
    await ask('표시 확인');
    const text = await screen.findByTestId('answer-text');
    expect(text.textContent).toContain('<b>강조</b>');
    expect(container.querySelector('[data-testid="answer-text"] b')).toBeNull();
  });

  it('근거 부족(NO_GROUNDING)은 오류가 아니라 "근거 문서를 찾지 못했어요"', async () => {
    const { port } = setup({ scenario: 'noGrounding' });
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={port} />);
    await ask('없는 정책');
    expect(await screen.findByText('근거 문서를 찾지 못했어요')).toBeInTheDocument();
    expect(screen.queryByTestId('answer-text')).not.toBeInTheDocument();
  });

  it('실시간 조회 필요(REALTIME_DATA_REQUIRED)·실행 요청(OUT_OF_SCOPE)은 각자의 안내로 보이고 근거 없음과 섞지 않는다', async () => {
    const rt = setup({ scenario: 'realtime' });
    const first = render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={rt.port} />);
    await ask('주문 123 지금 어디?');
    expect(await screen.findByText('지금 상태는 업무 화면에서 확인해 주세요')).toBeInTheDocument();
    expect(document.querySelector('[data-state="realtime-required"]')).toHaveTextContent('이 기능으로 확인할 수 없습니다'); // 서버 안내 문장 그대로
    expect(screen.queryByText('근거 문서를 찾지 못했어요')).not.toBeInTheDocument();
    first.unmount();

    const oos = setup({ scenario: 'outOfScope' });
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={oos.port} />);
    await ask('환불해 줘');
    expect(await screen.findByText('처리 요청은 할 수 없어요')).toBeInTheDocument();
    expect(screen.queryByTestId('answer-text')).not.toBeInTheDocument();
  });

  it('권한 거절(403)·색인 없음(422 CONFIG_REQUIRED)은 거절로 확정해 보이고 "근거 없음"으로 바꾸지 않는다', async () => {
    const denied = setup({ scenario: 'forbidden' });
    const first = render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={denied.port} />);
    await ask('질문');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-state', 'rejected');
    expect(alert).toHaveAttribute('data-code', 'FORBIDDEN');
    expect(screen.queryByText('근거 문서를 찾지 못했어요')).not.toBeInTheDocument();
    first.unmount();

    const cfg = setup({ scenario: 'configRequired' });
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={cfg.port} />);
    await ask('질문');
    const a2 = await screen.findByRole('alert');
    expect(a2).toHaveAttribute('data-code', 'CONFIG_REQUIRED');
    expect(screen.getByText(/문서 색인 전/)).toBeInTheDocument();
  });

  it('질의 중 503(결과 불명): 실패·완료로 단정하지 않고 "결과 확인" — 같은 키로만 다시 보낸다', async () => {
    const { port, keys } = setup({ scenario: 'unavailable' });
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={port} />);
    const user = await ask('질문');
    expect(await screen.findByText('처리 결과를 확인하고 있어요')).toBeInTheDocument();
    expect(screen.queryByText('근거 문서를 찾지 못했어요')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '질문 보내기' })).toBeDisabled(); // 새 키로 보내지 않는다
    await user.click(screen.getByRole('button', { name: '같은 요청으로 결과 확인' }));
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('202 처리 중: 완료로 보이지 않고 같은 키로 다시 확인하면 그때 답변을 받는다', async () => {
    const { port, keys, mock } = setup({ scenario: 'processingOnce' });
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={port} />);
    const user = await ask('오래 걸리는 질문');
    expect(await screen.findByText('처리 결과를 확인하고 있어요')).toBeInTheDocument();
    expect(screen.queryByTestId('answer-text')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '같은 요청으로 결과 확인' }));
    expect(await screen.findByTestId('answer-text')).toBeInTheDocument();
    expect(keys).toEqual([keys[0], keys[0]]);
    expect(mock.received).toHaveLength(1);
  });

  it('응답 유실 뒤 복구: 같은 Idempotency-Key 재전송으로 서버가 이미 만든 답변을 받는다(새로 만들지 않음)', async () => {
    const { port, keys, mock } = setup({ scenario: 'lostOnce' });
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={port} />);
    const user = await ask('유실 시험');
    expect(await screen.findByText('처리 결과를 확인하고 있어요')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '같은 요청으로 결과 확인' }));

    expect(await screen.findByTestId('answer-text')).toBeInTheDocument();
    expect(keys).toEqual([keys[0], keys[0]]);
    expect(mock.received).toHaveLength(1); // 서버 처리는 한 번
    expect(await historyHrefs()).toEqual(['/assistant/answers/ans-mock-1']);
  });

  it('중복 전송: 진행 중 다시 눌러도 한 번만 보낸다', async () => {
    const { port, mock } = setup({ delayMs: 30 });
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={port} />);
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: '질문' }), '한 번만');
    const button = screen.getByRole('button', { name: '질문 보내기' });
    await user.click(button);
    await user.click(button);
    await user.keyboard('{Enter}');
    expect(await screen.findByTestId('answer-text')).toBeInTheDocument();
    expect(mock.received).toHaveLength(1);
  });

  it('내 질문 목록: 최근 순, 다음 페이지는 "더 보기"(서버 커서)', async () => {
    const { port } = setup({ pageSize: 1 });
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={port} />);
    const user = await ask('첫 질문');
    await screen.findByTestId('answer-text');
    await user.click(screen.getByRole('button', { name: '새 질문' }));
    await user.type(screen.getByRole('textbox', { name: '질문' }), '둘째 질문');
    await user.click(screen.getByRole('button', { name: '질문 보내기' }));
    await screen.findByRole('link', { name: '답변 번호 ans-mock-2' });

    expect(await historyHrefs()).toEqual(['/assistant/answers/ans-mock-2']);
    expect(screen.getAllByTestId('history-item')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '더 보기' }));
    expect(await historyHrefs(2)).toEqual(['/assistant/answers/ans-mock-2', '/assistant/answers/ans-mock-1']);
    expect(screen.getAllByTestId('history-item')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument();
  });

  it('내 질문 목록 조회 실패는 "기록 없음"이 아니라 오류로 보인다', async () => {
    const { port } = setup();
    const broken: AssistantPort = { ...port, history: () => Promise.reject(new Error('down')) };
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={broken} />);
    expect(await screen.findByRole('alert')).toHaveAttribute('data-state', 'error');
    expect(screen.queryByText('아직 질문한 기록이 없어요.')).not.toBeInTheDocument();
  });

  it('계정 전환: 이전 사용자의 질문·답변·목록을 화면에서 지운다', async () => {
    const { port } = setup();
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={port} />);
    await ask('A 의 질문');
    expect(await screen.findByTestId('answer-text')).toBeInTheDocument();
    expect(await screen.findByTestId('history-item')).toBeInTheDocument();

    act(() => {
      tokens.accessToken = as.approver;
    });
    expect(await screen.findByText('아직 질문한 기록이 없어요.')).toBeInTheDocument();
    expect(screen.queryByText(/A 의 질문/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('answer-text')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-item')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '질문' })).toHaveValue('');
  });

  it('답변 다시 보기: 남의 답변·없는 번호는 오류로 보이고 "근거 문서를 찾지 못했어요"로 바꾸지 않는다', async () => {
    const { port } = setup();
    render(<App memory initialPath="/assistant/answers/ans-mock-999" initialToken={as.md} assistantPort={port} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-state', 'error');
    expect(screen.queryByText('근거 문서를 찾지 못했어요')).not.toBeInTheDocument();
  });

  it('답변 다시 보기: 내 답변은 근거와 함께 다시 연다', async () => {
    const { port } = setup();
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={port} />);
    const user = await ask('다시 볼 질문');
    await screen.findByTestId('answer-text');
    await user.click(screen.getByRole('link', { name: '답변 번호 ans-mock-1' }));
    expect(await screen.findByRole('heading', { name: '업무 도우미 답변' })).toBeInTheDocument();
    expect(await screen.findByTestId('answer-text')).toHaveTextContent('[목 답변]');
    expect(screen.getAllByTestId('citation')).toHaveLength(3);
  });

  it('답변 다시 보기: 처리 중이면 "답변을 만드는 중" + 다시 확인 → 완료 답변', async () => {
    const { IdempotencyKey } = await import('../../api/command');
    const mock = createDraftAssistantMock({ script: () => 'processingOnce' });
    tokens.accessToken = as.md;
    const first = await mock.ask('q', IdempotencyKey.generate());
    expect(first.state).toBe('PROCESSING');
    // 목은 다음 조회부터 완료 — 화면 시험을 위해 처리 중 한 번을 더 만든다
    const port: AssistantPort = {
      ...mock,
      get: (() => {
        let n = 0;
        return (id: string) => (n++ === 0 ? Promise.resolve(first) : mock.get(id));
      })(),
    };
    render(<App memory initialPath={`/assistant/answers/${first.answerId}`} initialToken={as.md} assistantPort={port} />);
    expect(await screen.findByText('답변을 만드는 중이에요')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '다시 확인' }));
    expect(await screen.findByTestId('answer-text')).toBeInTheDocument();
  });

  it('연결하지 않은 구성(notConnected): 호출하지 않고 "아직 연결되지 않았어요"만 보인다', async () => {
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={notConnectedAssistant} />);
    expect(await screen.findByText('업무 도우미는 아직 서버에 연결되지 않았어요')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '질문' })).not.toBeInTheDocument();
  });

  it('메뉴는 권한과 관계없이 보인다(권한은 서버 판정)', async () => {
    const { port } = setup();
    render(<App memory initialPath="/assistant" initialToken={as.center} assistantPort={port} />);
    expect(await screen.findByRole('link', { name: '업무 도우미' })).toBeInTheDocument();
  });
});

describe('업무 도우미 — 내 질문 목록에 질문 보이기(2026-11-19)', () => {
  it('이 탭에서 물은 질문은 목록 제목으로, 오늘 묶음 아래, 방금 받은 답은 강조 — 답변 다시 보기에도 질문', async () => {
    const { port } = setup();
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={port} />);
    const user = await ask('반품 기한은 며칠인가요?');
    await screen.findByTestId('answer-text');
    const row = await screen.findByTestId('history-item');
    expect(within(row).getByTestId('history-question')).toHaveTextContent('반품 기한은 며칠인가요?');
    expect(within(row).getByText(/\[목 답변\]/)).toBeInTheDocument(); // 답 앞부분은 아래 줄에
    expect(within(row).getByRole('link')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('history-day')).toHaveTextContent('오늘');
    await user.click(within(row).getByRole('link'));
    expect(await screen.findByText('Q. 반품 기한은 며칠인가요?')).toBeInTheDocument(); // 답변 다시 보기 화면의 질문 말풍선
  });

  it('다른 탭·예전 질문(이 탭에 기억 없음, 서버 question null)은 질문 글 없음이라 밝히고 답 앞부분으로', async () => {
    const { port } = setup();
    const { unmount } = render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={port} />);
    await ask('지워질 질문');
    await screen.findByTestId('answer-text');
    unmount();
    sessionStorage.clear(); // 새 탭
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={port} />);
    const row = await screen.findByTestId('history-item');
    expect(within(row).getByTestId('history-question-unknown')).toHaveTextContent('질문 글 없음');
    expect(within(row).queryByText('지워질 질문')).not.toBeInTheDocument();
  });

  it('서버가 question 을 주면 서버 값이 먼저', async () => {
    const { port } = setup();
    const withQ: AssistantPort = {
      ...port,
      history: async (c) => {
        const page = await port.history(c);
        return { ...page, items: page.items.map((h) => ({ ...h, question: '서버에 저장된 질문' })) };
      },
    };
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={withQ} />);
    await ask('탭에서 물은 질문');
    await screen.findByTestId('answer-text');
    expect(await screen.findByTestId('history-question')).toHaveTextContent('서버에 저장된 질문');
  });
});

describe('업무 도우미 — 출처 경로·계약 대조', () => {
  it('파일시스템 절대 경로·URL·상위 경로는 표시하지 않는다', () => {
    for (const bad of ['C:\\docs\\a.md', 'C:/docs/a.md', '/srv/rag/a.md', '\\\\host\\a', '~/a.md', 'file:///a', 'https://x', 'a/../b'])
      expect(isDisplayablePath(bad)).toBe(false);
    for (const ok of ['docs/business/overview.md', 'docs/adr/0036-x.md', 'contracts/states/order.md'])
      expect(isDisplayablePath(ok)).toBe(true);
  });

  it('저장소 상대 경로가 아닌 출처는 화면에서 가린다', async () => {
    const port: AssistantPort = {
      ...createDraftAssistantMock(),
      ask: () => Promise.resolve(answerFromWire(wireAnswer({ citations: [wireCitation('C:\\pmart\\secret\\policy.md')] }))),
    };
    render(<App memory initialPath="/assistant" initialToken={as.md} assistantPort={port} />);
    await ask('q');
    expect(await screen.findByText('표시할 수 없는 출처 경로(저장소 상대 경로가 아님)')).toBeInTheDocument();
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
  });

  it('응답 변환: 계약 필수 값이 없거나 enum 밖이면 빈 값으로 메우지 않고 계약 위반', () => {
    const bad = (o: Record<string, unknown>) => () => answerFromWire({ ...wireAnswer(), ...o });
    expect(bad({ answerId: undefined })).toThrow(/CONTRACT_VIOLATION|answerId/);
    expect(bad({ requestId: undefined })).toThrow(/CONTRACT_VIOLATION|requestId/);
    expect(bad({ state: 'MAYBE' })).toThrow(/CONTRACT_VIOLATION|state/);
    expect(bad({ answerMode: undefined })).toThrow(/CONTRACT_VIOLATION|answerMode/);
    expect(bad({ citations: undefined })).toThrow(/CONTRACT_VIOLATION|citations/);
    expect(bad({ citations: [{ ...wireCitation('docs/a.md'), authority: 'MAYBE' }] })).toThrow(/CONTRACT_VIOLATION|authority/);
    // 선택 값이 빠져도 읽힌다(null·빈 목록으로)
    const c = answerFromWire(wireAnswer({ citations: [wireCitation('docs/a.md')] })).citations[0]!;
    expect(c).toMatchObject({ supersededBy: null, proposedSupersededBy: [], implementationEvidence: null, documentVersion: null });
    expect(c.asOf).toEqual({ snapshotId: 'IDX-1', sourceRevision: null, sourceDirty: false, indexedAt: '2026-11-04T07:00:00Z' });
  });

  it('질문 목록 변환: question 은 null 그대로, nextCursor 없으면 끝', () => {
    const page = historyFromWire({
      items: [{ answerId: 'a', requestId: 'k', state: 'ANSWERED', askedAt: '2026-11-04T07:10:00Z', question: null, answerPreview: '앞부분' }],
      page: { nextCursor: null },
    });
    expect(page.items[0]).toMatchObject({ question: null, answerPreview: '앞부분', citationCount: null });
    expect(page.nextCursor).toBeNull();
  });

  it('목의 멱등 규칙(_common IdempotencyKey): 같은 키·다른 질문은 409 IDEMPOTENCY_CONFLICT', async () => {
    const mock = createDraftAssistantMock();
    tokens.accessToken = as.md;
    const { IdempotencyKey } = await import('../../api/command');
    const key = IdempotencyKey.generate();
    const a = await mock.ask('q1', key);
    expect(a.requestId).toBe(key.value);
    expect((await mock.ask('q1', key)).answerId).toBe(a.answerId);
    await expect(mock.ask('q2', key)).rejects.toMatchObject({ problem: { code: 'IDEMPOTENCY_CONFLICT', status: 409 } });
    tokens.accessToken = null;
  });
});

describe('업무 도우미 — 계정 전환 뒤 이전 답변', () => {
  it('다른 계정은 이전 사용자의 답변 번호를 조회할 수 없고(NOT_FOUND), 캐시된 답변도 보이지 않는다', async () => {
    const { IdempotencyKey } = await import('../../api/command');
    const mock = createDraftAssistantMock();
    tokens.accessToken = as.md;
    const mine = await mock.ask('A 만의 질문', IdempotencyKey.generate());
    tokens.accessToken = as.approver;
    await expect(mock.get(mine.answerId)).rejects.toMatchObject({ problem: { code: 'NOT_FOUND' } });
    expect((await mock.history()).items).toHaveLength(0);
    tokens.accessToken = null;

    // 화면: A 로 답변을 연 뒤(캐시) B 로 바뀌면 그 답변 화면은 다시 조회해 오류로 보인다
    tokens.accessToken = as.md;
    render(<App memory initialPath={`/assistant/answers/${mine.answerId}`} initialToken={as.md} assistantPort={mock} />);
    expect(await screen.findByTestId('answer-text')).toBeInTheDocument();
    act(() => {
      tokens.accessToken = as.approver;
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-state', 'error');
    expect(screen.queryByTestId('answer-text')).not.toBeInTheDocument();
  });
});
