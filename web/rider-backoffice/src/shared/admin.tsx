// 공용으로 바꿈(2026-11-20 웹 백오피스 맞추기 4단계) — 정본은 web/ui/src/console/ (@pmart/web-ui/console). 이 앱 안의 가져오기 경로를 그대로 두려고 다시 내보낸다.
// 이 앱에만 남긴 것: DetailHeader — 최근 본 것 기록(seen → recentViews)·목록 순서대로 이전·다음(QueueNav)이 이 앱 기능이라. 모양은 공용 콘솔 상세 머리와 같다(상자 없이 24px 제목).
// 직접 내보낸 이름(DetailHeader)이 export * 보다 먼저다.
import { type ComponentProps, type ReactNode, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { StatCard as ConsoleStatCard, type Tone } from '@pmart/web-ui/console';

import { useRecordRecent } from './recentViews';
import { StickyTitle, useScrolledPast } from './StickyTitle';
import { QueueNav } from './workQueue';

export * from '@pmart/web-ui/console';
// 라이더 시뮬레이터 모양 2단계(2026-11-21 사용자 "기능·보이는 정보·내용도 라이더시뮬레이션 UI처럼") — 검색 조건은 찾기 칸 + 깔때기 팝업 + 칩,
// 화면 설명·안내 상자는 ⓘ 로 접기. 공용과 같은 이름으로 덮는다(shared/simList.tsx).
export { GuideBox, PageHeader, SearchPanel, SearchRow, Section } from './simList';

/*
 * 라이더 시뮬레이터 모양 시범(2026-11-21 사용자 "라이더 백오피스에만 라이더 시뮬레이션 UI 적용") — 겉모양만, 글자·동작은 그대로.
 * 상태 = 작은 점 + 글자. 평상시 값(정상·완료 = success, 회색·중립)은 회색 글자, 색 글자는 문제(빨강)·주의(주황)·진행 중(파랑)에만.
 * 공용 콘솔(web/ui)은 다른 백오피스가 써서 그대로 두고 이 앱에서만 덮는다(직접 내보낸 이름이 export * 보다 먼저다). 모양은 src/sim-look.css.
 */
export function StatusText({ tone = 'ghost', children, testId }: { readonly tone?: Tone; readonly children: ReactNode; readonly testId?: string | undefined }) {
  return (
    <span className="pm-status" data-tone={tone} data-testid={testId}>
      {children}
    </span>
  );
}

export function StatusBadge(p: { readonly tone?: Tone; readonly children: ReactNode; readonly testId?: string }) {
  return <StatusText {...p} />;
}

/** 숫자 칸 — 값이 0 이면 숫자를 보조 글색으로(색은 0 이 아닐 때만). 숫자 바뀜 표시가 그대로 돌도록 값은 건드리지 않고 이름에 표시를 단다 */
export function StatCard(p: ComponentProps<typeof ConsoleStatCard>) {
  const zero = p.value === 0 || p.value === '0';
  return zero ? <ConsoleStatCard {...p} tone={undefined} label={<span data-zero="">{p.label}</span>} /> : <ConsoleStatCard {...p} />;
}

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
