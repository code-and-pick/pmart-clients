// 입고 메뉴의 나머지 탭 — mfc-inbound-service 0.9.0.
// - 초기 보유 수령(B2): `GET /initial-stock-loads?mfcId=`(센터 목록, inbound 0.12.0 MB-1) 또는 `?approvalId=`, `POST /initial-stock-loads/{receiptId}/receipts`(202 접수 — 결과는 상태로).
// - 회수품 반입: `POST /return-receipts`(202 CommandResponse, resultId = 반입 ID), `GET /return-receipts?mfcId=`(목록, MB-1)·`/{id}`.
// - 공급 요청: `POST /supply-requests`(201), `GET/PATCH /supply-requests/{id}`(X-Expected-Version), `POST …/withdrawals`(202, 버전). 목록 `GET /supply-requests?mfcId=&state=`(MB-1).
// 접수(ACCEPTED·SUBMITTED)를 완료로 보이지 않는다 — 서버가 돌려준 상태를 다시 읽어 보인다.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { CommandRejectedFailure, request, UnknownResultFailure, type CommandResponse } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/mfc-inbound';
import { useApi } from '../../app/ApiContext';
import { LotLabel } from '../../shared/LotLabel';
import { SystemNumbers } from '../../shared/displayNumber';
import { messages } from '../../shared/messages';
import { Who } from '../../shared/OperatorLabel';
import { InitialLoadList, ReturnReceiptList, SupplyRequestList } from '../lists/CenterLists';

const m = messages.inbound;
type Inb = components['schemas'];
type InitialLoad = Inb['InitialStockLoad'];
type SupplyRequest = Inb['SupplyRequest'];

/** 화면 입력(datetime-local, 한국 시간) → 계약 date-time */
const seoulInput = (v: string) => `${v}:00+09:00`;

/** CommandResponse 를 확정으로: REJECTED 는 거절, UNKNOWN_RESULT 는 결과 불명(같은 키) — ACCEPTED·APPLIED 는 화면이 상태를 다시 읽는다 */
function checkCommand(r: CommandResponse): CommandResponse {
  if (r.status === 'REJECTED') throw new CommandRejectedFailure(r.nextAction, r.requestId);
  if (r.status === 'UNKNOWN_RESULT') throw new UnknownResultFailure(r.status, r.requestId);
  return r;
}

function useParam(key: string): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams();
  return [
    params.get(key) ?? '',
    (v) => {
      const next = new URLSearchParams(params);
      if (v) next.set(key, v);
      else next.delete(key);
      setParams(next, { replace: true });
    },
  ];
}

function LookupForm({ label, value, onSubmit }: { readonly label: string; readonly value: string; readonly onSubmit: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v.trim());
      }}
    >
      <label className="flex flex-col gap-1">
        {label}
        <input className="input input-sm w-48 font-mono" value={v} onChange={(e) => setV(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-sm" disabled={!v.trim()}>
        {m.open}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------- 초기 보유 수령

export function InitialStockTab({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const [approvalId, setApprovalId] = useParam('approvalId');
  const query = useQuery({
    queryKey: ['initial-loads', approvalId],
    enabled: !!approvalId,
    queryFn: async () => (await request('GET', api.inbound.GET('/initial-stock-loads', { params: { query: { approvalId } } }))).items,
  });
  return (
    <div className="max-w-4xl space-y-3 text-sm">
      <p className="text-xs opacity-70">{m.initialHint}</p>
      <InitialLoadList mfcId={mfcId} />
      <LookupForm label={m.approvalId} value={approvalId} onSubmit={setApprovalId} />
      {approvalId && (
        <QueryState state={toUiState(query, (rows) => rows.length === 0)} onRetry={() => void query.refetch()} emptyText={m.initialEmpty}>
          {(rows) => (
            <div className="space-y-3">
              {rows.map((load) => (
                <InitialLoadCard key={`${load.receiptId}-${load.state}`} mfcId={mfcId} load={load} approvalId={approvalId} />
              ))}
            </div>
          )}
        </QueryState>
      )}
    </div>
  );
}

function InitialLoadCard({ mfcId, load, approvalId }: { readonly mfcId: string; readonly load: InitialLoad; readonly approvalId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const mine = load.mfcId === mfcId;
  const [toLocationCode, setTo] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState(false);
  const receive = useCommand(async (_: null, key) => {
    const r = checkCommand(
      await request(
        'POST',
        api.inbound.POST('/initial-stock-loads/{receiptId}/receipts', {
          ...commandParams(key, { path: { receiptId: load.receiptId } }),
          body: { toLocationCode: toLocationCode.trim(), lines: load.lines.map((l) => ({ sku: l.sku, receivedQty: Number(qty[l.sku] || 0) })) },
        }),
      ),
    );
    setAccepted(true);
    // 접수만으로 끝이 아니다 — 입고 예정 상태(PENDING·APPLIED·REJECTED)를 다시 읽어 보인다
    await queryClient.invalidateQueries({ queryKey: ['initial-loads', approvalId] });
    return r;
  });
  const valid = !!toLocationCode.trim() && load.lines.some((l) => Number(qty[l.sku] || 0) > 0);
  return (
    <div className="space-y-2 rounded-box bg-base-100 p-4" data-testid="initial-load">
      <p className="flex flex-wrap items-center gap-2">
        <span>{load.mfcId ?? messages.none}</span>
        <span className="badge badge-sm">{m.loadState[load.state] ?? load.state}</span>
        {load.receivingLocation && <span className="font-mono opacity-70">{load.receivingLocation}</span>}
      </p>
      <SystemNumbers ids={[{ label: m.sys.receipt, id: load.receiptId }]} />
      {load.rejectReason && <p className="text-error">{load.rejectReason}</p>}
      {load.lastError && <p className="text-warning text-xs">{`${m.lastError}: ${load.lastError}`}</p>}
      {accepted && <p role="status" className="text-success">{m.receiveAccepted}</p>}
      {!mine && <p className="text-xs opacity-70">{m.otherCenter}</p>}
      <form
        className="space-y-2"
        aria-label={`${m.receive} ${load.receiptId}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          if (receive.phase.kind === 'rejected') receive.reset();
          void receive.run(null);
        }}
      >
        <div className="overflow-x-auto">
        <table className="table table-xs">
          <thead>
            <tr>
              <th>{m.sku}</th>
              <th>{m.approvedQty}</th>
              <th>{m.receivedQty}</th>
            </tr>
          </thead>
          <tbody>
            {load.lines.map((l) => (
              <tr key={l.sku}>
                <td>{l.productName ? `${l.productName} (${l.sku})` : l.sku}</td>
                <td>{l.qty}</td>
                <td>
                  {load.state === 'EXPECTED' && mine ? (
                    <input
                      className="input input-xs w-20"
                      type="number"
                      min={0}
                      max={l.qty}
                      step={1}
                      aria-label={`${m.receivedQty} ${l.sku}`}
                      value={qty[l.sku] ?? ''}
                      onChange={(e) => setQty((prev) => ({ ...prev, [l.sku]: e.target.value }))}
                    />
                  ) : (
                    (l.receivedQty ?? messages.none)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {load.state === 'EXPECTED' && mine && (
          <>
            <p className="text-xs opacity-70">{m.receiveHint}</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                {m.receivingLocation}
                <input className="input input-sm w-40 font-mono" maxLength={64} value={toLocationCode} onChange={(e) => setTo(e.target.value.toUpperCase())} />
              </label>
              <button type="submit" className="btn btn-sm btn-primary" disabled={!valid || receive.busy}>
                {m.receive}
              </button>
            </div>
          </>
        )}
        <CommandFeedback command={receive} />
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- 회수품 반입

interface ReturnLine {
  readonly sku: string;
  readonly qty: string;
  readonly sourceLotRef: string;
  readonly expiryDate: string;
  readonly conditionNote: string;
}
const emptyReturnLine: ReturnLine = { sku: '', qty: '', sourceLotRef: '', expiryDate: '', conditionNote: '' };

export function ReturnReceiptTab({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const [openId, setOpenId] = useParam('returnReceiptId');
  const [claimId, setClaimId] = useState('');
  const [returnPickupId, setPickup] = useState('');
  const [orderId, setOrderId] = useState('');
  const [toLocationCode, setTo] = useState('');
  const [lines, setLines] = useState<ReturnLine[]>([emptyReturnLine]);
  const valid =
    !!claimId.trim() && !!returnPickupId.trim() && !!toLocationCode.trim() && lines.every((l) => !!l.sku.trim() && Number.isInteger(Number(l.qty)) && Number(l.qty) >= 1);
  const record = useCommand(async (_: null, key) => {
    const r = checkCommand(
      await request(
        'POST',
        api.inbound.POST('/return-receipts', {
          ...commandParams(key),
          body: {
            mfcId,
            claimId: claimId.trim(),
            returnPickupId: returnPickupId.trim(),
            toLocationCode: toLocationCode.trim(),
            ...(orderId.trim() ? { orderId: orderId.trim() } : {}),
            lines: lines.map((l) => ({
              sku: l.sku.trim(),
              qty: Number(l.qty),
              ...(l.sourceLotRef.trim() ? { sourceLotRef: l.sourceLotRef.trim() } : {}),
              ...(l.expiryDate ? { expiryDate: l.expiryDate } : {}),
              ...(l.conditionNote.trim() ? { conditionNote: l.conditionNote.trim() } : {}),
            })),
          },
        }),
      ),
    );
    if (r.resultId) setOpenId(r.resultId);
    return r;
  });
  const set = (i: number, patch: Partial<ReturnLine>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="max-w-4xl space-y-3 text-sm">
      <p className="text-xs opacity-70">{m.returnsHint}</p>
      <ReturnReceiptList mfcId={mfcId} />
      <form
        className="space-y-2 rounded-box bg-base-100 p-4"
        aria-label={m.submitReturn}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          if (record.phase.kind === 'rejected' || record.phase.kind === 'done') record.reset();
          void record.run(null);
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          {(
            [
              [m.claimId, claimId, setClaimId],
              [m.returnPickupId, returnPickupId, setPickup],
              [m.orderId, orderId, setOrderId],
              [m.returnLocation, toLocationCode, (v: string) => setTo(v.toUpperCase())],
            ] as const
          ).map(([label, value, onChange]) => (
            <label key={label} className="flex flex-col gap-1">
              {label}
              <input className="input input-sm w-40 font-mono" value={value} onChange={(e) => onChange(e.target.value)} />
            </label>
          ))}
        </div>
        <h3 className="font-semibold">{m.lines}</h3>
        {lines.map((l, i) => (
          <fieldset key={i} className="flex flex-wrap items-end gap-2" aria-label={m.resultRow(i + 1)}>
            <label className="flex flex-col gap-1">
              {m.sku}
              <input className="input input-sm w-36 font-mono" value={l.sku} onChange={(e) => set(i, { sku: e.target.value.toUpperCase() })} />
            </label>
            <label className="flex flex-col gap-1">
              {m.fields.qty.split('(')[0]}
              <input className="input input-sm w-20" type="number" min={1} step={1} value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              {m.sourceLotRef}
              <input className="input input-sm w-32" maxLength={64} value={l.sourceLotRef} onChange={(e) => set(i, { sourceLotRef: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              {m.expiryDate}
              <input className="input input-sm w-36" type="date" value={l.expiryDate} onChange={(e) => set(i, { expiryDate: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              {m.conditionNote}
              <input className="input input-sm w-48" maxLength={200} value={l.conditionNote} onChange={(e) => set(i, { conditionNote: e.target.value })} />
            </label>
            {lines.length > 1 && (
              <button type="button" className="btn btn-xs" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>
                {m.removeRow}
              </button>
            )}
          </fieldset>
        ))}
        <button type="button" className="btn btn-xs" onClick={() => setLines((prev) => [...prev, emptyReturnLine])}>
          {m.addRow}
        </button>
        <div>
          <button type="submit" className="btn btn-sm btn-primary" disabled={!valid || record.busy}>
            {m.submitReturn}
          </button>
        </div>
        <CommandFeedback command={record} />
      </form>
      <LookupForm key={openId} label={m.returnId} value={openId} onSubmit={setOpenId} />
      {openId && <ReturnReceiptView id={openId} />}
    </div>
  );
}

function ReturnReceiptView({ id }: { readonly id: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['return-receipt', id],
    queryFn: () => request('GET', api.inbound.GET('/return-receipts/{returnReceiptId}', { params: { path: { returnReceiptId: id } } })),
  });
  return (
    <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
      {(r) => (
        <div className="space-y-1 rounded-box bg-base-100 p-4" data-testid="return-receipt">
          <p className="flex flex-wrap items-center gap-2">
            <span className="badge badge-sm">{m.applyStatus[r.inventoryApplyStatus ?? ''] ?? r.inventoryApplyStatus}</span>
            <span className="badge badge-sm badge-outline">{m.inspectionState[r.inspectionState ?? ''] ?? r.inspectionState}</span>
          </p>
          <SystemNumbers ids={[{ label: m.sys.returnReceipt, id: r.returnReceiptId }]} />
          <p>{`${m.claimId} ${r.claimId ?? ''} · ${m.returnLocation} ${r.toLocationCode ?? ''} · ${r.receivedAt ? formatSeoul(r.receivedAt) : ''}`}</p>
          {r.rejectReason && <p className="text-error">{r.rejectReason}</p>}
          <ul className="list-disc pl-5">
            {(r.lines ?? []).map((l, i) => (
              <li key={`${l.sku ?? ''}-${i}`}>
                {`${l.sku ?? ''} × ${l.qty ?? 0} `}
                {l.lotId && (
                  <>
                    (<LotLabel lotId={l.lotId} />){' '}
                  </>
                )}
                {l.conditionNote ?? ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </QueryState>
  );
}

// ---------------------------------------------------------------- 공급 요청

interface SupplyLine {
  readonly sku: string;
  readonly qty: string;
}
interface SupplyForm {
  readonly requestedReadyAt: string;
  readonly urgency: 'NORMAL' | 'URGENT';
  readonly reason: string;
  readonly lines: readonly SupplyLine[];
}
const emptySupply: SupplyForm = { requestedReadyAt: '', urgency: 'NORMAL', reason: '', lines: [{ sku: '', qty: '' }] };

/** 계약 date-time → datetime-local(한국) */
const toLocalInput = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)).replace(' ', 'T');

const formFrom = (s: SupplyRequest): SupplyForm => ({
  requestedReadyAt: toLocalInput(s.requestedReadyAt),
  urgency: s.urgency,
  reason: s.reason,
  lines: s.lines.map((l) => ({ sku: l.sku, qty: String(l.qty) })),
});

const supplyValid = (f: SupplyForm) => !!f.requestedReadyAt && !!f.reason.trim() && f.lines.every((l) => !!l.sku.trim() && Number.isInteger(Number(l.qty)) && Number(l.qty) >= 1);

const supplyBody = (mfcId: string, f: SupplyForm) => ({
  mfcId,
  requestedReadyAt: seoulInput(f.requestedReadyAt),
  urgency: f.urgency,
  reason: f.reason.trim(),
  lines: f.lines.map((l) => ({ sku: l.sku.trim(), qty: Number(l.qty) })),
});

function SupplyFields({ value, onChange }: { readonly value: SupplyForm; readonly onChange: (f: SupplyForm) => void }) {
  const setLine = (i: number, patch: Partial<SupplyLine>) => onChange({ ...value, lines: value.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          {m.requestedReadyAt}
          <input className="input input-sm w-56" type="datetime-local" value={value.requestedReadyAt} onChange={(e) => onChange({ ...value, requestedReadyAt: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          {m.urgencyLabel}
          <select className="select select-sm w-28" value={value.urgency} onChange={(e) => onChange({ ...value, urgency: e.target.value as SupplyForm['urgency'] })}>
            <option value="NORMAL">{m.urgency.NORMAL}</option>
            <option value="URGENT">{m.urgency.URGENT}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {m.reason}
          <input className="input input-sm w-72" maxLength={500} value={value.reason} onChange={(e) => onChange({ ...value, reason: e.target.value })} />
        </label>
      </div>
      {value.lines.map((l, i) => (
        <fieldset key={i} className="flex flex-wrap items-end gap-2" aria-label={m.resultRow(i + 1)}>
          <label className="flex flex-col gap-1">
            {m.sku}
            <input className="input input-sm w-36 font-mono" value={l.sku} onChange={(e) => setLine(i, { sku: e.target.value.toUpperCase() })} />
          </label>
          <label className="flex flex-col gap-1">
            {m.fields.qty.split('(')[0]}
            <input className="input input-sm w-20" type="number" min={1} step={1} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
          </label>
          {value.lines.length > 1 && (
            <button type="button" className="btn btn-xs" onClick={() => onChange({ ...value, lines: value.lines.filter((_, j) => j !== i) })}>
              {m.removeRow}
            </button>
          )}
        </fieldset>
      ))}
      <button type="button" className="btn btn-xs" onClick={() => onChange({ ...value, lines: [...value.lines, { sku: '', qty: '' }] })}>
        {m.addRow}
      </button>
    </>
  );
}

export function SupplyRequestTab({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useParam('supplyRequestId');
  const [form, setForm] = useState<SupplyForm>(emptySupply);
  const create = useCommand(async (_: null, key) => {
    const r = await request('POST', api.inbound.POST('/supply-requests', { ...commandParams(key), body: supplyBody(mfcId, form) }));
    if (r.supplyRequestId) {
      queryClient.setQueryData(['supply-request', r.supplyRequestId], r);
      setOpenId(r.supplyRequestId);
    }
    setForm(emptySupply);
    return r;
  });
  return (
    <div className="max-w-4xl space-y-3 text-sm">
      <p className="text-xs opacity-70">{m.supplyHint}</p>
      <SupplyRequestList mfcId={mfcId} />
      <form
        className="space-y-2 rounded-box bg-base-100 p-4"
        aria-label={m.submitSupply}
        onSubmit={(e) => {
          e.preventDefault();
          if (!supplyValid(form)) return;
          if (create.phase.kind === 'rejected' || create.phase.kind === 'done') create.reset();
          void create.run(null);
        }}
      >
        <SupplyFields value={form} onChange={setForm} />
        <div>
          <button type="submit" className="btn btn-sm btn-primary" disabled={!supplyValid(form) || create.busy}>
            {m.submitSupply}
          </button>
        </div>
        <CommandFeedback command={create}>{() => <span className="text-success">{m.supplyCreated}</span>}</CommandFeedback>
      </form>
      <LookupForm key={openId} label={m.supplyId} value={openId} onSubmit={setOpenId} />
      {openId && <SupplyRequestView mfcId={mfcId} id={openId} />}
    </div>
  );
}

function SupplyRequestView({ mfcId, id }: { readonly mfcId: string; readonly id: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['supply-request', id],
    queryFn: () => request('GET', api.inbound.GET('/supply-requests/{supplyRequestId}', { params: { path: { supplyRequestId: id } } })),
  });
  return (
    <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
      {(s) => <SupplyRequestCard key={s.version} mfcId={mfcId} request={s} />}
    </QueryState>
  );
}

function SupplyRequestCard({ mfcId, request: s }: { readonly mfcId: string; readonly request: SupplyRequest }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const id = s.supplyRequestId ?? '';
  const [form, setForm] = useState<SupplyForm>(() => formFrom(s));
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['supply-request', id] });
  const editable = s.state === 'DRAFT' || s.state === 'SUBMITTED';
  const save = useCommand(async (_: null, key) => {
    setNotice(null);
    const r = await request(
      'PATCH',
      api.inbound.PATCH('/supply-requests/{supplyRequestId}', { ...commandParams(key, { path: { supplyRequestId: id }, version: s.version }), body: supplyBody(mfcId, form) }),
    );
    setNotice(m.supplySaved);
    await refresh();
    return r;
  });
  const withdraw = useCommand(async (_: null, key) => {
    setNotice(null);
    const r = checkCommand(
      await request(
        'POST',
        api.inbound.POST('/supply-requests/{supplyRequestId}/withdrawals', {
          ...commandParams(key, { path: { supplyRequestId: id }, version: s.version }),
          body: { reason: reason.trim() },
        }),
      ),
    );
    // 접수(ACCEPTED)면 상태를 다시 읽어 철회됐는지 본다
    await refresh();
    if (r.status === 'APPLIED') setNotice(m.withdrawn);
    return r;
  });
  return (
    <div className="space-y-3 rounded-box bg-base-100 p-4" data-testid="supply-request">
      <p className="flex flex-wrap items-center gap-2">
        <span className="badge badge-sm">{m.supplyState[s.state ?? ''] ?? s.state}</span>
        <span>{m.urgency[s.urgency] ?? s.urgency}</span>
        {s.linkedTrfId && <span className="opacity-70">{`${m.linkedTrf} ${s.linkedTrfId}`}</span>}
      </p>
      <SystemNumbers ids={[{ label: m.sys.supply, id: s.supplyRequestId }]} />
      {notice && (
        <p role="status" className="text-success">
          {notice}
        </p>
      )}
      <p className="opacity-70">
        {s.submittedAt ? `${formatSeoul(s.submittedAt)} ` : ''}
        {s.submittedBy && <Who id={s.submittedBy} />}
      </p>
      {editable ? (
        <form
          className="space-y-2 border-t border-base-200 pt-3"
          aria-label={m.saveSupply}
          onSubmit={(e) => {
            e.preventDefault();
            if (!supplyValid(form)) return;
            if (save.phase.kind === 'rejected') save.reset();
            void save.run(null);
          }}
        >
          <SupplyFields value={form} onChange={setForm} />
          <div>
            <button type="submit" className="btn btn-sm" disabled={!supplyValid(form) || save.busy}>
              {m.saveSupply}
            </button>
          </div>
          <CommandFeedback command={save} />
        </form>
      ) : (
        <ul className="list-disc pl-5">
          {s.lines.map((l) => (
            <li key={l.sku}>{`${l.sku} × ${l.qty}`}</li>
          ))}
        </ul>
      )}
      {s.state === 'ACKNOWLEDGED' && <p className="text-xs opacity-70">{m.supplyLocked}</p>}
      {s.state !== 'WITHDRAWN' && (
        <form
          className="flex flex-wrap items-end gap-2 border-t border-base-200 pt-3"
          aria-label={m.withdraw}
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) return;
            if (withdraw.phase.kind === 'rejected') withdraw.reset();
            void withdraw.run(null);
          }}
        >
          <label className="flex flex-col gap-1">
            {m.withdrawReason}
            <input className="input input-sm w-72" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-sm btn-warning" disabled={!reason.trim() || withdraw.busy}>
            {m.withdraw}
          </button>
          <div className="w-full">
            <CommandFeedback command={withdraw} />
          </div>
        </form>
      )}
    </div>
  );
}
