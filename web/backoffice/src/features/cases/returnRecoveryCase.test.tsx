// 반품 회수 실패 접수 건(case 0.22.0 R-8) — 고객센터 팀: 상담원이 맡고 완료 처리, 지원센터에는 안 보임, 넘기기 없음, 클레임 회수 조치로 이어짐
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('반품 회수 실패 접수 건', () => {
  it('상담원: 상세에 클레임·회수 조치, 맡기·완료 처리 가능, 넘기기 없음, "보기만" 안내 없음', async () => {
    renderAt('/cases/CASE-MOCK-R8', as.cs);
    expect(await screen.findByTestId('case-group')).toHaveTextContent('고객센터');
    expect(screen.getByRole('link', { name: /^클레임$/ })).toHaveAttribute('href', '/claims/CLM-MOCK-RF'); // 클레임 ID 는 글자로 안 보인다(ADR-0070 덧붙임)
    const claim = await screen.findByTestId('case-claim');
    expect(await within(claim).findByTestId('case-claim-state')).toHaveTextContent('회수 실패');
    expect(within(claim).getByTestId('recovery-actions')).toBeInTheDocument();
    expect(within(claim).getByText(/조치 뒤 직접 완료 처리해요/)).toBeInTheDocument();

    expect(screen.getByRole('button', { name: '내가 맡기' })).toBeInTheDocument();
    expect(screen.queryByTestId('case-transfer')).not.toBeInTheDocument();
    expect(screen.queryByText(/상담원은 접수 건을 보기만/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /완료 처리/ }).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: '내가 맡기' }));
    expect(await screen.findByTestId('case-assignee')).not.toHaveTextContent('아무도');
  });

  it('상담원 사건함 종류 거르기에 "반품 회수 실패"', async () => {
    renderAt('/cases', as.cs);
    expect(await screen.findByRole('option', { name: '반품 회수 실패' })).toBeInTheDocument();
  });

  it('지원센터에는 목록에 없고 상세도 없음(서버 404)', async () => {
    renderAt('/cases/CASE-MOCK-R8', as.riderOps);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('case-claim')).not.toBeInTheDocument();
  });

  it('배송 쪽 접수 건은 상담원에게 여전히 보기만', async () => {
    renderAt('/cases/CASE-MOCK-1', as.cs);
    expect(await screen.findByText(/상담원은 접수 건을 보기만/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '내가 맡기' })).not.toBeInTheDocument();
  });
});
