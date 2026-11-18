// 대시보드 "최근 본 항목" 줄(2026-11-18 사용자 "UI 보충 — 추천 다"). 이 브라우저·이 직원 것만(shared/recentViews).
// 본 것이 없으면 줄을 그리지 않는다. 지우기는 이 목록만 지운다(서버에는 아무것도 없다).
import { Link } from 'react-router';

import { ago } from '../features/lookup/parts';
import { messages as m } from '../shared/messages';
import { recentPath, useRecentViews } from '../shared/recentViews';

export function RecentViews() {
  const { items, clear } = useRecentViews();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="dash-recent" className="rounded-box border border-base-300 bg-base-100 px-5 py-3 shadow-sm" data-testid="dash-recent">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="dash-recent" className="text-sm font-bold">
          {m.recent.title}
        </h2>
        <ul className="flex min-w-0 flex-1 flex-wrap gap-2">
          {items.map((e) => (
            <li key={`${e.kind}:${e.id}`}>
              <Link
                to={recentPath[e.kind](e.id)}
                className="inline-flex items-center gap-1.5 rounded-full border border-base-300 bg-base-200/50 px-3 py-1 text-xs transition-colors hover:border-primary/50 hover:bg-primary/5"
                title={new Date(e.at).toLocaleString('ko-KR')}
              >
                <span className="text-base-content/55">{m.recent.kind[e.kind]}</span>
                <span className="max-w-48 truncate font-semibold">{e.label}</span>
                <span className="text-base-content/40">{ago(new Date(e.at).toISOString())}</span>
              </Link>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-ghost btn-xs text-base-content/55" onClick={clear}>
          {m.recent.clear}
        </button>
      </div>
    </section>
  );
}
