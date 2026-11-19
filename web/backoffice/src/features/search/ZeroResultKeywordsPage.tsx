// 결과 0건 검색어(search 0.4.0 `GET /search/zero-result-keywords`, ADR-0073 — MD·OPERATOR_ADMIN, 그 밖 403).
// 고객·비회원 첫 쪽 검색에서 최근 days 일 결과 0건 검색어를 많이 나온 순으로. 서버가 정렬·인기 키워드 숨김을 한다 — 화면은 그대로 보인다.
// 검색한 사람 수는 서버가 근사로 준다(원문 없음). 동의어 등록(SEARCH_SYNONYM 승인)은 다음 단계 계약이 나오면 이 화면에 붙인다.
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { PageHeader } from '../../shared/admin';

const m = messages.searchMisses;
export const ZERO_RESULT_DAYS = [1, 7, 30, 90] as const;
const SIZE = 50;

function daysOf(v: string | null): number {
  const n = Number(v);
  return ZERO_RESULT_DAYS.some((d) => d === n) ? n : 7;
}

export function ZeroResultKeywordsPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const days = daysOf(params.get('days'));

  const query = useQuery({
    queryKey: ['search', 'zero-result-keywords', days],
    queryFn: () => request('GET', api.search.GET('/search/zero-result-keywords', { params: { query: { days, size: SIZE } } })),
  });

  return (
    <section className="max-w-5xl space-y-4">
      <PageHeader title={m.title} />
      <div className="flex flex-wrap items-center gap-3 rounded-box border border-base-300 bg-base-100 px-4 py-3 text-sm shadow-sm">
        <span className="text-xs font-medium text-base-content/55">{m.period}</span>
        <div className="join" role="group" aria-label={m.period}>
          {ZERO_RESULT_DAYS.map((d) => (
            <button
              key={d}
              type="button"
              className={`btn btn-sm join-item ${d === days ? 'btn-primary' : 'btn-ghost border-base-300'}`}
              aria-pressed={d === days}
              data-testid={`zero-days-${d}`}
              onClick={() => setParams({ days: String(d) })}
            >
              {m.days(d)}
            </button>
          ))}
        </div>
      </div>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(r) => {
          const fresh = r.asOf?.freshness;
          return (
            <section className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 px-4 py-3">
                <h2 className="text-sm font-semibold" data-testid="zero-count">
                  {m.count(r.days, r.items.length, r.items.length >= SIZE)}
                </h2>
                <span className="flex items-center gap-2 text-xs text-base-content/50">
                  {fresh && fresh !== 'CURRENT' && (
                    <span className="badge badge-warning badge-soft badge-sm" data-testid="zero-stale">
                      {m.stale[fresh]}
                    </span>
                  )}
                  {r.asOf?.asOf ? m.asOf(formatSeoul(r.asOf.asOf)) : null}
                </span>
              </div>
              {r.items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-base-content/60" data-testid="zero-empty">
                  {m.empty(r.days)}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th className="w-14">{m.col.rank}</th>
                        <th>{m.col.keyword}</th>
                        <th className="text-right">{m.col.searches}</th>
                        <th className="text-right">{m.col.searchers}</th>
                        <th>{m.col.last}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.items.map((k, i) => (
                        <tr key={k.keyword} data-testid="zero-row">
                          <td className="tabular-nums text-base-content/60">{i + 1}</td>
                          <td className="font-medium">{k.keyword}</td>
                          <td className="text-right tabular-nums">{m.times(k.searches)}</td>
                          <td className="text-right tabular-nums">{m.people(k.searchers)}</td>
                          <td className="text-base-content/70">{k.lastSearchedAt ? formatSeoul(k.lastSearchedAt) : messages.none}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        }}
      </QueryState>
    </section>
  );
}
