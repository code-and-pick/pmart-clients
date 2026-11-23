// 업무 도우미(BO 내부 운영자용 정책·업무 절차 질의응답). 읽기 전용 — 어떤 도메인 변경 버튼·자동 실행도 두지 않는다(지우는 것은 내 채팅뿐).
// 채팅 세션(ai-assistant 1.3.0, ADR-0084, 2026-11-21 rag PC 4 요청): 왼쪽 대화 = 채팅 하나, 오른쪽 = 내 채팅 목록·새 채팅·지우기.
// 질의는 useCommand: 새 전송 = 새 Idempotency-Key. 결과 불명(타임아웃·503·응답 유실)과 202 처리 중은
// 실패로 단정하지 않고 같은 키·같은 질문으로 다시 확인한다(계약: 같은 키 재전송 = 같은 답).
// 권한 판정은 서버(403 / 404). 메뉴를 숨겨 대신하지 않는다.
import { type InfiniteData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { UnknownResultFailure } from '@pmart/web-core';
import { formatSeoul, formatSeoulDate } from '@pmart/web-ui';
import { messages as m } from '../../shared/messages';
import { QueryState, uiStateFromError } from '@pmart/web-ui';
import { CommandFeedback } from '../../shared/Feedback';
import { toUiState } from '@pmart/web-ui';
import { useCommand } from '@pmart/web-ui';
import { assistantQueryKey, useAssistant } from './AssistantContext';
import { AnswerView, BotAvatar } from './AnswerView';
import type { AssistantAnswer, ChatPage, ChatSession, ChatSummary } from './model';
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

const seoulTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' });
const seoulMonthDay = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' });

/** 날짜 묶음 이름(표시 전용): 오늘·어제·"11월 17일 (월)" */
function dayLabel(iso: string, now: Date): string {
  const d = formatSeoulDate(iso);
  if (d === formatSeoulDate(now.toISOString())) return m.assistant.today;
  if (d === formatSeoulDate(new Date(now.getTime() - 86_400_000).toISOString())) return m.assistant.yesterday;
  return seoulMonthDay.format(new Date(iso));
}

const chatPath = (sessionId: string) => `/assistant/chats/${encodeURIComponent(sessionId)}`;

/** 채팅 한 줄: 제목(서버 — 첫 질문 → 첫 답 앞부분) · 질문 수 · 마지막 질문 시각. 지우기 단추는 링크 밖. */
function ChatRow({ c, active, onDelete }: { readonly c: ChatSummary; readonly active: boolean; readonly onDelete: () => void }) {
  const title = c.title ?? m.assistant.chatUntitled;
  return (
    <li data-testid="chat-item" className="group relative flex items-stretch">
      <Link
        to={chatPath(c.sessionId)}
        className={`relative flex min-w-0 flex-1 gap-3 py-3 pl-4 pr-1 transition-colors hover:bg-primary/5 ${active ? 'bg-primary/5' : ''}`}
        aria-current={active ? 'true' : undefined}
      >
        <span className={`absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 space-y-1">
          <span className={`line-clamp-2 text-sm ${c.title ? 'font-semibold text-base-content' : 'italic text-base-content/50'}`} data-testid="chat-title">
            {title}
          </span>
          <span className="flex items-center gap-3 text-[11px] text-base-content/50">
            <span>{m.assistant.questionCount(c.questionCount)}</span>
            <span className="ml-auto tabular-nums" title={formatSeoul(c.lastAskedAt)}>
              {seoulTime.format(new Date(c.lastAskedAt))}
            </span>
          </span>
        </span>
      </Link>
      <button
        type="button"
        className="btn btn-ghost btn-xs btn-square my-auto mr-2 text-base-content/50 hover:text-error"
        aria-label={m.assistant.deleteChatNamed(title)}
        title={m.assistant.deleteChat}
        onClick={onDelete}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
        </svg>
      </button>
    </li>
  );
}

/** 지우기 확인(되돌릴 수 없음). 결과 불명이면 같은 키로 다시 확인한다(useCommand). */
function DeleteChat({ target, activeId, onClose }: { readonly target: ChatSummary; readonly activeId: string | null; readonly onClose: () => void }) {
  const { port, owner } = useAssistant();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const del = useCommand(async ({ sessionId }: { sessionId: string }, key) => {
    await port.deleteChat(sessionId, key);
    // 204 — 목록에서 빼고, 보고 있던 채팅이면 새 채팅 화면으로
    queryClient.setQueryData<InfiniteData<ChatPage>>(assistantQueryKey(owner, 'chats'), (d) =>
      d ? { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((i) => i.sessionId !== sessionId) })) } : d,
    );
    // 먼저 새 채팅 화면으로 옮긴 뒤 그 채팅 캐시를 지운다(보는 중에 지우면 다시 읽어 404 가 잠깐 보인다)
    if (sessionId === activeId) await navigate('/assistant');
    queryClient.removeQueries({ queryKey: assistantQueryKey(owner, 'chat', sessionId) });
    void queryClient.invalidateQueries({ queryKey: assistantQueryKey(owner, 'chats') });
    onClose();
    return null;
  });
  const title = target.title ?? m.assistant.chatUntitled;
  return (
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="chat-delete-title" data-testid="chat-delete-confirm">
      <div className="modal-box space-y-3">
        <h3 id="chat-delete-title" className="text-lg font-bold">
          {m.assistant.deleteConfirmTitle}
        </h3>
        <p className="line-clamp-2 text-sm font-semibold">{title}</p>
        <p className="text-sm text-base-content/75">{m.assistant.deleteConfirmBody(target.questionCount)}</p>
        {del.phase.kind !== 'idle' && del.phase.kind !== 'running' && <CommandFeedback command={del}>{() => null}</CommandFeedback>}
        <div className="modal-action">
          <button type="button" className="btn btn-sm btn-ghost" disabled={del.busy} onClick={onClose}>
            {m.assistant.deleteCancel}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-error"
            disabled={del.busy}
            onClick={() => {
              if (del.phase.kind === 'rejected') del.reset();
              void del.run({ sessionId: target.sessionId });
            }}
          >
            {m.assistant.deleteConfirm}
          </button>
        </div>
      </div>
      <button type="button" className="modal-backdrop" aria-hidden="true" tabIndex={-1} onClick={() => !del.busy && onClose()} />
    </div>
  );
}

/** 내 채팅 목록(서버, 마지막 질문 최근 순). 조회 실패는 "채팅 없음"이 아니라 오류로 보인다. */
function ChatList({ activeId }: { readonly activeId: string | null }) {
  const { port, owner } = useAssistant();
  const [deleting, setDeleting] = useState<ChatSummary | null>(null);
  const query = useInfiniteQuery({
    queryKey: assistantQueryKey(owner, 'chats'),
    queryFn: ({ pageParam }) => port.chats(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  // 날짜별 묶음(서버 순서 그대로 — 최근 순, 같은 날이 이어지는 동안 한 묶음)
  const now = new Date();
  const groups: { label: string; rows: ChatSummary[] }[] = [];
  for (const c of items) {
    const label = dayLabel(c.lastAskedAt, now);
    const last = groups.at(-1);
    if (last?.label === label) last.rows.push(c);
    else groups.push({ label, rows: [c] });
  }
  return (
    <section className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm lg:sticky lg:top-4" data-testid="chat-list">
      <div className="space-y-2 border-b border-base-300 bg-gradient-to-br from-primary/10 to-transparent px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            {m.assistant.chats}
            {items.length > 0 && <span className="badge badge-sm badge-ghost tabular-nums">{query.hasNextPage ? `${items.length}+` : items.length}</span>}
          </h2>
          <Link to="/assistant" className="btn btn-primary btn-xs ml-auto">
            <span aria-hidden="true">+</span>
            {m.assistant.newChat}
          </Link>
        </div>
        <p className="text-[11px] text-base-content/55" data-testid="chat-retention">
          {m.assistant.retention}
        </p>
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
        <p className="px-4 py-6 text-center text-sm text-base-content/60">{m.assistant.chatsEmpty}</p>
      ) : (
        <>
          <div className="max-h-[70vh] overflow-y-auto">
            {groups.map((g) => (
              <div key={g.label} data-testid="chat-day">
                <p className="sticky top-0 z-10 border-b border-base-300/60 bg-base-100/95 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-base-content/45 backdrop-blur">{g.label}</p>
                <ul className="divide-y divide-base-300/50">
                  {g.rows.map((c) => (
                    <ChatRow key={c.sessionId} c={c} active={c.sessionId === activeId} onDelete={() => setDeleting(c)} />
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
      {deleting && <DeleteChat target={deleting} activeId={activeId} onClose={() => setDeleting(null)} />}
    </section>
  );
}

/** 내 질문 말풍선(오른쪽). 질문 글을 모르면(서버 원문 미저장·다른 탭) 그렇다고 밝힌다. */
function QuestionBubble({ question }: { readonly question: string | null }) {
  return (
    <div className="flex justify-end">
      {question ? (
        <p className="max-w-[85%] whitespace-pre-wrap rounded-box rounded-br-none bg-primary px-4 py-2.5 text-sm text-primary-content shadow-sm" data-testid="chat-question">
          {`Q. ${question}`}
        </p>
      ) : (
        <p className="text-xs italic text-base-content/45" data-testid="chat-question-unknown">
          {m.assistant.questionUnknown}
        </p>
      )}
    </div>
  );
}

/**
 * 채팅 하나(2026-11-21, ai-assistant 1.3.0 채팅 세션 — ADR-0084).
 * sessionId 없음 = 새 채팅(질문을 sessionId 없이 보내고, 서버가 준 sessionId 의 채팅 화면으로 옮긴다).
 * 대화 = 서버 messages(질문 순) + 지금 보내는 질문 하나. 질문 글은 서버 question → 이 탭에서 기억한 값.
 */
function ChatView({ sessionId: routeId }: { readonly sessionId: string | null }) {
  const { port, owner } = useAssistant();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');
  const [sentQuestion, setSentQuestion] = useState<string | null>(null);
  /** 새 채팅에서 방금 만든 채팅으로 옮긴 경우 — 그때는 대화를 이어 보이고, 다른 채팅을 고르면 새로 시작한다 */
  const adopted = useRef<string | null>(null);
  /** 새 채팅에서 서버가 만든 채팅 — 주소가 바뀌기 전에도 그 채팅으로 보인다(같은 답이 두 번 그려지지 않게) */
  const [created, setCreated] = useState<string | null>(null);
  const sessionId = routeId ?? created;
  const chat = useQuery({
    queryKey: assistantQueryKey(owner, 'chat', sessionId ?? '-'),
    queryFn: () => port.chat(sessionId ?? ''),
    enabled: sessionId !== null,
  });

  const ask = useCommand(async ({ q }: { q: string }, key) => {
    try {
      const answer = await port.ask(q, key, sessionId);
      // 서버가 답변 ID 를 준 질문만 이 탭에 기억한다(서버가 question 을 주지 않을 때 쓰려고)
      rememberQuestion(owner, answer.answerId, q);
      // 202 처리 중: 아직 결과가 아니다 — 결과 불명으로 두고 같은 키로 다시 확인한다
      if (answer.state === 'PROCESSING') throw new UnknownResultFailure(answer, answer.requestId);
      setQuestion('');
      if (sessionId === null && answer.sessionId) {
        // 새 채팅: 받은 답으로 그 채팅을 먼저 채워 두고(옮긴 뒤 빈 화면·로딩이 깜박이지 않게) 서버 값으로 다시 읽는다
        const key = assistantQueryKey(owner, 'chat', answer.sessionId);
        queryClient.setQueryData<ChatSession>(key, { sessionId: answer.sessionId, createdAt: answer.askedAt, lastAskedAt: answer.askedAt, messages: [answer] });
        void queryClient.invalidateQueries({ queryKey: key });
        adopted.current = answer.sessionId;
        setCreated(answer.sessionId);
        void navigate(chatPath(answer.sessionId));
      } else if (sessionId !== null) await queryClient.invalidateQueries({ queryKey: assistantQueryKey(owner, 'chat', sessionId) });
      return answer;
    } finally {
      void queryClient.invalidateQueries({ queryKey: assistantQueryKey(owner, 'chats') });
    }
  });

  // 다른 채팅·새 채팅을 고르면 보내던 질문·결과를 지운다(방금 만든 채팅으로 옮긴 것은 이어 보인다)
  const shownFor = useRef(routeId);
  const { reset } = ask;
  useEffect(() => {
    if (shownFor.current === routeId) return;
    shownFor.current = routeId;
    if (routeId !== null && routeId === adopted.current) return;
    adopted.current = null;
    setCreated(null);
    reset();
    setQuestion('');
    setSentQuestion(null);
  }, [routeId, reset]);

  const messages = chat.data?.messages ?? [];
  const trimmed = question.trim();
  const locked = ask.busy; // 진행 중·결과 불명이면 질문을 바꾸거나 새로 보내지 않는다(같은 키 재확인만)
  const canSend = trimmed.length > 0 && trimmed.length <= MAX_QUESTION && !locked && !(sessionId !== null && chat.isError);
  // 방금 받은 답이 서버 대화에 들어왔으면 한 번만 보인다
  const phase = ask.phase;
  const doneShown = phase.kind === 'done' && messages.some((x) => x.answerId === phase.result.answerId);
  const showPending = phase.kind !== 'idle' && !doneShown;
  const empty = messages.length === 0 && !showPending;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-3 [&>*]:min-w-0">
      <div className="min-w-0 overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm lg:col-span-2">
        <div className="min-h-64 space-y-6 bg-base-200/30 p-4" data-testid="chat-thread">
          {sessionId !== null && chat.isPending ? (
            <QueryState state={{ kind: 'loading' }}>{() => null}</QueryState>
          ) : sessionId !== null && chat.isError ? (
            <QueryState state={uiStateFromError(chat.error)} onRetry={() => void chat.refetch()}>
              {() => null}
            </QueryState>
          ) : empty ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-base-content/60" data-state="idle">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z" />
                </svg>
              </span>
              {m.assistant.emptyThread}
            </div>
          ) : null}
          {messages.map((a) => (
            <div key={a.answerId} className="space-y-3" data-testid="chat-turn">
              <QuestionBubble question={a.question ?? askedQuestion(owner, a.answerId)} />
              <AnswerView answer={a} linkToDetail onRecheck={() => void chat.refetch()} />
            </div>
          ))}
          {showPending && (
            <div className="space-y-3" data-testid="chat-turn">
              <QuestionBubble question={sentQuestion} />
              {phase.kind === 'running' ? (
                <div role="status" className="flex items-center gap-2 text-sm">
                  <BotAvatar />
                  <span className="flex items-center gap-2 rounded-box bg-base-100 px-4 py-3 shadow-sm">
                    <span className="loading loading-dots loading-sm" />
                    {m.assistant.asking}
                  </span>
                </div>
              ) : (
                <CommandFeedback command={ask} unknown={{ body: m.assistant.unknownBody }}>
                  {(answer: AssistantAnswer) => <AnswerView answer={answer} linkToDetail />}
                </CommandFeedback>
              )}
            </div>
          )}
        </div>

        <form
          className="space-y-2 border-t border-base-300 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSend) return;
            if (phase.kind !== 'idle') ask.reset();
            setSentQuestion(trimmed);
            void ask.run({ q: trimmed });
          }}
        >
          {port.mockHints && <p className="text-xs opacity-60">{m.assistant.mockTags(port.mockHints.join(' '))}</p>}
          <label className="block">
            <span className="text-sm font-bold">{m.assistant.questionLabel}</span>
            <textarea
              className="textarea mt-1 w-full resize-y"
              rows={3}
              maxLength={MAX_QUESTION}
              placeholder={sessionId === null ? m.assistant.questionPlaceholder : m.assistant.followUpPlaceholder}
              value={question}
              disabled={locked}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <div className="flex items-center gap-2">
            <span className="mr-auto text-xs opacity-60">{m.assistant.counter(question.length, MAX_QUESTION)}</span>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!canSend}>
              {m.assistant.send}
            </button>
          </div>
        </form>
      </div>

      <ChatList activeId={sessionId} />
    </div>
  );
}

export function AssistantPage() {
  const { port, owner } = useAssistant();
  const { sessionId = null } = useParams();
  return (
    <section className="space-y-4">
      <Header />
      {/* 계정이 바뀌면 질문·명령 상태를 새로 시작한다(이전 사용자 질문이 남지 않게). 채팅이 바뀔 때는 ChatView 안에서 */}
      {port.connected ? <ChatView key={owner ?? '-'} sessionId={sessionId} /> : <NotConnected />}
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
                // 질문 원문: 서버 question(1.3.0, 원문 저장일 때) → 이 탭에서 물은 것(askedQuestions.ts)
                const q = answer.question ?? askedQuestion(owner, answer.answerId);
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
