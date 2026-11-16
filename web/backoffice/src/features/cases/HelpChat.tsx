// 라이더 도움요청 대화(execution 0.6.0, 백엔드 #60 — 알림 backoffice/2026-11-16-notice-help-request-messages).
// - 접수 건(RIDER_HELP 등) refs 의 deliveryId·requestId 로 `GET …/help-requests/{requestId}/messages?after=<seq>` — 오래된 것부터, 한 번에 200개.
//   상세를 열어 둔 동안 5초마다 마지막 seq 뒤만 다시 읽는다(새 메시지 알림은 아직 없음).
// - 답장 `POST …/messages` {body 1~1000} — 같은 키 재전송 = 같은 메시지. 처리 끝난 도움요청은 409 HELP_REQUEST_CLOSED(다시 처리하면 이어 씀).
// - 답장 권한·새 메시지 시각·대화 가림·처리 중 시점은 백엔드 DE-2(PC 5) 반영 뒤 바뀐다 — 지금은 계약 0.6.0 대로(볼 수 있는 본사 직원 모두 답장, 403 이면 서버 문구).
// - 대화는 화면에만(로그 없음). 입력란에 개인정보 안내.
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/delivery-execution';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { messages } from '../../shared/messages';
import { text, when } from '../../shared/ops';

const m = messages.helpChat;
type HelpMessage = components['schemas']['HelpMessage'];
const PAGE = 200;
const POLL_MS = 5000;
const MAX_BODY = 1000;

interface Thread {
  readonly items: readonly HelpMessage[];
  readonly helpState: string | undefined;
}

/** 접수 건 상세의 "라이더와 대화" 칸 */
export function HelpChat({ deliveryId, requestId }: { readonly deliveryId: string; readonly requestId: string }) {
  const api = useApi();
  const { session } = useSession();
  const roles = session?.roles ?? [];
  const canWrite = roles.includes('OPERATOR_ADMIN') || roles.includes('RIDER_OPS') || roles.includes('CS_AGENT');
  /** 지금까지 받은 메시지 — 다음 조회는 마지막 seq 뒤만 */
  const thread = useRef<Thread>({ items: [], helpState: undefined });
  const query = useQuery({
    queryKey: ['help-chat', deliveryId, requestId],
    refetchInterval: POLL_MS,
    queryFn: async (): Promise<Thread> => {
      let { items } = thread.current;
      let helpState = thread.current.helpState;
      for (;;) {
        const after = items.at(-1)?.seq;
        const r = await request(
          'GET',
          api.execution.GET('/deliveries/{deliveryId}/help-requests/{requestId}/messages', {
            params: { path: { deliveryId, requestId }, query: after === undefined ? {} : { after } },
          }),
        );
        const seen = new Set(items.map((x) => x.seq));
        items = [...items, ...r.items.filter((x) => !seen.has(x.seq))];
        helpState = r.helpState ?? helpState;
        if (r.items.length < PAGE) break;
      }
      thread.current = { items, helpState };
      return thread.current;
    },
  });
  const [draft, setDraft] = useState('');
  const send = useCommand(async (body: string, key) => {
    const r = await request(
      'POST',
      api.execution.POST('/deliveries/{deliveryId}/help-requests/{requestId}/messages', { ...commandParams(key, { path: { deliveryId, requestId } }), body: { body } }),
    );
    setDraft('');
    void query.refetch();
    return r;
  });
  const closed = query.data?.helpState === 'RESOLVED';
  const ok = draft.trim().length >= 1 && draft.trim().length <= MAX_BODY;
  return (
    <section className="space-y-2" aria-label={m.title}>
      <h2 className="font-bold">{m.title}</h2>
      <p className="text-xs opacity-70">{m.intro}</p>
      {/* 새로 읽기가 실패해도 받은 대화는 그대로 두고 경고만 — 0건·정상으로 바꾸지 않는다 */}
      {query.data && query.isError && (
        <p role="alert" className="text-xs text-error">
          {m.pollFailed}
        </p>
      )}
      <QueryState state={toUiState(query, (r) => r.items.length === 0)} onRetry={() => void query.refetch()} emptyText={m.empty}>
        {(r) => (
          <ol className="space-y-1 text-sm" data-testid="help-chat">
            {r.items.map((x) => {
              const rider = x.senderType === 'RIDER';
              return (
                <li key={x.seq} className={`flex ${rider ? 'justify-start' : 'justify-end'}`} data-testid="help-message" data-sender={x.senderType}>
                  <div className={`max-w-[80%] space-y-1 rounded-box p-2 ${rider ? 'bg-base-100' : 'bg-primary/10'}`}>
                    <div className="flex flex-wrap items-center gap-2 text-xs opacity-70">
                      <span className="font-semibold">{rider ? m.rider : m.support}</span>
                      <span className="font-mono">{text(x.senderId)}</span>
                      <span>{when(x.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{x.body}</p>
                    {(x.photoRefs ?? []).length > 0 && <p className="text-xs opacity-70">{m.photos((x.photoRefs ?? []).join(', '))}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </QueryState>
      {canWrite &&
        (closed ? (
          <p className="text-xs opacity-70" data-testid="help-chat-closed">
            {m.closed}
          </p>
        ) : (
          <form
            className="space-y-1"
            aria-label={m.reply}
            onSubmit={(e) => {
              e.preventDefault();
              if (!ok) return;
              if (send.phase.kind === 'rejected' || send.phase.kind === 'done') send.reset();
              void send.run(draft.trim());
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              {m.replyLabel}
              <textarea className="textarea textarea-sm w-full max-w-lg" maxLength={MAX_BODY} value={draft} onChange={(e) => setDraft(e.target.value)} />
            </label>
            <p className="text-xs text-warning">{m.piiHint}</p>
            <button type="submit" className="btn btn-sm" disabled={!ok || send.busy || query.data === undefined}>
              {m.reply}
            </button>
            <CommandFeedback command={send}>{() => <span className="text-xs text-success">{m.sent}</span>}</CommandFeedback>
          </form>
        ))}
    </section>
  );
}
