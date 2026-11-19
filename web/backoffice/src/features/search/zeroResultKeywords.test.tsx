// 결과 0건 검색어(search 0.4.0, ADR-0073 — MD·OPERATOR_ADMIN)
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';

const sentDays = (sent: Request[]) =>
  sent.filter((r) => new URL(r.url).pathname.endsWith('/search/zero-result-keywords')).map((r) => new URL(r.url).searchParams.get('days'));

describe('결과 없는 검색어', () => {
  it('상품팀: 메뉴에 있고, 기본 최근 7일·많이 나온 순 그대로, 사람 수는 "(약)"', async () => {
    const view = renderAt('/search/zero-results', as.md);
    const rows = await screen.findAllByTestId('zero-row');
    expect(rows.map((r) => within(r).getAllByRole('cell')[1]!.textContent)).toEqual(['두부조림', '샤인머스켓', '애호박전', '비건 만두', '감바스']);
    expect(rows[0]).toHaveTextContent('41번');
    expect(rows[0]).toHaveTextContent('33명');
    expect(screen.getByText('검색한 사람(약)')).toBeInTheDocument();
    expect(screen.getByTestId('zero-count')).toHaveTextContent('최근 7일 · 5개');
    expect(sentDays(view.sent)).toEqual(['7']);
    expect(within(screen.getByTestId('nav-group-catalog')).getAllByRole('link', { hidden: true }).map((a) => a.textContent)).toContain('결과 없는 검색어');
  });

  it('기간을 바꾸면 그 기간으로 다시 묻고, 마지막 검색 시각이 없으면 "-"(지어내지 않음)', async () => {
    const view = renderAt('/search/zero-results', as.admin);
    await screen.findAllByTestId('zero-row');
    await userEvent.click(screen.getByTestId('zero-days-90'));
    expect(await screen.findByText('ㅅㄱㅇ')).toBeInTheDocument();
    expect(screen.getByText('ㅅㄱㅇ').closest('tr')).toHaveTextContent(/1명-$/);
    expect(sentDays(view.sent)).toContain('90');
  });

  it('없으면 "없어요"(빈 표 아님), 늦은 값이면 표시', async () => {
    server.use(
      http.get(`${API_BASE}/search/zero-result-keywords`, () =>
        HttpResponse.json({ days: 1, items: [], asOf: { asOf: '2026-11-20T01:00:00Z', freshness: 'STALE' } }),
      ),
    );
    renderAt('/search/zero-results?days=1', as.md);
    expect(await screen.findByTestId('zero-empty')).toHaveTextContent('최근 1일 동안 결과 없는 검색어가 없어요');
    expect(screen.getByTestId('zero-stale')).toHaveTextContent('늦은 값');
  });

  it('상담원: 메뉴에 없고 주소로 열어도 서버가 403', async () => {
    renderAt('/search/zero-results', as.cs);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('zero-row')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-group-catalog')).not.toBeInTheDocument();
  });
});
