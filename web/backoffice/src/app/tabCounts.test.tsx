// 목록 탭·칩 옆 개수(2026-11-18 — 스마트스토어 "신규주문 3"·Shopify 목록 탭 참고) — 서버가 센 값만, 못 읽으면 빈칸
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { server } from '../test/server';
import { as, renderAt } from '../test/render';

describe('목록 탭 옆 개수', () => {
  it('접수 건: "아무도 안 맡은 것"·"기한 넘김" 탭 옆에 메뉴 알림과 같은 개수 — 탭 이름은 그대로', async () => {
    renderAt('/cases', as.riderOps);
    const tab = await screen.findByRole('tab', { name: '아무도 안 맡은 것' });
    expect(await within(tab).findByTestId('tab-count-casesUnassigned')).toHaveTextContent(/^\d+\+?$/);
    expect(await within(screen.getByRole('tab', { name: '기한 넘김' })).findByTestId('tab-count-casesOverdue')).toBeInTheDocument();
  });

  it('종류를 고르면 개수를 숨긴다(종류를 뺀 개수라 목록과 달라서)', async () => {
    renderAt('/cases?kind=MISDELIVERY', as.riderOps);
    const tab = await screen.findByRole('tab', { name: '아무도 안 맡은 것' });
    expect(within(tab).queryByTestId('tab-count-casesUnassigned')).not.toBeInTheDocument();
  });

  it('문의: "접수" 탭 옆 개수, 못 읽으면 빈칸(0 아님)', async () => {
    server.use(http.get(`${API_BASE}/inquiries`, ({ request }) => (new URL(request.url).searchParams.get('size') === '50' ? HttpResponse.json({ type: 'about:blank', title: 'x', status: 503, code: 'SERVICE_UNAVAILABLE', retryable: false }, { status: 503 }) : HttpResponse.json({ items: [], page: { nextCursor: null, size: 0 } }))));
    renderAt('/inquiries', as.cs);
    const tab = await screen.findByRole('radio', { name: '접수' });
    await screen.findByText(/문의가 없어요|0건|없어요/);
    expect(within(tab).queryByTestId('tab-count-inquiries')).not.toBeInTheDocument();
  });

  it('배송 확인(관리자): 진행 중 상태 칩 옆에 건수, 끝난 상태는 빈칸 — 관리자가 아니면 없음', async () => {
    const first = renderAt('/deliveries', as.admin);
    expect(await screen.findByTestId('chip-count-UNASSIGNED')).toHaveTextContent(/^\d+/);
    expect(screen.queryByTestId('chip-count-')).not.toBeInTheDocument(); // "전체" 칩
    first.unmount();
    renderAt('/deliveries', as.riderOps);
    await screen.findByRole('radio', { name: '미배정' });
    expect(screen.queryByTestId('chip-count-UNASSIGNED')).not.toBeInTheDocument();
  });
});
