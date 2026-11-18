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
import { AnswerView, BotAvatar } from './AnswerView';
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
    <li className="space-y-1 px-4 py-3 hover:bg-base-200/50" data-testid="history-item">
      <p className="line-clamp-2 text-sm text-base-content/85">{label ?? m.assistant.noPreview}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`badge badge-sm badge-soft ${HISTORY_TONE[h.state] ?? 'badge-ghost'}`}>{m.assistant.state[h.state]}</span>
        {h.citationCount !== null && <span className="text-base-content/55">{m.assistant.citationCount(h.citationCount)}</span>}
        <span className="text-base-content/55">{formatSeoul(h.askedAt)}</span>
      </div>
      <Link className="font-mono text-xs text-primary hover:underline" to={`/assistant/answers/${encodeURIComponent(h.answerId)}`}>
        {h.answerId}
      </Link>
    </li>
  );
}

/** 질문 목록 상태 색(이름이 있는 상태만) */
const HISTORY_TONE: Readonly<Record<string, string>> = {
  ANSWERED: 'badge-success',
  NO_GROUNDING: 'badge-warning',
  REALTIME_DATA_REQUIRED: 'badge-info',
  OUT_OF_SCOPE: 'badge-info',
  FORBIDDEN_SCOPE: 'badge-error',
  PROCESSING: 'badge-ghost',
};

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
    // 옆 칸 카드(2026-11-18) — 대화 앱의 지난 대화 목록처럼
    <section className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
      <div className="space-y-0.5 border-b border-base-300 px-4 py-3">
        <h2 className="font-semibold">{m.assistant.history}</h2>
        <p className="text-xs text-base-content/55">{m.assistant.historyNote}</p>
      </div>
      {query.isError && items.length === 0 ? (
        <div className="p-3">
          <QueryState state={uiStateFromError(query.error)} onRetry={() => void query.refetch()}>
            {() => null}
          </QueryState>
        </div>
      ) : query.isPending ? (
        <div className="p-3">
          <QueryState state={{ kind: 'loading' }}>{() => null}</QueryState>
        </div>
      ) : items.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-base-content/60">{m.assistant.historyEmpty}</p>
      ) : (
        <>
          <ul className="divide-y divide-base-300/70">
            {items.map((h) => (
              <HistoryRow key={h.answerId} h={h} />
            ))}
          </ul>
          {(query.isFetchNextPageError || query.hasNextPage) && (
            <div className="space-y-2 border-t border-base-300 px-4 py-3">
              {query.isFetchNextPageError && <p className="text-sm text-error">{m.assistant.historyMoreFailed}</p>}
              {query.hasNextPage && (
                <button type="button" className="btn btn-sm w-full" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                  {m.assistant.historyMore}
                </button>
              )}
            </div>
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

  const showNew = ask.phase.kind !== 'idle' && !locked;
  return (
    // 대화형(2026-11-18): 왼쪽 = 대화 카드(위 답변 줄 · 아래 질문 입력), 오른쪽 = 내 질문 목록
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <div className="min-w-0 overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm lg:col-span-2">
        <div className="min-h-64 space-y-4 bg-base-200/30 p-4">
          {ask.phase.kind === 'idle' ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-base-content/60" data-state="idle">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z" />
                </svg>
              </span>
              {m.assistant.emptyThread}
            </div>
          ) : ask.phase.kind === 'running' ? (
            <div role="status" className="flex items-center gap-2 text-sm">
              <BotAvatar />
              <span className="flex items-center gap-2 rounded-box bg-base-100 px-4 py-3 shadow-sm">
                <span className="loading loading-dots loading-sm" />
                {m.assistant.asking}
              </span>
            </div>
          ) : (
            <CommandFeedback command={ask} unknown={{ body: m.assistant.unknownBody }}>
              {(answer: AssistantAnswer) => <AnswerView answer={answer} {...(answeredQuestion ? { question: answeredQuestion } : {})} linkToDetail />}
            </CommandFeedback>
          )}
        </div>

        <form
          className="space-y-2 border-t border-base-300 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) void ask.run({ q: trimmed });
          }}
        >
          {port.mockHints && <p className="text-xs opacity-60">{m.assistant.mockTags(port.mockHints.join(' '))}</p>}
          <label className="block">
            <span className="text-sm font-bold">{m.assistant.questionLabel}</span>
            <textarea
              className="textarea mt-1 w-full resize-y"
              rows={3}
              maxLength={MAX_QUESTION}
              placeholder={m.assistant.questionPlaceholder}
              value={question}
              disabled={locked}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <div className="flex items-center gap-2">
            <span className="mr-auto text-xs opacity-60">{m.assistant.counter(question.length, MAX_QUESTION)}</span>
            {showNew && (
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
            <button type="submit" className="btn btn-primary btn-sm" disabled={!canSend}>
              {m.assistant.send}
            </button>
          </div>
        </form>
      </div>

      <History />
    </div>
  );
}

export function AssistantPage() {
  const { port, owner } = useAssistant();
  return (
    <section className="max-w-6xl space-y-4">
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
    <section className="max-w-4xl space-y-4">
      <Header />
      <Link className="inline-flex items-center gap-1 text-sm text-base-content/60 hover:text-base-content" to="/assistant">
        <span aria-hidden="true">‹</span>
        {m.assistant.back}
      </Link>
      <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
        <h2 className="border-b border-base-300 px-5 py-3 font-semibold">{m.assistant.detailTitle}</h2>
        <div className="bg-base-200/30 p-4">
          {port.connected ? (
            <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
              {(answer) => <AnswerView answer={answer} onRecheck={() => void query.refetch()} />}
            </QueryState>
          ) : (
            <NotConnected />
          )}
        </div>
      </div>
    </section>
  );
}
