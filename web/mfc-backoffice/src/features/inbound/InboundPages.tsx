// 입고 — mfc-inbound-service 0.9.0(요청서 mfc-backoffice/2026-11-15 §2·§2-1, 입고 화면 요청 all/2026-11-07 B2~B4).
// 탭(URL 쿼리 `tab`): 입고 작업(기본) · 초기 보유 수령 · 회수품 반입 · 공급 요청 · 입고 예정(TRF — 계약만, 안내).
// 입고 작업:
// - 목록 `GET /inbound-tasks?mfcId=&taskType=&state=&receiptId=` — 화면 기본은 대기(READY)를 보낸다.
// - 품질검사 `POST /inbound-tasks/{id}/inspections` {results[]} · 적치 `POST …/putaways` {toLocationCode, qty} → InboundTaskExecution.
//   applyStatus APPLIED = 반영, CAPTURED = 기록만(완료 아님), REJECTED = 재고 거절(rejectReason, 잔량 그대로), UNKNOWN_RESULT·503 = 결과 불명(같은 키로 다시).
//   담당(assigneeId)이 있으면 담당만 — 409 NOT_ASSIGNEE. 합계 ≤ 남은 수량은 화면에서도 막고 서버가 판정한다.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router';

import { request, UnknownResultFailure } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/mfc-inbound';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { InitialStockTab, ReturnReceiptTab, SupplyRequestTab } from './InboundOtherTabs';

const m = messages.inbound;

type Inb = components['schemas'];
type InboundTask = Inb['InboundTask'];
type Execution = Inb['InboundTaskExecution'];

type Tab = 'tasks' | 'initial' | 'returns' | 'supply' | 'promises';
const TABS: readonly Tab[] = ['tasks', 'initial', 'returns', 'supply', 'promises'];

export const inboundPath = (mfcId: string, rest = '') => centerPath(mfcId, rest ? `inbound/${rest}` : 'inbound');

/** `/c/:mfcId/inbound/*` */
export function InboundMenu({ mfcId }: { readonly mfcId: string }) {
  return (
    <Routes>
      <Route index element={<InboundHome mfcId={mfcId} />} />
      <Route path="tasks/:taskId" element={<InboundTaskPage mfcId={mfcId} />} />
    </Routes>
  );
}

function InboundHome({ mfcId }: { readonly mfcId: string }) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'tasks';
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{messages.menus.inbound}</h1>
      <p className="text-sm opacity-70">{m.intro}</p>
      <div role="tablist" className="tabs tabs-box w-fit">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`tab ${tab === t ? 'tab-active' : ''}`}
            onClick={() => setParams(t === 'tasks' ? {} : { tab: t }, { replace: true })}
          >
            {m.tabs[t]}
          </button>
        ))}
      </div>
      {tab === 'tasks' && <InboundTaskList mfcId={mfcId} />}
      {tab === 'initial' && <InitialStockTab mfcId={mfcId} />}
      {tab === 'returns' && <ReturnReceiptTab mfcId={mfcId} />}
      {tab === 'supply' && <SupplyRequestTab mfcId={mfcId} />}
      {tab === 'promises' && (
        <p role="note" className="alert text-sm">
          {m.promisesMissing}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- 입고 작업 목록

function InboundTaskList({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const rawType = params.get('taskType');
  const taskType = rawType === 'INSPECT' || rawType === 'PUTAWAY' ? rawType : undefined;
  // 화면 기본 = 대기. "전체"는 state=ALL 로 주소에 남기고 서버에는 보내지 않는다
  const rawState = params.get('state');
  const state = rawState === 'COMPLETED' ? 'COMPLETED' : rawState === 'ALL' ? undefined : 'READY';
  const receiptId = params.get('receiptId') ?? '';
  const query = useQuery({
    queryKey: ['inbound-tasks', mfcId, taskType ?? 'ALL', state ?? 'ALL', receiptId],
    queryFn: async () =>
      (
        await request(
          'GET',
          api.inbound.GET('/inbound-tasks', {
            params: { query: { mfcId, ...(taskType ? { taskType } : {}), ...(state ? { state } : {}), ...(receiptId ? { receiptId } : {}) } },
          }),
        )
      ).items,
  });
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  return (
    <div className="space-y-3">
      <form className="flex flex-wrap items-end gap-2 rounded-box bg-base-100 p-3 text-sm" onSubmit={(e) => e.preventDefault()}>
        <label className="flex flex-col gap-1">
          {m.filters.type}
          <select className="select select-sm w-32" value={taskType ?? ''} onChange={(e) => set('taskType', e.target.value)}>
            <option value="">{m.filters.all}</option>
            <option value="INSPECT">{m.taskType.INSPECT}</option>
            <option value="PUTAWAY">{m.taskType.PUTAWAY}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {m.filters.state}
          <select className="select select-sm w-28" value={rawState === 'COMPLETED' || rawState === 'ALL' ? rawState : ''} onChange={(e) => set('state', e.target.value)}>
            <option value="">{m.taskState.READY}</option>
            <option value="COMPLETED">{m.taskState.COMPLETED}</option>
            <option value="ALL">{m.filters.all}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {m.filters.receipt}
          <input className="input input-sm w-40 font-mono" value={receiptId} onChange={(e) => set('receiptId', e.target.value.trim())} />
        </label>
      </form>
      <QueryState state={toUiState(query, (rows) => rows.length === 0)} onRetry={() => void query.refetch()} emptyText={m.empty}>
        {(rows) => (
          <table className="table table-sm rounded-box bg-base-100">
            <thead>
              <tr>
                <th>{m.filters.type}</th>
                <th>{m.fields.product}</th>
                <th>{m.fields.lot}</th>
                <th>{m.fields.from}</th>
                <th>{m.fields.qty}</th>
                <th>{m.filters.state}</th>
                <th>{m.fields.assignee}</th>
                <th>{m.fields.createdAt}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.taskId} data-testid="inbound-task-row">
                  <td>
                    <Link className="link" to={inboundPath(mfcId, `tasks/${encodeURIComponent(t.taskId)}`)}>
                      {m.taskType[t.taskType] ?? t.taskType}
                    </Link>
                  </td>
                  <td>{t.productName ? `${t.productName} (${t.sku})` : t.sku}</td>
                  <td className="font-mono text-xs">{t.lotId}</td>
                  <td className="font-mono text-xs">{t.locationCode}</td>
                  <td>{m.qty(t.plannedQty, t.doneQty)}</td>
                  <td>{m.taskState[t.state] ?? t.state}</td>
                  <td>{t.assigneeId ?? messages.none}</td>
                  <td>{t.createdAt ? formatSeoul(t.createdAt) : messages.none}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </QueryState>
    </div>
  );
}

// ---------------------------------------------------------------- 입고 작업 상세·실행

function InboundTaskPage({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const { taskId = '' } = useParams();
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const query = useQuery({
    queryKey: ['inbound-task', taskId],
    queryFn: () => request('GET', api.inbound.GET('/inbound-tasks/{taskId}', { params: { path: { taskId } } })),
  });
  return (
    <section className="max-w-4xl space-y-4">
      <Link to={inboundPath(mfcId)} className="link text-sm">
        {m.back}
      </Link>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(t) => (
          <>
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold">
              {m.taskType[t.taskType] ?? t.taskType}
              <span className="font-mono text-base opacity-70">{t.taskId}</span>
              <span className={`badge badge-sm ${t.state === 'READY' ? 'badge-info' : 'badge-success'}`}>{m.taskState[t.state] ?? t.state}</span>
            </h1>
            {notice && (
              <p role="status" className={`text-sm ${notice.kind === 'ok' ? 'text-success' : notice.kind === 'warn' ? 'text-warning' : 'text-error'}`}>
                {notice.text}
              </p>
            )}
            <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-1 rounded-box bg-base-100 p-4 text-sm">
              <dt className="opacity-70">{m.fields.product}</dt>
              <dd>{t.productName ? `${t.productName} (${t.sku})` : t.sku}</dd>
              <dt className="opacity-70">{m.fields.lot}</dt>
              <dd className="font-mono">{t.lotId}</dd>
              <dt className="opacity-70">{m.fields.from}</dt>
              <dd className="font-mono">{t.locationCode}</dd>
              <dt className="opacity-70">{m.fields.qty}</dt>
              <dd>{m.qty(t.plannedQty, t.doneQty)}</dd>
              <dt className="opacity-70">{m.fields.receipt}</dt>
              <dd className="font-mono">{t.receiptId}</dd>
              <dt className="opacity-70">{m.fields.parent}</dt>
              <dd className="font-mono">{t.parentTaskId ?? messages.none}</dd>
              <dt className="opacity-70">{m.fields.assignee}</dt>
              <dd>{t.assigneeId ?? messages.none}</dd>
            </dl>
            {t.assigneeId && <p className="text-xs opacity-70">{m.assigneeOnly(t.assigneeId)}</p>}
            {t.state === 'READY' && t.taskType === 'INSPECT' && <InspectForm key={t.version} mfcId={mfcId} task={t} onDone={setNotice} />}
            {t.state === 'READY' && t.taskType === 'PUTAWAY' && <PutawayForm key={t.version} mfcId={mfcId} task={t} onDone={setNotice} />}
          </>
        )}
      </QueryState>
    </section>
  );
}

type Notice = (n: { kind: 'ok' | 'warn' | 'error'; text: string } | null) => void;

/** 실행 결과 → 문구. UNKNOWN_RESULT 는 결과 불명으로 던져 같은 키 재전송을 연다 */
function settleExecution(e: Execution, onDone: Notice): Execution {
  if (e.applyStatus === 'UNKNOWN_RESULT') throw new UnknownResultFailure(e.applyStatus, e.executionId);
  if (e.applyStatus === 'APPLIED') {
    const created = e.createdTaskIds ?? [];
    onDone({ kind: 'ok', text: created.length ? `${m.applied} ${m.createdTasks(created)}` : m.applied });
  } else if (e.applyStatus === 'CAPTURED') {
    onDone({ kind: 'warn', text: m.captured });
  } else {
    const reason = e.rejectReason ?? '';
    onDone({ kind: 'error', text: m.rejected(m.rejectReason[reason] ?? reason) });
  }
  return e;
}

function useAfterExecution(mfcId: string, taskId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['inbound-task', taskId] });
    await queryClient.invalidateQueries({ queryKey: ['inbound-tasks', mfcId] });
  };
}

interface ResultRow {
  readonly qty: string;
  readonly resultQuality: 'NORMAL' | 'QUARANTINED';
  readonly sourceLotRef: string;
  readonly expiryDate: string;
  readonly manufactureDate: string;
}

const emptyRow: ResultRow = { qty: '', resultQuality: 'NORMAL', sourceLotRef: '', expiryDate: '', manufactureDate: '' };

function InspectForm({ mfcId, task, onDone }: { readonly mfcId: string; readonly task: InboundTask; readonly onDone: Notice }) {
  const api = useApi();
  const after = useAfterExecution(mfcId, task.taskId);
  const [rows, setRows] = useState<ResultRow[]>([emptyRow]);
  const remaining = task.plannedQty - task.doneQty;
  const total = rows.reduce((n, r) => n + (Number(r.qty) || 0), 0);
  const valid = rows.every((r) => Number.isInteger(Number(r.qty)) && Number(r.qty) >= 1) && total <= remaining;
  const inspect = useCommand(async (results: ResultRow[], key) => {
    onDone(null);
    const e = await request(
      'POST',
      api.inbound.POST('/inbound-tasks/{taskId}/inspections', {
        ...commandParams(key, { path: { taskId: task.taskId } }),
        body: {
          results: results.map((r) => ({
            qty: Number(r.qty),
            resultQuality: r.resultQuality,
            ...(r.sourceLotRef.trim() ? { sourceLotRef: r.sourceLotRef.trim() } : {}),
            ...(r.expiryDate ? { expiryDate: r.expiryDate } : {}),
            ...(r.manufactureDate ? { manufactureDate: r.manufactureDate } : {}),
          })),
        },
      }),
    );
    settleExecution(e, onDone);
    await after();
    return e;
  });
  const set = (i: number, patch: Partial<ResultRow>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <form
      className="space-y-3 rounded-box bg-base-100 p-4 text-sm"
      aria-label={m.inspect}
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        if (inspect.phase.kind === 'rejected' || inspect.phase.kind === 'done') inspect.reset();
        void inspect.run(rows);
      }}
    >
      <h2 className="font-semibold">{m.inspect}</h2>
      <p className="text-xs opacity-70">{m.inspectHint}</p>
      {rows.map((r, i) => (
        <fieldset key={i} className="flex flex-wrap items-end gap-2 border-b border-base-200 pb-2" aria-label={m.resultRow(i + 1)}>
          <label className="flex flex-col gap-1">
            {m.fields.qty.split('(')[0]}
            <input className="input input-sm w-20" type="number" min={1} step={1} value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            {m.resultQuality}
            <select className="select select-sm w-24" value={r.resultQuality} onChange={(e) => set(i, { resultQuality: e.target.value as ResultRow['resultQuality'] })}>
              <option value="NORMAL">{m.quality.NORMAL}</option>
              <option value="QUARANTINED">{m.quality.QUARANTINED}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            {m.sourceLotRef}
            <input className="input input-sm w-32" maxLength={128} value={r.sourceLotRef} onChange={(e) => set(i, { sourceLotRef: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            {m.expiryDate}
            <input className="input input-sm w-36" type="date" value={r.expiryDate} onChange={(e) => set(i, { expiryDate: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            {m.manufactureDate}
            <input className="input input-sm w-36" type="date" value={r.manufactureDate} onChange={(e) => set(i, { manufactureDate: e.target.value })} />
          </label>
          {rows.length > 1 && (
            <button type="button" className="btn btn-xs" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>
              {m.removeRow}
            </button>
          )}
        </fieldset>
      ))}
      <button type="button" className="btn btn-xs" onClick={() => setRows((prev) => [...prev, emptyRow])}>
        {m.addRow}
      </button>
      {total > remaining && <p className="text-error text-xs">{m.totalOver(total, remaining)}</p>}
      <button type="submit" className="btn btn-sm btn-primary" disabled={!valid || inspect.busy}>
        {m.submitInspect}
      </button>
      <CommandFeedback command={inspect} />
    </form>
  );
}

function PutawayForm({ mfcId, task, onDone }: { readonly mfcId: string; readonly task: InboundTask; readonly onDone: Notice }) {
  const api = useApi();
  const after = useAfterExecution(mfcId, task.taskId);
  const remaining = task.plannedQty - task.doneQty;
  const [toLocationCode, setTo] = useState('');
  const [qty, setQty] = useState(String(remaining));
  const [showCandidates, setShowCandidates] = useState(false);
  const n = Number(qty);
  const valid = !!toLocationCode.trim() && Number.isInteger(n) && n >= 1 && n <= remaining;
  const candidates = useQuery({
    queryKey: ['putaway-candidates', mfcId, task.sku],
    enabled: showCandidates,
    queryFn: () => request('GET', api.location.GET('/putaway-candidates', { params: { query: { mfcId, sku: task.sku } } })),
  });
  const putaway = useCommand(async (_: null, key) => {
    onDone(null);
    const e = await request(
      'POST',
      api.inbound.POST('/inbound-tasks/{taskId}/putaways', {
        ...commandParams(key, { path: { taskId: task.taskId } }),
        body: { toLocationCode: toLocationCode.trim(), qty: n },
      }),
    );
    settleExecution(e, onDone);
    await after();
    return e;
  });
  return (
    <form
      className="space-y-3 rounded-box bg-base-100 p-4 text-sm"
      aria-label={m.putaway}
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        if (putaway.phase.kind === 'rejected' || putaway.phase.kind === 'done') putaway.reset();
        void putaway.run(null);
      }}
    >
      <h2 className="font-semibold">{m.putaway}</h2>
      <p className="text-xs opacity-70">{m.putawayHint}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          {m.toLocation}
          <input className="input input-sm w-44 font-mono" maxLength={64} value={toLocationCode} onChange={(e) => setTo(e.target.value.toUpperCase())} />
        </label>
        <label className="flex flex-col gap-1">
          {m.fields.qty.split('(')[0]}
          <input className="input input-sm w-20" type="number" min={1} max={remaining} step={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <button type="button" className="btn btn-sm" onClick={() => setShowCandidates(true)}>
          {m.candidates}
        </button>
      </div>
      {showCandidates && (
        <QueryState state={toUiState(candidates, (r) => (r.items ?? []).length === 0)} onRetry={() => void candidates.refetch()} emptyText={messages.moves.candidatesEmpty}>
          {(r) => (
            <ul className="flex flex-wrap gap-2">
              {(r.items ?? []).map((c) => (
                <li key={c.locationId}>
                  <button type="button" className="btn btn-xs btn-outline" onClick={() => setTo(c.locationCode ?? '')}>
                    <span className="font-mono">{c.locationCode}</span>
                    <span className="opacity-70">{messages.moves.remaining(c.remainingSpace)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      )}
      <button type="submit" className="btn btn-sm btn-primary" disabled={!valid || putaway.busy}>
        {m.submitPutaway}
      </button>
      <CommandFeedback command={putaway} />
    </form>
  );
}
