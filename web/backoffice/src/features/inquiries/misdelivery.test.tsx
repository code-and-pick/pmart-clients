// 오배송 문의 처리(case 0.39.0 R-16, ADR-0086 — 2026-11-24 사용자 "다시 보내거나 취소환불 할지를 선택하게 해서 … 종결")
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('오배송 문의', () => {
  it('목록: 선택 대기 꼬리표와 기한', async () => {
    renderAt('/inquiries', as.cs);
    const tag = await screen.findByTestId('inquiry-misdelivery');
    expect(tag).toHaveTextContent('오배송 · 선택 대기');
    expect(tag).toHaveTextContent('까지');
  });

  it('상세: 서버 상태(선택 대기·기한·남은 시간), 대화에 시스템 안내, 접수 건 링크', async () => {
    renderAt('/inquiries/INQ-MOCK-3', as.cs);
    const panel = await screen.findByTestId('misdelivery-panel');
    expect(within(panel).getByTestId('misdelivery-state')).toHaveTextContent('고객 선택 기다림');
    expect(within(panel).getByTestId('misdelivery-state')).toHaveTextContent(/시간 \d+분 남음/);
    expect(within(panel).getByTestId('misdelivery-case')).toHaveAttribute('href', '/cases/CASE-MOCK-3');
    expect(await screen.findByTestId('inquiry-system-message')).toHaveTextContent('오배송 선택 안내');
  });

  it('상담원이 대신 고르기: 사유 필수 → 한 번 더 눌러 확정 → 서버 결과(상담원이 대신 고름)·사유, 같은 키 한 번', async () => {
    const user = userEvent.setup();
    const view = renderAt('/inquiries/INQ-MOCK-3', as.cs);
    const form = await screen.findByRole('form', { name: '상담원이 대신 고르기' });
    await user.click(within(form).getByRole('radio', { name: '다시 보내기' }));
    expect(within(form).getByRole('button', { name: '고르기' })).toBeDisabled(); // 사유 없음
    await user.type(within(form).getByLabelText(/사유/), '고객 전화로 다시 보내기 원함');
    await user.click(within(form).getByRole('button', { name: '고르기' }));
    expect(within(form).getByTestId('misdelivery-confirm')).toHaveTextContent('"다시 보내기"로 정해요');
    expect(view.mutations('/misdelivery-choices')).toHaveLength(0); // 아직 안 보냄
    await user.click(within(form).getByRole('button', { name: '확정' }));
    const panel = screen.getByTestId('misdelivery-panel');
    await waitFor(() => expect(within(panel).getByTestId('misdelivery-state')).toHaveTextContent('다시 보내기'));
    expect(within(panel).getByTestId('misdelivery-state')).toHaveTextContent('상담원이 대신 고름');
    expect(within(panel).getByTestId('misdelivery-staff')).toHaveTextContent('고객 전화로 다시 보내기 원함');
    const sent = view.mutations('/misdelivery-choices');
    expect(sent).toHaveLength(1);
    expect(await sent[0]!.clone().json()).toEqual({ resolution: 'RESHIP', reason: '고객 전화로 다시 보내기 원함' });
    expect(within(panel).queryByRole('form')).not.toBeInTheDocument(); // 한 번만
  });

  it('관리자(OPERATOR_ADMIN)도 대신 고를 수 있다', async () => {
    renderAt('/inquiries/INQ-MOCK-3', as.admin);
    await screen.findByTestId('misdelivery-panel');
    expect(screen.getByRole('form', { name: '상담원이 대신 고르기' })).toBeInTheDocument();
  });
});
