// 작업자 — mfc-capacity-service 0.14.0 `/mfcs/{mfcId}/workers*`(요청서 mfc-backoffice/2026-11-15 §2·§2-1 "등록, 고용 형태·자격·업무, 상태, 근무, 휴게, 일일크루").
// - 목록 `GET …/workers?state=` — 비우면 서버 기본(재직·정지, 퇴사 빼고). 상태 거르기는 URL 쿼리.
// - 등록 `POST …/workers`(MFC_SUPERVISOR) — workerId = 직원 계정의 운영자 ID(바꿀 수 없음). 자격은 생략하면 서버 기본.
// - 상세 `GET …/workers/{id}`(WorkerDetail — 업무·상태 이력). 바꾸기:
//   업무 `duty-changes`(X-Expected-Version = dutyVersion, 사유 필수) / 자격 `qualification-changes`(X-Expected-Version = qualificationVersion)
//   상태 `state-changes`(사유 필수) / 속도 `speed-changes`(0.5~2.0, 사유 필수) — 업무·상태 응답의 affectedAssignments(맞지 않는 배정)를 보인다(지우지 않음).
//   휴게 `breaks`·`breaks/current/end`, 일일크루 오늘 출근 `day-enrollments`(날짜 생략 = 오늘, 서버가 정함).
//   근무 `shifts`(목록·등록·취소) — 시각 입력은 한국 시간(+09:00)으로 보낸다.
//   (0.20.0) 근무의 휴게 구간 `breakStartAt`·`breakEndAt`(둘 다 또는 둘 다 없음, 근무 안 — 서버가 400) → 그 시간에 자동 휴게.
// - (0.20.0) 센터 휴게 번호 `GET·PUT /mfcs/{mfcId}/break-pin` — 작업자가 PDA 로 휴게를 켤 때 넣는 4자리. 서버는 번호를 돌려주지 않는다.
// - 지금 배정 조건(effectiveTaskTypes)·PDA 업무(workAreas)는 서버 값을 보이기만 한다(계산하지 않음).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation as useRouterLocation, useNavigate, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/mfc-capacity';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { SystemNumbers } from '../../shared/displayNumber';
import { SearchBar, StatCard } from '../../shared/listParts';
import { Pager, usePage } from '../../shared/Pager';
import { useOperatorLabel, WhoAt } from '../../shared/OperatorLabel';
import { assignTaskName } from '../../shared/pickPack';
import { useRecordRecent, useSeenIds } from '../../shared/recentViews';
import { SavedViews } from '../../shared/SavedViews';
import { SeenMark } from '../../shared/SeenMark';
import { StickyTitle, useScrolledPast } from '../../shared/StickyTitle';
import { QueueNav, useRememberQueue } from '../../shared/workQueue';
import { BreakPinCard } from './BreakPinCard';

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
/**
 * 피킹·포장은 한 사람이 이어서 하는 일(포장은 피킹한 사람이 받는다, 사용자 2026-11-20 "업무 분리 불필요") —
 * 화면에서는 "피패킹" 한 칸으로 고르고 보이며, 서버에는 계약 그대로 PICK·PACK 둘을 함께 보낸다.
 */
const PICK_PACK: readonly TaskType[] = ['PICK', 'PACK'];
const PICKER: readonly { readonly key: string; readonly types: readonly TaskType[] }[] = [
  { key: 'PICK_PACK', types: PICK_PACK },
  ...TASK_TYPES.filter((t) => !PICK_PACK.includes(t)).map((t) => ({ key: t, types: [t] })),
];
/** 작업 유형 목록 → 화면 글. PICK·PACK 이 함께 있으면 "피패킹" 하나로(예전 데이터처럼 하나만 있으면 그 이름 그대로) */
const taskLabels = (t: readonly string[]): string[] => {
  const both = PICK_PACK.every((x) => t.includes(x));
  const out: string[] = [];
  for (const x of t) {
    if (both && (PICK_PACK as readonly string[]).includes(x)) {
      if (!out.includes(m.pickPack)) out.push(m.pickPack);
    } else out.push(m.task[x] ?? x);
  }
  return out;
};
const tasks = (t: readonly string[] | undefined) => (t?.length ? taskLabels(t).join(', ') : messages.none);
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

/** 작업자 목록 한 쪽 줄 수(사용자 2026-11-20) */
const WORKER_PAGE_SIZE = 15;

function WorkerListPage({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const { pathname, search } = useRouterLocation();
  const raw = params.get('state');
  const state = isState(raw) ? raw : undefined;
  const query = useQuery({
    queryKey: ['workers', mfcId, state ?? 'DEFAULT'],
    queryFn: async () =>
      (await request('GET', api.capacity.GET('/mfcs/{mfcId}/workers', { params: { path: { mfcId }, query: state ? { state } : {} } }))).items ?? [],
  });
  // 숫자 카드: 서버 기본 목록(재직·정지 — 쪽 나눔 없이 전부)을 센다. 거르기와 상관없이 같은 숫자(같은 조회 키라 두 번 읽지 않는다)
  const all = useQuery({
    queryKey: ['workers', mfcId, 'DEFAULT'],
    queryFn: async () => (await request('GET', api.capacity.GET('/mfcs/{mfcId}/workers', { params: { path: { mfcId }, query: {} } }))).items ?? [],
  });
  const cell = (pick: (w: Worker) => boolean) => (all.data ? m.ui.count(all.data.filter(pick).length) : all.isError ? '?' : '…');
  const setState = (v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set('state', v);
    else next.delete('state');
    next.delete('page'); // 거르기가 바뀌면 1쪽부터
    setParams(next, { replace: true });
  };
  const seen = useSeenIds('worker', mfcId);
  // 한 쪽 15명, 목록 위·아래에 쪽 넘김(사용자 2026-11-20) — 서버는 쪽 나눔 없이 전부 준다
  const paging = usePage(query.data?.length ?? 0, WORKER_PAGE_SIZE);
  const ids = (query.data ?? []).map((w) => w.workerId ?? '').filter(Boolean);
  useRememberQueue('worker', mfcId, query.data ? ids : undefined, `${pathname}${search}`);
  return (
    <section className="space-y-4">
      {/* 쪽 제목은 "작업자 목록"(사용자 2026-11-20), 안내 상자는 두지 않는다 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>{messages.menus.workers}</h1>
        <Link to={workersPath(mfcId, 'new')} className="btn btn-sm btn-primary">
          {m.register}
        </Link>
      </div>
      {/* 숫자 칸 넷이 아래 표 너비를 꽉 채우게 4칸 격자(사용자 2026-11-20 — 공용 StatStrip 은 한 줄 5칸이라 오른쪽이 비었다) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="group" aria-label={m.ui.countsLabel} data-testid="worker-counts">
        <StatCard testId="count-ACTIVE" label={m.state.ACTIVE} value={cell((w) => w.state === 'ACTIVE')} tone="info" active={state === 'ACTIVE'} onClick={() => setState(state === 'ACTIVE' ? '' : 'ACTIVE')} />
        <StatCard
          testId="count-SUSPENDED"
          label={m.state.SUSPENDED}
          value={cell((w) => w.state === 'SUSPENDED')}
          tone={(all.data ?? []).some((w) => w.state === 'SUSPENDED') ? 'warning' : undefined}
          active={state === 'SUSPENDED'}
          onClick={() => setState(state === 'SUSPENDED' ? '' : 'SUSPENDED')}
        />
        <StatCard testId="count-break" label={m.onBreak} value={cell((w) => !!w.onBreak)} hint={m.ui.breakHint} />
        <StatCard testId="count-daily" label={m.ui.dailyNotEnrolled} value={cell((w) => w.employmentType === 'DAILY' && !w.todayEnrollment)} hint={m.ui.dailyHint} />
      </div>
      <SavedViews listKey={`workers.${mfcId}`} />
      {/* 목록 묶음 — 휴게 번호(정해 두었으면 왼쪽 위 작은 "관리자 번호 변경"만) → 검색 → 쪽 넘김 → 표 → 쪽 넘김을 붙여서 */}
      <div className="space-y-2" data-testid="worker-list">
        <BreakPinCard mfcId={mfcId} compact />
        <SearchBar summary={[[m.stateFilter, state ? (m.state[state] ?? state) : m.defaultFilter]]} startOpen={!state}>
        <label className="flex flex-col gap-1">
          {m.stateFilter}
          <select className="select select-sm w-44" value={state ?? ''} onChange={(e) => setState(e.target.value)}>
            <option value="">{m.defaultFilter}</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {m.state[s]}
              </option>
            ))}
          </select>
        </label>
      </SearchBar>
        <QueryState state={toUiState(query, (rows) => rows.length === 0)} onRetry={() => void query.refetch()} emptyText={m.empty}>
        {(rows) => (
          <>
          <Pager testId="worker-pager-top" page={paging.page} pageCount={paging.pageCount} total={rows.length} from={paging.from} to={paging.to} onChange={paging.set} />
          <div className="overflow-x-auto rounded-box bg-base-100">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>{m.ui.employee}</th>
                <th>{m.fields.employmentType}</th>
                <th>{m.fields.state}</th>
                <th>{m.fields.effective}</th>
                <th>{m.fields.onBreak}</th>
                <th>{m.fields.today}</th>
                <th>{m.fields.speed}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(paging.from, paging.to).map((w) => (
                <tr key={w.workerId} data-testid="worker-row">
                  <td>
                    {/* 직원 표기 = 이름 · 사번(ADR-0070) — 운영자 ID 는 상세의 시스템 번호 칸에만 */}
                    <Link className="link" to={workersPath(mfcId, encodeURIComponent(w.workerId ?? ''))}>
                      <WorkerName worker={w} />
                    </Link>
                    <SeenMark seen={seen.has(w.workerId ?? '')} />
                  </td>
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
          </div>
          <Pager testId="worker-pager-bottom" page={paging.page} pageCount={paging.pageCount} total={rows.length} from={paging.from} to={paging.to} onChange={paging.set} />
          </>
        )}
        </QueryState>
      </div>
    </section>
  );
}

/** "이름 · 사번" — capacity 0.23.0 작업자 `name`·`employeeNo`(인사 사본)가 있으면 그것, 없으면 hr employee-labels. 못 읽으면 이름만 + 알림(운영자 ID 를 대신 내지 않는다) */
function WorkerName({ worker: w }: { readonly worker: Worker }) {
  const label = useOperatorLabel(w.employeeNo ? null : w.workerId);
  const no = w.employeeNo ?? label.data?.employeeNo ?? null;
  return (
    <span data-testid="worker-name">
      {w.name ?? w.displayName ?? label.data?.name ?? messages.none}
      {no ? (
        <span className="text-base-content/60">{` · ${no}`}</span>
      ) : label.isError ? (
        <span className="ml-1 text-xs text-warning">{m.ui.noEmployeeNo}</span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------- 공용 입력

function TaskTypePicker({ label, value, onChange, hint }: { readonly label: string; readonly value: readonly TaskType[]; readonly onChange: (v: TaskType[]) => void; readonly hint?: string }) {
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1">{label}</legend>
      <div className="flex flex-wrap gap-3">
        {PICKER.map((o) => (
          <label key={o.key} className="flex items-center gap-1">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={o.types.every((t) => value.includes(t))}
              onChange={(e) => {
                const rest = value.filter((x) => !o.types.includes(x));
                onChange(e.target.checked ? [...rest, ...o.types] : rest);
              }}
            />
            {o.key === 'PICK_PACK' ? m.pickPack : m.task[o.key]}
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
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const past = useScrolledPast(titleRef);
  useRecordRecent('worker', mfcId, workerId, query.data?.displayName);
  return (
    <section className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={workersPath(mfcId)} className="link text-sm">
          {m.back}
        </Link>
        <div className="ml-auto">
          <QueueNav kind="worker" mfcId={mfcId} id={workerId} />
        </div>
      </div>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(w) => (
          <>
            {/* 직원 표기 = 이름 · 사번(ADR-0070) — 운영자 ID 는 시스템 번호 칸에만 */}
            <h1 ref={titleRef} className="flex flex-wrap items-center gap-2">
              <WorkerName worker={w} />
              <StateBadge state={w.state} />
              {w.onBreak && <span className="badge badge-sm badge-info">{m.onBreak}</span>}
            </h1>
            <StickyTitle
              show={past}
              title={<WorkerName worker={w} />}
              badges={
                <>
                  <StateBadge state={w.state} />
                  {w.onBreak && <span className="badge badge-sm badge-info">{m.onBreak}</span>}
                </>
              }
            />
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
                    <li key={a.assignmentId}>{m.affectedTask(assignTaskName(a.taskType), a.taskId ?? '')}</li>
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
            <DutyQualificationGuide worker={w} />
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
            <Activities mfcId={mfcId} workerId={workerId} />
            <Histories worker={w} />
            <SystemNumbers ids={[{ label: m.fields.workerId, id: w.workerId }]} />
          </>
        )}
      </QueryState>
    </section>
  );
}

/** 맡은 일(업무)과 할 수 있는 일(자격)의 차이와 지금 값(서버 값 그대로) — 사용자 2026-11-16 "두 기능이 같아 보인다" */
function DutyQualificationGuide({ worker: w }: { readonly worker: WorkerDetail }) {
  return (
    <div role="note" className="space-y-1 rounded-box border border-info/40 bg-info/10 p-3 text-sm" data-testid="duty-qualification-guide">
      <p>{m.howItWorks}</p>
      <p className="text-xs">
        {m.howItWorksNow(tasks(w.duty?.taskTypes), tasks(w.qualification?.taskTypes), w.effectiveTaskTypes?.length ? tasks(w.effectiveTaskTypes) : m.noEffective)}
      </p>
      {w.qualification?.expired && <p className="text-xs text-warning">{m.qualificationExpiredNote}</p>}
    </div>
  );
}

/** 지금 유효한 자격(만료면 없음) — 저장 전 미리 보기용. 확정 값은 서버 effectiveTaskTypes */
const qualifiedNow = (w: Worker): readonly TaskType[] => (w.qualification?.expired ? [] : (w.qualification?.taskTypes ?? []));
const notIn = (a: readonly TaskType[], b: readonly TaskType[]) => a.filter((t) => !b.includes(t));

function PreviewWarning({ list, text }: { readonly list: readonly TaskType[]; readonly text: (s: string) => string }) {
  if (list.length === 0) return null;
  return (
    <div className="text-xs" data-testid="preview-warning">
      <p className="text-warning">{text(taskLabels(list).join(', '))}</p>
      <p className="opacity-70">{m.previewNote}</p>
    </div>
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
    [m.fields.registered, w.registeredAt ? <WhoAt id={w.registeredBy} at={formatSeoul(w.registeredAt)} /> : messages.none],
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
      <PreviewWarning list={notIn(taskTypes, qualifiedNow(worker))} text={m.willNotAssign} />
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
      <PreviewWarning list={notIn(worker.duty?.taskTypes ?? [], taskTypes)} text={m.willDrop} />
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
  const [breakStartAt, setBreakStartAt] = useState('');
  const [breakEndAt, setBreakEndAt] = useState('');
  // 휴게 구간은 둘 다 적거나 둘 다 비운다(근무 안인지는 서버가 판정 — 400).
  const breakHalf = !!breakStartAt !== !!breakEndAt;
  const add = useCommand(async (_: null, key) => {
    notify(null);
    const r = await request(
      'POST',
      api.capacity.POST('/mfcs/{mfcId}/workers/{workerId}/shifts', {
        ...commandParams(key, { path }),
        body: {
          startAt: seoulInput(startAt),
          endAt: seoulInput(endAt),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(breakStartAt && breakEndAt ? { breakStartAt: seoulInput(breakStartAt), breakEndAt: seoulInput(breakEndAt) } : {}),
        },
      }),
    );
    notify(m.shiftAdded);
    setStartAt('');
    setEndAt('');
    setNote('');
    setBreakStartAt('');
    setBreakEndAt('');
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
                {s.breakStartAt && s.breakEndAt && (
                  <span className="badge badge-sm badge-info">{m.shiftBreak(formatSeoul(s.breakStartAt), formatSeoul(s.breakEndAt))}</span>
                )}
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
          if (!startAt || !endAt || breakHalf) return;
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
          {m.shiftBreakStart}
          <input className="input input-sm w-56" type="datetime-local" value={breakStartAt} onChange={(e) => setBreakStartAt(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {m.shiftBreakEnd}
          <input className="input input-sm w-56" type="datetime-local" value={breakEndAt} onChange={(e) => setBreakEndAt(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {m.shiftNote}
          <input className="input input-sm w-48" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-sm" disabled={!startAt || !endAt || breakHalf || add.busy}>
          {m.addShift}
        </button>
        {breakHalf && (
          <p role="alert" className="w-full text-xs text-error">
            {m.shiftBreakBoth}
          </p>
        )}
        <p className="w-full text-xs opacity-70">{m.shiftHint}</p>
        <p className="w-full text-xs opacity-70">{m.shiftBreakHint}</p>
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

/** 업무 내역 — `GET …/workers/{id}/activities?date=`(capacity 0.17.0). 펼칠 때만 부른다. 날짜를 비우면 서버의 오늘(Asia/Seoul). */
function Activities({ mfcId, workerId }: { readonly mfcId: string; readonly workerId: string }) {
  const api = useApi();
  const a = m.activities;
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const query = useQuery({
    queryKey: ['worker-activities', mfcId, workerId, date],
    enabled: open,
    queryFn: () =>
      request('GET', api.capacity.GET('/mfcs/{mfcId}/workers/{workerId}/activities', { params: { path: { mfcId, workerId }, query: date ? { date } : {} } })),
  });
  const name = (map: Readonly<Record<string, string>>, v: string | null | undefined) => (v ? (map[v] ?? v) : messages.none);
  return (
    <details className="rounded-box bg-base-100" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer p-3 font-semibold">{m.sections.activities}</summary>
      <div className="space-y-3 px-4 pb-4 text-sm" data-testid="activities">
        <p className="opacity-70">{a.intro}</p>
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1">
            {a.date}
            <input type="date" className="input input-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {date && (
            <button type="button" className="btn btn-sm" onClick={() => setDate('')}>
              {a.today}
            </button>
          )}
        </div>
        {open && (
          <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
            {(r) => (
              <div className="space-y-3">
                <p className="opacity-70">{r.date}</p>
                {r.unavailableSources.length > 0 && (
                  <p role="alert" className="alert alert-warning text-sm">
                    {a.unavailable(r.unavailableSources.join(', '))}
                  </p>
                )}
                {r.totals.length > 0 && (
                  <div>
                    <h3 className="font-semibold">{a.totals}</h3>
                    <div className="overflow-x-auto">
                    <table className="table table-xs w-fit">
                      <thead>
                        <tr>
                          <th>{a.col.type}</th>
                          <th>{a.col.count}</th>
                          <th>{a.col.qty}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.totals.map((t) => (
                          <tr key={`${t.source}-${t.activityType}`} data-testid="activity-total">
                            <td>{name(a.type, t.activityType)}</td>
                            <td>{t.count}</td>
                            <td>{t.qty}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                    <p className="text-xs opacity-70">{a.rejectedNote}</p>
                  </div>
                )}
                {r.items.length === 0 ? (
                  <p data-state="empty" className="opacity-70">
                    {a.empty}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                  <table className="table table-xs">
                    <thead>
                      <tr>
                        <th>{a.col.at}</th>
                        <th>{a.col.type}</th>
                        <th>{a.col.ref}</th>
                        <th>{a.col.sku}</th>
                        <th>{a.col.qty}</th>
                        <th>{a.col.result}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.items.map((it, i) => (
                        <tr key={`${it.source}-${it.refId}-${i}`} data-testid="activity-row" className={it.result === 'REJECTED' ? 'text-error' : ''}>
                          <td>{formatSeoul(it.at)}</td>
                          <td>{name(a.type, it.activityType)}</td>
                          <td className="font-mono">{it.taskId ?? it.refId}</td>
                          <td className="font-mono">{it.sku ?? messages.none}</td>
                          <td>{it.qty ?? messages.none}</td>
                          <td>{name(a.result, it.result)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            )}
          </QueryState>
        )}
      </div>
    </details>
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
              <span className="ml-1 text-xs opacity-70">
                {d.reason ? `${d.reason} ` : ''}
                {d.changedAt && <WhoAt id={d.changedBy} at={formatSeoul(d.changedAt)} />}
              </span>
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
              <span className="ml-1 text-xs opacity-70">
                {s.reason ? `${s.reason} ` : ''}
                {s.changedAt && <WhoAt id={s.changedBy} at={formatSeoul(s.changedAt)} />}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 센터 휴게 번호(capacity 0.20.0)
