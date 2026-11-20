// 홈 보탬(2026-11-19 사용자 "MFC 웹에 필요한 기능 알아서 더 넣어") — 모두 이미 읽는 서버 값만 센다(새 API 없음).
// 1) 작업 흐름 두 줄(통합 백오피스 실시간 배송 LiveBoards 모양): 위 "먼저 확인"(늦음·멈춤·막힘·담당 없음), 아래 유형별 단계(대기 › 배정 › 진행).
//    원천 = 운영판의 끝나지 않은 작업 조회(opsQueries, 같은 키 — 다시 읽지 않는다). 다 못 읽었으면(쪽 상한) "이상".
//    누르면 작업 현황이 그 유형·상태로(주소 쿼리). 늦음·멈춤은 서버 표시값(TaskSummary.late·idle) — 화면이 판정하지 않는다.
// 2) 작업자 지금: 재직 작업자(capacity `GET …/workers?state=ACTIVE`)마다 맡은 끝나지 않은 작업 수(작업의 담당 투영)·휴게.
//    "맡은 일 없음"은 쉬는 중이 아닌데 끝나지 않은 작업이 0인 사람 — 작업 목록을 다 읽었을 때만 보인다(잘렸으면 모른다).
// 3) 최근 본 것: 이 브라우저·이 센터에서 연 상세(recentViews — 화면 표기만, 시스템 ID 없음).
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { useOperatorLabel } from '../../shared/OperatorLabel';
import { recentPath, useRecentViews } from '../../shared/recentViews';
import type { TaskSummary } from './opsRules';
import type { useOpenTasks } from './opsQueries';

const m = messages.ops.flow;
type OpenTasks = ReturnType<typeof useOpenTasks>;

const STAGE_TYPES = ['PICK', 'PACK', 'DISPATCH', 'RETURN'] as const;
const STAGES = [
  { key: 'before', states: ['WAITING'], query: 'WAITING' },
  { key: 'wait', states: ['READY'], query: 'READY' },
  { key: 'assigned', states: ['ASSIGNED'], query: 'ASSIGNED' },
  { key: 'doing', states: ['IN_PROGRESS'], query: 'IN_PROGRESS' },
] as const;

const tasksLink = (mfcId: string, q: Record<string, string>) => `${centerPath(mfcId, 'tasks')}?${new URLSearchParams(q).toString()}`;

export function FlowBoard({ mfcId, tasks }: { readonly mfcId: string; readonly tasks: OpenTasks }) {
  if (tasks.isError) return null; // 원천 실패는 위 숫자 칸·예외 처리함이 이미 "조회 실패"로 보인다
  const items: readonly TaskSummary[] = tasks.data?.items ?? [];
  const more = tasks.data ? !tasks.data.complete : false;
  const n = (k: number) => (tasks.data ? (more ? m.atLeast(k) : String(k)) : '…');
  const count = (pick: (t: TaskSummary) => boolean) => items.filter(pick).length;
  const first = [
    { key: 'late', n: count((t) => !!t.late), tone: 'text-error', to: tasksLink(mfcId, {}) },
    { key: 'idle', n: count((t) => !!t.idle), tone: 'text-warning', to: tasksLink(mfcId, {}) },
    { key: 'blocked', n: count((t) => t.state === 'BLOCKED'), tone: 'text-error', to: tasksLink(mfcId, { state: 'BLOCKED' }) },
    { key: 'unassigned', n: count((t) => t.state === 'READY'), tone: 'text-warning', to: tasksLink(mfcId, { state: 'READY' }) },
  ] as const;
  return (
    <section className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4" data-testid="flow-board" aria-label={m.title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">{m.title}</h2>
        <span className="text-xs text-base-content/50">{m.note}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2" data-testid="flow-first">
        <span className="mr-1 text-xs font-semibold text-base-content/60">{m.firstCheck}</span>
        {first.map((f) => (
          <Link
            key={f.key}
            to={f.to}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${f.n > 0 ? 'border-current/30 bg-base-100' : 'border-base-300 text-base-content/50'}`}
            data-testid={`flow-first-${f.key}`}
          >
            <span>{m.first[f.key]}</span>
            <span className={`font-bold tabular-nums ${f.n > 0 ? f.tone : ''}`}>{n(f.n)}</span>
          </Link>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="table table-sm" data-testid="flow-stages">
          <thead>
            <tr>
              <th>{m.type}</th>
              {STAGES.map((s, i) => (
                <th key={s.key}>
                  {i > 0 && <span className="mr-2 text-base-content/50" aria-hidden="true">›</span>}
                  {m.stage[s.key]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STAGE_TYPES.map((type) => (
              <tr key={type} data-testid={`flow-row-${type}`}>
                <td className="font-semibold">{messages.tasks.taskType[type] ?? type}</td>
                {STAGES.map((s) => {
                  const k = count((t) => t.taskType === type && (s.states as readonly string[]).includes(t.state ?? ''));
                  return (
                    <td key={s.key}>
                      <Link to={tasksLink(mfcId, { type, state: s.query })} className={`tabular-nums ${k > 0 ? 'link font-bold' : 'text-base-content/40'}`} data-testid={`flow-${type}-${s.key}`}>
                        {n(k)}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 작업자 지금

export function WorkerLoad({ mfcId, tasks }: { readonly mfcId: string; readonly tasks: OpenTasks }) {
  const api = useApi();
  const workers = useQuery({
    queryKey: ['workers', mfcId, 'ACTIVE'],
    queryFn: async () => (await request('GET', api.capacity.GET('/mfcs/{mfcId}/workers', { params: { path: { mfcId }, query: { state: 'ACTIVE' } } }))).items ?? [],
    refetchInterval: 60_000,
  });
  const complete = tasks.data?.complete ?? false;
  const mine = (workerId: string | undefined) => (tasks.data?.items ?? []).filter((t) => !!workerId && t.assignment?.workerId === workerId);
  return (
    <section className="space-y-2 rounded-box border border-base-300 bg-base-100 p-4" data-testid="worker-load" aria-label={m.workersTitle}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">{m.workersTitle}</h2>
        <Link to={centerPath(mfcId, 'workers')} className="link text-xs">
          {m.allWorkers}
        </Link>
      </div>
      {workers.isPending ? (
        <span className="loading loading-dots loading-sm" aria-label={messages.loading} />
      ) : workers.isError ? (
        <p role="alert" className="text-sm text-error">
          {m.workersFailed}
          <button type="button" className="btn btn-xs ml-2" onClick={() => void workers.refetch()}>
            {messages.ops.retry}
          </button>
        </p>
      ) : workers.data.length === 0 ? (
        <p className="text-sm text-base-content/60">{m.noWorkers}</p>
      ) : (
        <ul className="divide-y divide-base-200 text-sm">
          {[...workers.data]
            .map((w) => ({ w, list: mine(w.workerId) }))
            .sort((a, b) => b.list.length - a.list.length)
            .map(({ w, list }) => {
              const doing = list.filter((t) => t.state === 'IN_PROGRESS').length;
              const alert = list.some((t) => t.late || t.idle);
              return (
                <li key={w.workerId} className="flex flex-wrap items-center gap-2 py-1.5" data-testid="worker-load-row">
                  <Link to={centerPath(mfcId, `workers/${encodeURIComponent(w.workerId ?? '')}`)} className="link min-w-0 font-medium">
                    <WorkerLabel name={w.name ?? w.displayName} employeeNo={w.employeeNo} workerId={w.workerId} />
                  </Link>
                  {w.onBreak && <span className="badge badge-sm badge-info">{m.onBreak}</span>}
                  {alert && <span className="badge badge-sm badge-error">{m.hasLate}</span>}
                  <span className="ml-auto text-xs text-base-content/70">
                    {tasks.data ? (
                      list.length > 0 ? (
                        m.load(list.length, doing)
                      ) : complete && !w.onBreak ? (
                        <span className="font-semibold text-warning" data-testid="worker-free">
                          {m.free}
                        </span>
                      ) : complete ? (
                        m.load(0, 0)
                      ) : (
                        m.unknownLoad
                      )
                    ) : tasks.isError ? (
                      m.unknownLoad
                    ) : (
                      '…'
                    )}
                  </span>
                </li>
              );
            })}
        </ul>
      )}
    </section>
  );
}

/** "이름 · 사번" — 사번은 hr employee-labels(못 읽으면 이름만) */
function WorkerLabel({ name, employeeNo, workerId }: { readonly name: string | null | undefined; readonly employeeNo: string | null | undefined; readonly workerId: string | undefined }) {
  const label = useOperatorLabel(employeeNo ? null : workerId);
  const no = employeeNo ?? label.data?.employeeNo ?? null;
  return (
    <>
      {name ?? label.data?.name ?? messages.none}
      {no && <span className="font-normal text-base-content/60">{` · ${no}`}</span>}
    </>
  );
}

// ---------------------------------------------------------------- 최근 본 것

export function RecentPanel({ mfcId }: { readonly mfcId: string }) {
  const items = useRecentViews().filter((e) => e.mfcId === mfcId);
  return (
    <section className="space-y-2 rounded-box border border-base-300 bg-base-100 p-4" data-testid="recent-panel" aria-label={m.recentTitle}>
      <h2 className="font-bold">{m.recentTitle}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-base-content/50">{m.recentEmpty}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((e) => (
            <li key={`${e.kind}:${e.id}`} className="flex items-center gap-2">
              <span className="badge badge-ghost badge-sm shrink-0">{m.recentKind[e.kind]}</span>
              <Link to={recentPath[e.kind](mfcId, e.id)} className="link truncate" data-testid="recent-item">
                {e.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
