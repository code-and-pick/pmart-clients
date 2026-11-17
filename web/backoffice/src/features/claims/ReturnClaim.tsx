// 인계 뒤 반품(회수) — claim-service 0.2.0, 백엔드 요청 all/2026-11-17-request-return-recovery §2(고객센터 — CS_AGENT·OPERATOR_ADMIN).
// - 접수: `POST /claims` {orderId, type RETURN, lines, reason, reasonDetail?, channel CS, faultCode?, identityCheck, caseRef?} → 201 Claim.
//   회사 잘못(faultCode)이면 회수비 면제, 비우면 고객 사유 — 회수비는 서버가 정한다(화면은 안내만, 금액을 계산하지 않는다).
//   반품 가능 수량은 서버가 판정(422 QUANTITY_EXCEEDS_AVAILABLE·NOT_HANDED_OVER) — 화면은 인계·반품 완료 수량을 보여 주고 입력 최대만 건다.
// - 회수 조치: `POST /claims/{id}/recovery-actions` {action RETRY_PICKUP|CANCEL, note} — RECOVERY_FAILED 에서 둘 다, FEE_PENDING 에서는 취소만(그 밖 409).
// - 고객이 말한 번호·주소는 받지 않는다(본인 확인은 방법만).
// claim 0.3.0(CL-1 추가 결정 1~9):
// - 반품 가능 수량은 **전달 완료(deliveredQty)** − 반품 완료 기준(배달 중·전달 전 반품 불가 — 422 NOT_DELIVERED_YET).
// - 반품 기한(returnDeadlineAt, 접수 + 7일)·횟수에 드는 실패(pickup.countedFailures)·다시 회수 가능(pickup.retryAllowed)은 서버 값만 보인다.
//   다시 회수 버튼은 retryAllowed 가 false 가 아닐 때만(기한 지남은 서버 409 RETURN_DEADLINE_PASSED — 화면이 시각을 비교해 막지 않는다).
// - 반품 취소 때 낸 회수비(feePayment PAID)를 돌려줄지 feeRefund — 고객 사유는 안 돌려줌·우리 잘못은 돌려줌으로 정해져 있고 파손·기타만 상담원 판단.
//   계약에 회수 실패 사유가 없어 화면은 파손·기타인지 모른다 → 낸 회수비가 있으면 고르게 두고 고를 때만 true, 규칙과 다르면 서버 422 FEE_REFUND_NOT_ALLOWED 안내.
// - 라이더가 수거했거나 센터가 받은 회수품이 있으면 취소 버튼 없음(서버 409) — 받은 만큼만 끝내기. 결과는 feePayment.refundDecision·환불(kind RETURN_FEE).
// - 받은 만큼만 끝내기(CLOSE_AS_RECEIVED): IN_PROGRESS·RECOVERY_FAILED 에서 센터가 받은 수량이 요청보다 적을 때 — 남은 수량은 환불 없음·다시 반품 접수 불가.
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
import { DataTable, PageHeader } from '../../shared/admin';

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
  NOT_DELIVERED_YET: m.notDelivered,
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
          <fieldset className="space-y-2 rounded-box border border-base-300 bg-base-100 p-4" disabled={locked}>
            <legend className="font-bold">{m.lines}</legend>
            <p className="text-xs text-base-content/60">{m.linesHint}</p>
            <DataTable>
              <thead>
                <tr>
                  <th>{m.product}</th>
                  <th>{m.delivered}</th>
                  <th>{m.returned}</th>
                  <th>{m.qty}</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l) => {
                  // claim 0.3.0: 전달 완료 수량 기준(모르면 0 — 서버가 최종 판정)
                  const max = Math.max(0, (l.deliveredQty ?? 0) - (l.returnedQty ?? 0));
                  const id = l.orderLineId ?? '';
                  return (
                    <tr key={id} data-testid="return-line">
                      <td>{`${text(l.productName ?? l.sku)}${l.optionLabel ? ` · ${l.optionLabel}` : ''}`}</td>
                      <td>{text(l.deliveredQty)}</td>
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
            </DataTable>
          </fieldset>

          <fieldset className="space-y-2 rounded-box border border-base-300 bg-base-100 p-4" disabled={locked}>
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

          <fieldset className="space-y-2 rounded-box border border-base-300 bg-base-100 p-4" disabled={locked}>
            <legend className="font-bold">{messages.csIntake.method}</legend>
            <p className="text-xs text-base-content/60">{messages.csIntake.identityHint}</p>
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
      <PageHeader title={m.title} description={m.intro} />
      <form
        className="flex flex-wrap items-end gap-2 rounded-box border border-base-300 bg-base-100 p-3 text-sm"
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
      {orderId ? <ReturnForm key={orderId} orderId={orderId} /> : <p className="text-sm text-base-content/60">{m.enterOrder}</p>}
    </section>
  );
}

/** 반품 진행 — 회사 잘못·회수비 결제(돌려주기 결정)·반품 기한·회수 횟수(0.3.0 횟수에 드는 실패·다시 회수 가능) */
export function ReturnProgress({ claim }: { readonly claim: Claim }) {
  if (claim.type !== 'RETURN') return null;
  const fee = claim.feePayment;
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2.5 text-sm [&_dt]:text-base-content/55" data-testid="return-progress">
      <dt>{m.fault}</dt>
      <dd>{claim.faultCode ? m.faultName[claim.faultCode] : m.customerFault}</dd>
      <dt>{m.feePayment}</dt>
      <dd data-testid="return-fee">
        {fee ? `${won(fee.amount)} · ${label(m.feeState, fee.state)} · ${m.feeDeadline} ${when(fee.deadlineAt)}${fee.refundDecision ? ` · ${label(m.refundDecision, fee.refundDecision)}` : ''}` : m.noFee}
      </dd>
      <dt>{m.returnDeadline}</dt>
      <dd data-testid="return-deadline">{when(claim.returnDeadlineAt)}</dd>
      <dt>{m.pickupAttempts}</dt>
      <dd data-testid="return-attempts">
        {m.attempts(text(claim.pickup?.attempts), text(claim.pickup?.failedAttempts))}
        {claim.pickup?.countedFailures !== undefined && ` · ${m.countedFailures(text(claim.pickup.countedFailures))}`}
        {claim.pickup?.retryAllowed === false && <span className="text-warning">{` · ${m.noMoreRetry}`}</span>}
      </dd>
    </dl>
  );
}

type RecoveryAction = components['schemas']['RecoveryActionRequest']['action'];

/** 조치 거절 코드 → 안내(0.3.0) */
const ACTION_REJECT_TEXT: Readonly<Record<string, string>> = {
  PICKUP_ATTEMPTS_EXHAUSTED: m.attemptsExhausted,
  RETURN_DEADLINE_PASSED: m.deadlinePassed,
  NOTHING_RECEIVED: m.nothingReceived,
  NOT_SHORT: m.notShort,
  PICKUP_IN_PROGRESS: m.pickupInProgress,
  FEE_REFUND_NOT_ALLOWED: m.feeRefundNotAllowed,
};

/** 서버 값으로 본 지금 할 수 있는 조치(최종 판정은 서버) */
function availableActions(claim: Claim): Set<RecoveryAction> {
  const out = new Set<RecoveryAction>();
  if (claim.type !== 'RETURN') return out;
  const lines = claim.lines ?? [];
  // 백엔드 요청 §5: 다시 회수는 RECOVERY_FAILED·retryAllowed·기한 전일 때만(기한 판정은 서버 — 지나면 409 RETURN_DEADLINE_PASSED)
  const beforeDeadline = !claim.returnDeadlineAt || Date.now() < Date.parse(claim.returnDeadlineAt);
  if (claim.state === 'RECOVERY_FAILED' && claim.pickup?.retryAllowed !== false && beforeDeadline) out.add('RETRY_PICKUP');
  // 라이더가 이미 수거했거나 센터가 받은 회수품이 있으면 취소는 409 — 받은 만큼만 끝내기를 쓴다
  const pickedUp = lines.some((l) => (l.pickedUpQty ?? 0) > 0 || (l.receivedQty ?? 0) > 0);
  if ((claim.state === 'RECOVERY_FAILED' || claim.state === 'FEE_PENDING') && !pickedUp) out.add('CANCEL');
  const received = lines.some((l) => (l.receivedQty ?? 0) > 0);
  const short = lines.some((l) => (l.receivedQty ?? 0) < (l.approvedQty ?? l.requestedQty ?? 0));
  if ((claim.state === 'IN_PROGRESS' || claim.state === 'RECOVERY_FAILED') && received && short) out.add('CLOSE_AS_RECEIVED');
  return out;
}

/** 회수 조치 — 다시 회수(RECOVERY_FAILED·시도 남음)·반품 취소(RECOVERY_FAILED·FEE_PENDING)·받은 만큼만 끝내기(덜 받았을 때). 고객과 다시 연락한 뒤 사유와 함께 */
export function RecoveryActions({ claim }: { readonly claim: Claim }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [feeRefund, setFeeRefund] = useState(false);
  // 보낸 조치 — 성공하면 상태가 바뀌어 버튼 조건이 사라지므로, 결과를 보이도록 보낸 버튼은 남긴다
  const [sent, setSent] = useState<RecoveryAction | null>(null);
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
      // 0.3.0 회수비 돌려주기는 환불(kind RETURN_FEE)로 생긴다
      void queryClient.invalidateQueries({ queryKey: ['claims', 'refunds', claimId] });
    }
  });
  const can = availableActions(claim);
  if (sent !== null) can.add(sent);
  // 조치가 성공하면 상태가 바뀌어 이 칸이 사라진다 — 결과를 보이도록 명령을 한 번이라도 보냈으면 남긴다
  if (can.size === 0 && act.phase.kind === 'idle') return null;
  const locked = act.busy || act.phase.kind === 'done';
  const ok = note.trim().length > 0;
  // 낸 회수비가 있을 때만 돌려주기를 고를 수 있다. 고르면 true 만 보내고, 안 고르면 보내지 않는다(서버가 규칙대로 — 고객 사유 안 돌려줌·우리 잘못 돌려줌·파손·기타 기본 안 돌려줌).
  // 회수 실패 사유가 계약에 없어 화면이 파손·기타인지 모른다 — 규칙과 다르면 422 FEE_REFUND_NOT_ALLOWED 안내
  const paidFee = claim.feePayment?.state === 'PAID';
  const run = (action: RecoveryAction) => {
    setSent(action);
    void act.run({ action, note: note.trim(), ...(action === 'CANCEL' && paidFee && feeRefund ? { feeRefund: true } : {}) });
  };
  const code = act.phase.kind === 'rejected' ? failureCode(act.phase.failure) : undefined;
  return (
    <div className="space-y-2 rounded-box border border-warning bg-base-100 px-5 py-4" data-testid="recovery-actions">
      <h2 className="font-bold">{m.actionsTitle}</h2>
      {act.phase.kind !== 'done' && (
        <p className="text-sm">{claim.state === 'RECOVERY_FAILED' ? m.recoveryFailedNote : claim.state === 'FEE_PENDING' ? m.feePendingNote : m.shortNote}</p>
      )}
      {claim.state === 'RECOVERY_FAILED' && claim.pickup?.retryAllowed === false && act.phase.kind === 'idle' && (
        <p className="text-sm text-warning" data-testid="no-more-retry">
          {m.attemptsExhausted}
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm">
        {m.actionNote}
        <input className="input input-sm w-full" maxLength={500} value={note} disabled={locked} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        {can.has('RETRY_PICKUP') && (
          <button type="button" className="btn btn-sm btn-primary" disabled={locked || !ok} onClick={() => run('RETRY_PICKUP')}>
            {m.retryPickup}
          </button>
        )}
        {can.has('CANCEL') && (
          <button type="button" className="btn btn-sm" disabled={locked || !ok} onClick={() => run('CANCEL')}>
            {m.cancelReturn}
          </button>
        )}
        {can.has('CLOSE_AS_RECEIVED') && (
          <button type="button" className="btn btn-sm btn-outline btn-warning" disabled={locked || !ok} onClick={() => run('CLOSE_AS_RECEIVED')}>
            {m.closeAsReceived}
          </button>
        )}
      </div>
      {can.has('CANCEL') && paidFee && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="checkbox checkbox-sm" checked={feeRefund} disabled={locked} onChange={(e) => setFeeRefund(e.target.checked)} />
          <span>
            {m.feeRefund}
            <span className="block text-xs text-base-content/60">{m.feeRefundHint}</span>
          </span>
        </label>
      )}
      {can.has('CANCEL') && <p className="text-xs text-base-content/60">{m.cancelHint}</p>}
      {can.has('CLOSE_AS_RECEIVED') && (
        <p className="text-xs text-warning" data-testid="close-as-received-hint">
          {m.closeAsReceivedHint}
        </p>
      )}
      {(code === 'INVALID_STATE' || code === 'VERSION_CONFLICT' || code === 'CONFLICT') && <p className="text-sm text-warning">{m.actionConflict}</p>}
      {code !== undefined && ACTION_REJECT_TEXT[code] && (
        <p className="text-sm text-warning" data-testid="recovery-rejected">
          {ACTION_REJECT_TEXT[code]}
        </p>
      )}
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

/** 접수 건(RETURN_RECOVERY_FAILED, case 0.22.0) → 클레임 상태·회수 조치. 조치해도 접수 건은 사람이 완료 처리한다 */
export function ClaimOfCase({ claimId }: { readonly claimId: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['claims', 'detail', claimId],
    enabled: claimId !== '',
    queryFn: () => request('GET', api.claims.GET('/claims/{claimId}', { params: { path: { claimId } } })),
  });
  if (!claimId) return null;
  return (
    <div className="space-y-2 rounded-box border border-base-300 bg-base-100 p-4 text-sm" data-testid="case-claim">
      <h2 className="font-bold">
        {m.caseClaim}{' '}
        <Link className="link font-mono" to={`/claims/${encodeURIComponent(claimId)}`}>
          {claimId}
        </Link>
      </h2>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(c) => (
          <>
            <p data-testid="case-claim-state">{label(messages.claims.stateName, c.state)}</p>
            <p className="text-xs text-base-content/60">{availableActions(c).size > 0 ? m.caseClaimNote : m.caseClaimDone}</p>
            <ReturnProgress claim={c} />
            <RecoveryActions claim={c} />
          </>
        )}
      </QueryState>
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
