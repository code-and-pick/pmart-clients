// 라이더 도움요청 대화(execution 0.6.0, 백엔드 #60 — 알림 backoffice/2026-11-16-notice-help-request-messages).
// - 접수 건(RIDER_HELP 등) refs 의 deliveryId·requestId 로 `GET …/help-requests/{requestId}/messages?after=<seq>` — 오래된 것부터, 한 번에 200개.
//   상세를 열어 둔 동안 5초마다 마지막 seq 뒤만 다시 읽는다(새 메시지 알림은 아직 없음).
// - 답장 `POST …/messages` {body 1~1000} — 같은 키 재전송 = 같은 메시지. 처리 끝난 도움요청은 409 HELP_REQUEST_CLOSED(다시 처리하면 이어 씀).
// - execution 0.8.0 DE-2(백엔드 회신 backoffice/2026-11-17-reply-help-chat-de2): 답장은 지원센터(RIDER_OPS)·관리자만, 접수 건이 관리자 팀이면 관리자만(상담원은 보기만).
//   관리자는 메시지를 사유(2~500자)와 함께 가린다(`…/messages/{messageId}/maskings`) — body null·masked, 라이더에게도 가려 보인다. 가리면 받은 대화를 처음부터 다시 읽는다(after 로는 옛 메시지가 안 바뀜).
//   새 메시지 표시는 bff 사건함(#88) 뒤.
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

/** 관리자 가리기(0.8.0) — 사유 2~500자. 사유는 화면에만(로그 없음). */
function MaskMessage({ deliveryId, requestId, messageId, onDone }: { readonly deliveryId: string; readonly requestId: string; readonly messageId: string; readonly onDone: () => void }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const mask = useCommand(async (r: string, key) => {
    const res = await request(
      'POST',
      api.execution.POST('/deliveries/{deliveryId}/help-requests/{requestId}/messages/{messageId}/maskings', {
        ...commandParams(key, { path: { deliveryId, requestId, messageId } }),
        body: { reason: r },
      }),
    );
    onDone();
    return res;
  });
  const ok = reason.trim().length >= 2 && reason.trim().length <= 500;
  if (!open)
    return (
      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOpen(true)}>
        {m.mask}
      </button>
    );
  return (
    <form
      className="flex flex-wrap items-end gap-1"
      aria-label={m.mask}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        if (mask.phase.kind === 'rejected') mask.reset();
        void mask.run(reason.trim());
      }}
    >
      <label className="flex flex-col gap-1 text-xs">
        {m.maskReason}
        <input className="input input-xs w-56" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-xs btn-warning" disabled={!ok || mask.busy}>
        {m.mask}
      </button>
      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOpen(false)}>
        {m.cancel}
      </button>
      <CommandFeedback command={mask}>{() => <span className="text-xs text-success">{m.maskedDone}</span>}</CommandFeedback>
    </form>
  );
}

/** 접수 건 상세의 "라이더와 대화" 칸 */
export function HelpChat({ deliveryId, requestId, adminTeam = false }: { readonly deliveryId: string; readonly requestId: string; readonly adminTeam?: boolean }) {
  const api = useApi();
  const { session } = useSession();
  const roles = session?.roles ?? [];
  const admin = roles.includes('OPERATOR_ADMIN');
  // 0.8.0: 지원센터·관리자만, 관리자 팀으로 넘긴 건은 관리자만(판정은 서버 403)
  const canWrite = admin || (!adminTeam && roles.includes('RIDER_OPS'));
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
  /** 가린 뒤에는 옛 메시지가 바뀌므로 처음부터 다시 읽는다 */
  const reload = () => {
    thread.current = { items: [], helpState: undefined };
    void query.refetch();
  };
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
                    {x.masked ? (
                      <p className="text-xs italic opacity-70" data-testid="help-message-masked">
                        {m.maskedLine(text(x.maskedBy), text(x.maskReason))}
                      </p>
                    ) : (
                      <p className="whitespace-pre-wrap">{x.body}</p>
                    )}
                    {(x.photoRefs ?? []).length > 0 && <p className="text-xs opacity-70">{m.photos((x.photoRefs ?? []).join(', '))}</p>}
                    {admin && !x.masked && <MaskMessage deliveryId={deliveryId} requestId={requestId} messageId={x.messageId} onDone={reload} />}
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
      {!canWrite && (
        <p className="text-xs opacity-70" data-testid="help-chat-read-only">
          {adminTeam ? m.readOnlyAdminTeam : m.readOnly}
        </p>
      )}
    </section>
  );
}
