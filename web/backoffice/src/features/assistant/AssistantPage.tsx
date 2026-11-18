// 업무 도우미(BO 내부 운영자용 정책·업무 절차 질의응답). 읽기 전용 — 어떤 도메인 변경 버튼·자동 실행도 두지 않는다.
// 질의는 useCommand: 새 전송 = 새 Idempotency-Key. 결과 불명(타임아웃·503·응답 유실)과 202 처리 중은
// 실패로 단정하지 않고 같은 키·같은 질문으로 다시 확인한다(계약: 같은 키 재전송 = 같은 답).
// 권한 판정은 서버(403 / 404). 메뉴를 숨겨 대신하지 않는다.
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { UnknownResultFailure } from '@pmart/web-core';
import { formatSeoul } from '@pmart/web-ui';
import { messages as m } from '../../shared/messages';
import { QueryState, uiStateFromError } from '@pmart/web-ui';
import { CommandFeedback } from '../../shared/Feedback';
import { toUiState } from '@pmart/web-ui';
import { useCommand } from '@pmart/web-ui';
import { assistantQueryKey, useAssistant } from './AssistantContext';
import { AnswerView } from './AnswerView';
import type { AssistantAnswer, HistoryItem } from './model';
import { PageHeader } from '../../shared/admin';

const MAX_QUESTION = 2000; // 계약 PolicyQuestion.question maxLength

function NotConnected() {
  return (
    <div role="status" data-state="not-connected" className="alert alert-info alert-soft flex-col items-start">
      <span className="font-bold">{m.assistant.notConnectedTitle}</span>
      <span>{m.assistant.notConnectedBody}</span>
    </div>
  );
}

function Header() {
  const { port } = useAssistant();
  return (
    <>
      <PageHeader
        title={
          <>
            {m.assistant.title}
            {port.mock && <span className="badge badge-warning ml-2 align-middle">{m.assistant.mockBadge}</span>}
          </>
        }
        description={m.assistant.intro}
      />
    </>
  );
}

function HistoryRow({ h }: { readonly h: HistoryItem }) {
  const label = h.question ?? h.answerPreview;
  return (
    <li className="flex flex-wrap items-center gap-2" data-testid="history-item">
      <Link className="link" to={`/assistant/answers/${encodeURIComponent(h.answerId)}`}>
        {h.answerId}
      </Link>
      <span className="badge badge-ghost badge-sm">{m.assistant.state[h.state]}</span>
      <span className="text-xs opacity-60">{formatSeoul(h.askedAt)}</span>
      {h.citationCount !== null && <span className="text-xs opacity-60">{m.assistant.citationCount(h.citationCount)}</span>}
      <span className="w-full truncate opacity-80">{label ?? m.assistant.noPreview}</span>
    </li>
  );
}

/** 내 질문 목록(서버, 최근 순). 조회 실패는 "질문 없음"이 아니라 오류로 보인다. */
function History() {
  const { port, owner } = useAssistant();
  const query = useInfiniteQuery({
    queryKey: assistantQueryKey(owner, 'history'),
    queryFn: ({ pageParam }) => port.history(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section className="space-y-2">
      <h2 className="font-bold">{m.assistant.history}</h2>
      <p className="text-xs opacity-60">{m.assistant.historyNote}</p>
      {query.isError && items.length === 0 ? (
        <QueryState state={uiStateFromError(query.error)} onRetry={() => void query.refetch()}>
          {() => null}
        </QueryState>
      ) : query.isPending ? (
        <QueryState state={{ kind: 'loading' }}>{() => null}</QueryState>
      ) : items.length === 0 ? (
        <p className="text-sm text-base-content/60">{m.assistant.historyEmpty}</p>
      ) : (
        <>
          <ul className="space-y-2 text-sm">
            {items.map((h) => (
              <HistoryRow key={h.answerId} h={h} />
            ))}
          </ul>
          {query.isFetchNextPageError && <p className="text-sm text-error">{m.assistant.historyMoreFailed}</p>}
          {query.hasNextPage && (
            <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              {m.assistant.historyMore}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function AskView() {
  const { port, owner } = useAssistant();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState('');

  const [answeredQuestion, setAnsweredQuestion] = useState<string | null>(null);
  const ask = useCommand(async ({ q }: { q: string }, key) => {
    try {
      const answer = await port.ask(q, key);
      // 202 처리 중: 아직 결과가 아니다 — 결과 불명으로 두고 같은 키로 다시 확인한다
      if (answer.state === 'PROCESSING') throw new UnknownResultFailure(answer, answer.requestId);
      setAnsweredQuestion(q);
      return answer;
    } finally {
      void queryClient.invalidateQueries({ queryKey: assistantQueryKey(owner, 'history') });
    }
  });

  const trimmed = question.trim();
  const locked = ask.busy; // 진행 중·결과 불명이면 질문을 바꾸거나 새로 보내지 않는다(같은 키 재확인만)
  // 방금 답을 받은 질문을 그대로 다시 누르면 새 키로 중복 질의가 된다 — 질문을 고치거나 "새 질문"으로 시작한다
  const answeredSame = ask.phase.kind === 'done' && answeredQuestion === trimmed;
  const canSend = trimmed.length > 0 && trimmed.length <= MAX_QUESTION && !locked && !answeredSame;

  return (
    <>
      {port.mockHints && <p className="text-xs opacity-60">{m.assistant.mockTags(port.mockHints.join(' '))}</p>}

      <form
        className="space-y-2 rounded-box border border-base-300 bg-base-100 shadow-sm p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) void ask.run({ q: trimmed });
        }}
      >
        <label className="block">
          <span className="text-sm font-bold">{m.assistant.questionLabel}</span>
          <textarea
            className="textarea mt-1 w-full"
            rows={3}
            maxLength={MAX_QUESTION}
            placeholder={m.assistant.questionPlaceholder}
            value={question}
            disabled={locked}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        <div className="flex items-center gap-2">
          <button type="submit" className="btn btn-primary btn-sm" disabled={!canSend}>
            {m.assistant.send}
          </button>
          {ask.phase.kind !== 'idle' && !locked && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                ask.reset();
                setQuestion('');
              }}
            >
              {m.assistant.newQuestion}
            </button>
          )}
          <span className="ml-auto text-xs opacity-60">{m.assistant.counter(question.length, MAX_QUESTION)}</span>
        </div>
      </form>

      {ask.phase.kind === 'running' ? (
        <div role="status" className="flex items-center gap-2 text-sm">
          <span className="loading loading-spinner loading-sm" />
          {m.assistant.asking}
        </div>
      ) : (
        <CommandFeedback command={ask} unknown={{ body: m.assistant.unknownBody }}>
          {(answer: AssistantAnswer) => <AnswerView answer={answer} {...(answeredQuestion ? { question: answeredQuestion } : {})} linkToDetail />}
        </CommandFeedback>
      )}

      <History />
    </>
  );
}

export function AssistantPage() {
  const { port, owner } = useAssistant();
  return (
    <section className="max-w-3xl space-y-4">
      <Header />
      {/* 계정이 바뀌면 질문·명령 상태를 새로 시작한다(이전 사용자 질문이 남지 않게) */}
      {port.connected ? <AskView key={owner ?? '-'} /> : <NotConnected />}
    </section>
  );
}

/** 답변 다시 보기(GET). 조회 실패는 "근거 없음"이 아니라 오류로 보인다. 처리 중이면 다시 확인. */
export function AssistantAnswerPage() {
  const { answerId = '' } = useParams();
  const { port, owner } = useAssistant();
  const query = useQuery({
    queryKey: assistantQueryKey(owner, 'answer', answerId),
    queryFn: () => port.get(answerId),
    enabled: port.connected,
  });
  return (
    <section className="max-w-3xl space-y-4">
      <Header />
      <h2 className="font-bold">{m.assistant.detailTitle}</h2>
      {port.connected ? (
        <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
          {(answer) => <AnswerView answer={answer} onRecheck={() => void query.refetch()} />}
        </QueryState>
      ) : (
        <NotConnected />
      )}
      <Link className="link text-sm" to="/assistant">
        {m.assistant.back}
      </Link>
    </section>
  );
}
