// 찾기 전 빈 화면 안내(2026-11-18 — Shopify 빈 화면 참고). "무엇을 넣으면 되는지"를 모양으로 보이고, 이 화면 종류의 최근 본 항목을 바로 연다.
// 예시는 모양만(누르지 않는다) — 진짜처럼 보이는 번호를 누르게 하면 실서버에 없는 번호를 찾게 된다.
import { Link } from 'react-router';

import { messages as m } from './messages';
import { recentPath, useRecentViews, type RecentKind } from './recentViews';

export function StartGuide({ recentKinds, testId }: { readonly recentKinds: readonly RecentKind[]; readonly testId?: string }) {
  const recent = useRecentViews().items.filter((e) => recentKinds.includes(e.kind)).slice(0, 5);
  // 설명 문장·번호 형식 표는 뺐다(2026-11-20 사용자 "쓸데없는 말 다 지워") — 입력 칸 자리표시자가 형식을 보인다. 최근 본 것이 없으면 그리지 않는다
  if (recent.length === 0) return null;
  return (
    <div className="rounded-box border border-base-300 bg-base-100 px-6 py-5" data-testid={testId ?? 'start-guide'}>
      {recent.length > 0 && (
        <div className="max-w-3xl">
          <p className="mb-2 text-xs font-semibold text-base-content/55">{m.startGuide.recent}</p>
          <ul className="flex flex-wrap gap-2">
            {recent.map((e) => (
              <li key={`${e.kind}:${e.id}`}>
                <Link to={recentPath[e.kind](e.id)} className="inline-flex items-center gap-1.5 rounded-full border border-base-300 px-3 py-1 text-xs hover:border-primary/50 hover:bg-primary/5">
                  <span className="text-base-content/55">{m.recent.kind[e.kind]}</span>
                  <span className="font-semibold">{e.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
