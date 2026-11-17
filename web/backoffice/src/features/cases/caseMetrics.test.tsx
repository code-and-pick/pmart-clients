// 접수 건 현황 건수(case 0.18.0) — 관리자만, 건수만, 0건 줄 없음 → 0, 실패는 0 이 아니라 오류
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';

describe('접수 건 현황', () => {
  it('종류별 처리 중·안 맡음·기한 지남(기한 지남은 사건함 링크), 문의 답변 대기는 종류별 — 없는 종류는 0', async () => {
    server.use(
      http.get(`${API_BASE}/cases/metrics`, () =>
        HttpResponse.json({
          asOf: '2026-11-17T03:00:00Z',
          cases: [{ kind: 'MISDELIVERY', open: 3, unassigned: 1, overdue: 1 }],
          obligations: [{ owner: 'CS', open: 2, overdue: 0 }],
          pendingHandovers: 1,
          inquiries: [{ requesterType: 'RIDER', awaitingAnswer: 3, oldestReceivedAt: '2026-11-17T01:24:00Z' }],
        }),
      ),
    );
    renderAt('/case-metrics', as.admin);
    const row = await screen.findByTestId('metrics-case');
    expect(row).toHaveTextContent('오배송');
    expect(row).toHaveTextContent('3건 중 1건');
    expect(within(row).getByTestId('metrics-overdue')).toHaveAttribute('href', '/cases?tab=overdue&kind=MISDELIVERY');
    expect(screen.getByTestId('metrics-obligation')).toHaveTextContent('고객센터 · 처리 중 2 · 기한 지남 0 / 2');
    expect(screen.getByTestId('metrics-handovers')).toHaveTextContent('받기 전 인계서 1');
    const inquiries = screen.getAllByTestId('metrics-inquiry');
    const customer = inquiries[0]!;
    const rider = inquiries[1]!;
    expect(customer).toHaveTextContent('고객 문의 · 답변 대기 0');
    expect(rider).toHaveTextContent('라이더 문의 · 답변 대기 3');
    expect(within(rider).getByRole('link', { name: '3' })).toHaveAttribute('href', '/rider-inquiries?status=RECEIVED');
    expect(screen.getByTestId('metrics-as-of')).toHaveTextContent('기준');
  });

  it('메뉴: 처리 대기 묶음에 관리자만, 조회 실패는 0 이 아니라 오류', async () => {
    server.use(
      http.get(`${API_BASE}/cases/metrics`, () =>
        HttpResponse.json({ type: 'about:blank', title: 'x', status: 503, code: 'DEPENDENCY_UNAVAILABLE' }, { status: 503, headers: { 'content-type': 'application/problem+json' } }),
      ),
    );
    renderAt('/case-metrics', as.admin);
    const pending = await screen.findByTestId('nav-group-pending');
    expect(within(pending).getAllByRole('link', { hidden: true }).map((a) => a.textContent)).toContain('접수 건 현황');
    expect(await screen.findByRole('button', { name: /다시/ })).toBeInTheDocument();
    expect(screen.queryByTestId('metrics-case')).not.toBeInTheDocument();
  });
});
