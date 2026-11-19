// search 0.4.0 `GET /search/zero-result-keywords` 목(ADR-0073). MD·OPERATOR_ADMIN 만, 그 밖 403. 많이 나온 순.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { operator, problem, unauthorized } from './support';

const hour = 3_600_000;
const rows = [
  { keyword: '두부조림', searches: 41, searchers: 33, back: 2 },
  { keyword: '샤인머스켓', searches: 28, searchers: 25, back: 5 },
  { keyword: '애호박전', searches: 17, searchers: 15, back: 30 },
  { keyword: '비건 만두', searches: 9, searchers: 8, back: 80 },
  { keyword: '감바스', searches: 4, searchers: 4, back: 160 },
  { keyword: 'ㅅㄱㅇ', searches: 3, searchers: 1, back: null },
] as const;

export const searchHandlers = [
  http.get(`${API_BASE}/search/zero-result-keywords`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    if (!who.roles.some((r) => r === 'MD' || r === 'OPERATOR_ADMIN')) return problem(403, 'FORBIDDEN');
    const q = new URL(request.url).searchParams;
    const days = Number(q.get('days'));
    const size = Number(q.get('size') ?? 50);
    if (!Number.isInteger(days) || days < 1 || days > 90) return problem(400, 'VALIDATION_FAILED', [{ field: 'days' }]);
    const now = Date.now();
    // 기간 안(마지막 검색이 days 일 안)인 것만 — 시각이 없는 것은 넓은 기간(30일 이상)에만
    const items = rows
      .filter((r) => (r.back === null ? days >= 30 : r.back * hour <= days * 24 * hour))
      .slice(0, size)
      .map((r) => ({ keyword: r.keyword, searches: r.searches, searchers: r.searchers, lastSearchedAt: r.back === null ? null : new Date(now - r.back * hour).toISOString() }));
    return HttpResponse.json({ days, items, asOf: { asOf: new Date(now).toISOString(), freshness: 'CURRENT' } });
  }),
];
