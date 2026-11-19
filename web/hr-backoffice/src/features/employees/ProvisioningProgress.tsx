// 계정 발급 진행 단계(2026-11-19 사용자 "인사팀 쪽이 백오피스보다 심심하다" — 백오피스 주문·승인 진행과 같은 모양).
// 요청 → 사서함 → 로그인 계정 → 안내 메일 → 완료. 서버 step 값만 자리로 바꾼다(판정하지 않는다).
// 실패(FAILED·COMPENSATED)는 계약에 "어느 단계에서" 가 없어 단계를 칠하지 않고 갈래로만 보인다.
import type { ProvisioningStep } from '../../api/models';
import { messages } from '../../shared/messages';
import { ProgressSteps, type StepPlace } from '../../shared/ProgressSteps';

const m = messages.provisioningProgress;

export function provisioningPlace(step: ProvisioningStep): { readonly place: StepPlace | null; readonly ended?: string } {
  switch (step) {
    case 'REQUESTED':
      return { place: { step: 1, done: false, note: m.note.mailbox } };
    case 'MAILBOX_CREATED':
      return { place: { step: 2, done: false, note: m.note.iam } };
    case 'IAM_CREATED':
      return { place: { step: 3, done: false, note: m.note.invite } };
    case 'INVITE_SENT':
      return { place: { step: 4, done: false, note: m.note.finishing } };
    case 'DONE':
      return { place: { step: 4, done: true } };
    case 'FAILED':
      return { place: null, ended: m.failed };
    case 'COMPENSATED':
      return { place: null, ended: m.compensated };
  }
}

export function ProvisioningProgress({ step }: { readonly step: ProvisioningStep }) {
  const { place, ended } = provisioningPlace(step);
  return <ProgressSteps steps={m.steps} place={place} ended={ended} label={m.title} testId="provisioning-progress" endedTestId="provisioning-progress-ended" />;
}
