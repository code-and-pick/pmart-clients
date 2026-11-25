// "자기 자신은 안 됨"(hr-service 2026-11-17, 백엔드 알림 hr-backoffice/2026-11-17-notice-self-action-rules §1) — 본인이면 버튼 대신 안내, 판정은 서버
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';

describe('본인 인사 처리·권한 요청', () => {
  it('내 직원 상세: 소속 변경·정지·퇴사 버튼 없이 "다른 인사 담당자가 처리해요"', async () => {
    renderAt('/employees/OP-hr-1'); // 로그인 = OP-hr-1
    expect(await screen.findByTestId('self-action-note')).toHaveTextContent('내 계정은 인사 처리를 할 수 없어요');
    expect(screen.queryByRole('button', { name: '소속 변경' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '정지' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '퇴사' })).not.toBeInTheDocument();
  });

  it('다른 직원 상세는 그대로 버튼', async () => {
    renderAt('/employees/OP-md-1');
    expect(await screen.findByRole('button', { name: '소속 변경' })).toBeInTheDocument();
    expect(screen.queryByTestId('self-action-note')).not.toBeInTheDocument();
  });

  it('내 권한 화면: 요청 폼 대신 안내', async () => {
    renderAt('/permissions/OP-hr-1');
    expect(await screen.findByTestId('self-grant-note')).toHaveTextContent('자기 권한은 요청할 수 없어요');
  });
});
