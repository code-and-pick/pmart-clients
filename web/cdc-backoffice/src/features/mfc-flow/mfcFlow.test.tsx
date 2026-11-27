// MFC 재고 이동 — TRF 단계(서버 상태)로 MFC 별 칸 나눔, 운송 중 = 재고 transit 합, 최근 출발.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    await waitFor(() => expect(done).toHaveTextContent('오늘 2곳 인계'));
    expect(done).toHaveTextContent('받은 박스 12 / 보낸 13');
    await waitFor(() => expect(screen.getAllByTestId('mfc-side').length).toBeGreaterThan(2));
    const text = screen.getAllByTestId('mfc-side').map((x) => x.textContent).join(' | ');
    expect(text).toContain('박스 8/8');
    expect(text).toContain('가는 중 · 도착 예정');
    expect(text).toContain('빠짐·파손 1');
  });

  it('최근 출발 줄을 누르면 DC 출발 → MFC 인계까지 펼침(받은 사람·박스·빠진 박스·가는 길)', async () => {
    renderAt('/c/CDC01/mfc-flow');
    const rows = await screen.findAllByTestId('flow-recent-row');
    await waitFor(() => expect(rows.find((r) => r.textContent?.includes('T553019'))).toHaveTextContent('빠짐·파손 1'));
    const row = rows.find((r) => r.textContent?.includes('T553019'))!;
    await userEvent.click(within(row).getByRole('button'));
    const detail = within(row).getByTestId('flow-recent-detail');
    expect(detail).toHaveTextContent('✓ MFC 인계');
    expect(within(detail).getByTestId('flow-recent-story')).toHaveTextContent('김인수 님이 박스 5개 중 4개를 받았어요.');
    expect(within(detail).getByTestId('flow-recent-missing')).toHaveTextContent('빠진 박스 LPN-C05');
    expect(within(detail).getByRole('link', { name: 'TRF T553019 상세 ›' })).toBeInTheDocument();
  });

  it('다섯째 걸음 MFC 입고 — 최근 출발 줄에 입고 반영, 펼치면 MFC 입고 시각·안 맞음(transits 0.22.0)', async () => {
    renderAt('/c/CDC01/mfc-flow');
    const stocked = await screen.findByTestId('flow-step-STOCKED');
    await waitFor(() => expect(stocked).toHaveTextContent(/오늘 \d건 입고/));
    expect(within(stocked).getByTestId('flow-to-receipts')).toHaveAttribute('href', '/c/CDC01/mfc-receipts');
    const rows = await screen.findAllByTestId('flow-recent-row');
    const row = rows.find((r) => r.textContent?.includes('T553019'))!;
    await waitFor(() => expect(within(row).getByTestId('receipt-chip')).toHaveTextContent('입고 · 8개 안 맞음'));
    await userEvent.click(within(row).getByRole('button'));
    expect(within(row).getByTestId('flow-recent-stocked')).toHaveTextContent('40개 중 32개만 반영됐어요 — 8개가 안 맞아요.');
  });

  it('TRF 상세 — DC → MFC 진행 줄(배차된 운행이 있으면 차량·도착 계획)', async () => {
    renderAt('/c/CDC01/trf-wave/trf/TRF-20261126-0001');
    const j = await screen.findByTestId('trf-journey');
    expect(within(j).getByText('피킹').closest('[aria-current]')).not.toBeNull();
    await waitFor(() => expect(screen.getByTestId('trf-journey-note')).toHaveTextContent('배차됨 — 차량 경기 81바 1101'));
  });
});
