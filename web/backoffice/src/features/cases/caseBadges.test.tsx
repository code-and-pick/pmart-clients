// 접수 건 알림 배지 — 1분마다 안 맡음·기한 지남 개수, 50 넘으면 "50+", 늘면 잠깐 강조, 실패는 "?"
import { act, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_BASE } from '../../api/client';
import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ caseId: `CASE-B-${i}`, kind: 'RIDER_HELP', state: 'OPEN' }));
const counts = (c: { unassigned: number | 'fail'; overdue: number; moreOverdue?: boolean }) =>
  http.get(`${API_BASE}/cases`, ({ request }) => {
    const q = new URL(request.url).searchParams;
    if (q.get('unassigned') === 'true') {
      if (c.unassigned === 'fail') return HttpResponse.json({ type: 'about:blank', title: 'x', status: 503, code: 'DEPENDENCY_UNAVAILABLE' }, { status: 503, headers: { 'content-type': 'application/problem+json' } });
      return HttpResponse.json({ items: items(c.unassigned), page: { nextCursor: null, size: 50 } });
    }
    if (q.get('overdue') === 'true') return HttpResponse.json({ items: items(c.overdue), page: { nextCursor: c.moreOverdue ? 'C50' : null, size: 50 } });
    return HttpResponse.json({ items: [], page: { nextCursor: null, size: 50 } });
  });

describe('접수 건 알림 배지', () => {
  afterEach(() => vi.useRealTimers());

  it('지원센터: 메뉴 "접수 건" 옆에 안 맡음·기한 지남 개수, 다음 쪽이 있으면 "50+"', async () => {
    server.use(counts({ unassigned: 3, overdue: 50, moreOverdue: true }));
    renderAt('/session', as.riderOps);
    expect(await screen.findByTestId('case-badge-unassigned')).toHaveTextContent('3');
    expect(screen.getByTestId('case-badge-overdue')).toHaveTextContent('50+');
    expect(screen.getByTestId('case-badge-unassigned')).toHaveAttribute('title', '아무도 안 맡은 접수 건');
  });

  it('0건이면 배지가 없고, 상담원(보기만)에게는 묻지도 않는다', async () => {
    server.use(counts({ unassigned: 0, overdue: 0 }));
    const view = renderAt('/session', as.cs);
    await screen.findByTestId('nav-group-support');
    expect(screen.queryByTestId('case-badge-unassigned')).not.toBeInTheDocument();
    expect(view.sent.some((r) => new URL(r.url).searchParams.get('unassigned') === 'true')).toBe(false);
  });

  it('읽지 못하면 0 이 아니라 "?"', async () => {
    server.use(counts({ unassigned: 'fail', overdue: 1 }));
    renderAt('/session', as.admin);
    await waitFor(() => expect(screen.getByTestId('case-badge-unassigned')).toHaveTextContent('?'), { timeout: 5000 });
    expect(screen.getByTestId('case-badge-overdue')).toHaveTextContent('1');
  });

  it('1분 뒤 다시 세어 늘었으면 잠깐 강조(소리·알림 없음)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.use(counts({ unassigned: 1, overdue: 0 }));
    renderAt('/session', as.riderOps);
    const badge = await screen.findByTestId('case-badge-unassigned');
    expect(badge).toHaveAttribute('data-flash', 'false');
    server.use(counts({ unassigned: 2, overdue: 0 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    await waitFor(() => expect(screen.getByTestId('case-badge-unassigned')).toHaveTextContent('2'));
    expect(screen.getByTestId('case-badge-unassigned')).toHaveAttribute('data-flash', 'true');
  });
});
