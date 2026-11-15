// 처리 대기(BO-12, 백엔드 요청 backoffice/2026-11-16-request-case-inbox-and-pending-work §2 — bff 0.2.0). OPERATOR_ADMIN.
// - 목록 `GET /backoffice/views/pending-work`(ComposedView): 멈춘 주문 처리(STUCK_SAGA)·이행 확인 필요(FULFILLMENT_ISSUE). unavailableSources 는 "일부 원천을 읽지 못함".
// - 버튼은 항목의 allowedActions 에 있는 것만:
//   REQUERY_RESULT → bff `POST /backoffice/commands/order-orchestration-service/saga-requery` {targetRef: refId, reason?, payload: {}}
//   MARK_RESOLVED  → bff `…/saga-resolve`(사유 필수 — 목록에서 빠질 뿐 주문·재고는 그대로)
//   ACKNOWLEDGE    → order-service `POST /fulfillment-issues/{refId}/acknowledgements` {note}
//   bff 명령 응답은 CommandResponse(ACCEPTED ≠ 성공) — settleCommand 로 짝 조회(`GET …/commands/{ts}/{cmd}/{requestId}`)까지. 422 NOT_REQUERYABLE·NOT_RESOLVABLE = 이미 바뀜(새로고침).
// - 사유·메모에 개인정보를 적지 않게 안내하고, 로그에 남기지 않는다.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { request, settleCommand } from '@pmart/web-core';
import { CommandFeedback, QueryState, uiStateFromError, useCommand, type UiState } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/backoffice-bff';
import { useApi } from '../../app/ApiContext';
import { messages as m } from '../../shared/messages';
import { label, text, when } from '../../shared/ops';
import { SourceStamps } from '../../shared/SourceStamps';

type Item = components['schemas']['PendingWorkItem'];
type View = components['schemas']['ComposedView'] & { items?: Item[] };
type Action = 'REQUERY_RESULT' | 'MARK_RESOLVED' | 'ACKNOWLEDGE';

const ORCHESTRATION = 'order-orchestration-service';
const COMMAND: Record<'REQUERY_RESULT' | 'MARK_RESOLVED', string> = { REQUERY_RESULT: 'saga-requery', MARK_RESOLVED: 'saga-resolve' };

const ACTION_LABEL: Record<Action, string> = { REQUERY_RESULT: m.pending.requery, MARK_RESOLVED: m.pending.resolve, ACKNOWLEDGE: m.pending.acknowledge };
const isAction = (a: string): a is Action => a === 'REQUERY_RESULT' || a === 'MARK_RESOLVED' || a === 'ACKNOWLEDGE';

function ActionForm({ item, action, onClose }: { readonly item: Item; readonly action: Action; readonly onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [text_, setText] = useState('');
  const cmd = useCommand(async (v: { text: string }, key) => {
    let r: unknown;
    if (action === 'ACKNOWLEDGE') {
      r = await request('POST', api.orders.POST('/fulfillment-issues/{issueId}/acknowledgements', { ...commandParams(key, { path: { issueId: item.refId } }), body: { note: v.text } }));
    } else {
      const command = COMMAND[action];
      r = await settleCommand(
        key,
        () =>
          request(
            'POST',
            api.bff.POST('/commands/{targetService}/{command}', {
              ...commandParams(key, { path: { targetService: ORCHESTRATION, command } }),
              body: { targetRef: item.refId, payload: {}, ...(v.text ? { reason: v.text } : {}) },
            }),
          ),
        (requestId) => request('GET', api.bff.GET('/commands/{targetService}/{command}/{requestId}', { params: { path: { targetService: ORCHESTRATION, command, requestId } } })),
      );
    }
    await queryClient.invalidateQueries({ queryKey: ['bff', 'pending-work'] });
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
      {action === 'MARK_RESOLVED' && (
        <p role="alert" className="text-xs text-warning">
          {m.pending.resolveWarn}
        </p>
      )}
      <label className="flex flex-col gap-1 text-xs">
        {action === 'ACKNOWLEDGE' ? m.pending.note : action === 'MARK_RESOLVED' ? m.pending.resolveReason : m.pending.requeryReason}
        <textarea className="textarea textarea-xs w-64" maxLength={500} value={text_} onChange={(e) => setText(e.target.value)} />
      </label>
      <p className="text-xs opacity-70">{action === 'ACKNOWLEDGE' ? m.pending.noteHint : m.pending.reasonHint}</p>
      <div className="flex gap-1">
        <button type="submit" className="btn btn-xs btn-primary" disabled={!ok || cmd.busy}>
          {m.pending.confirm}
        </button>
        <button type="button" className="btn btn-xs" disabled={cmd.busy} onClick={onClose}>
          {m.pending.cancel}
        </button>
      </div>
      <CommandFeedback command={cmd}>{() => <span className="text-xs text-success">{m.pending.done}</span>}</CommandFeedback>
    </form>
  );
}

function Actions({ item }: { readonly item: Item }) {
  const [open, setOpen] = useState<Action | null>(null);
  const actions = item.allowedActions.filter(isAction);
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
                      <Link className="link" to={`/orders/${encodeURIComponent(i.orderId)}`}>
                        {i.orderId}
                      </Link>
                    </td>
                    <td>
                      {i.reasonCode ? label(i.kind === 'FULFILLMENT_ISSUE' ? m.pending.reasonName : {}, i.reasonCode) : m.none}
                      {i.reasonMessage && <p className="text-xs opacity-70">{i.reasonMessage}</p>}
                    </td>
                    <td>{text(i.state)}</td>
                    <td>
                      <Actions item={i} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </QueryState>
      <p className="text-xs opacity-70" data-testid="pending-not-yet">
        {m.pending.notYet}
      </p>
    </section>
  );
}
