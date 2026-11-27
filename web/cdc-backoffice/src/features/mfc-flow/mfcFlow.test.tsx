// MFC 재고 이동 — TRF 단계(서버 상태)로 MFC 별 칸 나눔, 운송 중 = 재고 transit 합, 최근 출발.
import { screen, waitFor, within } from '@testing-library/react';
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
    expect(within(stages).getByText('DC 에서 준비 중')).toBeInTheDocument();
    expect(within(stages).getByText('차 타고 가는 중')).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('TRF');
    expect(await screen.findByTestId('flow-recent')).toBeInTheDocument();
  });

  it('MFC 쪽 — 출발한 TRF 마다 운행 정차의 인계·가는 중, 넷째 걸음은 인계한 곳 수', async () => {
    renderAt('/c/CDC01/mfc-flow');
    const done = await screen.findByTestId('flow-step-DONE');
    await waitFor(() => expect(done).toHaveTextContent('2곳 인계'));
    expect(done).toHaveTextContent('받은 박스 12 / 보낸 13');
    await waitFor(() => expect(screen.getAllByTestId('mfc-side').length).toBeGreaterThan(2));
    const text = screen.getAllByTestId('mfc-side').map((x) => x.textContent).join(' | ');
    expect(text).toContain('박스 8/8');
    expect(text).toContain('가는 중 · 도착 예정');
    expect(text).toContain('빠짐·파손 1');
  });

  it('TRF 상세 — DC → MFC 진행 줄(배차된 운행이 있으면 차량·도착 계획)', async () => {
    renderAt('/c/CDC01/trf-wave/trf/TRF-20261126-0001');
    const j = await screen.findByTestId('trf-journey');
    expect(within(j).getByText('피킹').closest('[aria-current]')).not.toBeNull();
    await waitFor(() => expect(screen.getByTestId('trf-journey-note')).toHaveTextContent('배차됨 — 차량 경기 81바 1101'));
  });
});
