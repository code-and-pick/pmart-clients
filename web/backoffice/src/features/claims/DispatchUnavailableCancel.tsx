// 배차 지연 접수 건 → "배차 불가로 취소"(claim 0.7.0 CL-5, 2026-11-19 백엔드 요청 — PC 5 요청, 사용자 "추천대로 일단").
// - 누가: 상담원·관리자(그 센터 센터 관리자는 MFC 백오피스). 판정은 서버(403).
// - 무엇: 주문 전체 취소 + 원 승인액 전액 환불 — `POST /claims` {orderId, type CANCEL, reason DISPATCH_UNAVAILABLE, channel CS|OPERATOR, lines(미이행 전부), caseRef}.
//   회사 사유라 본인 확인 없음. 상품준비 뒤라도 인계 전이면 된다(인계 뒤·미이행 0 은 422).
// - 실제 취소·환불이 일어나므로 확인 상자를 거친다. 결과는 서버가 준 클레임 상태만(취소 접수 ≠ 환불 끝남) — 진행은 클레임 상세.
// - 보상 쿠폰: promotion 이 OrderCancelled(DISPATCH_UNAVAILABLE)를 받아 주문마다 한 번 2,000원(받은 날 포함 30일, 최소 주문 없음)을 주고
//   고객에게 알림을 따로 보낸다(백엔드 a0d2c884, ADR-0082 5단계 — 2026-11-21). 화면은 안내만 하고 "즉시"라 쓰지 않는다(MFC 백오피스와 같은 표현).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { ProblemFailure, request } from '@pmart/web-core';
import { failureCode, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/claim';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { DisplayNumber } from '../../shared/displayNumber';
import { CommandFeedback } from '../../shared/Feedback';
import { messages } from '../../shared/messages';
import { label } from '../../shared/ops';
import { Notice, Section } from '../../shared/admin';

const m = messages.dispatchCancel;

export function DispatchUnavailableCancel({ caseId, orderId, closed }: { readonly caseId: string; readonly orderId: string | null | undefined; readonly closed: boolean }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const roles = session?.roles ?? [];
  const admin = roles.includes('OPERATOR_ADMIN');
  const can = admin || roles.includes('CS_AGENT');
  const [confirming, setConfirming] = useState(false);

  const order = useQuery({
    queryKey: ['orders', 'lookup', orderId ?? ''],
    enabled: Boolean(orderId) && can,
    queryFn: () => request('GET', api.orders.GET('/orders/lookups/{orderId}', { params: { path: { orderId: orderId ?? '' } } })),
  });
  const create = useCommand(async (body: components['schemas']['CreateClaimRequest'], key) => {
    try {
      const claim = await request('POST', api.claims.POST('/claims', { ...commandParams(key), body }));
      void queryClient.invalidateQueries({ queryKey: ['claims'] });
      return claim;
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['orders', 'lookup', orderId ?? ''] });
      void queryClient.invalidateQueries({ queryKey: ['cases', 'detail', caseId] });
    }
  });

  if (!can || !orderId) return null;
  const o = order.data;
  const lines = (o?.lines ?? []).filter((l) => l.orderLineId && (l.unfulfilledQty ?? 0) > 0).map((l) => ({ orderLineId: l.orderLineId ?? '', qty: l.unfulfilledQty ?? 0 }));
  const failure = create.phase.kind === 'rejected' ? create.phase.failure : undefined;
  const code = failure ? failureCode(failure) : undefined;
  const serverDetail = failure instanceof ProblemFailure ? failure.problem.detail : undefined;
  const done = create.phase.kind === 'done';

  return (
    <Section id="dispatch-cancel" title={m.title} testId="dispatch-cancel">
      <div className="space-y-3 text-sm">
        <p className="text-base-content/70">{m.intro}</p>
        {done ? null : order.isError ? (
          <Notice tone="warning">{m.orderFailed}</Notice>
        ) : !o ? (
          <p className="text-base-content/50">…</p>
        ) : lines.length === 0 ? (
          <Notice tone="muted">{m.nothingLeft}</Notice>
        ) : (
          <p>
            {m.orderLine} <DisplayNumber number={o.orderNumber} systemId={o.orderId} /> · {m.lineCount(lines.length)}
          </p>
        )}
        {!done && (
          <button type="button" className="btn btn-error btn-sm" disabled={closed || !o || lines.length === 0 || create.busy} onClick={() => setConfirming(true)} data-testid="dispatch-cancel-open">
            {m.button}
          </button>
        )}
        {closed && <p className="text-xs text-base-content/55">{m.closedNote}</p>}
        {code && (
          <p role="alert" className="text-error" data-testid="dispatch-cancel-error">
            {code === 'ORDER_NOT_CANCELLABLE' ? (serverDetail ?? m.notCancellable) : code === 'DUPLICATE_CLAIM' ? m.duplicate : (messages.reason[code] ?? code)}
          </p>
        )}
        <CommandFeedback command={create}>
          {(claim) => (
            // 접수 ≠ 끝남 — 클레임이 닫혔을 때만 초록, 아니면 진행 중 색(2026-11-21 점검)
            <p role="status" className={claim.state === 'CLOSED' ? 'text-success' : 'text-info'} data-testid="dispatch-cancel-done">
              {m.done(label(messages.claims.stateName, claim.state ?? null))}{' '}
              {claim.claimId && (
                <Link className="link" to={`/claims/${encodeURIComponent(claim.claimId)}`}>
                  {m.openClaim}
                </Link>
              )}
            </p>
          )}
        </CommandFeedback>
      </div>

      {/* 확인 상자 — 실제 취소·전액 환불이 일어난다 */}
      {confirming && o && (
        <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="dispatch-cancel-title" data-testid="dispatch-cancel-confirm">
          <div className="modal-box space-y-3">
            <h3 id="dispatch-cancel-title" className="text-lg font-bold">
              {m.confirmTitle}
            </h3>
            <p className="text-sm">
              {m.orderLine} <DisplayNumber number={o.orderNumber} systemId={o.orderId} /> · {m.lineCount(lines.length)}
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-base-content/75">
              {m.confirmPoints.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <div className="modal-action">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>
                {m.keep}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-error"
                disabled={create.busy}
                onClick={() => {
                  setConfirming(false);
                  if (create.phase.kind === 'rejected') create.reset();
                  void create.run({ orderId: o.orderId, type: 'CANCEL', reason: 'DISPATCH_UNAVAILABLE', channel: admin ? 'OPERATOR' : 'CS', lines, caseRef: caseId });
                }}
              >
                {m.confirm}
              </button>
            </div>
          </div>
          {/* 바깥을 누르면 닫힘(화면 읽기·키보드는 '그만두기' 단추로) */}
          <button type="button" className="modal-backdrop" aria-hidden="true" tabIndex={-1} onClick={() => setConfirming(false)} />
        </div>
      )}
    </Section>
  );
}
