// MFC 입고 확인(cdc-inventory 0.22.0 transits — 사용자 2026-11-27 "mfc에서 적치까지 완료했는데 왜 계속 출발이라고").
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { renderAt } from '../../test/render';
import { server } from '../../test/server';

describe('MFC 입고 확인', () => {
  it('출발 최신 순 — 입고 전 / 안 맞음 / 입고 완료, 줄 누르면 상품별 수량과 시각', async () => {
    renderAt('/c/CDC01/mfc-receipts');
    const rows = await screen.findAllByTestId('receipt-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByTestId('receipt-chip')).toHaveTextContent('MFC 입고 전');
    expect(within(rows[1]!).getByTestId('receipt-chip')).toHaveTextContent('✓ MFC 입고 완료');
    expect(rows[1]).toHaveTextContent('T482913');
    expect(within(rows[2]!).getByTestId('receipt-chip')).toHaveTextContent('입고 · 8개 안 맞음');
    await userEvent.click(rows[2]!);
    const detail = await screen.findByTestId('receipt-detail');
    expect(within(detail).getByTestId('receipt-story')).toHaveTextContent('40개 보냈는데 MFC 가 32개를 받았어요 — 8개가 아직 안 맞아요.');
    expect(within(detail).getByTestId('receipt-lines')).toHaveTextContent('LOT-A1');
    expect(detail).toHaveTextContent('✓ MFC 마지막 반영');
  });

  it('입고 상태 거르기는 주소 쿼리로 서버에 보낸다', async () => {
    const view = renderAt('/c/CDC01/mfc-receipts');
    await screen.findAllByTestId('receipt-row');
    await userEvent.selectOptions(screen.getByTestId('receipt-state'), 'TRANSIT_RECONCILED');
    await waitFor(() => expect(screen.getAllByTestId('receipt-row')).toHaveLength(1));
    expect(view.gets('/cdcs/CDC01/transits').some((r) => new URL(r.url).searchParams.get('state') === 'TRANSIT_RECONCILED')).toBe(true);
  });

  it('조회 실패는 빈 목록이 아니라 실패로', async () => {
    server.use(http.get(`${API_BASE}/cdcs/:cdcId/transits`, () => HttpResponse.json({ code: 'INTERNAL_ERROR', status: 500 }, { status: 500 })));
    renderAt('/c/CDC01/mfc-receipts');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('조건에 맞는 출발이 없어요.')).not.toBeInTheDocument();
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
});
