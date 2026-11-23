// 라이더 앱 "채팅 상담"으로 연 문의 — 상담 관리 목록 "채팅" 꼬리표, 상세는 대화 칸을 먼저·크게(2026-11-23). 목(MSW) 기준.
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const chatInquiry = {
  inquiryId: 'INQ-CHAT',
  riderId: 'RD-7',
  category: 'OTHER',
  title: '실시간 채팅 상담',
  status: 'RECEIVED',
  createdAt: '2026-11-17T00:40:00.000Z',
  answeredAt: null,
  requesterType: 'RIDER',
  version: 1,
};

describe('채팅 상담(라이더 앱)', () => {
  it('상담 관리 목록에서 "채팅" 꼬리표가 붙는다(다른 일반 문의에는 없다)', async () => {
    server.use(http.get(`${API_BASE}/inquiries`, () => HttpResponse.json({ items: [chatInquiry, { ...chatInquiry, inquiryId: 'INQ-2', title: '정산 문의', category: 'SETTLEMENT' }], page: { nextCursor: null } })));
    renderAt('/consults', as.riderOps);
    const rows = await screen.findAllByTestId('consult-row');
    const chat = rows.find((r) => r.textContent?.includes('실시간 채팅 상담'))!;
    expect(within(chat).getByTestId('consult-chat')).toHaveTextContent('채팅');
    const other = rows.find((r) => r.textContent?.includes('정산 문의'))!;
    expect(within(other).queryByTestId('consult-chat')).toBeNull();
  });

  it('상세는 "채팅 상담" 대화 칸이 첫 탭·먼저 보인다', async () => {
    server.use(
      http.get(`${API_BASE}/inquiries/INQ-CHAT`, () =>
        HttpResponse.json({ ...chatInquiry, body: '정산이 안 들어왔어요', replies: [], photos: [] }),
      ),
    );
    renderAt('/inquiries/INQ-CHAT', as.riderOps);
    expect(await screen.findByRole('heading', { name: '채팅 상담' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('#sec-'));
    expect(tabs[0]).toHaveTextContent('채팅 상담');
  });
});
