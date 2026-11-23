// 배송 상세 기록은 최신 것이 위로(2026-11-23 사용자 "오늘 배차시도가 맨아래에 있으면 어떡해") — 서버가 오래된 순으로 줘도.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

describe('배송 상세 기록 순서', () => {
  it('배차 시도는 가장 최근 시도가 맨 위', async () => {
    server.use(
      http.get(`${API_BASE}/deliveries/:deliveryId/dispatch`, ({ params }) =>
        HttpResponse.json({
          deliveryId: params['deliveryId'],
          orderId: 'ORD-MOCK-1001',
          mfcId: 'MFC-BSN-01',
          state: 'SEARCHING',
          attempts: [
            { attemptId: 'ATT-OLD', state: 'FAILED', failureReason: 'EXPIRED', trigger: 'STORE_STAFF', startedAt: '2026-11-20T10:36:00Z' },
            { attemptId: 'ATT-MID', state: 'FAILED', failureReason: 'NO_RIDER', trigger: 'STORE_STAFF', startedAt: '2026-11-21T10:36:00Z' },
            { attemptId: 'ATT-NEW', state: 'FAILED', failureReason: 'REPEATED_REJECTION', trigger: 'STORE_STAFF', startedAt: '2026-11-23T10:36:00Z' },
          ],
        }),
      ),
    );
    renderAt('/deliveries/DLV-MOCK-1', as.admin);
    const panel = await screen.findByTestId('dispatch-panel');
    await waitFor(() => expect(within(panel).getByText(/반복 거절/)).toBeInTheDocument());
    const text = panel.textContent ?? '';
    expect(text.indexOf('반복 거절')).toBeLessThan(text.indexOf('라이더 없음'));
    expect(text.indexOf('라이더 없음')).toBeLessThan(text.indexOf('시간 초과'));
  });

  it('배차 시도가 많으면 최근 5개만, "모두 보기"로 펼침 — 배차 칸에는 라이더·센터를 다시 적지 않는다', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API_BASE}/deliveries/:deliveryId/dispatch`, ({ params }) =>
        HttpResponse.json({
          deliveryId: params['deliveryId'],
          orderId: 'ORD-MOCK-1001',
          mfcId: 'MFC-BSN-01',
          state: 'SEARCHING',
          attempts: Array.from({ length: 7 }, (_, i) => ({ attemptId: `ATT-${i}`, state: 'FAILED', failureReason: 'EXPIRED', trigger: 'STORE_STAFF', startedAt: `2026-11-2${i}T10:00:00Z` })),
        }),
      ),
    );
    renderAt('/deliveries/DLV-MOCK-1', as.admin);
    const panel = await screen.findByTestId('dispatch-panel');
    const toggle = await within(panel).findByTestId('attempts-toggle');
    expect(within(panel).getAllByText(/시간 초과/)).toHaveLength(5);
    expect(toggle).toHaveTextContent('모두 보기 (7개)');
    await user.click(toggle);
    expect(within(panel).getAllByText(/시간 초과/)).toHaveLength(7);
    expect(within(panel).queryByText('센터')).not.toBeInTheDocument();
    expect(within(panel).queryByText('라이더')).not.toBeInTheDocument();
  });
});
