// 승인 진행 단계(2026-11-18) — 서버 상태 값 → 요청·심사·결정·반영 자리
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';
import { approvalPlace } from './ApprovalProgress';

describe('승인 진행 단계', () => {
  it('상태 짝 → 단계 자리', () => {
    expect(approvalPlace({ requestState: 'SUBMITTED', reviewState: 'REVIEW_PENDING', executionState: 'NOT_REQUESTED' }).place).toMatchObject({ step: 1, done: false });
    expect(approvalPlace({ requestState: 'SUBMITTED', reviewState: 'EVIDENCE_REQUIRED', executionState: 'NOT_REQUESTED' }).place).toMatchObject({ step: 1, warn: true, note: '자료를 더 달라고 함' });
    expect(approvalPlace({ requestState: 'SUBMITTED', reviewState: 'APPROVED', executionState: 'IN_PROGRESS' }).place).toMatchObject({ step: 3, done: false, note: '반영하는 중' });
    expect(approvalPlace({ requestState: 'SUBMITTED', reviewState: 'APPROVED', executionState: 'APPLIED' }).place).toMatchObject({ step: 3, done: true });
    expect(approvalPlace({ requestState: 'SUBMITTED', reviewState: 'APPROVED', executionState: 'UNKNOWN_RESULT' }).place).toMatchObject({ step: 3, warn: true, note: '반영 결과 확인 중' });
    expect(approvalPlace({ requestState: 'SUBMITTED', reviewState: 'REJECTED', executionState: 'NOT_REQUESTED' })).toEqual({ place: null, ended: '반려됨' });
    expect(approvalPlace({ requestState: 'WITHDRAWN', reviewState: 'REVIEW_PENDING', executionState: 'NOT_REQUESTED' })).toEqual({ place: null, ended: '철회됨' });
  });

  it('승인 상세 머리 아래에 진행 단계 — 심사 대기면 "심사"가 지금 단계', async () => {
    renderAt('/approvals/apv-seed-price-1', as.admin);
    const steps = await screen.findByTestId('approval-progress');
    const now = within(steps).getAllByRole('listitem').find((li) => li.getAttribute('aria-current') === 'step');
    expect(now).toHaveTextContent('심사');
  });
});
