// 문의 미답변 현황(2026-11-19 쿠팡 윙 고객문의 참고) — 서버 접수 시각에서 기다린 시간으로 묶어 보일 뿐(기한 판정 아님)
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';

const H = 3_600_000;
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * H).toISOString();
const inq = (id: string, hoursAgo: number, status = 'RECEIVED') => ({ inquiryId: id, inquiryNumber: `Q-1119-${id}`, title: `문의 ${id}`, category: 'DELIVERY', status, createdAt: iso(hoursAgo), version: 1, requesterType: 'CUSTOMER' });

function serve() {
  const all = [inq('0001', 2), inq('0002', 30), inq('0003', 100), inq('0004', 200), inq('0005', 5, 'ANSWERED')];
  server.use(
    http.get('*/api/v1/inquiries', ({ request }) => {
      const st = new URL(request.url).searchParams.get('status');
      return HttpResponse.json({ items: all.filter((i) => !st || i.status === st), page: { nextCursor: null } });
    }),
  );
}

describe('문의 미답변 현황', () => {
  it('접수(미답변)만 기다린 시간으로 — 24시간 이내 1 · 24~72시간 1 · 72시간 넘음 2(빨강)', async () => {
    serve();
    renderAt('/inquiries', as.cs);
    // 카드 밑 설명·안내 상자는 없다(2026-11-20) — 카드 이름 뒤에 숫자
    await waitFor(() => expect(screen.getByTestId('inquiry-wait-gt72')).toHaveTextContent(/넘음2$/)); // 끝 숫자(이름의 72 와 헷갈리지 않게)
    expect(screen.queryByTestId('inquiry-guide')).not.toBeInTheDocument();
    expect(screen.getByTestId('inquiry-wait-lt24')).toHaveTextContent(/이내1$/);
    expect(screen.getByTestId('inquiry-wait-h24to72')).toHaveTextContent(/시간1$/);
  });

  it('"72시간 넘음"을 누르면 그 문의만, 줄에 "N일째 기다림"', async () => {
    const user = userEvent.setup();
    serve();
    renderAt('/inquiries', as.cs);
    await waitFor(() => expect(screen.getByTestId('inquiry-wait-gt72')).toHaveTextContent(/넘음2$/)); // 끝 숫자(이름의 72 와 헷갈리지 않게)
    await user.click(screen.getByTestId('inquiry-wait-gt72'));
    await waitFor(() => expect(screen.getAllByTestId('inquiry-row')).toHaveLength(2));
    for (const r of screen.getAllByTestId('inquiry-row')) expect(within(r).getByTestId('inquiry-wait')).toHaveTextContent(/일째 기다림/);
  });

  it('답변한 문의에는 기다린 시간 표시가 없다', async () => {
    serve();
    renderAt('/inquiries', as.cs);
    await waitFor(() => expect(screen.getAllByTestId('inquiry-row')).toHaveLength(5));
    const answered = screen.getAllByTestId('inquiry-row').find((r) => r.textContent?.includes('문의 0005'))!;
    expect(within(answered).queryByTestId('inquiry-wait')).not.toBeInTheDocument();
  });
});
