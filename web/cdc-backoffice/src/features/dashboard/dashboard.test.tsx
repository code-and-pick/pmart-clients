// 대시보드 — 서버 집계만(진행률도 서버 값), 날짜는 서버로, 상태별 줄은 거른 목록 링크, 조회 실패는 숫자 0 이 아니라 실패.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { renderAt } from '../../test/render';
import { server } from '../../test/server';

describe('대시보드', () => {
  it('TRF 수·진행률·부족, 상태별 막대 링크', async () => {
    renderAt('/c/CDC01/dashboard');
    expect(await screen.findByTestId('dash-trf')).toHaveTextContent('6');
    // 피킹 62 ÷ 승인 190 = 33%
    expect(screen.getByTestId('dash-progress')).toHaveTextContent('33%');
    expect(screen.getByTestId('dash-short')).toHaveTextContent('2');
    expect(within(screen.getByTestId('dash-trf-states')).getByRole('link', { name: /피킹 중/ })).toHaveAttribute('href', '/c/CDC01/trf-wave?state=PICKING');
    expect(within(screen.getByTestId('dash-waves')).getByRole('link', { name: /계획/ })).toHaveAttribute('href', '/c/CDC01/trf-wave?view=waves&state=PLANNED');
    expect(screen.getByTestId('dash-tasks')).toHaveTextContent('피킹 · 진행 중');
    expect(screen.getByText(/입고 현황은 입고 서비스가 아직 없어/)).toBeInTheDocument();
  });

  it('날짜를 바꾸면 그 날짜로 묻는다', async () => {
    const view = renderAt('/c/CDC01/dashboard');
    await screen.findByTestId('dash-trf');
    fireEvent.change(screen.getByTestId('dash-date'), { target: { value: '2026-11-27' } });
    await waitFor(() => expect(view.gets('/outbound-summary').some((r) => new URL(r.url).searchParams.get('date') === '2026-11-27')).toBe(true));
  });

  it('승인 0 이면 진행률은 "승인 0"(0% 아님)', async () => {
    server.use(
      http.get(`${API_BASE}/cdcs/:cdcId/outbound-summary`, () =>
        HttpResponse.json({ cdcId: 'CDC01', date: '2026-11-26', transferCount: 0, transfersByState: [], approvedQty: 0, allocatedQty: 0, pickedQty: 0, shortQty: 0, progress: null, wavesByState: [], tasksByKindState: [] }),
      ),
    );
    renderAt('/c/CDC01/dashboard');
    expect(await screen.findByTestId('dash-progress')).toHaveTextContent('승인 0');
  });

  it('조회 실패는 0 이 아니라 실패로', async () => {
    server.use(http.get(`${API_BASE}/cdcs/:cdcId/outbound-summary`, () => HttpResponse.json({ code: 'INTERNAL_ERROR', status: 500 }, { status: 500 })));
    renderAt('/c/CDC01/dashboard');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('dash-trf')).not.toBeInTheDocument();
  });
});
