// 콘텐츠 초안 목록(product-content 0.4.0 PCT-1, 2026-11-20)
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

describe('콘텐츠 초안 목록', () => {
  it('서버 상태별 수 띠와 최근 바뀐 순 목록 — 줄은 초안 상세로', async () => {
    renderAt('/contents/drafts', as.md);
    await waitFor(() => expect(screen.getByTestId('content-draft-state-all')).toHaveTextContent('1'));
    expect(screen.getByTestId('content-draft-state-PUBLISHED')).toHaveTextContent('1');
    expect(screen.getByTestId('content-draft-state-DRAFT')).toHaveTextContent('0');
    const row = await screen.findByTestId('content-draft-row');
    expect(row).toHaveTextContent('사과 1.5kg');
    expect(row).toHaveTextContent('게시됨');
    expect(screen.getByRole('link', { name: /사과 1.5kg/ })).toHaveAttribute('href', '/contents/drafts/cd-seed-published-1');
  });

  it('상태 칸을 누르면 그 상태만 서버에 묻는다(state=)', async () => {
    const user = userEvent.setup();
    const view = renderAt('/contents/drafts', as.md);
    await screen.findByTestId('content-draft-row');
    await user.click(screen.getByTestId('content-draft-state-DRAFT'));
    await screen.findByText('이 상태의 콘텐츠 초안이 없어요.');
    expect(view.sent.some((r) => new URL(r.url).pathname.endsWith('/content-drafts') && new URL(r.url).searchParams.get('state') === 'DRAFT')).toBe(true);
  });

  it('상태별 수를 못 읽으면 0 이 아니라 "?"', async () => {
    server.use(
      http.get('*/api/v1/content-drafts/counts', () =>
        HttpResponse.json({ type: 'about:blank', status: 503, code: 'UPSTREAM_UNAVAILABLE', retryable: true }, { status: 503, headers: { 'content-type': 'application/problem+json' } }),
      ),
    );
    renderAt('/contents/drafts', as.md);
    await waitFor(() => expect(screen.getByTestId('content-draft-state-all')).toHaveTextContent('?'), { timeout: 5000 });
  });
});
