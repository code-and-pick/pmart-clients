// MFC 재고 이동 — TRF 단계(서버 상태)로 MFC 별 칸 나눔, 운송 중 = 재고 transit 합, 최근 출발.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { renderAt } from '../../test/render';
import { server } from '../../test/server';
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
    const rows = await screen.findAllByTestId('flow-recent-row');
    const row = rows.find((r) => r.textContent?.includes('T553019'))!;
    await waitFor(() => expect(within(row).getByTestId('receipt-chip')).toHaveTextContent('입고 · 8개 안 맞음'));
    await userEvent.click(within(row).getByRole('button'));
    expect(within(row).getByTestId('flow-recent-stocked')).toHaveTextContent('40개 중 32개만 반영됐어요 — 8개가 안 맞아요.');
    // 입고가 있으면 보낸 상품 대신 MFC 입고 상품표(상품·LOT 별 정상·격리·판정 전·손실·안 맞음)
    const lines = within(row).getByTestId('flow-receipt-lines');
    expect(lines).toHaveTextContent('LOT-A1');
    expect(within(row).queryByTestId('flow-recent-lines')).not.toBeInTheDocument();
  });

  it('입고 확인을 한 화면에 — 최근 출발을 MFC 입고 상태로 거르기(주소 ?receipt=), 따로 메뉴는 없다(사용자 2026-11-27 "하나에 다 몰아서")', async () => {
    renderAt('/c/CDC01/mfc-flow');
    await screen.findAllByTestId('flow-recent-row');
    await waitFor(() => expect(screen.getByTestId('flow-receipt-MISMATCH')).toHaveTextContent('안 맞음 1'));
    await userEvent.click(screen.getByTestId('flow-receipt-MISMATCH'));
    expect(screen.getByTestId('flow-receipt-MISMATCH')).toHaveAttribute('aria-pressed', 'true');
    const only = screen.getAllByTestId('flow-recent-row');
    expect(only).toHaveLength(1);
    expect(only[0]).toHaveTextContent('T553019');
    await userEvent.click(screen.getByTestId('flow-receipt-DONE'));
    expect(screen.getAllByTestId('flow-recent-row').map((r) => r.textContent)).toEqual([expect.stringContaining('T482913')]);
    await userEvent.click(screen.getByTestId('flow-receipt-WAITING'));
    expect(screen.queryAllByTestId('flow-recent-row')).toHaveLength(0);
    expect(screen.getByText('최근 출발 50건 중 이 상태인 것이 없어요.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'MFC 입고 확인' })).not.toBeInTheDocument();
  });

  it('TRF 목록 — 출발한 TRF 는 상태 옆에 MFC 입고 반영', async () => {
    server.use(
      http.get(`${API_BASE}/cdcs/:cdcId/transfers`, () =>
        HttpResponse.json({
          items: [
            { trfId: 'TRF-20261126-0001', trfNumber: 'T482913', cdcId: 'CDC01', mfcId: 'MFC-BJG-01', state: 'DEPARTED', dueAt: '2026-11-27T01:00:00Z', updatedAt: '2026-11-27T02:00:00Z', lineCount: 2, approvedQty: 52, allocatedQty: 52, pickedQty: 52, shortQty: 0, version: 3 },
            { trfId: 'TRF-20261127-0011', trfNumber: 'T900011', cdcId: 'CDC01', mfcId: 'MFC-BNG-01', state: 'DEPARTED', dueAt: '2026-11-27T01:00:00Z', updatedAt: '2026-11-27T01:00:00Z', lineCount: 1, approvedQty: 18, allocatedQty: 18, pickedQty: 18, shortQty: 0, version: 3 },
          ],
          page: 0,
          size: 200,
          hasNext: false,
        }),
      ),
    );
    renderAt('/c/CDC01/trf-wave');
    const rows = await screen.findAllByTestId('trf-row');
    await waitFor(() => expect(within(rows[0]!).getByTestId('receipt-chip')).toHaveTextContent('✓ MFC 입고 완료'));
    expect(within(rows[1]!).getByTestId('receipt-chip')).toHaveTextContent('MFC 입고 전');
  });

  it('TRF 상세 — DC → MFC 진행 줄(배차된 운행이 있으면 차량·도착 계획)', async () => {
    renderAt('/c/CDC01/trf-wave/trf/TRF-20261126-0001');
    const j = await screen.findByTestId('trf-journey');
    expect(within(j).getByText('피킹').closest('[aria-current]')).not.toBeNull();
    await waitFor(() => expect(screen.getByTestId('trf-journey-note')).toHaveTextContent('배차됨 — 차량 경기 81바 1101'));
  });
});
