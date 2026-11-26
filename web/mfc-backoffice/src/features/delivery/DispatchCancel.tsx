// "배차 불가로 취소" — claim 0.11.0 DC-1(백엔드 회신 clients/mfc-backoffice/2026-11-21-reply-dispatch-cancel-lines).
// - 회사 사유 전체 취소는 lines 를 빼고 보낸다 — 서버가 order 원장에서 모든 행 × 미이행 수량을 채운다.
//   본문 {orderId, type CANCEL, reason DISPATCH_UNAVAILABLE, channel OPERATOR, reasonDetail?}. 그 센터 MFC_SUPERVISOR 만(남의 센터 404).
// - 실제 취소·전액 환불이 일어나므로 확인 상자를 거친다. 결과는 서버가 준 클레임 상태만(취소 접수 ≠ 환불 끝남).
// - 이미 라이더에게 넘겼으면 422 ORDER_NOT_CANCELLABLE(반품으로). 보상 쿠폰은 promotion 이 따로 준다(ADR-0082 5단계 — "즉시"라 쓰지 않는다).
import { useState } from 'react';

import { request } from '@pmart/web-core';
import { CommandFeedback, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/claim';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';

const m = messages.dispatchDelays;
type Claim = components['schemas']['Claim'];

export function DispatchCancelButton({ orderId, label, kind = 'SEARCH' }: { readonly orderId: string; readonly label: string; readonly kind?: 'SEARCH' | 'PICKUP' }) {
  const api = useApi();
  const [confirming, setConfirming] = useState(false);
  const [detail, setDetail] = useState('');
  const cancel = useCommand(async (_: null, key): Promise<Claim> => {
    // 목록은 30초마다 다시 읽는다 — 바로 무효화하면 줄이 빠지며 결과 안내도 함께 사라진다.
    return request(
      'POST',
      api.claims.POST('/claims', {
        ...commandParams(key),
        body: { orderId, type: 'CANCEL', reason: 'DISPATCH_UNAVAILABLE', channel: 'OPERATOR', ...(detail.trim() ? { reasonDetail: detail.trim() } : {}) },
      }),
    );
  });
  const done = cancel.phase.kind === 'done';

  return (
    <div className="space-y-1">
      {!done && (
        <button type="button" className="btn btn-xs btn-error btn-outline" disabled={cancel.busy} onClick={() => setConfirming(true)}>
          {m.cancel}
        </button>
      )}
      <CommandFeedback command={cancel}>
        {(claim: Claim) => (
          <p role="status" className="text-xs text-success" data-testid="dispatch-cancel-done">
            {m.cancelDone(m.claimState[claim.state ?? ''] ?? claim.state ?? messages.none)}
          </p>
        )}
      </CommandFeedback>

      {/* 확인 상자 — 실제 취소·전액 환불이 일어난다 */}
      {confirming && (
        <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby={`dispatch-cancel-${orderId}`} data-testid="dispatch-cancel-confirm">
          <div className="modal-box space-y-3">
            <h3 id={`dispatch-cancel-${orderId}`} className="text-lg font-bold">
              {m.confirmTitle}
            </h3>
            <p className="text-sm">{m.confirmTarget(label)}</p>
            {kind === 'PICKUP' && (
              <p role="alert" className="alert alert-warning text-sm" data-testid="dispatch-cancel-assigned">
                {m.assignedWarning}
              </p>
            )}
            <ul className="list-disc space-y-1 pl-5 text-sm text-base-content/75">
              {[...m.confirmPoints, ...(kind === 'PICKUP' ? m.assignedPoints : [])].map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <label className="flex flex-col gap-1 text-sm">
              {m.detail}
              <input className="input input-sm w-full" maxLength={200} placeholder={m.detailPlaceholder} value={detail} onChange={(e) => setDetail(e.target.value)} />
            </label>
            <div className="modal-action">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>
                {m.keep}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-error"
                disabled={cancel.busy}
                onClick={() => {
                  setConfirming(false);
                  if (cancel.phase.kind === 'rejected') cancel.reset();
                  void cancel.run(null);
                }}
              >
                {m.confirm}
              </button>
            </div>
          </div>
          <button type="button" className="modal-backdrop" aria-hidden="true" tabIndex={-1} onClick={() => setConfirming(false)} />
        </div>
      )}
    </div>
  );
}
