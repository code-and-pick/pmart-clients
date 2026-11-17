// 처리 대기(BO-12, 백엔드 요청 backoffice/2026-11-16-request-case-inbox-and-pending-work §2 — bff 0.2.0). OPERATOR_ADMIN.
// - 목록 `GET /backoffice/views/pending-work`(ComposedView): 멈춘 주문 처리(STUCK_SAGA)·이행 확인 필요(FULFILLMENT_ISSUE). unavailableSources 는 "일부 원천을 읽지 못함".
// - 버튼은 항목의 allowedActions 에 있는 것만:
//   REQUERY_RESULT → bff `POST /backoffice/commands/order-orchestration-service/saga-requery` {targetRef: refId, reason?, payload: {}}
//   MARK_RESOLVED  → bff `…/saga-resolve`(사유 필수 — 목록에서 빠질 뿐 주문·재고는 그대로)
//   ACKNOWLEDGE    → order-service `POST /fulfillment-issues/{refId}/acknowledgements` {note}
//   RETRY          → bff `…/commands/mfc-fulfillment-service/stop-retry`(MFC_STOP_FAILED)·`handover-retry`(MFC_HANDOVER_REJECTED), 사유 필수
//                    (bff 0.4.0, 백엔드 알림 notice-pending-work-mfc-retry). REJECTED = 다시 실패(원인 고친 뒤 다시). 메모는 아직 MFC 에 저장되지 않는다 — "기록됨"이라 쓰지 않는다.
//   MFC 두 종류 목록은 MFC 목록 API(F-4) 전까지 서버 설정으로 꺼져 있다 — sources 에 mfc-fulfillment-service 가 없으면 "아직 꺼져 있음" 안내(장애 아님).
//   bff 명령 응답은 CommandResponse(ACCEPTED ≠ 성공). 짝 조회 `GET …/commands/{ts}/{cmd}/{requestId}` 는 아직 501(백엔드 회신 reply-case-inbox-questions §3) —
//   그래서 APPLIED·REJECTED 만 확정하고, ACCEPTED·UNKNOWN_RESULT·시간 초과는 목록을 다시 읽어 "목록에서 확인" 안내(결과 불명 — 같은 키 재전송만).
//   422 NOT_REQUERYABLE·NOT_RESOLVABLE = 이미 바뀜(새로고침).
// - 사유·메모에 개인정보를 적지 않게 안내하고, 로그에 남기지 않는다.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { CommandRejectedFailure, UnknownResultFailure, request } from '@pmart/web-core';
import { CommandFeedback, QueryState, uiStateFromError, useCommand, type UiState } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/backoffice-bff';
import { useApi } from '../../app/ApiContext';
import { messages as m } from '../../shared/messages';
import { label, text, when } from '../../shared/ops';
import { SourceStamps } from '../../shared/SourceStamps';

type Item = components['schemas']['PendingWorkItem'];
type View = components['schemas']['ComposedView'] & { items?: Item[] };
type Action = 'REQUERY_RESULT' | 'MARK_RESOLVED' | 'ACKNOWLEDGE' | 'RETRY';

const ORCHESTRATION = 'order-orchestration-service';
const MFC = 'mfc-fulfillment-service';
const COMMAND: Record<'REQUERY_RESULT' | 'MARK_RESOLVED', string> = { REQUERY_RESULT: 'saga-requery', MARK_RESOLVED: 'saga-resolve' };
/** RETRY 명령은 종류마다 다르다 */
const RETRY_COMMAND: Readonly<Record<string, string>> = { MFC_STOP_FAILED: 'stop-retry', MFC_HANDOVER_REJECTED: 'handover-retry' };

const ACTION_LABEL: Record<Action, string> = { REQUERY_RESULT: m.pending.requery, MARK_RESOLVED: m.pending.resolve, ACKNOWLEDGE: m.pending.acknowledge, RETRY: m.pending.retry };
const isAction = (a: string): a is Action => a === 'REQUERY_RESULT' || a === 'MARK_RESOLVED' || a === 'ACKNOWLEDGE' || a === 'RETRY';
/** 버튼으로 보일 조치: 서버가 허락했고, RETRY 는 화면이 아는 종류일 때만 */
const actionsOf = (item: Item): Action[] => item.allowedActions.filter(isAction).filter((a) => a !== 'RETRY' || !!RETRY_COMMAND[item.kind]);

/**
 * bff 명령을 한 번 보낸다 — 짝 조회(지금 501) 대신 목록 다시 읽기.
 * APPLIED → 그대로, REJECTED → 거절. ACCEPTED·UNKNOWN_RESULT·시간 초과 → 목록을 다시 읽고 결과 불명(같은 키 재전송만 허용).
 */
async function sendBffOnce<S extends { readonly status?: string; readonly requestId?: string; readonly nextAction?: string }>(
  send: () => Promise<S>,
  keyValue: string,
  reread: () => Promise<unknown>,
): Promise<S> {
  let first: S | undefined;
  try {
    first = await send();
  } catch (e) {
    if (!(e instanceof UnknownResultFailure)) throw e;
  }
  if (first?.status === 'APPLIED') return first;
  if (first?.status === 'REJECTED') throw new CommandRejectedFailure(first.nextAction, first.requestId);
  await reread();
  throw new UnknownResultFailure(undefined, first?.requestId || keyValue);
}

function ActionForm({ item, action, onClose }: { readonly item: Item; readonly action: Action; readonly onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [text_, setText] = useState('');
  const cmd = useCommand(async (v: { text: string }, key) => {
    let r: unknown;
    try {
      if (action === 'ACKNOWLEDGE') {
        r = await request('POST', api.orders.POST('/fulfillment-issues/{issueId}/acknowledgements', { ...commandParams(key, { path: { issueId: item.refId } }), body: { note: v.text } }));
      } else {
        const targetService = action === 'RETRY' ? MFC : ORCHESTRATION;
        const command = action === 'RETRY' ? (RETRY_COMMAND[item.kind] ?? '') : COMMAND[action];
        r = await sendBffOnce(
          () =>
            request(
              'POST',
              api.bff.POST('/commands/{targetService}/{command}', {
                ...commandParams(key, { path: { targetService, command } }),
                body: { targetRef: item.refId, payload: {}, ...(v.text ? { reason: v.text } : {}) },
              }),
            ),
          key.value,
          () => queryClient.invalidateQueries({ queryKey: ['bff', 'pending-work'] }),
        );
      }
    } finally {
      // 거절(REJECTED)이어도 MFC 에 재시도 기록이 남는다(bff 0.8.0 lastRetry) — 목록을 다시 읽는다
      await queryClient.invalidateQueries({ queryKey: ['bff', 'pending-work'] });
    }
    return r;
  });
  const required = action !== 'REQUERY_RESULT';
  const ok = (!required || text_.trim().length >= 1) && text_.trim().length <= 500;
  return (
    <form
      className="space-y-1"
      aria-label={`${ACTION_LABEL[action]} ${item.refId}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        if (cmd.phase.kind === 'rejected') cmd.reset();
        void cmd.run({ text: text_.trim() });
      }}
    >
      {action === 'RETRY' && item.kind === 'MFC_HANDOVER_REJECTED' && (
        <p role="note" className="text-xs text-warning">
          {m.pending.handoverRetryGuide}
        </p>
      )}
      {action === 'MARK_RESOLVED' && (
        <p role="alert" className="text-xs text-warning">
          {m.pending.resolveWarn}
        </p>
      )}
      <label className="flex flex-col gap-1 text-xs">
        {action === 'ACKNOWLEDGE' ? m.pending.note : action === 'MARK_RESOLVED' ? m.pending.resolveReason : action === 'RETRY' ? m.pending.retryReason : m.pending.requeryReason}
        <textarea className="textarea textarea-xs w-64" maxLength={500} value={text_} onChange={(e) => setText(e.target.value)} />
      </label>
      <p className="text-xs opacity-70">{action === 'ACKNOWLEDGE' ? m.pending.noteHint : action === 'RETRY' ? m.pending.retryHint : m.pending.reasonHint}</p>
      <div className="flex gap-1">
        <button type="submit" className="btn btn-xs btn-primary" disabled={!ok || cmd.busy}>
          {m.pending.confirm}
        </button>
        <button type="button" className="btn btn-xs" disabled={cmd.busy} onClick={onClose}>
          {m.pending.cancel}
        </button>
      </div>
      {action === 'RETRY' && cmd.phase.kind === 'rejected' && (
        <p className="text-xs text-warning" data-testid="retry-rejected">
          {m.pending.retryRejected}
        </p>
      )}
      <CommandFeedback command={cmd} {...(action === 'ACKNOWLEDGE' ? {} : { unknown: { body: m.pending.unknownReread } })}>{() => <span className="text-xs text-success">{m.pending.done}</span>}</CommandFeedback>
    </form>
  );
}

/** 주문 칸 — MFC 거절 인계는 주문 번호가 없을 수 있다(bff 0.9.2). 없으면 "—"(빈 링크를 만들지 않는다) */
function OrderCell({ orderId }: { readonly orderId: string | null | undefined }) {
  if (!orderId) return <span className="opacity-70">{m.none}</span>;
  return (
    <Link className="link" to={`/orders/${encodeURIComponent(orderId)}`}>
      {orderId}
    </Link>
  );
}

function Actions({ item }: { readonly item: Item }) {
  const [open, setOpen] = useState<Action | null>(null);
  const actions = actionsOf(item);
  if (open) return <ActionForm item={item} action={open} onClose={() => setOpen(null)} />;
  return (
    <div className="flex flex-wrap gap-1">
      {actions.map((a) => (
        <button key={a} type="button" className={`btn btn-xs ${a === 'MARK_RESOLVED' ? 'btn-outline btn-warning' : ''}`} onClick={() => setOpen(a)}>
          {ACTION_LABEL[a]}
        </button>
      ))}
    </div>
  );
}

export function PendingPage() {
  const api = useApi();
  const query = useQuery({
    queryKey: ['bff', 'pending-work'],
    queryFn: async (): Promise<View> => request('GET', api.bff.GET('/views/pending-work', {})),
  });
  const state: UiState<View> = query.isPending
    ? { kind: 'loading' }
    : query.isError
      ? uiStateFromError(query.error)
      : (query.data.unavailableSources?.length ?? 0) > 0
        ? { kind: 'partial', data: query.data, missing: query.data.unavailableSources ?? [] }
        : (query.data.items?.length ?? 0) === 0
          ? { kind: 'empty' }
          : { kind: 'ready', data: query.data };

  return (
    <section className="max-w-6xl space-y-4">
      <h1 className="text-xl font-bold">{m.pending.title}</h1>
      <p className="text-sm opacity-70">{m.pending.intro}</p>
      <QueryState state={state} onRetry={() => void query.refetch()} emptyText={m.pending.empty}>
        {(view) => (
          <>
            <SourceStamps sources={view.sources} unavailableSources={view.unavailableSources} />
            <table className="table table-sm rounded-box bg-base-100">
              <thead>
                <tr>
                  <th>{m.pending.since}</th>
                  <th>{m.pending.kind}</th>
                  <th>{m.pending.orderId}</th>
                  <th>{m.pending.reason}</th>
                  <th>{m.pending.state}</th>
                  <th>{m.pending.actions}</th>
                </tr>
              </thead>
              <tbody>
                {(view.items ?? []).map((i) => (
                  <tr key={`${i.kind}:${i.refId}`} data-testid="pending-item" data-kind={i.kind}>
                    <td>{when(i.since)}</td>
                    <td>
                      {label(m.pending.kindName, i.kind)}
                      {i.sagaType && <p className="text-xs opacity-70">{`${label(m.pending.sagaTypeName, i.sagaType)}${i.step ? ` · ${i.step}` : ''}`}</p>}
                      {i.mfcId && <p className="text-xs opacity-70">{i.mfcId}</p>}
                    </td>
                    <td>
                      <OrderCell orderId={i.orderId} />
                    </td>
                    <td>
                      {i.reasonCode ? label(i.kind === 'FULFILLMENT_ISSUE' ? m.pending.reasonName : {}, i.reasonCode) : m.none}
                      {i.reasonMessage && <p className="text-xs opacity-70">{i.reasonMessage}</p>}
                    </td>
                    <td>{text(i.state)}</td>
                    <td>
                      <Actions item={i} />
                      {/* bff 0.8.0 — 최근 운영자 재시도(MFC 에 남은 기록). 없으면 줄 없음 */}
                      {i.lastRetry && (
                        <p className="mt-1 text-xs opacity-70" data-testid="pending-last-retry">
                          {m.pending.lastRetry(text(i.lastRetry.operatorId), when(i.lastRetry.retriedAt), text(i.lastRetry.reason))}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </QueryState>
      {query.isSuccess && !(query.data.sources ?? []).some((s) => s.system === MFC) && !(query.data.unavailableSources ?? []).includes(MFC) && (
        <p className="text-xs opacity-70" data-testid="pending-not-yet">
          {m.pending.notYet}
        </p>
      )}
    </section>
  );
}
