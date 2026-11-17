// 인계 뒤 반품(회수) — claim-service 0.2.0, 백엔드 요청 all/2026-11-17-request-return-recovery §2(고객센터 — CS_AGENT·OPERATOR_ADMIN).
// - 접수: `POST /claims` {orderId, type RETURN, lines, reason, reasonDetail?, channel CS, faultCode?, identityCheck, caseRef?} → 201 Claim.
//   회사 잘못(faultCode)이면 회수비 면제, 비우면 고객 사유 — 회수비는 서버가 정한다(화면은 안내만, 금액을 계산하지 않는다).
//   반품 가능 수량은 서버가 판정(422 QUANTITY_EXCEEDS_AVAILABLE·NOT_HANDED_OVER) — 화면은 인계·반품 완료 수량을 보여 주고 입력 최대만 건다.
// - 회수 조치: `POST /claims/{id}/recovery-actions` {action RETRY_PICKUP|CANCEL, note} — RECOVERY_FAILED 에서 둘 다, FEE_PENDING 에서는 취소만(그 밖 409).
// - 고객이 말한 번호·주소는 받지 않는다(본인 확인은 방법만).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { failureCode, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/claim';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback } from '../../shared/Feedback';
import { messages } from '../../shared/messages';
import { label, text, when, won } from '../../shared/ops';

const m = messages.returns;
type Claim = components['schemas']['Claim'];
type Reason = components['schemas']['ClaimReason'];
type Fault = components['schemas']['ReturnFaultCode'];
type Method = components['schemas']['IdentityCheck']['method'];

const REASONS: readonly Reason[] = ['CHANGE_OF_MIND', 'DEFECT', 'WRONG_ITEM', 'NOT_AS_ADVERTISED', 'DAMAGED_IN_DELIVERY', 'MISSING_ITEM', 'LATE_DELIVERY', 'OTHER'];
const FAULTS: readonly Fault[] = ['MISDELIVERY', 'DEFECTIVE', 'DAMAGED_IN_DELIVERY', 'SEVERE_DELAY', 'WRONG_SUBSTITUTE'];
const METHODS: readonly Method[] = ['ORDER_DETAILS_MATCH', 'APP_SIGNED_IN_CHAT', 'OTHER'];

/** 접수 거절 코드 → 안내(오류 분기는 Problem code 로만) */
const REJECT_TEXT: Readonly<Record<string, string>> = {
  QUANTITY_EXCEEDS_AVAILABLE: m.qtyExceeded,
  NOT_HANDED_OVER: m.notHandedOver,
  CONFIG_REQUIRED: m.configRequired,
};

function ReturnForm({ orderId }: { readonly orderId: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const order = useQuery({
    queryKey: ['orders', 'lookup', orderId],
    queryFn: () => request('GET', api.orders.GET('/orders/lookups/{orderId}', { params: { path: { orderId } } })),
  });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<Reason | ''>('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [fault, setFault] = useState<Fault | ''>('');
  const [method, setMethod] = useState<Method | ''>('');
  const [methodNote, setMethodNote] = useState('');
  const [caseRef, setCaseRef] = useState('');

  const create = useCommand(async (body: components['schemas']['CreateClaimRequest'], key) => {
    const claim = await request('POST', api.claims.POST('/claims', { ...commandParams(key), body }));
    void queryClient.invalidateQueries({ queryKey: ['claims'] });
    return claim;
  });
  const locked = create.busy || create.phase.kind === 'done';
  const lines = Object.entries(qty)
    .filter(([, n]) => n > 0)
    .map(([orderLineId, n]) => ({ orderLineId, qty: n }));
  const noteOk = method !== 'OTHER' || methodNote.trim().length > 0;
  const valid = lines.length > 0 && reason !== '' && method !== '' && noteOk;
  const code = create.phase.kind === 'rejected' ? failureCode(create.phase.failure) : undefined;

  const submit = () => {
    if (!valid) return;
    void create.run({
      orderId,
      type: 'RETURN',
      channel: 'CS',
      lines,
      reason,
      ...(reasonDetail.trim() ? { reasonDetail: reasonDetail.trim() } : {}),
      ...(fault ? { faultCode: fault } : {}),
      identityCheck: { method, ...(methodNote.trim() ? { note: methodNote.trim() } : {}) },
      ...(caseRef.trim() ? { caseRef: caseRef.trim() } : {}),
    });
  };

  return (
    <QueryState state={toUiState(order)} onRetry={() => void order.refetch()}>
      {(o) => (
        <form
          className="space-y-4"
          aria-label={m.formLabel}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <fieldset className="space-y-2 rounded-box bg-base-100 p-4" disabled={locked}>
            <legend className="font-bold">{m.lines}</legend>
            <p className="text-xs opacity-70">{m.linesHint}</p>
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>{m.product}</th>
                  <th>{m.handedOver}</th>
                  <th>{m.returned}</th>
                  <th>{m.qty}</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l) => {
                  const max = Math.max(0, (l.handedOverQty ?? 0) - (l.returnedQty ?? 0));
                  const id = l.orderLineId ?? '';
                  return (
                    <tr key={id} data-testid="return-line">
                      <td>{`${text(l.productName ?? l.sku)}${l.optionLabel ? ` · ${l.optionLabel}` : ''}`}</td>
                      <td>{text(l.handedOverQty)}</td>
                      <td>{text(l.returnedQty)}</td>
                      <td>
                        <input
                          type="number"
                          className="input input-xs w-20"
                          aria-label={m.qtyOf(text(l.productName ?? l.sku))}
                          min={0}
                          max={max}
                          disabled={max === 0}
                          value={qty[id] ?? 0}
                          onChange={(e) => setQty((q) => ({ ...q, [id]: Math.min(max, Math.max(0, Number(e.target.value) || 0)) }))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </fieldset>

          <fieldset className="space-y-2 rounded-box bg-base-100 p-4" disabled={locked}>
            <legend className="font-bold">{m.why}</legend>
            <label className="flex flex-col gap-1 text-sm">
              {m.reason}
              <select className="select select-sm w-64" value={reason} onChange={(e) => setReason(e.target.value as Reason | '')}>
                <option value="">{m.pick}</option>
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {messages.claims.reasonName[r]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {m.reasonDetail}
              <input className="input input-sm w-full" maxLength={500} value={reasonDetail} onChange={(e) => setReasonDetail(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {m.fault}
              <select className="select select-sm w-64" value={fault} onChange={(e) => setFault(e.target.value as Fault | '')}>
                <option value="">{m.customerFault}</option>
                {FAULTS.map((f) => (
                  <option key={f} value={f}>
                    {m.faultName[f]}
                  </option>
                ))}
              </select>
            </label>
            <p className={`text-xs ${fault ? 'text-info' : 'text-warning'}`} data-testid="return-fee-hint">
              {fault ? m.feeWaived : m.feeCustomer}
            </p>
          </fieldset>

          <fieldset className="space-y-2 rounded-box bg-base-100 p-4" disabled={locked}>
            <legend className="font-bold">{messages.csIntake.method}</legend>
            <p className="text-xs opacity-70">{messages.csIntake.identityHint}</p>
            <div className="flex flex-wrap gap-3">
              {METHODS.map((v) => (
                <label key={v} className="flex items-center gap-1 text-sm">
                  <input type="radio" className="radio radio-xs" name="return-identity" value={v} checked={method === v} onChange={() => setMethod(v)} />
                  {messages.csIntake.methodName[v]}
                </label>
              ))}
            </div>
            <label className="flex flex-col gap-1 text-sm">
              {method === 'OTHER' ? m.methodNoteRequired : m.methodNote}
              <input className="input input-sm w-full" maxLength={200} value={methodNote} onChange={(e) => setMethodNote(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {m.caseRef}
              <input className="input input-sm w-64" maxLength={64} value={caseRef} onChange={(e) => setCaseRef(e.target.value)} />
            </label>
          </fieldset>

          <button type="submit" className="btn btn-primary btn-sm" disabled={locked || !valid}>
            {m.submit}
          </button>
          {code && REJECT_TEXT[code] && <p className="text-sm text-warning">{REJECT_TEXT[code]}</p>}
          <CommandFeedback command={create} unknown={{ body: m.unknown }}>
            {(c) => (
              <div role="status" className="alert alert-success text-sm" data-testid="return-created">
                <span>{m.created(label(messages.claims.stateName, c.state))}</span>
                {c.claimId && (
                  <button type="button" className="btn btn-xs" onClick={() => void navigate(`/claims/${encodeURIComponent(c.claimId ?? '')}`)}>
                    {m.openClaim}
                  </button>
                )}
              </div>
            )}
          </CommandFeedback>
        </form>
      )}
    </QueryState>
  );
}

/** 고객센터 "반품 접수" — 주문 ID 로 시작(주문 상세에서 ?orderId= 로 들어온다) */
export function ReturnIntakePage() {
  const [params, setParams] = useSearchParams();
  const orderId = params.get('orderId') ?? '';
  const [draft, setDraft] = useState(orderId);
  return (
    <section className="max-w-4xl space-y-4">
      <h1 className="text-xl font-bold">{m.title}</h1>
      <p className="text-sm opacity-70">{m.intro}</p>
      <form
        className="flex flex-wrap items-end gap-2 rounded-box bg-base-100 p-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const v = draft.trim();
          setParams(v ? { orderId: v } : {});
        }}
      >
        <label className="flex flex-col gap-1">
          {messages.claims.orderId}
          <input className="input input-sm w-64" value={draft} maxLength={64} onChange={(e) => setDraft(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-sm">
          {m.loadOrder}
        </button>
      </form>
      {orderId ? <ReturnForm key={orderId} orderId={orderId} /> : <p className="text-sm opacity-70">{m.enterOrder}</p>}
    </section>
  );
}

/** 반품 진행(0.2.0 필드) — 회사 잘못·회수비 결제·회수 횟수 */
export function ReturnProgress({ claim }: { readonly claim: Claim }) {
  if (claim.type !== 'RETURN') return null;
  const fee = claim.feePayment;
  return (
    <dl className="grid grid-cols-[9rem_1fr] gap-1 rounded-box bg-base-100 p-4 text-sm" data-testid="return-progress">
      <dt>{m.fault}</dt>
      <dd>{claim.faultCode ? m.faultName[claim.faultCode] : m.customerFault}</dd>
      <dt>{m.feePayment}</dt>
      <dd data-testid="return-fee">{fee ? `${won(fee.amount)} · ${label(m.feeState, fee.state)} · ${m.feeDeadline} ${when(fee.deadlineAt)}` : m.noFee}</dd>
      <dt>{m.pickupAttempts}</dt>
      <dd>{m.attempts(text(claim.pickup?.attempts), text(claim.pickup?.failedAttempts))}</dd>
    </dl>
  );
}

/** 회수 조치 — RECOVERY_FAILED 는 다시 회수·취소, FEE_PENDING 은 취소만. 고객과 다시 연락한 뒤 사유와 함께 */
export function RecoveryActions({ claim }: { readonly claim: Claim }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const claimId = claim.claimId ?? '';
  const act = useCommand(async (body: components['schemas']['RecoveryActionRequest'], key) => {
    try {
      const next = await request(
        'POST',
        api.claims.POST('/claims/{claimId}/recovery-actions', { ...commandParams(key, { path: { claimId }, ...(claim.version !== undefined ? { version: claim.version } : {}) }), body }),
      );
      queryClient.setQueryData(['claims', 'detail', claimId], next);
      return next;
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['claims', 'list'] });
    }
  });
  // 조치가 성공하면 상태가 바뀌어 이 칸이 사라진다 — 결과를 보이도록 명령을 한 번이라도 보냈으면 남긴다
  if ((claim.type !== 'RETURN' || (claim.state !== 'RECOVERY_FAILED' && claim.state !== 'FEE_PENDING')) && act.phase.kind === 'idle') return null;
  const locked = act.busy || act.phase.kind === 'done';
  const ok = note.trim().length > 0;
  const run = (action: 'RETRY_PICKUP' | 'CANCEL') => void act.run({ action, note: note.trim() });
  const code = act.phase.kind === 'rejected' ? failureCode(act.phase.failure) : undefined;
  return (
    <div className="space-y-2 rounded-box border border-warning bg-base-100 p-4" data-testid="recovery-actions">
      <h2 className="font-bold">{m.actionsTitle}</h2>
      {act.phase.kind !== 'done' && <p className="text-sm">{claim.state === 'RECOVERY_FAILED' ? m.recoveryFailedNote : m.feePendingNote}</p>}
      <label className="flex flex-col gap-1 text-sm">
        {m.actionNote}
        <input className="input input-sm w-full" maxLength={500} value={note} disabled={locked} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        {(claim.state === 'RECOVERY_FAILED' || act.phase.kind !== 'idle') && (
          <button type="button" className="btn btn-sm btn-primary" disabled={locked || !ok} onClick={() => run('RETRY_PICKUP')}>
            {m.retryPickup}
          </button>
        )}
        <button type="button" className="btn btn-sm" disabled={locked || !ok} onClick={() => run('CANCEL')}>
          {m.cancelReturn}
        </button>
      </div>
      <p className="text-xs opacity-70">{m.cancelHint}</p>
      {(code === 'INVALID_STATE' || code === 'VERSION_CONFLICT' || code === 'CONFLICT') && <p className="text-sm text-warning">{m.actionConflict}</p>}
      <CommandFeedback command={act} unknown={{ body: m.unknown }}>
        {(c) => (
          <p role="status" className="text-sm text-success" data-testid="recovery-done">
            {m.actionDone(label(messages.claims.stateName, c.state))}
          </p>
        )}
      </CommandFeedback>
    </div>
  );
}

/** 주문 상세 → 반품 접수(인계된 품목이 있을 때) */
export function ReturnIntakeLink({ orderId }: { readonly orderId: string }) {
  return (
    <Link className="btn btn-sm" to={`/return-intake?orderId=${encodeURIComponent(orderId)}`}>
      {m.startFromOrder}
    </Link>
  );
}
