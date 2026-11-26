// 보충관리 — cdc-inbound 0.2.0 putaway-tasks kind=REPLENISHMENT·replenishment-checks. 입고관리(적치 지시) 메뉴는 뺐다(사용자 2026-11-26 "입고관리도 빼줘").
// - 목록 `GET /cdcs/{cdcId}/putaway-tasks?state=&kind=&size=&cursor=`(최신 순, cursor 쪽 나눔 — nextCursor null 이면 끝). 보충 = kind=REPLENISHMENT(따로 자원 없음).
// - 취소 `…/{taskId}/cancellations {reason}`(CDC_MANAGER, 남은 수량만). 적치 지시(POST putaway-tasks)는 입고관리와 함께 뺐다.
// - 보충 판단 `GET /cdcs/{cdcId}/replenishment-checks?reason=&limit=`(피킹 선반마다 마지막 계산 — 0 이면 사유). 수동 보충은 서버에 없다.
// 작업 상태는 서버 값만 — 결과(results)의 재고 반영이 PENDING 이면 "반영 중"(옮김 확정 아님).
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/cdc-inbound';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { Who } from '../../shared/OperatorLabel';
import { SkuName } from '../../shared/SkuName';
import { CheckDetail } from './CheckDetail';

const t = messages.putaway;
type S = components['schemas'];
type Task = S['PutawayTask'];
type Kind = S['PutawayTaskKind'];
type State = S['PutawayTaskState'];
const STATES: readonly State[] = ['DISPATCHED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED', 'COMPLETED', 'FAILED', 'CANCELLED'];
const CANCELLABLE = new Set(['DISPATCHED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED']);

function StateBadge({ state }: { readonly state: string | undefined }) {
  const tone = state === 'COMPLETED' ? 'badge-success' : state === 'FAILED' ? 'badge-error' : state === 'CANCELLED' ? 'badge-ghost' : state === 'PARTIALLY_COMPLETED' ? 'badge-warning' : 'badge-info';
  return <span className={`badge badge-sm whitespace-nowrap ${tone}`}>{state ? (t.state[state] ?? state) : messages.none}</span>;
}

/** `/c/:cdcId/replenishment` */
export function ReplenishmentMenu({ cdcId }: { readonly cdcId: string }) {
  return (
    <section className="space-y-4">
      <div>
        <h1>{messages.menus.replenishment}</h1>
        <p className="max-w-4xl text-sm text-base-content/60">{t.leadRepl}</p>
      </div>
      <TaskList cdcId={cdcId} kind="REPLENISHMENT" />
      <Checks cdcId={cdcId} />
    </section>
  );
}

function TaskList({ cdcId, kind }: { readonly cdcId: string; readonly kind: Kind }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const raw = params.get('state');
  const state = STATES.find((s) => s === raw);
  const [open, setOpen] = useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: ['cdc', cdcId, 'putaway-tasks', kind, state ?? 'all'],
    refetchInterval: 15_000,
    initialPageParam: '',
    getNextPageParam: (last: { nextCursor?: string | null }) => last.nextCursor ?? undefined,
    queryFn: ({ pageParam }) =>
      request(
        'GET',
        api.inbound.GET('/cdcs/{cdcId}/putaway-tasks', { params: { path: { cdcId }, query: { kind, size: 50, ...(state ? { state } : {}), ...(pageParam ? { cursor: pageParam } : {}) } } }),
      ),
  });
  const rows = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t.stateFilter}
          <select
            className="select select-sm w-40"
            value={state ?? ''}
            onChange={(e) => {
              const q = new URLSearchParams(params);
              if (e.target.value) q.set('state', e.target.value);
              else q.delete('state');
              setParams(q, { replace: true });
            }}
            data-testid="putaway-state"
          >
            <option value="">{t.all}</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {t.state[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <QueryState state={toUiState(query, () => rows.length === 0)} onRetry={() => void query.refetch()} emptyText={kind === 'REPLENISHMENT' ? t.emptyRepl : t.empty}>
        {() => (
          <>
            <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <table className="table table-sm" data-testid="putaway-table">
                <thead>
                  <tr>
                    <th>{t.sku}</th>
                    <th>{t.from}</th>
                    <th>{t.to}</th>
                    <th className="text-right">{t.progress}</th>
                    <th>{t.stateLabel}</th>
                    <th>{t.createdBy}</th>
                    <th>{t.createdAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((x) => {
                    const id = x.taskId ?? '';
                    const isOpen = open === id;
                    return (
                      <Fragment key={id}>
                        <tr className="cursor-pointer hover" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen} data-testid="putaway-row">
                          <td>
                            <span className="inline-flex items-start gap-1">
                              <span aria-hidden className="mt-0.5 inline-block w-3 text-base-content/50">
                                {isOpen ? '▾' : '▸'}
                              </span>
                              <span>
                                <SkuName sku={x.sku ?? ''} />
                                <span className="block font-mono text-xs text-base-content/55">{`${x.lot ?? ''}${x.qualityState && x.qualityState !== 'RELEASED' ? ` · ${t.quality[x.qualityState] ?? x.qualityState}` : ''}`}</span>
                              </span>
                            </span>
                          </td>
                          <td className="font-mono text-xs">{x.fromLocationCode}</td>
                          <td className="font-mono text-xs">{x.toLocationCode}</td>
                          <td className="text-right tabular-nums">{`${messages.qty(x.completedQty ?? 0)} / ${messages.qty(x.qty ?? 0)}`}</td>
                          <td>
                            <StateBadge state={x.state} />
                          </td>
                          <td>{x.kind === 'REPLENISHMENT' ? <span className="text-xs text-base-content/60">{t.kind.REPLENISHMENT}</span> : <Who id={x.createdBy} />}</td>
                          <td className="text-xs">{x.createdAt ? formatSeoul(x.createdAt) : messages.none}</td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={7} className="pm-detail bg-base-200/50">
                              <TaskDetail cdcId={cdcId} task={x} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {query.hasNextPage && (
              <div className="flex justify-center">
                <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                  {t.more}
                </button>
              </div>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}

function TaskDetail({ cdcId, task }: { readonly cdcId: string; readonly task: Task }) {
  const [cancelling, setCancelling] = useState(false);
  return (
    <div className="space-y-2 p-1 text-sm" data-testid="putaway-detail">
      <p data-testid="putaway-story">
        {t.story(task.fromLocationCode ?? messages.none, task.toLocationCode ?? messages.none, messages.qty(task.qty ?? 0), messages.qty(task.completedQty ?? 0))}{' '}
        <span className="text-base-content/60">{t.stateLong[task.state ?? ''] ?? ''}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Link className="btn btn-xs" to={centerPath(cdcId, `master/locations/${encodeURIComponent(task.fromLocationCode ?? '')}`)}>
          {t.fromLink}
        </Link>
        <Link className="btn btn-xs" to={centerPath(cdcId, `master/locations/${encodeURIComponent(task.toLocationCode ?? '')}`)}>
          {t.toLink}
        </Link>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-base-content/70">
        <span className="font-mono">{`${t.id} ${task.taskId}`}</span>
        {task.deviceId && <span>{`${t.device} ${task.deviceId}`}</span>}
        {task.reason && <span>{`${t.reason}: ${task.reason}`}</span>}
        {task.failureReason && <span className="text-error">{t.failure(task.failureReason)}</span>}
        {task.updatedAt && <span>{formatSeoul(task.updatedAt)}</span>}
      </div>
      <p className="text-xs font-semibold">{t.results}</p>
      {(task.results ?? []).length === 0 ? (
        <p className="text-xs text-base-content/55">{t.noResults}</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {(task.results ?? []).map((r) => (
            <li key={r.eventId} className="flex flex-wrap items-center gap-2">
              <span className="text-base-content/60">{r.receivedAt ? formatSeoul(r.receivedAt) : ''}</span>
              <span>{r.status}</span>
              <span className="tabular-nums">{`+${messages.qty(r.completedQty ?? 0)}`}</span>
              <span className={`badge badge-xs ${r.state === 'APPLIED' ? 'badge-success' : r.state === 'REJECTED' ? 'badge-error' : 'badge-warning'}`}>{t.resultState[r.state ?? ''] ?? r.state}</span>
              {r.rejectReason && <span className="text-error">{r.rejectReason}</span>}
            </li>
          ))}
        </ul>
      )}
      {CANCELLABLE.has(task.state ?? '') &&
        (cancelling ? (
          <CancelForm cdcId={cdcId} taskId={task.taskId ?? ''} onClose={() => setCancelling(false)} />
        ) : (
          <button type="button" className="btn btn-xs" onClick={() => setCancelling(true)} data-testid="putaway-cancel-open">
            {t.cancel}
          </button>
        ))}
    </div>
  );
}

function CancelForm({ cdcId, taskId, onClose }: { readonly cdcId: string; readonly taskId: string; readonly onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const cmd = useCommand(async (r: string, key) =>
    request('POST', api.inbound.POST('/cdcs/{cdcId}/putaway-tasks/{taskId}/cancellations', { ...commandParams(key, { path: { cdcId, taskId } }), body: { reason: r } })),
  );
  return (
    <form
      className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim()) return;
        void cmd.run(reason.trim()).then((phase) => {
          if (phase.kind === 'done') void qc.invalidateQueries({ queryKey: ['cdc', cdcId, 'putaway-tasks'] });
        });
      }}
      data-testid="putaway-cancel-form"
    >
      <p className="text-xs text-base-content/70">{t.cancelHint}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          {t.cancelReason}
          <input className="input input-xs w-72" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="putaway-cancel-reason" />
        </label>
        <button type="submit" className="btn btn-xs btn-error" disabled={!reason.trim() || cmd.busy} data-testid="putaway-cancel-go">
          {t.cancelGo}
        </button>
        <button type="button" className="btn btn-ghost btn-xs" onClick={onClose}>
          {t.close}
        </button>
      </div>
      <CommandFeedback command={cmd}>
        {() => (
          <p role="status" className="alert alert-info py-1 text-sm">
            {t.cancelled}
          </p>
        )}
      </CommandFeedback>
    </form>
  );
}

/** 피킹 선반별 보충 판단 — 사유별 건수 거르기 */
function Checks({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const [reason, setReason] = useState('');
  const [openLoc, setOpenLoc] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'replenishment-checks'],
    refetchInterval: 60_000,
    queryFn: () => request('GET', api.inbound.GET('/cdcs/{cdcId}/replenishment-checks', { params: { path: { cdcId }, query: { limit: 2000 } } })),
  });
  return (
    <section className="space-y-2" data-testid="repl-checks">
      <div>
        <h2 className="text-base font-semibold">{t.checks}</h2>
        <p className="text-xs text-base-content/60">{t.checksLead} {t.checkHint}</p>
      </div>
      <QueryState state={toUiState(query, (d) => (d.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={t.checkEmpty}>
        {(d) => {
          const items = d.items ?? [];
          const counts = new Map<string, number>();
          for (const x of items) counts.set(x.reason ?? '', (counts.get(x.reason ?? '') ?? 0) + 1);
          const shown = reason ? items.filter((x) => x.reason === reason) : items;
          return (
            <>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.reasonFilter} data-testid="repl-reasons">
                <button type="button" aria-pressed={!reason} className={`btn btn-xs ${!reason ? 'btn-primary' : 'btn-ghost border border-base-300'}`} onClick={() => setReason('')}>
                  {t.all}
                  <span className="badge badge-xs">{items.length}</span>
                </button>
                {[...counts.entries()].map(([k, n]) => (
                  <button key={k} type="button" aria-pressed={reason === k} className={`btn btn-xs ${reason === k ? 'btn-primary' : 'btn-ghost border border-base-300'}`} onClick={() => setReason(k)}>
                    {t.checkReason[k] ?? k}
                    <span className="badge badge-xs">{n}</span>
                  </button>
                ))}
              </div>
              <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
                <table className="table table-sm" data-testid="repl-check-table">
                  <thead>
                    <tr>
                      <th>{t.location}</th>
                      <th>{t.sku}</th>
                      <th className="text-right">{t.current}</th>
                      <th className="text-right">{t.min}</th>
                      <th className="text-right">{t.target}</th>
                      <th className="text-right">{t.open}</th>
                      <th className="text-right">{t.need}</th>
                      <th className="text-right">{t.ordered}</th>
                      <th className="text-right">{t.unit}</th>
                      <th>{t.reasonFilter}</th>
                      <th>{t.checkedAt}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((x) => {
                      const n = (v: number | null | undefined) => (v === null || v === undefined ? messages.none : messages.qty(v));
                      const warn = ['UNIT_MISSING', 'SOURCE_SHORT', 'ROOM_SHORT', 'RESERVE_FAILED'].includes(x.reason ?? '');
                      return (
                        <Fragment key={x.locationCode}>
                        <tr data-testid="repl-check-row" className="cursor-pointer hover" onClick={() => setOpenLoc(openLoc === x.locationCode ? null : (x.locationCode ?? null))} aria-expanded={openLoc === x.locationCode}>
                          <td className="whitespace-nowrap font-mono text-xs">
                            <span aria-hidden className="mr-1 inline-block w-3 text-base-content/50">
                              {openLoc === x.locationCode ? '▾' : '▸'}
                            </span>
                            {x.locationCode}
                          </td>
                          <td>{x.sku ? <SkuName sku={x.sku} lookup={shown.length <= 100} /> : messages.none}</td>
                          <td className="text-right tabular-nums">{n(x.currentQty)}</td>
                          <td className="text-right tabular-nums">{messages.qty(x.minQty ?? 0)}</td>
                          <td className="text-right tabular-nums">{messages.qty(x.targetQty ?? 0)}</td>
                          <td className="text-right tabular-nums">{n(x.openQty)}</td>
                          <td className="text-right tabular-nums">{n(x.needQty)}</td>
                          <td className="text-right tabular-nums">{n(x.orderedQty)}</td>
                          <td className="text-right tabular-nums">{n(x.unitQty)}</td>
                          <td className={warn ? 'text-warning' : ''}>{t.checkReason[x.reason ?? ''] ?? x.reason}</td>
                          <td className="text-xs">{x.checkedAt ? formatSeoul(x.checkedAt) : messages.none}</td>
                        </tr>
                        {openLoc === x.locationCode && (
                          <tr>
                            <td colSpan={11} className="pm-detail bg-base-200/50">
                              <CheckDetail cdcId={cdcId} x={x} />
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          );
        }}
      </QueryState>
    </section>
  );
}
