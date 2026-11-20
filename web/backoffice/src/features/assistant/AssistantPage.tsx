// 업무 도우미(BO 내부 운영자용 정책·업무 절차 질의응답). 읽기 전용 — 어떤 도메인 변경 버튼·자동 실행도 두지 않는다.
// 질의는 useCommand: 새 전송 = 새 Idempotency-Key. 결과 불명(타임아웃·503·응답 유실)과 202 처리 중은
// 실패로 단정하지 않고 같은 키·같은 질문으로 다시 확인한다(계약: 같은 키 재전송 = 같은 답).
// 권한 판정은 서버(403 / 404). 메뉴를 숨겨 대신하지 않는다.
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { UnknownResultFailure } from '@pmart/web-core';
import { formatSeoul, formatSeoulDate } from '@pmart/web-ui';
import { messages as m } from '../../shared/messages';
import { QueryState, uiStateFromError } from '@pmart/web-ui';
import { CommandFeedback } from '../../shared/Feedback';
import { toUiState } from '@pmart/web-ui';
import { useCommand } from '@pmart/web-ui';
import { assistantQueryKey, useAssistant } from './AssistantContext';
import { AnswerView, BotAvatar } from './AnswerView';
import type { AssistantAnswer, HistoryItem } from './model';
import { askedQuestion, rememberQuestion } from './askedQuestions';
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
      />
    </>
  );
}

/** 질문 목록 상태 점 색(이름이 있는 상태만) */
const HISTORY_DOT: Readonly<Record<string, string>> = {
  ANSWERED: 'bg-success',
  NO_GROUNDING: 'bg-warning',
  REALTIME_DATA_REQUIRED: 'bg-info',
  OUT_OF_SCOPE: 'bg-info',
  FORBIDDEN_SCOPE: 'bg-error',
  PROCESSING: 'bg-base-content/30',
};

const seoulTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' });
const seoulMonthDay = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' });

/** 날짜 묶음 이름(표시 전용): 오늘·어제·"11월 17일 (월)" */
function dayLabel(iso: string, now: Date): string {
  const d = formatSeoulDate(iso);
  if (d === formatSeoulDate(now.toISOString())) return m.assistant.today;
  if (d === formatSeoulDate(new Date(now.getTime() - 86_400_000).toISOString())) return m.assistant.yesterday;
  return seoulMonthDay.format(new Date(iso));
}

/**
 * 질문 한 줄(2026-11-19 사용자 "전에 한 질문이 뭔지 안 보여 — 직관적이고 간지나게"):
 * 제목 = 질문(서버 값 → 이 탭에서 기억한 값). 질문을 모르면 그렇다고 밝히고 답 앞부분을 제목처럼 쓴다.
 * 줄 전체가 답변 다시 보기 링크.
 */
function HistoryRow({ h, question, active }: { readonly h: HistoryItem; readonly question: string | null; readonly active: boolean }) {
  return (
    <li data-testid="history-item">
      <Link
        to={`/assistant/answers/${encodeURIComponent(h.answerId)}`}
        className={`group relative flex gap-3 px-4 py-3 transition-colors hover:bg-primary/5 ${active ? 'bg-primary/5' : ''}`}
        aria-current={active ? 'true' : undefined}
      >
        <span className={`absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`} aria-hidden="true" />
        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${question ? 'bg-primary text-primary-content' : 'bg-base-200 text-base-content/50'}`} aria-hidden="true">
          Q
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          {question ? (
            <span className="line-clamp-2 text-sm font-semibold text-base-content" data-testid="history-question">
              {question}
            </span>
          ) : (
            <span className="block text-xs italic text-base-content/45" data-testid="history-question-unknown">
              {m.assistant.questionUnknown}
            </span>
          )}
          <span className={`flex gap-1.5 text-xs text-base-content/60 ${question ? 'line-clamp-1' : ''}`}>
            <span className="shrink-0 font-bold text-base-content/35" aria-hidden="true">
              A
            </span>
            <span className={question ? 'truncate' : 'line-clamp-2 text-sm text-base-content/80'}>{h.answerPreview ?? m.assistant.noPreview}</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-base-content/50">
            <span className="inline-flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${HISTORY_DOT[h.state] ?? 'bg-base-content/30'}`} aria-hidden="true" />
              {m.assistant.state[h.state]}
            </span>
            {h.citationCount !== null && <span>{m.assistant.citationCount(h.citationCount)}</span>}
            <span className="ml-auto tabular-nums" title={formatSeoul(h.askedAt)}>
              {seoulTime.format(new Date(h.askedAt))}
            </span>
          </span>
        </span>
      </Link>
    </li>
  );
}

/** 내 질문 목록(서버, 최근 순). 조회 실패는 "질문 없음"이 아니라 오류로 보인다. */
function History({ activeId }: { readonly activeId: string | null }) {
  const { port, owner } = useAssistant();
  const query = useInfiniteQuery({
    queryKey: assistantQueryKey(owner, 'history'),
    queryFn: ({ pageParam }) => port.history(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  // 날짜별 묶음(서버 순서 그대로 — 최근 순, 같은 날이 이어지는 동안 한 묶음)
  const now = new Date();
  const groups: { label: string; rows: HistoryItem[] }[] = [];
  for (const h of items) {
    const label = dayLabel(h.askedAt, now);
    const last = groups.at(-1);
    if (last?.label === label) last.rows.push(h);
    else groups.push({ label, rows: [h] });
  }
  return (
    // 옆 칸 카드(2026-11-18) — 대화 앱의 지난 대화 목록처럼
    <section className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm lg:sticky lg:top-4">
      <div className="flex items-start gap-2 border-b border-base-300 bg-gradient-to-br from-primary/10 to-transparent px-4 py-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8v4l2.5 1.5M21 12a9 9 0 1 1-2.6-6.4M21 4v4h-4" />
          </svg>
        </span>
        <div className="min-w-0 space-y-0.5">
          <h2 className="flex items-center gap-2 font-semibold">
            {m.assistant.history}
            {items.length > 0 && <span className="badge badge-sm badge-ghost tabular-nums">{query.hasNextPage ? `${items.length}+` : items.length}</span>}
          </h2>
        </div>
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
          <div className="max-h-[70vh] overflow-y-auto">
            {groups.map((g) => (
              <div key={g.label} data-testid="history-day">
                <p className="sticky top-0 z-10 border-b border-base-300/60 bg-base-100/95 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-base-content/45 backdrop-blur">{g.label}</p>
                <ul className="divide-y divide-base-300/50">
                  {g.rows.map((h) => (
                    <HistoryRow key={h.answerId} h={h} question={h.question ?? askedQuestion(owner, h.answerId)} active={h.answerId === activeId} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
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
  const [lastAnswerId, setLastAnswerId] = useState<string | null>(null);
  const ask = useCommand(async ({ q }: { q: string }, key) => {
    try {
      const answer = await port.ask(q, key);
      // 서버가 답변 ID 를 준 질문만 이 탭에 기억한다(처리 중이어도 같은 답변 — 목록에서 질문으로 보이게)
      rememberQuestion(owner, answer.answerId, q);
      setLastAnswerId(answer.answerId);
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

      <History activeId={ask.phase.kind === 'idle' ? null : lastAnswerId} />
    </div>
  );
}

export function AssistantPage() {
  const { port, owner } = useAssistant();
  return (
    <section className="space-y-4">
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
              {(answer) => {
                // 질문 원문은 서버에 없다 — 이 탭에서 물은 것만 함께 보인다(askedQuestions.ts)
                const q = askedQuestion(owner, answer.answerId);
                return <AnswerView answer={answer} onRecheck={() => void query.refetch()} {...(q ? { question: q } : {})} />;
              }}
            </QueryState>
          ) : (
            <NotConnected />
          )}
        </div>
      </div>
    </section>
  );
}
