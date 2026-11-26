// 작업 조작(cdc-outbound 0.20.0 — 사용자 2026-11-26 "바로 할 수 있는 것부터"): 담당 바꾸기·보류·보류 풀기·우선순위 + 조작 이력.
// - `POST /cdcs/{cdcId}/tasks/{taskId}/reassignments {workerId|null, reason}`(비우면 대기열 — CREATED, 시작한 작업은 409 INVALID_STATE, 그 작업자가 다른 작업 중이면 409 WORKER_BUSY)
// - `…/holds`·`…/resumptions {reason?}`, `…/priority-changes {priority -100~100, reason}`, `GET …/adjustments`. 모두 X-Expected-Version.
// 결과는 작업을 다시 읽어 서버 값으로 보인다(응답 200 Task 를 그대로 확정으로 쓰지 않고 목록·상세를 무효화).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/cdc-outbound';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { useOperatorLabel, Who } from '../../shared/OperatorLabel';

const c = messages.taskOps;
type Task = components['schemas']['Task'];
type Action = 'reassign' | 'hold' | 'resume' | 'priority';

/** 계약 조건만으로 버튼을 낸다(판정은 서버): 시작 전(CREATED·ASSIGNED·ACCEPTED)만 담당·보류, HELD 는 풀기, 끝나지 않은 작업은 우선순위 */
export function taskActions(t: Task): readonly Action[] {
  const st = t.state ?? '';
  if (st === 'HELD') return ['resume', 'priority'];
  const out: Action[] = [];
  if (['CREATED', 'ASSIGNED', 'ACCEPTED'].includes(st)) out.push('reassign', 'hold');
  if (!['DONE', 'CANCELLED'].includes(st)) out.push('priority');
  return out;
}

function WorkerOption({ id }: { readonly id: string }) {
  const q = useOperatorLabel(id);
  // 이름을 모르면 운영자 ID 대신 "직원"(ADR-0070) — 값은 ID
  return <option value={id}>{q.data ? `${q.data.name} · ${q.data.employeeNo}` : q.isPending ? "…" : messages.operator.unknown}</option>;
}

export function TaskControls({ cdcId, task }: { readonly cdcId: string; readonly task: Task }) {
  const api = useApi();
  const qc = useQueryClient();
  const taskId = task.taskId ?? '';
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [worker, setWorker] = useState('');
  const [priority, setPriority] = useState(String(task.priority ?? 0));
  const acts = taskActions(task);
  const workers = useQuery({
    enabled: action === 'reassign',
    queryKey: ['cdc', cdcId, 'workers'],
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/workers', { params: { path: { cdcId } } })),
  });
  const cmd = useCommand(async (v: { readonly action: Action; readonly version: number | undefined }, key) => {
    const p = commandParams(key, { path: { cdcId, taskId }, version: v.version });
    const r = reason.trim();
    const withReason = r ? { reason: r } : {};
    switch (v.action) {
      case 'reassign':
        return request('POST', api.outbound.POST('/cdcs/{cdcId}/tasks/{taskId}/reassignments', { ...p, body: { workerId: worker.trim() || null, ...withReason } }));
      case 'hold':
        return request('POST', api.outbound.POST('/cdcs/{cdcId}/tasks/{taskId}/holds', { ...p, body: withReason }));
      case 'resume':
        return request('POST', api.outbound.POST('/cdcs/{cdcId}/tasks/{taskId}/resumptions', { ...p, body: withReason }));
      case 'priority':
        return request('POST', api.outbound.POST('/cdcs/{cdcId}/tasks/{taskId}/priority-changes', { ...p, body: { priority: Number(priority), ...withReason } }));
    }
  });
  const prioOk = /^-?\d+$/.test(priority.trim()) && Number(priority) >= -100 && Number(priority) <= 100 && Number(priority) !== (task.priority ?? 0);
  const ready = action !== null && (action !== 'priority' || prioOk);
  if (acts.length === 0) return <TaskHistory cdcId={cdcId} taskId={taskId} />;
  return (
    <div className="space-y-3" data-testid="task-controls">
      <div className="flex flex-wrap items-center gap-2">
        {acts.map((a) => (
          <button
            key={a}
            type="button"
            className={`btn btn-sm ${action === a ? 'btn-primary' : ''}`}
            onClick={() => {
              setAction(action === a ? null : a);
              setReason('');
              setWorker('');
              setPriority(String(task.priority ?? 0));
            }}
            data-testid={`task-op-${a}`}
          >
            {c.actions[a]}
          </button>
        ))}
        <span className="text-xs text-base-content/60">{`${c.priority} ${task.priority ?? 0}`}</span>
      </div>
      {action && (
        <form
          className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
            void cmd.run({ action, version: task.version }).then((phase) => {
              if (phase.kind === 'done') {
                setAction(null);
                void qc.invalidateQueries({ queryKey: ['cdc', cdcId, 'task', taskId] });
                void qc.invalidateQueries({ queryKey: ['cdc', cdcId, 'tasks'] });
                void qc.invalidateQueries({ queryKey: ['cdc', cdcId, 'task', taskId, 'adjustments'] });
              }
            });
          }}
          data-testid="task-op-form"
        >
          <p className="text-sm">{c.hint[action]}</p>
          {action === 'reassign' && (
            <label className="flex flex-col gap-1 text-sm">
              {c.worker}
              <select className="select select-sm w-72" value={worker} onChange={(e) => setWorker(e.target.value)} data-testid="task-worker">
                <option value="">{c.toQueue}</option>
                {(workers.data?.workers ?? [])
                  .filter((w) => w.workerId !== task.assigneeId)
                  .map((w) => (
                    <WorkerOption key={w.workerId} id={w.workerId} />
                  ))}
              </select>
              <span className="text-xs text-base-content/55">{c.workersHint}</span>
              {workers.isError && <span className="text-xs text-error">{messages.loadFailed}</span>}
            </label>
          )}
          {action === 'priority' && (
            <label className="flex flex-col gap-1 text-sm">
              {c.priority}
              <input className="input input-sm w-28" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} data-testid="task-priority" />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            {c.reason}
            <input className="input input-sm w-full max-w-md" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-sm btn-primary" disabled={!ready || cmd.busy} data-testid="task-op-go">
              {c.go}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAction(null)}>
              {c.close}
            </button>
          </div>
        </form>
      )}
      <CommandFeedback command={cmd}>
        {() => (
          <p role="status" className="alert alert-info text-sm">
            {c.done}
          </p>
        )}
      </CommandFeedback>
      <TaskHistory cdcId={cdcId} taskId={taskId} />
    </div>
  );
}

function TaskHistory({ cdcId, taskId }: { readonly cdcId: string; readonly taskId: string }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    enabled: open,
    queryKey: ['cdc', cdcId, 'task', taskId, 'adjustments'],
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/tasks/{taskId}/adjustments', { params: { path: { cdcId, taskId } } })),
  });
  return (
    <details className="text-sm" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-testid="task-history">
      <summary className="cursor-pointer text-xs text-base-content/60">{c.history}</summary>
      {open && (
        <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={c.historyEmpty}>
          {(d) => (
            <ul className="mt-2 space-y-1 text-xs">
              {d.items.map((a) => (
                <li key={a.adjustmentId} className="flex flex-wrap gap-2">
                  <span className="text-base-content/60">{formatSeoul(a.adjustedAt)}</span>
                  <span className="font-semibold">{c.historyAction[a.action] ?? a.action}</span>
                  {a.fromState !== a.toState && <span>{`${messages.task.state[a.fromState] ?? a.fromState} → ${messages.task.state[a.toState] ?? a.toState}`}</span>}
                  {a.fromPriority !== a.toPriority && <span>{c.priorityChange(a.fromPriority, a.toPriority)}</span>}
                  {a.action === 'REASSIGN' && (
                    <span>
                      <Who id={a.fromAssignee} empty={messages.task.unassigned} /> → <Who id={a.toAssignee} empty={messages.task.unassigned} />
                    </span>
                  )}
                  {a.reason && <span>{a.reason}</span>}
                  <Who id={a.actorId} />
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      )}
    </details>
  );
}
