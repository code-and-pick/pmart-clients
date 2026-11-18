// 배송 상세의 배정 라이더 카드(2026-11-18 Refine 참고)
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { http, HttpResponse } from 'msw';

import { API_BASE } from '../../api/client';
import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';

describe('배송 상세 — 배정 라이더 카드', () => {
  it('배정된 배송: 가린 이름·번호·가린 전화·운행·수단, 라이더 상세와 이 라이더의 배송 링크(원문 열람 버튼은 없음)', async () => {
    renderAt('/deliveries/DLV-MOCK-1', as.cs);
    const card = await screen.findByTestId('delivery-rider-card');
    expect(await within(card).findByTestId('rider-card-name')).toHaveTextContent('김**더482913');
    expect(card).toHaveTextContent('010****2222');
    expect(card).toHaveTextContent('운행 중');
    expect(card).toHaveTextContent('오토바이');
    expect(within(card).getByRole('link', { name: '라이더 상세' })).toHaveAttribute('href', '/riders/RID-MOCK-1');
    expect(within(card).getByRole('link', { name: '이 라이더의 배송' })).toHaveAttribute('href', '/deliveries?q=1&riderId=RID-MOCK-1');
    expect(within(card).queryByRole('button', { name: /열람/ })).not.toBeInTheDocument();
  });

  it('미배정 배송에는 카드가 없다', async () => {
    renderAt('/deliveries/DLV-MOCK-4', as.cs);
    await screen.findByTestId('execution-panel');
    await screen.findAllByText(/미배정/);
    expect(screen.queryByTestId('delivery-rider-card')).not.toBeInTheDocument();
  });

  it('라이더를 못 읽으면 빈 카드가 아니라 실패로 보인다', async () => {
    server.use(http.get(`${API_BASE}/riders/:riderId`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 403, code: 'FORBIDDEN', retryable: false }, { status: 403 })));
    renderAt('/deliveries/DLV-MOCK-1', as.cs);
    const card = await screen.findByTestId('delivery-rider-card');
    expect(await within(card).findByRole('alert')).toBeInTheDocument();
    expect(within(card).queryByTestId('rider-card-name')).not.toBeInTheDocument();
  });
});
