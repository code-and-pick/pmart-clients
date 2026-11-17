// 승인함 목록 — "더 보기"가 다음 쪽을 이어 붙인다(2026-11-17 사용자 신고: 눌러도 이전 기록이 안 나옴)
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';

const row = (n: number) => ({ approvalId: `APV-${n}`, type: 'PRODUCT', summary: `요청 ${n}`, requesterId: 'op-md-1', reviewState: 'APPROVED', executionState: 'APPLIED', submittedAt: '2026-11-17T00:00:00Z' });

describe('승인함 목록 — 더 보기', () => {
  it('다음 쪽(nextCursor)을 같은 필터로 묻고, 받은 줄 아래에 이어 붙인다', async () => {
    server.use(
      http.get(`${API_BASE}/approvals`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        return cursor === 'C2'
          ? HttpResponse.json({ items: [row(3)], page: { nextCursor: null, size: 50 } })
          : HttpResponse.json({ items: [row(1), row(2)], page: { nextCursor: 'C2', size: 50 } });
      }),
    );
    const view = renderAt('/approvals?type=PRODUCT', as.admin);
    expect(await screen.findByRole('link', { name: 'APV-2' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '더 보기' }));
    expect(await screen.findByRole('link', { name: 'APV-3' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'APV-1' })).toBeInTheDocument(); // 앞 줄은 그대로
    await waitFor(() => expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument()); // 끝
    const second = view.sent.find((r) => new URL(r.url).searchParams.get('cursor') === 'C2')!;
    expect(new URL(second.url).searchParams.get('type')).toBe('PRODUCT'); // 같은 필터
  });

  it('다음 쪽을 못 읽으면 받은 줄은 두고 경고 — 끝이나 0건으로 보이지 않는다', async () => {
    server.use(
      http.get(`${API_BASE}/approvals`, ({ request }) =>
        new URL(request.url).searchParams.get('cursor')
          ? HttpResponse.json({ type: 'about:blank', title: 'x', status: 400, code: 'VALIDATION_FAILED' }, { status: 400, headers: { 'content-type': 'application/problem+json' } })
          : HttpResponse.json({ items: [row(1)], page: { nextCursor: 'C2', size: 50 } }),
      ),
    );
    renderAt('/approvals', as.admin);
    await userEvent.click(await screen.findByRole('button', { name: '더 보기' }));
    expect(await screen.findByText(/이전 기록을 더 불러오지 못했어요/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'APV-1' })).toBeInTheDocument();
  });
});
