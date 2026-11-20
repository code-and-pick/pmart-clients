// 공용으로 바꿈(2026-11-20 웹 백오피스 맞추기 4단계) — 정본은 web/ui/src/console/ (@pmart/web-ui/console). 이 앱 안의 가져오기 경로를 그대로 두려고 다시 내보낸다.
// 이 앱에만 남긴 것: DetailHeader — 최근 본 것 기록(seen → recentViews)·목록 순서대로 이전·다음(QueueNav)이 이 앱 기능이라. 모양은 공용 콘솔 상세 머리와 같다(상자 없이 24px 제목).
// 직접 내보낸 이름(DetailHeader)이 export * 보다 먼저다.
import { type ReactNode, useRef } from 'react';
import { Link, useLocation } from 'react-router';

import { useRecordRecent } from './recentViews';
import { StickyTitle, useScrolledPast } from './StickyTitle';
import { QueueNav } from './workQueue';

export * from '@pmart/web-ui/console';

/** 상세 머리 — 공용 콘솔 모양(상자 없이 24px 제목 + 표시, 아래 회색 요약, 오른쪽 동작) + 이 앱의 최근 본 것 기록·이전·다음 */
export function DetailHeader({ back, title, badges, summary, actions, seen = false }: { readonly back: { readonly to: string; readonly label: string }; readonly title: ReactNode; readonly badges?: ReactNode; readonly summary?: ReactNode; readonly actions?: ReactNode; readonly seen?: boolean }) {
  // 제목이 화면 위로 지나가면 위에 얇은 제목 띠(2026-11-19)
  const card = useRef<HTMLDivElement>(null);
  const past = useScrolledPast(card);
  const { pathname } = useLocation();
  useRecordRecent(pathname, seen);
  return (
    <header className="space-y-1">
      <StickyTitle show={past} title={title} badges={badges} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={back.to} className="inline-flex items-center gap-1 text-sm text-base-content/70 underline underline-offset-2 hover:text-primary">
          <span aria-hidden>‹</span>
          {back.label}
        </Link>
        {/* 목록 순서대로 이전·n/N·다음([ ] 키) — 마지막으로 본 목록에 이 건이 있을 때만 */}
        <QueueNav />
      </div>
      <div ref={card} className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{title}</h1>
            {badges}
          </div>
          {summary && <p className="text-sm text-base-content/70">{summary}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
