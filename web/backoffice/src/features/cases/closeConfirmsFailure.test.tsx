// case 0.30.0(2026-11-20) — 라이더 도움요청·전달 실패 접수 건은 닫으면 전달 실패 확정 + 반납 배송: 완료 처리 폼에 미리 알린다.
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('완료 처리 — 전달 실패 확정 안내', () => {
  it('라이더 도움요청 접수 건은 완료 처리 폼에 "닫으면 전달 실패로 확정" 안내', async () => {
    renderAt('/cases/CASE-MOCK-1', as.admin); // 목: CASE-MOCK-1 = RIDER_HELP
    expect(await screen.findByTestId('close-confirms-failure')).toHaveTextContent('전달 실패로 확정되고 반납 배송');
    // 반려하려면 이 건의 배송 상세 실패 결정 칸으로 바로(2026-11-20)
    expect(screen.getByTestId('close-go-reject')).toHaveAttribute('href', expect.stringMatching(/^\/deliveries\/.+#failure-decision$/));
  });
});
