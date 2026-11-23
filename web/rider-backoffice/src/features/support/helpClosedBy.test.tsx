// 도움요청 "닫은 직원" — 상담 관리(사건)에서 닫으면 resolvedBy 가 "case:<사건 ID>" — 긴 ID 대신 사건의 닫은 직원(이름·사번)과
// "상담 관리에서 완료", 처리 메모의 옛 말·코드("사건함에서 닫음 (RESOLVED)")도 화면 말로(2026-11-23). 목(MSW) 기준.
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

describe('도움요청 닫은 직원', () => {
  it('case:<ID> 대신 사건을 닫은 직원과 "상담 관리에서 완료", 메모는 한글로', async () => {
    server.use(
      http.get(`${API_BASE}/deliveries/DLV-9/help-requests/HR-9`, () =>
        HttpResponse.json({
          requestId: 'HR-9',
          deliveryId: 'DLV-9',
          category: 'OTHER',
          state: 'RESOLVED',
          stage: 'ASSIGNED',
          caseId: 'CASE-565a0aab-0fa7-4ed1-b2d5-9212f82bb159',
          createdAt: '2026-11-23T10:05:00Z',
          resolvedAt: '2026-11-23T10:48:00Z',
          resolvedBy: 'case:CASE-565a0aab-0fa7-4ed1-b2d5-9212f82bb159',
          resolutionNote: '사건함에서 닫음 (RESOLVED)',
        }),
      ),
      http.get(`${API_BASE}/cases/CASE-565a0aab-0fa7-4ed1-b2d5-9212f82bb159`, () =>
        HttpResponse.json({
          caseId: 'CASE-565a0aab-0fa7-4ed1-b2d5-9212f82bb159',
          caseType: 'RIDER_HELP',
          state: 'CLOSED',
          closure: { closedAt: '2026-11-23T10:48:00Z', closedBy: 'OP-rops-1', resolution: 'RESOLVED' },
        }),
      ),
    );
    renderAt('/help-requests/DLV-9/HR-9', as.riderOps);
    const detail = await screen.findByTestId('help-detail');
    expect((await within(detail).findAllByText('상담 관리에서 완료')).length).toBeGreaterThan(0);
    expect(await within(detail).findByText('나')).toBeInTheDocument(); // 로그인한 본인이 닫음
    expect(detail).not.toHaveTextContent('case:');
    expect(detail).not.toHaveTextContent('RESOLVED');
    expect(detail).not.toHaveTextContent('사건함');
    expect(detail).toHaveTextContent('처리 완료');
  });
});
