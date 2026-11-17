// 고객센터 "주문 취소"(상품준비 전) — claim-service 0.4.0, 백엔드 요청 backoffice/2026-11-18-request-cs-order-cancel.
// - 누가: CS_AGENT·OPERATOR_ADMIN(그 밖 역할은 버튼을 숨긴다 — 판정은 서버 403).
// - 언제: 주문 CONFIRMED 만 버튼. PREPARING 부터는 버튼 대신 "받으신 뒤 반품으로 안내" 문구(ADR-0060 그대로).
// - 범위: 주문 전체 — 모든 행 × 미이행 수량(unfulfilledQty). 부분 취소 없음.
// - 본문: `POST /claims` {orderId, type CANCEL, lines, reason, reasonDetail?, channel CS, identityCheck, caseRef?} → 201 Claim(STOP_PENDING).
// - 422 ORDER_NOT_CANCELLABLE(누른 사이 상태가 바뀜)은 서버 detail 을 그대로 보이고 주문을 다시 읽는다. DUPLICATE_CLAIM 은 이미 진행 중인 취소 안내.
// - 결과는 서버가 준 클레임 상태만 보인다(STOP_PENDING ≠ 취소 끝남) — 진행은 클레임 상세에서.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { ProblemFailure, request } from '@pmart/web-core';
import { failureCode, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/claim';
import type { components as OrderC } from '../../api/generated/order';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { CommandFeedback } from '../../shared/Feedback';
import { messages } from '../../shared/messages';
import { label } from '../../shared/ops';
import { Notice, Section } from '../../shared/admin';

const m = messages.orderCancel;
type Reason = components['schemas']['ClaimReason'];
type Method = components['schemas']['IdentityCheck']['method'];
type Order = OrderC['schemas']['StaffOrderDetail'];

/** 상담원이 고를 수 있는 사유(시스템 사유 FULFILLMENT_REJECTED·OUT_OF_STOCK 은 400) */
const REASONS: readonly Reason[] = ['CHANGE_OF_MIND', 'LATE_DELIVERY', 'ADDRESS_ERROR', 'OTHER'];
const METHODS: readonly Method[] = ['ORDER_DETAILS_MATCH', 'APP_SIGNED_IN_CHAT', 'OTHER'];
/** 상품준비가 시작된 뒤(버튼 대신 반품 안내) */
const AFTER_PREPARING = new Set(['PREPARING', 'PARTIALLY_HANDED_OVER', 'IN_DELIVERY', 'PARTIALLY_DELIVERED', 'COMPLETED']);

export function canCancelOrder(roles: readonly string[]) {
  return roles.includes('CS_AGENT') || roles.includes('OPERATOR_ADMIN');
}

/** 주문 상세 머리 오른쪽 — CONFIRMED 면 버튼, 상품준비 뒤면 안내 한 줄, 그 밖·권한 없음이면 없음 */
export function OrderCancelAction({ order, open, onOpen }: { readonly order: Order; readonly open: boolean; readonly onOpen: () => void }) {
  const { session } = useSession();
  if (!canCancelOrder(session?.roles ?? [])) return null;
  if (order.status === 'CONFIRMED')
    return (
      <button type="button" className="btn btn-sm btn-error btn-outline" aria-expanded={open} onClick={onOpen} data-testid="order-cancel-open">
        {m.button}
      </button>
    );
  if (AFTER_PREPARING.has(order.status ?? ''))
    return (
      <span className="text-xs text-base-content/60" data-testid="order-cancel-closed">
        {m.afterPreparing}
      </span>
    );
  return null;
}

/** 확인 상자 — 사유·메모, 본인 확인(기타면 메모 필수), 연결할 CS 접수 */
export function OrderCancelForm({ order, caseRef: initialCaseRef = '', onClose }: { readonly order: Order; readonly caseRef?: string; readonly onClose: () => void }) {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<Reason | ''>('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [method, setMethod] = useState<Method | ''>('');
  const [methodNote, setMethodNote] = useState('');
  const [caseRef, setCaseRef] = useState(initialCaseRef);

  const lines = order.lines.filter((l) => l.orderLineId && (l.unfulfilledQty ?? 0) > 0).map((l) => ({ orderLineId: l.orderLineId ?? '', qty: l.unfulfilledQty ?? 0 }));
  const create = useCommand(async (body: components['schemas']['CreateClaimRequest'], key) => {
    try {
      const claim = await request('POST', api.claims.POST('/claims', { ...commandParams(key), body }));
      void queryClient.invalidateQueries({ queryKey: ['claims'] });
      return claim;
    } finally {
      // 성공·거절 모두 주문을 다시 읽는다(누른 사이 상태가 바뀌었을 수 있다)
      void queryClient.invalidateQueries({ queryKey: ['orders', 'lookup', order.orderId] });
    }
  });
  const locked = create.busy || create.phase.kind === 'done';
  const noteOk = method !== 'OTHER' || methodNote.trim().length > 0;
  const valid = lines.length > 0 && reason !== '' && method !== '' && noteOk;
  const failure = create.phase.kind === 'rejected' ? create.phase.failure : undefined;
  const code = failure ? failureCode(failure) : undefined;
  const serverDetail = failure instanceof ProblemFailure ? failure.problem.detail : undefined;

  return (
    <Section id="order-cancel" title={m.title} testId="order-cancel" aside={<button type="button" className="btn btn-ghost btn-xs" onClick={onClose}>{m.close}</button>}>
      <form
        className="space-y-4"
        aria-label={m.title}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || locked) return;
          void create.run({
            orderId: order.orderId,
            type: 'CANCEL',
            channel: 'CS',
            lines,
            reason,
            ...(reasonDetail.trim() ? { reasonDetail: reasonDetail.trim() } : {}),
            identityCheck: { method, ...(methodNote.trim() ? { note: methodNote.trim() } : {}) },
            ...(caseRef.trim() ? { caseRef: caseRef.trim() } : {}),
          });
        }}
      >
        <Notice tone="warning">{m.whole}</Notice>
        <fieldset className="space-y-3" disabled={locked}>
          <label className="flex flex-col gap-1 text-sm">
            {m.reason}
            <select className="select select-sm w-64" value={reason} onChange={(e) => setReason(e.target.value as Reason | '')}>
              <option value="">{messages.returns.pick}</option>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {messages.claims.reasonName[r] ?? r}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {m.reasonDetail}
            <input className="input input-sm w-full" maxLength={500} placeholder={m.reasonDetailHint} value={reasonDetail} onChange={(e) => setReasonDetail(e.target.value)} />
          </label>
          <div className="space-y-1">
            <p className="text-sm">{messages.csIntake.method}</p>
            <p className="text-xs text-base-content/60">{messages.csIntake.identityHint}</p>
            <div className="flex flex-wrap gap-3">
              {METHODS.map((v) => (
                <label key={v} className="flex items-center gap-1 text-sm">
                  <input type="radio" className="radio radio-xs" name="cancel-identity" value={v} checked={method === v} onChange={() => setMethod(v)} />
                  {messages.csIntake.methodName[v]}
                </label>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            {method === 'OTHER' ? messages.returns.methodNoteRequired : messages.returns.methodNote}
            <input className="input input-sm w-full" maxLength={200} value={methodNote} onChange={(e) => setMethodNote(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {messages.returns.caseRef}
            <input className="input input-sm w-64" maxLength={64} value={caseRef} onChange={(e) => setCaseRef(e.target.value)} />
          </label>
        </fieldset>
        {lines.length === 0 && <p className="text-sm text-warning">{m.nothingLeft}</p>}
        <button type="submit" className="btn btn-error btn-sm" disabled={locked || !valid}>
          {m.submit}
        </button>
        {code === 'ORDER_NOT_CANCELLABLE' && (
          <p role="note" className="text-sm text-warning" data-testid="order-cancel-not-cancellable">
            {serverDetail ?? m.afterPreparing}
          </p>
        )}
        {code === 'DUPLICATE_CLAIM' && <p className="text-sm text-warning">{m.duplicate}</p>}
        <CommandFeedback command={create} unknown={{ body: m.unknown }}>
          {(c) => (
            <div role="status" className="alert alert-success text-sm" data-testid="order-cancel-created">
              <span>{m.created(label(messages.claims.stateName, c.state))}</span>
              {c.claimId && (
                <button type="button" className="btn btn-xs" onClick={() => void navigate(`/claims/${encodeURIComponent(c.claimId ?? '')}`)}>
                  {messages.returns.openClaim}
                </button>
              )}
            </div>
          )}
        </CommandFeedback>
      </form>
    </Section>
  );
}
