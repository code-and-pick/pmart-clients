// 클레임 조회(2026-11-19 쿠팡 윙 반품관리 참고)
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

const rowOf = (text: string) => screen.getAllByTestId('claim-row').find((r) => r.textContent?.includes(text))!;

describe('클레임 조회', () => {
  it('단계 숫자 카드(서버 상태를 묶어 셈) — 회수 실패는 "고객 연락 필요"로 빨강, 안내 상자는 없다(2026-11-20)', async () => {
    renderAt('/claims', as.cs);
    await screen.findByTestId('claim-stage-all');
    expect(screen.queryByTestId('claim-guide')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('claim-stage-all')).toHaveTextContent('3'));
    expect(screen.getByTestId('claim-stage-contact')).toHaveTextContent('1');
    expect(screen.getByTestId('claim-stage-progress')).toHaveTextContent('1');
    expect(screen.getByTestId('claim-stage-done')).toHaveTextContent('1');
  });

  it('단계 카드를 누르면 그 단계만(주소 stage=)', async () => {
    const user = userEvent.setup();
    renderAt('/claims', as.cs);
    await waitFor(() => expect(screen.getAllByTestId('claim-row')).toHaveLength(3));
    await user.click(screen.getByTestId('claim-stage-contact'));
    await waitFor(() => expect(screen.getAllByTestId('claim-row')).toHaveLength(1));
    expect(screen.getByTestId('claim-row')).toHaveTextContent('회수 실패');
    expect(screen.getByTestId('claim-stage-contact')).toHaveAttribute('aria-current', 'true');
  });

  it('줄에 사유·접수 경로·환불(서버 요약 그대로 — 진행 중은 완료가 아니다)', async () => {
    renderAt('/claims', as.cs);
    await waitFor(() => expect(screen.getAllByTestId('claim-row')).toHaveLength(3));
    const closed = rowOf('종료');
    expect(closed).toHaveTextContent('단순 변심');
    expect(within(closed).getByTestId('claim-refund')).toHaveTextContent('15,100원');
    expect(within(closed).getByTestId('claim-refund')).toHaveTextContent('환불 완료');
    expect(within(rowOf('출고 중지 대기')).getByTestId('claim-refund')).toHaveTextContent('환불 진행 중');
    expect(rowOf('회수 실패')).toHaveTextContent('고객센터');
  });

  it('상태(11가지)는 속성 필터의 값 목록(2026-11-20 AWS 개편)', async () => {
    const user = userEvent.setup();
    renderAt('/claims', as.cs);
    await user.click(await screen.findByRole('combobox', { name: '속성으로 거르기' }));
    await user.click(screen.getByRole('option', { name: '상태' }));
    expect(screen.getAllByRole('option').length).toBeGreaterThanOrEqual(11);
  });
});
