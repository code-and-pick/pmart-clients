// 라이더 상세 배달 지역 — 센터 이름 · 구역 이름(rider 0.26.0 zoneName), 이름이 없으면 구역 ID 를 흐리게.
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

describe('라이더 배달 지역', () => {
  it('구역 이름이 있으면 "센터 이름 · 구역 이름"(구역 ID 는 안 보임)', async () => {
    renderAt('/riders/RID-MOCK-1', as.cs);
    await waitFor(() => expect(screen.getByTestId('rider-basic')).toHaveTextContent('부산진구 MFC · 서면 구역'));
    expect(screen.getByTestId('rider-basic')).not.toHaveTextContent('ZONE-MOCK-1');
  });

  it('구역 이름이 null 이면 구역 ID 를 보인다(못 읽음 ≠ 없음)', async () => {
    server.use(
      http.get(`${API_BASE}/riders/:riderId`, ({ params }) =>
        HttpResponse.json({ riderId: params['riderId'], riderNumber: 'R4785', nameMasked: '김**더', deliveryAreas: [{ mfcId: 'MFC-BSN-01', zoneId: 'ZONE-X-9', zoneName: null }] }),
      ),
    );
    renderAt('/riders/RID-MOCK-1', as.cs);
    await waitFor(() => expect(screen.getByTestId('rider-basic')).toHaveTextContent('부산진구 MFC · ZONE-X-9'));
  });
});
