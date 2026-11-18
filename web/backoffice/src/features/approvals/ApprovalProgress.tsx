// 승인 진행 단계(2026-11-18 — Saleor·Refine 타임라인 참고): 요청 → 심사 → 결정 → 반영.
// 지금은 상태 배지 셋(요청·심사·반영)을 사람이 짜 맞춰야 했다. 서버 상태 값만 단계 자리로 바꾼다 — 판정은 하지 않는다.
// 반려·만료·다른 요청으로 바뀜·철회는 단계 밖 갈래, 자료 요청·일부 반영·반영 결과 불명은 그 자리에 노랑 + 짧은 말.
import type { components } from '../../api/generated/approval';
import { messages } from '../../shared/messages';
import { ProgressSteps, type StepPlace } from '../../shared/ProgressSteps';

type A = Pick<components['schemas']['Approval'], 'requestState' | 'reviewState' | 'executionState'>;
const m = messages.approvals.progress;

export function approvalPlace(a: A): { readonly place: StepPlace | null; readonly ended?: string } {
  if (a.requestState === 'WITHDRAWN') return { place: null, ended: m.withdrawn };
  if (a.requestState === 'DRAFT') return { place: { step: 0, done: false } };
  switch (a.reviewState) {
    case 'REJECTED':
      return { place: null, ended: m.rejected };
    case 'EXPIRED':
      return { place: null, ended: m.expired };
    case 'SUPERSEDED':
      return { place: null, ended: m.superseded };
    case 'EVIDENCE_REQUIRED':
      return { place: { step: 1, done: false, note: m.evidence, warn: true } };
    case 'REVIEW_PENDING':
      return { place: { step: 1, done: false, ...(a.requestState === 'WITHDRAW_REQUESTED' ? { note: m.withdrawRequested, warn: true } : {}) } };
    case 'APPROVED':
    case 'PARTIALLY_APPROVED': {
      const partial = a.reviewState === 'PARTIALLY_APPROVED';
      switch (a.executionState) {
        case 'APPLIED':
          return { place: { step: 3, done: true } };
        case 'PARTIAL':
          return { place: { step: 3, done: false, note: m.partialApplied, warn: true } };
        case 'REJECTED':
          return { place: { step: 3, done: false, note: m.applyRejected, warn: true } };
        case 'UNKNOWN_RESULT':
          return { place: { step: 3, done: false, note: m.applyUnknown, warn: true } };
        default:
          return { place: { step: 3, done: false, note: partial ? m.partialApproved : m.applying } };
      }
    }
    default:
      return { place: null };
  }
}

export function ApprovalProgress({ approval }: { readonly approval: A }) {
  const { place, ended } = approvalPlace(approval);
  return (
    <ProgressSteps
      steps={m.steps}
      place={place}
      ended={ended}
      unknownText={approval.reviewState ? m.unknown(approval.reviewState) : undefined}
      label={m.title}
      testId="approval-progress"
      endedTestId="approval-progress-ended"
    />
  );
}
