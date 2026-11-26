// 피킹·분배 — 진행 중 Wave 의 피킹 작업을 통로 피킹 방식별 탭으로(새 API 없이 waves·tasks 조회만).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { renderAt } from '../../test/render';
import { server } from '../../test/server';

describe('피킹·분배', () => {
  it('진행 중 Wave 의 피킹 작업 — 탭마다 끝나지 않은 작업 수, 방식으로 거르기', async () => {
    renderAt('/c/CDC01/picking');
    const tabs = await screen.findByTestId('picking-tabs');
    await waitFor(() => expect(screen.getAllByTestId('picking-row')).toHaveLength(3));
    // 전체 3건 중 끝나지 않은 것 2건(진행 중·일부)
    expect(within(tabs).getByRole('tab', { name: /전체/ })).toHaveTextContent('2');
    await userEvent.click(within(tabs).getByRole('tab', { name: /DPS/ }));
    expect(screen.getAllByTestId('picking-row')).toHaveLength(1);
    expect(screen.getByText(/TRF 하나씩, 선반 통로마다/)).toBeInTheDocument();
    await userEvent.click(within(tabs).getByRole('tab', { name: /분배/ }));
    expect(screen.getByTestId('picking-empty')).toBeInTheDocument();
  });

  it('진행 중 Wave 가 없으면 안내(0 건으로 꾸미지 않음)', async () => {
    server.use(http.get(`${API_BASE}/cdcs/:cdcId/waves`, () => HttpResponse.json({ items: [], page: 0, size: 100, hasNext: false })));
    renderAt('/c/CDC01/picking');
    expect(await screen.findByText(/진행 중인 Wave 가 없어요/)).toBeInTheDocument();
  });
});

describe('피킹 부족 재할당', () => {
  it('기본은 재할당 중 — 부족·못 채움 수량', async () => {
    renderAt('/c/CDC01/picking');
    const rows = await screen.findAllByTestId('shortage-row');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText('재할당 중')).toBeInTheDocument();
  });
});
