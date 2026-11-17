// 배송 상세 조치(2026-11-17, PC 5): 상태 정정(execution 0.17.0), 전달 실패 확정·반려 + 반납할 사람(0.18.0), 지원센터 직접 실패 처리(0.18.0),
// 배차 취소(dispatch). 권한·상태 판정은 서버 — 화면은 지금 상태에 맞는 폼만 보인다.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '@pmart/web-core';
import { CommandFeedback, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components as Dispatch } from '../../api/generated/delivery-dispatch';
import type { components as Execution } from '../../api/generated/delivery-execution';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { label, settled } from '../../shared/opsUi';

type DeliveryExecution = Execution['schemas']['DeliveryExecution'];
type DispatchView = Dispatch['schemas']['Delivery'];
const a = ops.actions;
const n = messages.names;

const CORRECTABLE: Readonly<Record<string, readonly string[]>> = {
  ASSIGNED: ['ARRIVED_AT_STORE'],
  ARRIVED_AT_STORE: ['ASSIGNED'],
  PICKED_UP: ['ARRIVED_AT_CUSTOMER'],
  ARRIVED_AT_CUSTOMER: ['PICKED_UP'],
};
const FAILURE_REASONS = ['CUSTOMER_ABSENT', 'ADDRESS_ERROR', 'UNREACHABLE', 'REFUSED', 'DAMAGED', 'RIDER_INCIDENT', 'OTHER'] as const;

function Result({ applied }: { readonly applied: boolean }) {
  return (
    <p role="status" className={applied ? 'text-sm text-success' : 'text-sm text-info'} data-testid="action-result">
      {applied ? a.decided : a.accepted}
    </p>
  );
}

export function DeliveryActions({ delivery, dispatch }: { readonly delivery: DeliveryExecution; readonly dispatch: DispatchView | undefined }) {
  const state = delivery.state ?? '';
  const forward = delivery.type !== 'RETURN';
  return (
    <div className="space-y-3" data-testid="delivery-actions">
      {forward && CORRECTABLE[state] && <CorrectionForm delivery={delivery} />}
      {state === 'FAILURE_REPORTED' && <FailureDecisionForm delivery={delivery} direct={false} />}
      {forward && (state === 'PICKED_UP' || state === 'ARRIVED_AT_CUSTOMER') && <FailureDecisionForm delivery={delivery} direct />}
      {dispatch && (dispatch.state === 'ASSIGNED' || dispatch.state === 'DISPATCHING') && <CancellationForm dispatch={dispatch} />}
    </div>
  );
}

function useRefresh(deliveryId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['delivery', deliveryId] });
    void queryClient.invalidateQueries({ queryKey: ['delivery-dispatch', deliveryId] });
  };
}

function CorrectionForm({ delivery }: { readonly delivery: DeliveryExecution }) {
  const api = useApi();
  const deliveryId = delivery.deliveryId ?? '';
  const refresh = useRefresh(deliveryId);
  const targets = CORRECTABLE[delivery.state ?? ''] ?? [];
  const [target, setTarget] = useState(targets[0] ?? '');
  const [reason, setReason] = useState('');
  const correct = useCommand(async (body: { targetState: 'ASSIGNED' | 'ARRIVED_AT_STORE' | 'PICKED_UP' | 'ARRIVED_AT_CUSTOMER'; reason: string }, key) => {
    try {
      return settled(
        await request(
          'POST',
          api.execution.POST('/deliveries/{deliveryId}/status-corrections', {
            ...commandParams(key, { path: { deliveryId }, ...(delivery.version !== undefined ? { version: delivery.version } : {}) }),
            body,
          }),
        ),
      );
    } finally {
      refresh();
    }
  });
  const ok = reason.trim().length >= 2 && target !== '';
  return (
    <form
      className="space-y-2 rounded-box bg-base-100 p-4 text-sm"
      aria-label={a.correction}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) void correct.run({ targetState: target as 'ASSIGNED', reason: reason.trim() });
      }}
    >
      <h3 className="font-semibold">{a.correction}</h3>
      <p className="text-xs opacity-60">{a.correctionIntro}</p>
      <label className="block">
        {a.targetState}
        <select className="select select-sm mt-1 block" value={target} onChange={(e) => setTarget(e.target.value)}>
          {targets.map((t) => (
            <option key={t} value={t}>
              {label(n.executionState, t)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        {a.reason}
        <input className="input input-sm mt-1 w-full" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-sm" disabled={!ok || correct.busy || correct.phase.kind === 'done'}>
        {a.correct}
      </button>
      <CommandFeedback command={correct} unknown={{ body: a.unknown }}>
        {(r) => <Result applied={r.status === 'APPLIED'} />}
      </CommandFeedback>
    </form>
  );
}

function FailureDecisionForm({ delivery, direct }: { readonly delivery: DeliveryExecution; readonly direct: boolean }) {
  const api = useApi();
  const deliveryId = delivery.deliveryId ?? '';
  const refresh = useRefresh(deliveryId);
  const [decision, setDecision] = useState<'CONFIRM' | 'REJECT' | ''>(direct ? 'CONFIRM' : '');
  const [custody, setCustody] = useState<'RIDER' | 'STORE'>('RIDER');
  const [returnBy, setReturnBy] = useState<'SAME_RIDER' | 'OTHER_RIDER'>(direct ? 'OTHER_RIDER' : 'SAME_RIDER');
  const [reason, setReason] = useState<(typeof FAILURE_REASONS)[number]>('RIDER_INCIDENT');
  const [note, setNote] = useState('');
  const decide = useCommand(async (body: Record<string, unknown>, key) => {
    try {
      return settled(
        await request(
          'POST',
          api.execution.POST('/deliveries/{deliveryId}/failure-decisions', {
            ...commandParams(key, { path: { deliveryId }, ...(delivery.version !== undefined ? { version: delivery.version } : {}) }),
            body: body as never,
          }),
        ),
      );
    } finally {
      refresh();
    }
  });
  const title = direct ? a.directTitle : a.decideTitle;
  return (
    <form
      className="space-y-2 rounded-box bg-base-100 p-4 text-sm"
      aria-label={title}
      onSubmit={(e) => {
        e.preventDefault();
        if (!decision) return;
        void decide.run({
          decision,
          ...(decision === 'CONFIRM' ? { custody, ...(custody === 'RIDER' ? { returnBy } : {}) } : {}),
          ...(direct ? { reason } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        });
      }}
    >
      <h3 className="font-semibold">{title}</h3>
      <p className="text-xs opacity-60">{direct ? a.directIntro : a.decideIntro}</p>
      {!direct && (
        <fieldset className="flex gap-4">
          <legend className="sr-only">{a.decision}</legend>
          {(['CONFIRM', 'REJECT'] as const).map((d) => (
            <label key={d} className="flex items-center gap-1">
              <input type="radio" className="radio radio-sm" name={`decision-${deliveryId}`} checked={decision === d} onChange={() => setDecision(d)} />
              {label(n.decision, d)}
            </label>
          ))}
        </fieldset>
      )}
      {direct && (
        <label className="block">
          {a.failureReason}
          <select className="select select-sm mt-1 block" value={reason} onChange={(e) => setReason(e.target.value as (typeof FAILURE_REASONS)[number])}>
            {FAILURE_REASONS.map((x) => (
              <option key={x} value={x}>
                {label(n.failureReason, x)}
              </option>
            ))}
          </select>
        </label>
      )}
      {decision === 'CONFIRM' && (
        <>
          <label className="block">
            {a.custody}
            <select className="select select-sm mt-1 block" value={custody} onChange={(e) => setCustody(e.target.value as 'RIDER' | 'STORE')}>
              {(['RIDER', 'STORE'] as const).map((x) => (
                <option key={x} value={x}>
                  {label(n.custody, x)}
                </option>
              ))}
            </select>
          </label>
          {custody === 'RIDER' && (
            <label className="block">
              {a.returnBy}
              <select className="select select-sm mt-1 block" value={returnBy} onChange={(e) => setReturnBy(e.target.value as 'SAME_RIDER' | 'OTHER_RIDER')}>
                {(['SAME_RIDER', 'OTHER_RIDER'] as const).map((x) => (
                  <option key={x} value={x}>
                    {a.returnByName[x]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      <label className="block">
        {a.note}
        <textarea className="textarea mt-1 w-full" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-sm btn-primary" disabled={!decision || decide.busy || decide.phase.kind === 'done'}>
        {a.decide}
      </button>
      <CommandFeedback command={decide} unknown={{ body: a.unknown }}>
        {(r) => <Result applied={r.status === 'APPLIED'} />}
      </CommandFeedback>
    </form>
  );
}

type CancelReason = 'RIDER_UNABLE' | 'STORE_REQUEST' | 'NO_SHOW' | 'OPERATOR';

function CancellationForm({ dispatch }: { readonly dispatch: DispatchView }) {
  const api = useApi();
  const deliveryId = dispatch.deliveryId ?? '';
  const refresh = useRefresh(deliveryId);
  const [reason, setReason] = useState<CancelReason>('OPERATOR');
  const [reassign, setReassign] = useState(true);
  const cancel = useCommand(async (body: { requestedBy: 'OPERATOR'; reason: CancelReason; reassign: boolean }, key) => {
    try {
      return settled(
        await request(
          'POST',
          api.dispatch.POST('/deliveries/{deliveryId}/assignment-cancellations', {
            ...commandParams(key, { path: { deliveryId } }),
            body: body as never,
          }),
        ),
      );
    } finally {
      refresh();
    }
  });
  return (
    <form
      className="space-y-2 rounded-box bg-base-100 p-4 text-sm"
      aria-label={a.cancelTitle}
      onSubmit={(e) => {
        e.preventDefault();
        void cancel.run({ requestedBy: 'OPERATOR', reason, reassign });
      }}
    >
      <h3 className="font-semibold">{a.cancelTitle}</h3>
      <p className="text-xs opacity-60">{a.cancelIntro}</p>
      <label className="block">
        {a.cancelReason}
        <select className="select select-sm mt-1 block" value={reason} onChange={(e) => setReason(e.target.value as CancelReason)}>
          {(Object.keys(a.cancelReasonName) as CancelReason[]).map((x) => (
            <option key={x} value={x}>
              {a.cancelReasonName[x]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" className="checkbox checkbox-sm" checked={reassign} onChange={(e) => setReassign(e.target.checked)} />
        {a.reassign}
      </label>
      <button type="submit" className="btn btn-sm btn-warning" disabled={cancel.busy || cancel.phase.kind === 'done'}>
        {a.cancel}
      </button>
      <CommandFeedback command={cancel} unknown={{ body: a.unknown }}>
        {(r) => <Result applied={r.status === 'APPLIED'} />}
      </CommandFeedback>
    </form>
  );
}
