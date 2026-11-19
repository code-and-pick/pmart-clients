// 작업 현황 — mfc-fulfillment-service 0.4.11(요청서 mfc-backoffice/2026-11-15 §2·§2-1 "센터 작업 목록·상세, 작업 풀기, 포장 상세·인계 상태").
// - 목록 `GET /tasks?mfcId=&type=&state=`(state 를 비우면 서버 기본 ASSIGNED·IN_PROGRESS), 커서 더 보기, 담당은 capacity 배정의 투영 — asOf 를 같이 보인다.
// - 상세 `GET /tasks/{taskId}`(줄·확정 대기·막힌 이유). 완료량은 서버 확정값만.
// - 내놓기 `POST /tasks/{id}/releases` {workerId = 지금 담당, reason} — ASSIGNED·IN_PROGRESS 만, 진행 중 실적이면 409 EXECUTION_IN_FLIGHT, 503 은 결과 불명(같은 키).
// - 출하 `GET /shipments/{id}`(포장·인계 허가), 포장 인계 판정 `GET /packages/{id}/handover-resolution`(누를 때만).
// - 확인 필요 포장 목록·확인(`GET /packages?checkRequired=true`, `handover-checks`) — 센터 관리자도(MB-3, fulfillment 0.17.0). `HandoverChecks.tsx`.
// - 늦음·멈춤은 서버 표시값 — 화면이 계산하지 않고, 자동으로 빼앗는 버튼도 없다.
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState, type ReactNode } from 'react';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/mfc-fulfillment';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { RiderLabel } from '../../shared/displayNumber';
import { Who } from '../../shared/OperatorLabel';
import { HandoverChecks } from './HandoverChecks';
import { ReassignForm, ReleaseForm, TaskActionButtons, type TaskAction } from './TaskActions';

const m = messages.tasks;

type Ful = components['schemas'];
type TaskType = Ful['TaskType'];
type TaskState = Ful['TaskState'];
type TaskSummary = Ful['TaskSummary'];
type TaskDetail = Ful['TaskDetail'];

const TYPES: readonly TaskType[] = ['PICK', 'PACK', 'DISPATCH', 'RETURN'];
const STATES: readonly TaskState[] = ['WAITING', 'READY', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED', 'CLOSED_PARTIAL'];
const isType = (v: string | null): v is TaskType => !!v && (TYPES as readonly string[]).includes(v);
const isState = (v: string | null): v is TaskState => !!v && (STATES as readonly string[]).includes(v);

/** 한 번에 받는 작업 수(계약 PageSize 기본값) */
export const TASK_PAGE_SIZE = 50;

const tasksPath = (mfcId: string, rest = '') => centerPath(mfcId, rest ? `tasks/${rest}` : 'tasks');

/** `/c/:mfcId/tasks/*` */
export function TasksMenu({ mfcId }: { readonly mfcId: string }) {
  return (
    <Routes>
      <Route index element={<TaskListPage mfcId={mfcId} />} />
      <Route path=":taskId" element={<TaskDetailPage mfcId={mfcId} />} />
    </Routes>
  );
}

function StateBadge({ state }: { readonly state: TaskState | undefined }) {
  if (!state) return <>{messages.none}</>;
  const tone =
    state === 'IN_PROGRESS' || state === 'ASSIGNED'
      ? 'badge-info'
      : state === 'COMPLETED'
        ? 'badge-success'
        : state === 'BLOCKED' || state === 'FAILED'
          ? 'badge-error'
          : state === 'READY'
            ? 'badge-warning'
            : 'badge-ghost';
  return <span className={`badge badge-sm ${tone}`}>{m.taskState[state] ?? state}</span>;
}

function Flags({ task }: { readonly task: TaskSummary }) {
  return (
    <>
      {task.late && <span className="badge badge-sm badge-error ml-1">{m.late}</span>}
      {task.idle && <span className="badge badge-sm badge-warning ml-1">{m.idle}</span>}
    </>
  );
}

// ---------------------------------------------------------------- 목록

function TaskListPage({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const rawType = params.get('type');
  const rawState = params.get('state');
  const type = isType(rawType) ? rawType : undefined;
  const state = isState(rawState) ? rawState : undefined;
  const query = useInfiniteQuery({
    queryKey: ['tasks', mfcId, type ?? 'ALL', state ?? 'DEFAULT'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request(
        'GET',
        api.fulfillment.GET('/tasks', {
          params: {
            query: { mfcId, ...(type ? { type } : {}), ...(state ? { state: [state] } : {}), size: TASK_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) },
          },
        }),
      ),
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  // 늦음·멈춤을 위로(빼앗을 대상을 찾기 쉽게 — 백엔드 알림 2026-11-19 §3), 나머지는 서버 순서 그대로
  const rows = (query.data?.pages ?? []).flatMap((p) => p.items ?? []).sort((a, b) => Number(!!(b.late || b.idle)) - Number(!!(a.late || a.idle)));
  const [open, setOpen] = useState<{ readonly taskId: string; readonly action: TaskAction } | null>(null);
  const asOf = query.data?.pages[0]?.asOf?.asOf;
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{messages.menus.tasks}</h1>
      <p className="text-sm opacity-70">{m.intro}</p>
      <HandoverChecks mfcId={mfcId} />
      <form className="flex flex-wrap items-end gap-2 rounded-box bg-base-100 p-3 text-sm" onSubmit={(e) => e.preventDefault()}>
        <label className="flex flex-col gap-1">
          {m.type}
          <select className="select select-sm w-32" value={type ?? ''} onChange={(e) => setFilter('type', e.target.value)}>
            <option value="">{m.allTypes}</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {m.taskType[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {m.state}
          <select className="select select-sm w-48" value={state ?? ''} onChange={(e) => setFilter('state', e.target.value)}>
            <option value="">{m.defaultState}</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {m.taskState[s]}
              </option>
            ))}
          </select>
        </label>
        {asOf && <span className="text-xs opacity-70">{m.asOf(formatSeoul(asOf))}</span>}
      </form>
      <p className="text-xs opacity-70">{m.lateHint}</p>
      <QueryState state={toUiState(query, () => rows.length === 0)} onRetry={() => void query.refetch()} emptyText={m.empty}>
        {() => (
          <div className="space-y-2">
            <table className="table table-sm rounded-box bg-base-100">
              <thead>
                <tr>
                  <th>{m.type}</th>
                  <th>{m.fields.product}</th>
                  <th>{m.state}</th>
                  <th>{m.fields.assignee}</th>
                  <th>{m.fields.qty}</th>
                  <th>{m.fields.promisedReadyAt}</th>
                  <th>{m.fields.lastActivity}</th>
                  <th>{m.actions.col}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <Fragment key={t.taskId}>
                  <tr data-testid="task-row">
                    <td>
                      <Link className="link" to={tasksPath(mfcId, encodeURIComponent(t.taskId ?? ''))}>
                        {m.taskType[t.taskType ?? ''] ?? t.taskType}
                      </Link>
                    </td>
                    <td>{m.headline(t.headline?.productName, t.headline?.otherLineCount ?? 0)}</td>
                    <td>
                      <StateBadge state={t.state} />
                      <Flags task={t} />
                    </td>
                    <td>
                      <Who id={t.assignment?.workerId} empty={m.unassigned} />
                    </td>
                    <td>{m.qty(t.plannedQty ?? 0, t.completedQty ?? 0, t.remainingQty ?? 0)}</td>
                    <td>{t.promisedReadyAt ? formatSeoul(t.promisedReadyAt) : messages.none}</td>
                    <td>{t.lastActivityAt ? formatSeoul(t.lastActivityAt) : messages.none}</td>
                    <td>
                      <TaskActionButtons
                        task={t}
                        open={open && open.taskId === t.taskId ? open.action : null}
                        onOpen={(a) => setOpen(a ? { taskId: t.taskId ?? '', action: a } : null)}
                      />
                    </td>
                  </tr>
                  {open && open.taskId === t.taskId && (
                    <tr data-testid="task-action-row">
                      <td colSpan={8}>
                        {open.action === 'reassign' ? (
                          <ReassignForm key={`${t.taskId}-reassign`} mfcId={mfcId} task={t} onClose={() => setOpen(null)} />
                        ) : (
                          <ReleaseForm key={`${t.taskId}-release`} mfcId={mfcId} task={t} onClose={() => setOpen(null)} />
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {query.hasNextPage && (
              <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                {m.more}
              </button>
            )}
            {query.isFetchNextPageError && (
              <p role="alert" className="text-error text-sm">
                {messages.errorTitle}
              </p>
            )}
          </div>
        )}
      </QueryState>
    </section>
  );
}

// ---------------------------------------------------------------- 상세

function TaskDetailPage({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const { taskId = '' } = useParams();
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => request('GET', api.fulfillment.GET('/tasks/{taskId}', { params: { path: { taskId } } })),
  });
  return (
    <section className="max-w-5xl space-y-4">
      <Link to={tasksPath(mfcId)} className="link text-sm">
        {m.back}
      </Link>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(t) => (
          <>
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold">
              {m.taskType[t.taskType ?? ''] ?? t.taskType}
              <span className="font-mono text-base opacity-70">{t.taskId}</span>
              <StateBadge state={t.state} />
              <Flags task={t} />
            </h1>
            {notice && (
              <p role="status" className="text-success text-sm">
                {notice}
              </p>
            )}
            <TaskFacts task={t} />
            {(t.pendingExecutions ?? []).length > 0 && <p className="alert alert-info text-sm">{m.pendingNote(t.pendingExecutions!.length)}</p>}
            {(t.state === 'ASSIGNED' || t.state === 'IN_PROGRESS') && t.assignment?.workerId && (
              <Release key={`${t.version ?? 0}`} mfcId={mfcId} task={t} onDone={setNotice} />
            )}
            <TaskLines task={t} />
            {t.shipmentId ? <ShipmentView shipmentId={t.shipmentId} /> : <p className="text-sm opacity-70">{m.noShipment}</p>}
          </>
        )}
      </QueryState>
    </section>
  );
}

function TaskFacts({ task: t }: { readonly task: TaskDetail }) {
  const rows: ReadonlyArray<readonly [string, ReactNode]> = [
    [m.fields.product, m.headline(t.headline?.productName, t.headline?.otherLineCount ?? 0)],
    [m.fields.assignee, <Who id={t.assignment?.workerId} empty={m.unassigned} />],
    [m.fields.qty, m.qty(t.plannedQty ?? 0, t.completedQty ?? 0, t.remainingQty ?? 0)],
    [m.fields.promisedReadyAt, t.promisedReadyAt ? formatSeoul(t.promisedReadyAt) : messages.none],
    [m.fields.lastActivity, t.lastActivityAt ? formatSeoul(t.lastActivityAt) : messages.none],
    [m.fields.createdAt, t.createdAt ? formatSeoul(t.createdAt) : messages.none],
    [m.fields.blockReason, t.blockReason ?? messages.none],
    [m.fields.packingLocations, t.packingLocations?.length ? t.packingLocations.join(', ') : messages.none],
    [m.fields.routeMethod, t.routeMethod ? (m.route[t.routeMethod] ?? t.routeMethod) : messages.none],
    [m.fields.shipment, t.shipmentId ?? messages.none],
  ];
  return (
    <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1 rounded-box bg-base-100 p-4 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="opacity-70">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function TaskLines({ task: t }: { readonly task: TaskDetail }) {
  const l = m.line;
  return (
    <div className="rounded-box bg-base-100 p-4">
      <h2 className="mb-2 font-semibold">{m.lines}</h2>
      <table className="table table-xs">
        <thead>
          <tr>
            <th>{m.fields.product}</th>
            <th>{l.sku}</th>
            <th>{l.location}</th>
            <th>{l.lot}</th>
            <th>{l.planned}</th>
            <th>{l.completed}</th>
            <th>{l.cancelled}</th>
            <th>{l.remaining}</th>
            <th>{l.pendingQty}</th>
          </tr>
        </thead>
        <tbody>
          {(t.lines ?? []).map((line) => (
            <tr key={line.taskLineId} data-testid="task-line">
              <td>{line.productName ?? messages.none}</td>
              <td className="font-mono">{line.sku}</td>
              <td className="font-mono">{line.locationId ?? messages.none}</td>
              <td className="font-mono">{line.lotId ?? messages.none}</td>
              <td>{line.plannedQty}</td>
              <td>{line.completedQty}</td>
              <td>{line.cancelledQty}</td>
              <td>{line.remainingQty}</td>
              <td>{line.pendingQty ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Release({ mfcId, task, onDone }: { readonly mfcId: string; readonly task: TaskDetail; readonly onDone: (t: string | null) => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const taskId = task.taskId ?? '';
  const [reason, setReason] = useState('');
  const release = useCommand(async (_: null, key) => {
    onDone(null);
    const r = await request(
      'POST',
      api.fulfillment.POST('/tasks/{taskId}/releases', {
        ...commandParams(key, { path: { taskId } }),
        body: { workerId: task.assignment?.workerId ?? '', ...(reason.trim() ? { reason: reason.trim() } : {}) },
      }),
    );
    // 서버가 돌려준 상태가 READY 일 때만 "내놓음"
    onDone(r.state === 'READY' ? m.released : null);
    await queryClient.invalidateQueries({ queryKey: ['task', taskId] });
    await queryClient.invalidateQueries({ queryKey: ['tasks', mfcId] });
    return r;
  });
  return (
    <form
      className="space-y-2 rounded-box bg-base-100 p-4 text-sm"
      aria-label={m.release}
      onSubmit={(e) => {
        e.preventDefault();
        if (release.phase.kind === 'rejected') release.reset();
        void release.run(null);
      }}
    >
      <p className="text-xs opacity-70">{m.releaseHint}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          {m.releaseReason}
          <input className="input input-sm w-72" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-sm btn-warning" disabled={release.busy}>
          {m.release}
        </button>
      </div>
      <CommandFeedback command={release} />
    </form>
  );
}

// ---------------------------------------------------------------- 출하·포장

function ShipmentView({ shipmentId }: { readonly shipmentId: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['shipment', shipmentId],
    queryFn: () => request('GET', api.fulfillment.GET('/shipments/{shipmentId}', { params: { path: { shipmentId } } })),
  });
  const p = m.pkg;
  return (
    <div className="space-y-2 rounded-box bg-base-100 p-4 text-sm">
      <h2 className="font-semibold">{m.shipmentTitle}</h2>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(s) => (
          <>
            <p>
              {s.orderNumber && (
                <span className="mr-2 font-mono font-semibold" data-testid="order-number">
                  {m.orderNumber(s.orderNumber)}
                </span>
              )}
              <span className="font-mono">{s.shipmentId}</span> · {m.shipmentState[s.state ?? ''] ?? s.state}
              {s.holdReason && <span className="ml-1 opacity-70">{s.holdReason}</span>}
            </p>
            {(s.packages ?? []).length === 0 ? (
              <p className="opacity-70">{m.noPackages}</p>
            ) : (
              <table className="table table-xs">
                <thead>
                  <tr>
                    <th>{p.id}</th>
                    <th>{p.handoverCode}</th>
                    <th>{p.state}</th>
                    <th>{p.fence}</th>
                    <th>{p.rider}</th>
                    <th>{p.sealedAt}</th>
                    <th>{p.handedOverAt}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(s.packages ?? []).map((pkg) => (
                    <tr key={pkg.packageId} data-testid="package-row">
                      <td className="font-mono">{pkg.packageId}</td>
                      <td className="font-mono" data-testid="handover-code">
                        {pkg.handoverCode ?? messages.none}
                      </td>
                      <td>{m.packageState[pkg.state ?? ''] ?? pkg.state}</td>
                      <td>
                        {m.fenceState[pkg.fence?.state ?? ''] ?? pkg.fence?.state ?? messages.none}
                        {pkg.fence?.expiresAt && <span className="ml-1 opacity-70">{formatSeoul(pkg.fence.expiresAt)}</span>}
                      </td>
                      <td>{pkg.fence?.riderId ? <RiderLabel riderId={pkg.fence.riderId} /> : messages.none}</td>
                      <td>{pkg.sealedAt ? formatSeoul(pkg.sealedAt) : messages.none}</td>
                      <td>{pkg.handedOverAt ? formatSeoul(pkg.handedOverAt) : messages.none}</td>
                      <td>
                        <Resolution packageId={pkg.packageId ?? ''} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}

/** 포장 인계 판정(누를 때만) */
function Resolution({ packageId }: { readonly packageId: string }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ['handover-resolution', packageId],
    enabled: open,
    queryFn: () => request('GET', api.fulfillment.GET('/packages/{packageId}/handover-resolution', { params: { path: { packageId } } })),
  });
  if (!open) {
    return (
      <button type="button" className="btn btn-xs" onClick={() => setOpen(true)}>
        {m.resolution}
      </button>
    );
  }
  return (
    <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
      {(r) => (
        <div data-testid="resolution">
          <span>{m.verdict[r.verdict ?? ''] ?? r.verdict}</span>
          {r.checkRequired && <span className="badge badge-sm badge-warning ml-1">{m.checkRequired}</span>}
        </div>
      )}
    </QueryState>
  );
}
