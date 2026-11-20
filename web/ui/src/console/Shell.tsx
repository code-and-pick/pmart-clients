// 공용 @pmart/web-ui/console(2026-11-20) — 직원 웹 화면 틀(AWS 콘솔 모양, 백오피스 App.tsx 틀을 본뜸).
// 맨 위 전체 폭 흰 머리줄(로고 · 앱 도구) → 그 아래 흰 왼쪽 메뉴(접기) | 위치 줄(묶음 / 메뉴) + 본문.
// 앱은 메뉴 묶음·항목과 머리줄 도구만 넘긴다. 시험이 찾는 이름표: side-menu(data-collapsed)·nav-group-<id>·nav-rail-<testId>·page-title.
import { type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';

export interface ConsoleNavItem {
  readonly to: string;
  readonly label: string;
  /** 접은 메뉴 아이콘(SVG path d, 24×24 선) */
  readonly icon?: string;
  /** 이 주소에서만 켜짐(아래 주소에서는 안 켜짐) */
  readonly end?: boolean;
  /** 메뉴 옆 숫자 칩 등 */
  readonly badge?: ReactNode;
  /** nav-rail-<testId> */
  readonly testId?: string;
  /** 접은 메뉴 아이콘을 요소로(앱 아이콘 부품) — 있으면 icon 보다 먼저 */
  readonly iconNode?: ReactNode;
}
export interface ConsoleNavGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly ConsoleNavItem[];
  /** 묶음 아이콘(요소) — 펼친 메뉴 묶음 제목 옆, rail='groups' 의 접은 메뉴 */
  readonly icon?: ReactNode;
}

const railSvg = (d: string | undefined) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d ?? 'M4 6h16M4 12h16M4 18h16'} />
  </svg>
);

export function ConsoleShell({
  title,
  homeLabel,
  tools,
  groups,
  collapsed,
  onToggleMenu,
  expandLabel,
  collapseLabel,
  navLabel = '메뉴',
  rail = 'items',
  activePath,
  location,
  locationAside,
  banner,
  menuFooter,
  children,
}: {
  readonly title: string;
  readonly homeLabel: string;
  /** 머리줄 오른쪽(시계·찾기·테마·내 세션·앱 바꾸기 등) */
  readonly tools: ReactNode;
  readonly groups: readonly ConsoleNavGroup[];
  readonly collapsed: boolean;
  /** 없으면 접기 단추를 그리지 않는다(접지 않는 앱) */
  readonly onToggleMenu?: (() => void) | undefined;
  readonly expandLabel?: string;
  readonly collapseLabel?: string;
  /** 메뉴 nav 이름(읽기 도구·시험) */
  readonly navLabel?: string;
  /** 접은 메뉴: items = 메뉴마다 아이콘(기본), groups = 묶음마다 아이콘 하나(그 묶음 첫 메뉴로) */
  readonly rail?: 'items' | 'groups';
  /** 지금 주소(rail='groups' 에서 켜진 묶음을 고를 때) */
  readonly activePath?: string;
  /** 위치 줄 — 보통 ConsoleBreadcrumb */
  readonly location?: ReactNode;
  /** 위치 줄 오른쪽(역할 꼬리표·도움말) */
  readonly locationAside?: ReactNode;
  /** 본문 위 띠(인터넷 끊김 등) */
  readonly banner?: ReactNode;
  /** 펼친 메뉴 맨 아래(보는 법 등) */
  readonly menuFooter?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-base-200">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-base-300 bg-base-100 px-4">
        <Link to="/" className="flex shrink-0 items-center gap-2 font-bold text-base-content" aria-label={homeLabel}>
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-accent text-xs text-accent-content" aria-hidden="true">
            P
          </span>
          <span className="truncate text-[15px]">{title}</span>
        </Link>
        <div className="ml-auto flex items-center gap-2 text-sm">{tools}</div>
      </header>
      <div className="flex min-w-0 flex-1">
        <aside className={`sticky top-0 flex h-screen shrink-0 flex-col self-start overflow-y-auto border-r border-base-300 bg-base-100 pb-11 text-base-content transition-[width] ${collapsed ? 'w-20' : 'w-[220px]'}`} data-testid="side-menu" data-collapsed={collapsed}>
          <div className={`flex h-10 shrink-0 items-center ${collapsed ? 'justify-center px-1' : 'justify-end px-2'}`}>
            {onToggleMenu && (
              <button type="button" className="btn btn-ghost btn-sm h-8 w-8 p-0 text-base-content/70" onClick={onToggleMenu} aria-label={collapsed ? expandLabel : collapseLabel} title={collapsed ? expandLabel : collapseLabel}>
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {collapsed ? <path d="m9 6 6 6-6 6M4 4v16" /> : <path d="m15 6-6 6 6 6M20 4v16" />}
                </svg>
              </button>
            )}
          </div>
          {/* 메뉴 nav 는 접어도 같은 요소(펼침·접음은 안의 내용만 바뀐다) */}
          <nav aria-label={navLabel} className={collapsed ? 'flex flex-1 flex-col items-center gap-1 py-2' : 'flex-1 pb-3'}>
            {collapsed
              ? rail === 'groups'
                ? groups.map((g) => {
                    const first = g.items[0];
                    if (!first) return null;
                    const active = g.items.some((it) => it.to === activePath || (activePath ?? '').startsWith(`${it.to}/`));
                    return (
                      <Link
                        key={g.id}
                        to={first.to}
                        aria-label={g.label || first.label}
                        title={g.label || first.label}
                        className={`flex w-16 flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] transition-colors ${active ? 'bg-primary/10 font-semibold text-primary' : 'text-base-content/70 hover:bg-base-200 hover:text-base-content'}`}
                        data-testid={`nav-rail-${g.id}`}
                      >
                        {g.icon ?? railSvg(first.icon)}
                        <span aria-hidden="true" className="line-clamp-2 break-keep text-center">
                          {g.label || first.label}
                        </span>
                      </Link>
                    );
                  })
                : groups.flatMap((g) => g.items).map((it) => (
                    <NavLink
                      key={it.to}
                      to={it.to}
                      end={it.end ?? true}
                      aria-label={it.label}
                      title={it.label}
                      className={({ isActive }) => `flex w-16 flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] transition-colors ${isActive ? 'bg-primary/10 font-semibold text-primary' : 'text-base-content/70 hover:bg-base-200 hover:text-base-content'}`}
                      {...(it.testId ? { 'data-testid': `nav-rail-${it.testId}` } : {})}
                    >
                      {it.iconNode ?? railSvg(it.icon)}
                      <span aria-hidden="true" className="line-clamp-2 break-keep text-center">
                        {it.label}
                      </span>
                      {it.badge && <span className="empty:hidden">{it.badge}</span>}
                    </NavLink>
                  ))
              : groups.map((g) => (
                  <div key={g.id} className="mb-2" data-testid={`nav-group-${g.id}`}>
                    {/* 이름 없는 묶음(홈 등)은 제목 없이 */}
                    {g.label && (
                      <p className="flex items-center gap-2 px-4 py-[5px] text-sm font-bold text-base-content">
                        {g.icon && <span className="text-base-content/60 [&_svg]:h-4 [&_svg]:w-4">{g.icon}</span>}
                        <span data-group-label>{g.label}</span>
                      </p>
                    )}
                    <ul>
                      {g.items.map((it) => (
                        <li key={it.to}>
                          <NavLink
                            to={it.to}
                            end={it.end ?? true}
                            className={({ isActive }) => `flex items-center justify-between gap-2 py-[5px] ${g.label ? 'pl-7' : 'pl-4 font-bold'} pr-4 text-sm transition-colors ${isActive ? 'font-semibold text-primary' : g.label ? 'text-base-content/80 hover:text-primary' : 'text-base-content hover:text-primary'}`}
                          >
                            <span className="truncate">{it.label}</span>
                            {it.badge}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
          </nav>
          {!collapsed && menuFooter}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-3 px-6">
            {location}
            {locationAside && <div className="ml-auto flex items-center gap-2">{locationAside}</div>}
          </div>
          {banner}
          <main className="min-w-0 flex-1 px-6 pb-6 pt-1">{children}</main>
        </div>
      </div>
    </div>
  );
}

/** 위치 줄(AWS 빵부스러기) — "묶음 / 지금 메뉴". 묶음은 링크(그 묶음 첫 화면), 지금 메뉴는 굵게. data-testid="page-title" */
export function ConsoleBreadcrumb({ group, current }: { readonly group?: { readonly label: string; readonly to: string } | undefined; readonly current?: string | undefined }) {
  return (
    <nav aria-label="위치" className="min-w-0 truncate text-sm text-base-content/70" data-testid="page-title">
      {group && (
        <>
          <Link to={group.to} className="underline-offset-2 hover:text-primary hover:underline">
            {group.label}
          </Link>
          {current && <span className="px-1.5 text-base-content/40">/</span>}
        </>
      )}
      {current && <span className="font-semibold text-base-content">{current}</span>}
    </nav>
  );
}
