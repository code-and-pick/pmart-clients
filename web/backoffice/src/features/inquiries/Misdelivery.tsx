// 오배송 문의 처리(case 0.39.0 R-16, ADR-0086 — 사용자 "오배송 문의를 처리하는 UI도 바로 구축 … 다시 보내거나 취소환불 할지를 선택하게 해서 배송이랑 주문 상태를 종결").
// - 고객이 "받지 못함(NOT_RECEIVED)"으로 문의하면 서버가 오배송 접수 건을 열고 고객에게 다시 보내기·취소 환불을 고르게 한다(5시간 안, 안 고르면 서버가 자동 환불).
// - 이 칸은 서버 값(misdelivery)을 그대로 보인다: 선택 대기·기한, 고른 값·고른 쪽(고객·상담원·자동). 고르면 서버가 회수·재발송(접수 건)·환불(클레임)을 진행한다.
// - 상담원(CS_AGENT·OPERATOR_ADMIN)은 선택 대기일 때 대신 고른다 — 사유 2~200자 필수, 한 번만. 409(이미 고름·기한 지남)는 서버 판정 그대로 알린다.
// - 남은 시간은 서버 기한을 보여 주는 것일 뿐 — 지났는지 판정·자동 환불은 서버(화면이 지났다고 확정하지 않고 "곧 자동 환불" 안내).
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { ProblemFailure, request } from '@pmart/web-core';
import { formatSeoul, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback } from '../../shared/Feedback';
import { messages } from '../../shared/messages';
import { StaffName } from '../lookup/parts';
import { Card, ICON } from './HelpdeskParts';

type Inquiry = components['schemas']['Inquiry'];
type Resolution = 'RESHIP' | 'REFUND';
const m = messages.inquiries.misdelivery;

/** 남은 시간(분 단위, 보이기만) */
function useNow(stepMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(t);
  }, [stepMs]);
  return now;
}
const leftText = (deadline: string, now: number) => {
  const min = Math.floor((Date.parse(deadline) - now) / 60_000);
  if (min <= 0) return null;
  return min >= 60 ? m.leftHours(Math.floor(min / 60), min % 60) : m.leftMinutes(min);
};

export function MisdeliveryPanel({ q, canChoose }: { readonly q: Inquiry; readonly canChoose: boolean }) {
  const md = q.misdelivery;
  const now = useNow();
  if (!md) return null;
  const waiting = md.state === 'AWAITING_CHOICE';
  const left = waiting ? leftText(md.deadlineAt, now) : null;
  return (
    <Card title={m.title} icon={ICON.shield} testId="misdelivery-panel">
      <div className="space-y-3 text-sm">
        {waiting ? (
          <p className="rounded-box bg-warning/10 px-3 py-2" data-testid="misdelivery-state">
            <span className="font-semibold">{m.waiting}</span>
            <span className="ml-1 text-base-content/70">{m.deadline(formatSeoul(md.deadlineAt))}</span>
            {left ? <span className="ml-1 font-semibold text-warning">{`(${left})`}</span> : <span className="ml-1 text-base-content/60">{m.passedSoonAuto}</span>}
          </p>
        ) : (
          <p className="rounded-box bg-success/10 px-3 py-2" data-testid="misdelivery-state">
            <span className="font-semibold">{md.resolution ? m.resolutionName[md.resolution] : m.unknown}</span>
            <span className="ml-1 text-base-content/70">
              {`· ${md.chosenByType ? m.chosenByName[md.chosenByType] : m.unknown}`}
              {md.chosenAt ? ` · ${formatSeoul(md.chosenAt)}` : ''}
            </span>
          </p>
        )}
        {!waiting && md.chosenByType === 'STAFF' && (
          <p className="text-xs text-base-content/65" data-testid="misdelivery-staff">
            {m.chosenBy} <StaffName id={md.chosenBy ?? null} />
            {md.chosenReason ? ` · ${md.chosenReason}` : ''}
          </p>
        )}
        <p className="text-xs text-base-content/60">{m.explain}</p>
        {/* 진행은 서버가 연 접수 건(회수·재발송)과 클레임(환불)에서 */}
        <div className="flex flex-wrap gap-2 text-xs">
          <Link className="link link-primary" to={`/cases/${encodeURIComponent(md.caseId)}`} data-testid="misdelivery-case">
            {m.openCase}
          </Link>
          {q.orderId && md.resolution === 'REFUND' && (
            <Link className="link link-primary" to={`/claims?orderId=${encodeURIComponent(q.orderId)}`} data-testid="misdelivery-claims">
              {m.openClaims}
            </Link>
          )}
        </div>
        {waiting && canChoose && <ChooseForm q={q} />}
      </div>
    </Card>
  );
}

/** 상담원이 대신 고르기 — 사유 필수, 한 번만(서버 판정) */
function ChooseForm({ q }: { readonly q: Inquiry }) {
  const api = useApi();
  const qc = useQueryClient();
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const reasonOk = reason.trim().length >= 2 && reason.trim().length <= 200;
  const cmd = useCommand(async (v: { resolution: Resolution; reason: string }, key) => {
    const r = await request('POST', api.cases.POST('/inquiries/{inquiryId}/misdelivery-choices', { ...commandParams(key, { path: { inquiryId: q.inquiryId } }), body: v }));
    qc.setQueryData(['inquiries', 'detail', q.inquiryId], r);
    void qc.invalidateQueries({ queryKey: ['inquiries'] });
    return r;
  });
  const conflict = cmd.phase.kind === 'rejected' && cmd.phase.failure instanceof ProblemFailure ? cmd.phase.failure.problem.code : null;
  return (
    <form
      className="space-y-2 border-t border-base-200 pt-3"
      aria-label={m.chooseTitle}
      onSubmit={(e) => {
        e.preventDefault();
        if (!resolution || !reasonOk) return;
        if (!confirming) {
          setConfirming(true);
          return;
        }
        if (cmd.phase.kind === 'rejected') cmd.reset();
        void cmd.run({ resolution, reason: reason.trim() });
      }}
    >
      <p className="text-xs font-semibold text-base-content/80">{m.chooseTitle}</p>
      <div className="flex flex-wrap gap-3" role="radiogroup" aria-label={m.chooseTitle}>
        {(['RESHIP', 'REFUND'] as const).map((r) => (
          <label key={r} className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              className="radio radio-sm"
              name={`misdelivery-${q.inquiryId}`}
              checked={resolution === r}
              disabled={cmd.busy}
              onChange={() => {
                setResolution(r);
                setConfirming(false);
              }}
            />
            {m.resolutionName[r]}
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-xs text-base-content/70">
        {m.reason}
        <input className="input input-sm w-full" maxLength={200} value={reason} disabled={cmd.busy} placeholder={m.reasonHint} onChange={(e) => { setReason(e.target.value); setConfirming(false); }} />
      </label>
      {confirming && resolution && (
        <p role="alert" className="text-xs text-warning" data-testid="misdelivery-confirm">
          {m.confirm(m.resolutionName[resolution])}
        </p>
      )}
      <button type="submit" className={`btn btn-sm ${confirming ? 'btn-warning' : 'btn-primary'}`} disabled={!resolution || !reasonOk || cmd.busy}>
        {confirming ? m.confirmButton : m.choose}
      </button>
      {conflict === 'MISDELIVERY_ALREADY_CHOSEN' || conflict === 'MISDELIVERY_CHOICE_EXPIRED' ? (
        <p role="alert" className="text-xs text-warning" data-testid="misdelivery-conflict">
          {m.conflict[conflict]}
        </p>
      ) : (
        <CommandFeedback command={cmd}>{() => <p role="status" className="text-xs text-success">{m.chosen}</p>}</CommandFeedback>
      )}
    </form>
  );
}
