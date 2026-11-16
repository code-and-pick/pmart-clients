// 작업자 — mfc-capacity-service 0.14.0 `/mfcs/{mfcId}/workers*`(요청서 mfc-backoffice/2026-11-15 §2·§2-1 "등록, 고용 형태·자격·업무, 상태, 근무, 휴게, 일일크루").
// - 목록 `GET …/workers?state=` — 비우면 서버 기본(재직·정지, 퇴사 빼고). 상태 거르기는 URL 쿼리.
// - 등록 `POST …/workers`(MFC_SUPERVISOR) — workerId = 직원 계정의 운영자 ID(바꿀 수 없음). 자격은 생략하면 서버 기본.
// - 상세 `GET …/workers/{id}`(WorkerDetail — 업무·상태 이력). 바꾸기:
//   업무 `duty-changes`(X-Expected-Version = dutyVersion, 사유 필수) / 자격 `qualification-changes`(X-Expected-Version = qualificationVersion)
//   상태 `state-changes`(사유 필수) / 속도 `speed-changes`(0.5~2.0, 사유 필수) — 업무·상태 응답의 affectedAssignments(맞지 않는 배정)를 보인다(지우지 않음).
//   휴게 `breaks`·`breaks/current/end`, 일일크루 오늘 출근 `day-enrollments`(날짜 생략 = 오늘, 서버가 정함).
//   근무 `shifts`(목록·등록·취소) — 시각 입력은 한국 시간(+09:00)으로 보낸다.
// - 지금 배정 조건(effectiveTaskTypes)·PDA 업무(workAreas)는 서버 값을 보이기만 한다(계산하지 않음).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation as useRouterLocation, useNavigate, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/mfc-capacity';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';

const m = messages.workers;

type Cap = components['schemas'];
export type Worker = Cap['Worker'];
type WorkerDetail = Cap['WorkerDetail'];
type TaskType = Cap['TaskType'];
type WorkerState = Cap['WorkerState'];
type EmploymentType = Cap['EmploymentType'];
type Assignment = Cap['Assignment'];

const TASK_TYPES: readonly TaskType[] = ['PICK', 'PACK', 'RETURN', 'DISPATCH', 'RECEIVE', 'INSPECT', 'PUTAWAY', 'REPLENISH', 'MOVE'];
const STATES: readonly WorkerState[] = ['ACTIVE', 'SUSPENDED', 'LEFT'];
const EMPLOYMENT: readonly EmploymentType[] = ['REGULAR', 'PART_TIME', 'DAILY'];
const isState = (v: string | null): v is WorkerState => !!v && (STATES as readonly string[]).includes(v);

const workersPath = (mfcId: string, rest = '') => centerPath(mfcId, rest ? `workers/${rest}` : 'workers');
const tasks = (t: readonly string[] | undefined) => (t?.length ? t.map((x) => m.task[x] ?? x).join(', ') : messages.none);
/** 화면 입력(datetime-local, 한국 시간) → 계약 date-time */
const seoulInput = (v: string) => `${v}:00+09:00`;

/** `/c/:mfcId/workers/*` */
export function WorkersMenu({ mfcId }: { readonly mfcId: string }) {
  return (
    <Routes>
      <Route index element={<WorkerListPage mfcId={mfcId} />} />
      <Route path="new" element={<WorkerRegisterPage mfcId={mfcId} />} />
      <Route path=":workerId" element={<WorkerDetailPage mfcId={mfcId} />} />
    </Routes>
  );
}

function StateBadge({ state }: { readonly state: WorkerState | undefined }) {
  if (!state) return <>{messages.none}</>;
  const tone = state === 'ACTIVE' ? 'badge-success' : state === 'SUSPENDED' ? 'badge-warning' : 'badge-ghost';
  return <span className={`badge badge-sm ${tone}`}>{m.state[state] ?? state}</span>;
}

/** 오늘 출근(일일크루만): 등록됨 / 출근 전 */
const todayText = (w: Worker) => (w.employmentType !== 'DAILY' ? messages.none : w.todayEnrollment ? m.enrolled : m.notEnrolled);

// ---------------------------------------------------------------- 목록

function WorkerListPage({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const raw = params.get('state');
  const state = isState(raw) ? raw : undefined;
  const query = useQuery({
    queryKey: ['workers', mfcId, state ?? 'DEFAULT'],
    queryFn: async () =>
      (await request('GET', api.capacity.GET('/mfcs/{mfcId}/workers', { params: { path: { mfcId }, query: state ? { state } : {} } }))).items ?? [],
  });
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{messages.menus.workers}</h1>
        <Link to={workersPath(mfcId, 'new')} className="btn btn-sm btn-primary">
          {m.register}
        </Link>
      </div>
      <p className="text-sm opacity-70">{m.intro}</p>
      <label className="flex w-fit flex-col gap-1 rounded-box bg-base-100 p-3 text-sm">
        {m.stateFilter}
        <select
          className="select select-sm w-44"
          value={state ?? ''}
          onChange={(e) => {
            const next = new URLSearchParams(params);
            if (e.target.value) next.set('state', e.target.value);
            else next.delete('state');
            setParams(next, { replace: true });
          }}
        >
          <option value="">{m.defaultFilter}</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {m.state[s]}
            </option>
          ))}
        </select>
      </label>
      <QueryState state={toUiState(query, (rows) => rows.length === 0)} onRetry={() => void query.refetch()} emptyText={m.empty}>
        {(rows) => (
          <table className="table table-sm rounded-box bg-base-100">
            <thead>
              <tr>
                <th>{m.fields.name}</th>
                <th>{m.fields.workerId}</th>
                <th>{m.fields.employmentType}</th>
                <th>{m.fields.state}</th>
                <th>{m.fields.effective}</th>
                <th>{m.fields.onBreak}</th>
                <th>{m.fields.today}</th>
                <th>{m.fields.speed}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.workerId} data-testid="worker-row">
                  <td>
                    <Link className="link" to={workersPath(mfcId, encodeURIComponent(w.workerId ?? ''))}>
                      {w.displayName}
                    </Link>
                  </td>
                  <td className="font-mono text-xs">{w.workerId}</td>
                  <td>{m.employment[w.employmentType ?? ''] ?? w.employmentType ?? messages.none}</td>
                  <td>
                    <StateBadge state={w.state} />
                  </td>
                  <td>{tasks(w.effectiveTaskTypes)}</td>
                  <td>{w.onBreak ? <span className="badge badge-sm badge-info">{m.onBreak}</span> : messages.none}</td>
                  <td>{todayText(w)}</td>
                  <td>{w.speedFactor ?? messages.none}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </QueryState>
    </section>
  );
}

// ---------------------------------------------------------------- 공용 입력

function TaskTypePicker({ label, value, onChange, hint }: { readonly label: string; readonly value: readonly TaskType[]; readonly onChange: (v: TaskType[]) => void; readonly hint?: string }) {
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1">{label}</legend>
      <div className="flex flex-wrap gap-3">
        {TASK_TYPES.map((t) => (
          <label key={t} className="flex items-center gap-1">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={value.includes(t)}
              onChange={(e) => onChange(e.target.checked ? [...value, t] : value.filter((x) => x !== t))}
            />
            {m.task[t]}
          </label>
        ))}
      </div>
      {hint && <p className="text-xs opacity-70">{hint}</p>}
    </fieldset>
  );
}

function ReasonInput({ label, value, onChange }: { readonly label: string; readonly value: string; readonly onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      {label}
      <input className="input input-sm w-72" maxLength={200} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// ---------------------------------------------------------------- 등록

function WorkerRegisterPage({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [workerId, setWorkerId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [employmentType, setEmploymentType] = useState<EmploymentType>('REGULAR');
  const [duty, setDuty] = useState<TaskType[]>([]);
  const [ownQualification, setOwnQualification] = useState(false);
  const [qualification, setQualification] = useState<TaskType[]>([]);
  const [expiresAt, setExpiresAt] = useState('');
  const ok = !!workerId.trim() && !!displayName.trim() && duty.length > 0 && (!ownQualification || qualification.length > 0);
  const register = useCommand(async (_: null, key) => {
    const created = await request(
      'POST',
      api.capacity.POST('/mfcs/{mfcId}/workers', {
        ...commandParams(key, { path: { mfcId } }),
        body: {
          workerId: workerId.trim(),
          displayName: displayName.trim(),
          employmentType,
          duty: { taskTypes: duty },
          ...(ownQualification ? { qualification: { taskTypes: qualification, expiresAt: expiresAt ? seoulInput(expiresAt) : null } } : {}),
        },
      }),
    );
    await queryClient.invalidateQueries({ queryKey: ['workers', mfcId] });
    if (created.workerId) void navigate(workersPath(mfcId, encodeURIComponent(created.workerId)), { state: { created: true } });
    return created;
  });
  return (
    <section className="max-w-3xl space-y-4">
      <Link to={workersPath(mfcId)} className="link text-sm">
        {m.back}
      </Link>
      <h1 className="text-xl font-bold">{m.register}</h1>
      <form
        className="space-y-3 rounded-box bg-base-100 p-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          if (register.phase.kind === 'rejected' || register.phase.kind === 'done') register.reset();
          void register.run(null);
        }}
      >
        <label className="flex flex-col gap-1">
          {m.fields.workerId}
          <input className="input input-sm w-64 font-mono" maxLength={64} value={workerId} onChange={(e) => setWorkerId(e.target.value.trim())} />
          <span className="text-xs opacity-70">{m.workerIdHint}</span>
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            {m.fields.name}
            <input className="input input-sm w-48" maxLength={60} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            {m.fields.employmentType}
            <select className="select select-sm w-36" value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}>
              {EMPLOYMENT.map((t) => (
                <option key={t} value={t}>
                  {m.employment[t]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {employmentType === 'DAILY' && <p className="text-xs opacity-70">{m.dailyNote}</p>}
        <TaskTypePicker label={m.fields.duty} value={duty} onChange={setDuty} hint={m.dutyHint} />
        <label className="flex items-center gap-2">
          <input type="checkbox" className="checkbox checkbox-sm" checked={ownQualification} onChange={(e) => setOwnQualification(e.target.checked)} />
          {m.qualificationOwn}
        </label>
        {ownQualification ? (
          <div className="space-y-2 rounded-box border border-base-300 p-3">
            <TaskTypePicker label={m.fields.qualification} value={qualification} onChange={setQualification} />
            <label className="flex flex-col gap-1">
              {m.fields.expiresAt}
              <input className="input input-sm w-56" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              <span className="text-xs opacity-70">{m.expiresHint}</span>
            </label>
          </div>
        ) : (
          <p className="text-xs opacity-70">{m.qualificationDefault}</p>
        )}
        <button type="submit" className="btn btn-sm btn-primary" disabled={!ok || register.busy}>
          {m.register}
        </button>
        <CommandFeedback command={register} />
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- 상세

type Notify = (text: string | null, affected?: readonly Assignment[]) => void;

function WorkerDetailPage({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const { workerId = '' } = useParams();
  const routerLocation = useRouterLocation();
  const [notice, setNotice] = useState<{ text: string | null; affected: readonly Assignment[] }>({
    text: (routerLocation.state as { created?: boolean } | null)?.created ? m.created : null,
    affected: [],
  });
  const notify: Notify = (text, affected = []) => setNotice({ text, affected });
  const query = useQuery({
    queryKey: ['worker', mfcId, workerId],
    queryFn: () => request('GET', api.capacity.GET('/mfcs/{mfcId}/workers/{workerId}', { params: { path: { mfcId, workerId } } })),
  });
  return (
    <section className="max-w-4xl space-y-4">
      <Link to={workersPath(mfcId)} className="link text-sm">
        {m.back}
      </Link>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(w) => (
          <>
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold">
              {w.displayName}
              <span className="font-mono text-base opacity-70">{w.workerId}</span>
              <StateBadge state={w.state} />
              {w.onBreak && <span className="badge badge-sm badge-info">{m.onBreak}</span>}
            </h1>
            {notice.text && (
              <p role="status" className="text-success text-sm">
                {notice.text}
              </p>
            )}
            {notice.affected.length > 0 && (
              <div role="alert" className="alert alert-warning flex-col items-start text-sm">
                <p className="font-semibold">{m.affected}</p>
                <ul className="list-disc pl-5" aria-label={m.affected}>
                  {notice.affected.map((a) => (
                    <li key={a.assignmentId}>{m.affectedTask(m.task[a.taskType ?? ''] ?? a.taskType ?? '', a.taskId ?? '')}</li>
                  ))}
                </ul>
              </div>
            )}
            <WorkerFacts worker={w} />
            <Section title={m.sections.breakDay}>
              <BreakAndDay mfcId={mfcId} worker={w} notify={notify} />
            </Section>
            <Section title={m.sections.shifts}>
              <Shifts mfcId={mfcId} workerId={workerId} notify={notify} />
            </Section>
            <Section title={m.sections.duty}>
              <DutyChange key={`duty-${w.duty?.dutyVersion ?? 0}`} mfcId={mfcId} worker={w} notify={notify} />
            </Section>
            <Section title={m.sections.qualification}>
              <QualificationChange key={`qual-${w.qualification?.qualificationVersion ?? 0}`} mfcId={mfcId} worker={w} notify={notify} />
            </Section>
            <Section title={m.sections.state}>
              <StateChange key={`state-${w.state ?? ''}`} mfcId={mfcId} worker={w} notify={notify} />
            </Section>
            <Section title={m.sections.speed}>
              <SpeedChange key={`speed-${w.speedFactor ?? 1}`} mfcId={mfcId} worker={w} notify={notify} />
            </Section>
            <Histories worker={w} />
          </>
        )}
      </QueryState>
    </section>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <details className="rounded-box bg-base-100" open={title === m.sections.breakDay}>
      <summary className="cursor-pointer p-3 font-semibold">{title}</summary>
      <div className="space-y-2 px-4 pb-4 text-sm">{children}</div>
    </details>
  );
}

function WorkerFacts({ worker: w }: { readonly worker: WorkerDetail }) {
  const q = w.qualification;
  const rows: ReadonlyArray<readonly [string, ReactNode]> = [
    [m.fields.employmentType, m.employment[w.employmentType ?? ''] ?? w.employmentType ?? messages.none],
    [m.fields.duty, `${tasks(w.duty?.taskTypes)} (v${w.duty?.dutyVersion ?? '-'})`],
    [
      m.fields.qualification,
      <>
        {`${tasks(q?.taskTypes)} (v${q?.qualificationVersion ?? '-'})`}
        {q?.expired && <span className="badge badge-sm badge-error ml-1">{m.expired}</span>}
      </>,
    ],
    [m.fields.expiresAt, q?.expiresAt ? formatSeoul(q.expiresAt) : m.noExpiry],
    [m.fields.effective, w.effectiveTaskTypes?.length ? tasks(w.effectiveTaskTypes) : m.noEffective],
    [m.fields.workAreas, w.workAreas?.length ? w.workAreas.map((a) => m.area[a] ?? a).join(', ') : messages.none],
    [m.fields.today, todayText(w)],
    [m.fields.speed, w.speedFactor ?? messages.none],
    [m.fields.registered, w.registeredAt ? m.by(w.registeredBy ?? '', formatSeoul(w.registeredAt)) : messages.none],
  ];
  return (
    <dl className="grid grid-cols-[11rem_1fr] gap-x-4 gap-y-1 rounded-box bg-base-100 p-4 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="opacity-70">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function useRefresh(mfcId: string, workerId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['worker', mfcId, workerId] });
    await queryClient.invalidateQueries({ queryKey: ['workers', mfcId] });
  };
}

/** 사유 + 제출 단추로 끝나는 바꾸기 양식 */
function ChangeForm({
  label,
  canSubmit,
  busy,
  onSubmit,
  children,
  feedback,
}: {
  readonly label: string;
  readonly canSubmit: boolean;
  readonly busy: boolean;
  readonly onSubmit: () => void;
  readonly children: ReactNode;
  readonly feedback: ReactNode;
}) {
  return (
    <form
      className="space-y-2"
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      {children}
      <button type="submit" className="btn btn-sm" disabled={!canSubmit || busy}>
        {m.save}
      </button>
      {feedback}
    </form>
  );
}

function DutyChange({ mfcId, worker, notify }: { readonly mfcId: string; readonly worker: Worker; readonly notify: Notify }) {
  const api = useApi();
  const workerId = worker.workerId ?? '';
  const refresh = useRefresh(mfcId, workerId);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([...(worker.duty?.taskTypes ?? [])]);
  const [reason, setReason] = useState('');
  const change = useCommand(async (_: null, key) => {
    notify(null);
    const r = await request(
      'POST',
      api.capacity.POST('/mfcs/{mfcId}/workers/{workerId}/duty-changes', {
        ...commandParams(key, { path: { mfcId, workerId }, version: worker.duty?.dutyVersion }),
        body: { taskTypes, reason: reason.trim() },
      }),
    );
    notify(r.changed ? m.saved : m.unchanged, r.affectedAssignments ?? []);
    await refresh();
    return r;
  });
  return (
    <ChangeForm
      label={m.sections.duty}
      canSubmit={taskTypes.length > 0 && !!reason.trim()}
      busy={change.busy}
      onSubmit={() => {
        if (change.phase.kind === 'rejected') change.reset();
        void change.run(null);
      }}
      feedback={<CommandFeedback command={change} />}
    >
      <p className="text-xs opacity-70">{m.dutyChangeHint}</p>
      <TaskTypePicker label={m.fields.duty} value={taskTypes} onChange={setTaskTypes} />
      <ReasonInput label={`${m.sections.duty} ${m.fields.reason}`} value={reason} onChange={setReason} />
    </ChangeForm>
  );
}

function QualificationChange({ mfcId, worker, notify }: { readonly mfcId: string; readonly worker: Worker; readonly notify: Notify }) {
  const api = useApi();
  const workerId = worker.workerId ?? '';
  const refresh = useRefresh(mfcId, workerId);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([...(worker.qualification?.taskTypes ?? [])]);
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');
  const change = useCommand(async (_: null, key) => {
    notify(null);
    const r = await request(
      'POST',
      api.capacity.POST('/mfcs/{mfcId}/workers/{workerId}/qualification-changes', {
        ...commandParams(key, { path: { mfcId, workerId }, version: worker.qualification?.qualificationVersion }),
        body: { taskTypes, expiresAt: expiresAt ? seoulInput(expiresAt) : null, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      }),
    );
    notify(m.saved);
    await refresh();
    return r;
  });
  return (
    <ChangeForm
      label={m.sections.qualification}
      canSubmit={taskTypes.length > 0}
      busy={change.busy}
      onSubmit={() => {
        if (change.phase.kind === 'rejected') change.reset();
        void change.run(null);
      }}
      feedback={<CommandFeedback command={change} />}
    >
      <p className="text-xs opacity-70">{m.qualificationChangeHint}</p>
      <TaskTypePicker label={m.fields.qualification} value={taskTypes} onChange={setTaskTypes} />
      <label className="flex flex-col gap-1">
        {m.fields.expiresAt}
        <input className="input input-sm w-56" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        <span className="text-xs opacity-70">{m.expiresHint}</span>
      </label>
      <ReasonInput label={`${m.sections.qualification} ${m.fields.reason}`} value={reason} onChange={setReason} />
    </ChangeForm>
  );
}

function StateChange({ mfcId, worker, notify }: { readonly mfcId: string; readonly worker: Worker; readonly notify: Notify }) {
  const api = useApi();
  const workerId = worker.workerId ?? '';
  const refresh = useRefresh(mfcId, workerId);
  const [state, setState] = useState<WorkerState>(worker.state ?? 'ACTIVE');
  const [reason, setReason] = useState('');
  const change = useCommand(async (_: null, key) => {
    notify(null);
    const r = await request(
      'POST',
      api.capacity.POST('/mfcs/{mfcId}/workers/{workerId}/state-changes', {
        ...commandParams(key, { path: { mfcId, workerId } }),
        body: { state, reason: reason.trim() },
      }),
    );
    notify(r.changed ? m.saved : m.unchanged, r.affectedAssignments ?? []);
    await refresh();
    return r;
  });
  return (
    <ChangeForm
      label={m.sections.state}
      canSubmit={state !== worker.state && !!reason.trim()}
      busy={change.busy}
      onSubmit={() => {
        if (change.phase.kind === 'rejected') change.reset();
        void change.run(null);
      }}
      feedback={<CommandFeedback command={change} />}
    >
      <p className="text-xs opacity-70">{m.stateChangeHint}</p>
      <label className="flex flex-col gap-1">
        {m.fields.state}
        <select className="select select-sm w-36" value={state} onChange={(e) => setState(e.target.value as WorkerState)}>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {m.state[s]}
            </option>
          ))}
        </select>
      </label>
      <ReasonInput label={`${m.sections.state} ${m.fields.reason}`} value={reason} onChange={setReason} />
    </ChangeForm>
  );
}

function SpeedChange({ mfcId, worker, notify }: { readonly mfcId: string; readonly worker: Worker; readonly notify: Notify }) {
  const api = useApi();
  const workerId = worker.workerId ?? '';
  const refresh = useRefresh(mfcId, workerId);
  const [speed, setSpeed] = useState(String(worker.speedFactor ?? 1));
  const [reason, setReason] = useState('');
  const value = Number(speed);
  const valid = speed.trim() !== '' && value >= 0.5 && value <= 2;
  const change = useCommand(async (_: null, key) => {
    notify(null);
    const r = await request(
      'POST',
      api.capacity.POST('/mfcs/{mfcId}/workers/{workerId}/speed-changes', {
        ...commandParams(key, { path: { mfcId, workerId } }),
        body: { speedFactor: value, reason: reason.trim() },
      }),
    );
    notify(m.saved);
    await refresh();
    return r;
  });
  return (
    <ChangeForm
      label={m.sections.speed}
      canSubmit={valid && !!reason.trim()}
      busy={change.busy}
      onSubmit={() => {
        if (change.phase.kind === 'rejected') change.reset();
        void change.run(null);
      }}
      feedback={<CommandFeedback command={change} />}
    >
      <p className="text-xs opacity-70">{m.speedHint}</p>
      <label className="flex flex-col gap-1">
        {m.fields.speed}
        <input className="input input-sm w-28" type="number" min={0.5} max={2} step={0.1} value={speed} onChange={(e) => setSpeed(e.target.value)} />
      </label>
      <ReasonInput label={`${m.sections.speed} ${m.fields.reason}`} value={reason} onChange={setReason} />
    </ChangeForm>
  );
}

function BreakAndDay({ mfcId, worker, notify }: { readonly mfcId: string; readonly worker: Worker; readonly notify: Notify }) {
  const api = useApi();
  const workerId = worker.workerId ?? '';
  const refresh = useRefresh(mfcId, workerId);
  const path = { mfcId, workerId };
  const toggleBreak = useCommand(async (start: boolean, key) => {
    notify(null);
    const r = start
      ? await request('POST', api.capacity.POST('/mfcs/{mfcId}/workers/{workerId}/breaks', { ...commandParams(key, { path }) }))
      : await request('POST', api.capacity.POST('/mfcs/{mfcId}/workers/{workerId}/breaks/current/end', { ...commandParams(key, { path }) }));
    notify(start ? m.breakStarted : m.breakEnded);
    await refresh();
    return r;
  });
  const enroll = useCommand(async (_: null, key) => {
    notify(null);
    // 날짜를 보내지 않는다 — 생략 = 오늘(Asia/Seoul, 서버가 정함)
    const r = await request('POST', api.capacity.POST('/mfcs/{mfcId}/workers/{workerId}/day-enrollments', { ...commandParams(key, { path }), body: {} }));
    notify(m.enrolledDone);
    await refresh();
    return r;
  });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-sm"
          disabled={toggleBreak.busy}
          onClick={() => {
            if (toggleBreak.phase.kind === 'rejected' || toggleBreak.phase.kind === 'done') toggleBreak.reset();
            void toggleBreak.run(!worker.onBreak);
          }}
        >
          {worker.onBreak ? m.endBreak : m.startBreak}
        </button>
        {worker.employmentType === 'DAILY' && !worker.todayEnrollment && (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={enroll.busy}
            onClick={() => {
              if (enroll.phase.kind === 'rejected') enroll.reset();
              void enroll.run(null);
            }}
          >
            {m.enrollToday}
          </button>
        )}
      </div>
      {worker.employmentType === 'DAILY' && <p className="text-xs opacity-70">{m.dailyNote}</p>}
      <CommandFeedback command={toggleBreak} />
      <CommandFeedback command={enroll} />
    </div>
  );
}

function Shifts({ mfcId, workerId, notify }: { readonly mfcId: string; readonly workerId: string; readonly notify: Notify }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const path = { mfcId, workerId };
  const query = useQuery({
    queryKey: ['shifts', mfcId, workerId],
    queryFn: async () => (await request('GET', api.capacity.GET('/mfcs/{mfcId}/workers/{workerId}/shifts', { params: { path } }))).items ?? [],
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['shifts', mfcId, workerId] });
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [note, setNote] = useState('');
  const add = useCommand(async (_: null, key) => {
    notify(null);
    const r = await request(
      'POST',
      api.capacity.POST('/mfcs/{mfcId}/workers/{workerId}/shifts', {
        ...commandParams(key, { path }),
        body: { startAt: seoulInput(startAt), endAt: seoulInput(endAt), ...(note.trim() ? { note: note.trim() } : {}) },
      }),
    );
    notify(m.shiftAdded);
    setStartAt('');
    setEndAt('');
    setNote('');
    await refresh();
    return r;
  });
  return (
    <div className="space-y-3">
      <p className="text-xs opacity-70">{m.defaultShiftNote}</p>
      <QueryState state={toUiState(query, (rows) => rows.length === 0)} onRetry={() => void query.refetch()} emptyText={m.shiftsEmpty}>
        {(rows) => (
          <ul className="space-y-2">
            {rows.map((s) => (
              <li key={s.shiftId} data-testid="shift-row" className="flex flex-wrap items-center gap-2">
                <span>{`${s.startAt ? formatSeoul(s.startAt) : ''} ~ ${s.endAt ? formatSeoul(s.endAt) : ''}`}</span>
                {s.note && <span className="opacity-70">{s.note}</span>}
                <CancelShift mfcId={mfcId} workerId={workerId} shiftId={s.shiftId ?? ''} label={s.startAt ? formatSeoul(s.startAt) : ''} notify={notify} onDone={refresh} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      <form
        className="flex flex-wrap items-end gap-2 border-t border-base-200 pt-3"
        aria-label={m.addShift}
        onSubmit={(e) => {
          e.preventDefault();
          if (!startAt || !endAt) return;
          if (add.phase.kind === 'rejected' || add.phase.kind === 'done') add.reset();
          void add.run(null);
        }}
      >
        <label className="flex flex-col gap-1">
          {m.shiftStart}
          <input className="input input-sm w-56" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {m.shiftEnd}
          <input className="input input-sm w-56" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {m.shiftNote}
          <input className="input input-sm w-48" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-sm" disabled={!startAt || !endAt || add.busy}>
          {m.addShift}
        </button>
        <p className="w-full text-xs opacity-70">{m.shiftHint}</p>
        <div className="w-full">
          <CommandFeedback command={add} />
        </div>
      </form>
    </div>
  );
}

function CancelShift({
  mfcId,
  workerId,
  shiftId,
  label,
  notify,
  onDone,
}: {
  readonly mfcId: string;
  readonly workerId: string;
  readonly shiftId: string;
  readonly label: string;
  readonly notify: Notify;
  readonly onDone: () => Promise<void>;
}) {
  const api = useApi();
  const [reason, setReason] = useState('');
  const cancel = useCommand(async (_: null, key) => {
    notify(null);
    const r = await request(
      'POST',
      api.capacity.POST('/mfcs/{mfcId}/workers/{workerId}/shifts/{shiftId}/cancellations', {
        ...commandParams(key, { path: { mfcId, workerId, shiftId } }),
        body: { reason: reason.trim() },
      }),
    );
    notify(m.shiftCancelled);
    await onDone();
    return r;
  });
  return (
    <form
      className="flex flex-wrap items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim()) return;
        if (cancel.phase.kind === 'rejected') cancel.reset();
        void cancel.run(null);
      }}
    >
      <input className="input input-xs w-40" maxLength={200} aria-label={m.cancelShiftReason(label)} placeholder={m.fields.reason} value={reason} onChange={(e) => setReason(e.target.value)} />
      <button type="submit" className="btn btn-xs" disabled={!reason.trim() || cancel.busy}>
        {m.cancelShift}
      </button>
      <CommandFeedback command={cancel} />
    </form>
  );
}

function Histories({ worker: w }: { readonly worker: WorkerDetail }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-box bg-base-100 p-4 text-sm">
        <h2 className="mb-2 font-semibold">{m.sections.dutyHistory}</h2>
        <ul className="space-y-1">
          {(w.dutyHistory ?? []).map((d) => (
            <li key={d.dutyVersion}>
              {`v${d.dutyVersion ?? ''} ${tasks(d.taskTypes)}`}
              <span className="ml-1 text-xs opacity-70">{`${d.reason ?? ''} ${d.changedAt ? m.by(d.changedBy ?? '', formatSeoul(d.changedAt)) : ''}`.trim()}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-box bg-base-100 p-4 text-sm">
        <h2 className="mb-2 font-semibold">{m.sections.stateHistory}</h2>
        <ul className="space-y-1">
          {(w.stateHistory ?? []).map((s, i) => (
            <li key={`${s.changedAt ?? ''}-${i}`}>
              {`${s.fromState ? `${m.state[s.fromState] ?? s.fromState} → ` : ''}${m.state[s.toState ?? ''] ?? s.toState ?? ''}`}
              <span className="ml-1 text-xs opacity-70">{`${s.reason ?? ''} ${s.changedAt ? m.by(s.changedBy ?? '', formatSeoul(s.changedAt)) : ''}`.trim()}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
