// 작업 현황 목록의 행 조치 — 담당 바꾸기(빼앗아 재배정)·내려놓기(백엔드 알림 clients/mfc-backoffice/2026-11-19-notice-reassign-release, 서버 변경 없음).
// - 담당 바꾸기: mfc-capacity `POST /assignments` {mfcId, taskId, taskType, workerId, reason} + X-Expected-Version = 목록의 assignment.assignmentVersion(담당 없으면 0).
//   201 새 배정(앞 배정 SUPERSEDED), 200 = 이미 그 사람(변화 없음). warnings OFF_SHIFT 는 안내만. 409 VERSION_CONFLICT·422 WORKER_NOT_REGISTERED·WORKER_NOT_ACTIVE·DUTY_NOT_ALLOWED 는 거절 안내.
//   고를 작업자 = `GET /mfcs/{mfcId}/workers?state=ACTIVE` 중 effectiveTaskTypes 에 그 작업 유형이 있는 사람(휴게 중이면 표시). 진행 중이면 현장 주의 문구.
// - 내려놓기: mfc-fulfillment `POST /tasks/{id}/releases` {workerId = 지금 담당, reason} → READY(담당 없음). 409 EXECUTION_IN_FLIGHT·INVALID_STATE·NOT_ASSIGNEE, 503 은 결과 불명(같은 키).
// - 사유는 둘 다 받는다(200자). 끝나면 목록을 다시 읽고, 배정 반영이 늦을 수 있어 1.5초 뒤 한 번 더.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/mfc-fulfillment';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';

const m = messages.tasks.actions;
type TaskSummary = components['schemas']['TaskSummary'];
export type TaskAction = 'reassign' | 'release';

const REASON_MAX = 200;
const AGAIN_MS = 1_500;

/** 목록 다시 읽기 — 지금 한 번, 배정 반영을 기다려 한 번 더 */
function useRefreshTasks(mfcId: string) {
  const queryClient = useQueryClient();
  return async (taskId: string) => {
    const again = () =>
      Promise.all([queryClient.invalidateQueries({ queryKey: ['tasks', mfcId] }), queryClient.invalidateQueries({ queryKey: ['task', taskId] })]);
    setTimeout(() => void again(), AGAIN_MS);
    await again();
  };
}

/** 행 조치 단추 — 진행 중·배정됨은 둘 다, 대기(담당 없음)는 담당 정하기만 */
export function TaskActionButtons({ task, open, onOpen }: { readonly task: TaskSummary; readonly open: TaskAction | null; readonly onOpen: (a: TaskAction | null) => void }) {
  const assigned = task.state === 'ASSIGNED' || task.state === 'IN_PROGRESS';
  const canAssign = assigned || task.state === 'READY' || task.state === 'WAITING';
  if (!canAssign) return null;
  const toggle = (a: TaskAction) => onOpen(open === a ? null : a);
  return (
    <div className="flex flex-wrap gap-1">
      <button type="button" className={`btn btn-xs ${open === 'reassign' ? 'btn-primary' : ''}`} aria-expanded={open === 'reassign'} onClick={() => toggle('reassign')}>
        {task.assignment?.workerId ? m.reassign : m.assign}
      </button>
      {assigned && task.assignment?.workerId && (
        <button type="button" className={`btn btn-xs ${open === 'release' ? 'btn-warning' : ''}`} aria-expanded={open === 'release'} onClick={() => toggle('release')}>
          {m.release}
        </button>
      )}
    </div>
  );
}

/** 담당 바꾸기 폼 */
export function ReassignForm({ mfcId, task, onClose }: { readonly mfcId: string; readonly task: TaskSummary; readonly onClose: () => void }) {
  const api = useApi();
  const refresh = useRefreshTasks(mfcId);
  const taskId = task.taskId ?? '';
  const current = task.assignment?.workerId ?? null;
  const version = task.assignment?.assignmentVersion ?? 0;
  const [workerId, setWorkerId] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const workers = useQuery({
    queryKey: ['workers', mfcId, 'ACTIVE'],
    queryFn: async () => (await request('GET', api.capacity.GET('/mfcs/{mfcId}/workers', { params: { path: { mfcId }, query: { state: 'ACTIVE' } } }))).items ?? [],
  });
  const assign = useCommand(async (_: null, key) => {
    setNotice(null);
    const r = await request(
      'POST',
      api.capacity.POST('/assignments', {
        ...commandParams(key, { version }),
        body: { mfcId, taskId, taskType: task.taskType!, workerId, reason: reason.trim() },
      }),
    );
    const notes = [r.assignmentVersion === version ? m.unchanged : m.assigned(r.workerId ?? workerId)];
    if (r.warnings?.includes('OFF_SHIFT')) notes.push(m.offShift);
    setNotice(notes.join(' '));
    await refresh(taskId);
    return r;
  });
  const ready = !!workerId && !!reason.trim() && !!task.taskType;
  return (
    <form
      className="space-y-2 rounded-box border border-base-300 bg-base-200/50 p-3 text-sm"
      aria-label={m.reassignTitle}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        if (assign.phase.kind === 'rejected' || assign.phase.kind === 'done') assign.reset();
        void assign.run(null);
      }}
    >
      <p className="font-semibold">{m.reassignTitle}</p>
      {task.state === 'IN_PROGRESS' && (
        <ul className="list-inside list-disc text-xs text-warning" data-testid="reassign-warn">
          {m.inProgressNotes(task.taskType ?? '').map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <QueryState state={toUiState(workers)} onRetry={() => void workers.refetch()}>
        {(list) => {
          const fit = list.filter((w) => w.workerId && w.workerId !== current && (w.effectiveTaskTypes ?? []).includes(task.taskType as never));
          return fit.length === 0 ? (
            <p className="text-xs opacity-70">{m.noWorkers}</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                {m.worker}
                <select className="select select-sm w-64" value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
                  <option value="">{m.chooseWorker}</option>
                  {fit.map((w) => (
                    <option key={w.workerId} value={w.workerId}>
                      {`${w.displayName ?? w.workerId} (${w.workerId})${w.onBreak ? ` · ${m.onBreak}` : ''}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                {m.reason}
                <input className="input input-sm w-64" maxLength={REASON_MAX} placeholder={m.reasonPlaceholder} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <button type="submit" className="btn btn-sm btn-primary" disabled={!ready || assign.busy}>
                {m.reassignSubmit}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
                {m.close}
              </button>
            </div>
          );
        }}
      </QueryState>
      {notice && (
        <p role="status" className="text-success">
          {notice}
        </p>
      )}
      <CommandFeedback command={assign} />
    </form>
  );
}

/** 내려놓기 폼 */
export function ReleaseForm({ mfcId, task, onClose }: { readonly mfcId: string; readonly task: TaskSummary; readonly onClose: () => void }) {
  const api = useApi();
  const refresh = useRefreshTasks(mfcId);
  const taskId = task.taskId ?? '';
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const release = useCommand(async (_: null, key) => {
    setNotice(null);
    const r = await request(
      'POST',
      api.fulfillment.POST('/tasks/{taskId}/releases', {
        ...commandParams(key, { path: { taskId } }),
        body: { workerId: task.assignment?.workerId ?? '', reason: reason.trim() },
      }),
    );
    // 서버가 돌려준 상태가 READY 일 때만 "내려놓음"
    setNotice(r.state === 'READY' ? m.released : null);
    await refresh(taskId);
    return r;
  });
  return (
    <form
      className="space-y-2 rounded-box border border-base-300 bg-base-200/50 p-3 text-sm"
      aria-label={m.releaseTitle}
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim()) return;
        if (release.phase.kind === 'rejected' || release.phase.kind === 'done') release.reset();
        void release.run(null);
      }}
    >
      <p className="font-semibold">{m.releaseTitle}</p>
      <p className="text-xs opacity-70">{m.releaseHint}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          {m.reason}
          <input className="input input-sm w-72" maxLength={REASON_MAX} placeholder={m.reasonPlaceholder} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-sm btn-warning" disabled={!reason.trim() || release.busy}>
          {m.releaseSubmit}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
          {m.close}
        </button>
      </div>
      {notice && (
        <p role="status" className="text-success">
          {notice}
        </p>
      )}
      <CommandFeedback command={release} />
    </form>
  );
}
