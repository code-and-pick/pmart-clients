// MFC 재고 이동 — TRF 단계(서버 상태)로 MFC 별 칸 나눔, 운송 중 = 재고 transit 합, 최근 출발.
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';
import { stageOf } from './MfcFlowPage';

describe('MFC 재고 이동', () => {
  it('TRF 상태 → 단계(취소는 뺌)', () => {
    expect(stageOf('RESERVED')).toBe('WAIT');
    expect(stageOf('PICKING')).toBe('PICK');
    expect(stageOf('LOADED')).toBe('READY');
    expect(stageOf('DEPARTED')).toBe('DEPARTED');
    expect(stageOf('CANCELLED')).toBeNull();
  });

  it('MFC 별 줄과 단계 카드, 최근 출발', async () => {
    renderAt('/c/CDC01/mfc-flow');
    const rows = await screen.findAllByTestId('flow-row');
    expect(rows.length).toBeGreaterThan(0);
    const stages = screen.getByTestId('flow-stages');
    expect(within(stages).getByText('확보·대기')).toBeInTheDocument();
    expect(await screen.findByTestId('flow-recent')).toBeInTheDocument();
  });
});
