// 접힌 메뉴(2026-11-19 사용자 "전체 UI·UX 를 관제 화면 형식으로" — 왼쪽 아이콘 + 글자 세로 칸).
// 묶음을 누르면 오른쪽에 하위 메뉴 판이 열린다(알림 배지 포함). 판은 다른 곳을 누르거나 Esc·화면 이동으로 닫힌다.
// 묶음 칸의 합계 배지는 펼친 메뉴와 같은 부품(색별 — 파랑 할 일·빨강 기한 지남).
// 2026-11-20 AWS 개편 2단계(ADR-0004): 흰 메뉴 — 지금 칸은 연한 파랑 바탕 + 파랑 글자, 판은 흰 상자 + 1px 테두리.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink } from 'react-router';

import { GroupAlertBadge, MenuItemAlerts } from './MenuAlerts';
import { GroupIcon } from './groupIcons';
import { covers, type NavGroup } from './nav';
import { messages as m } from '../shared/messages';

const cell = (active: boolean) =>
  `relative flex w-16 flex-col items-center gap-1 rounded px-1 py-2 text-[10.5px] font-medium leading-tight transition-colors ${active ? 'bg-primary/10 font-semibold text-primary' : 'text-base-content/75 hover:bg-base-200 hover:text-base-content'}`;

export function NavRail({ groups, pathname, showDashboard }: { readonly groups: readonly NavGroup[]; readonly pathname: string; readonly showDashboard: boolean }) {
  const [open, setOpen] = useState<{ id: string; top: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // 화면이 바뀌면 판을 닫는다
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) {
    setSeen(pathname);
    setOpen(null);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || (t instanceof Element && t.closest('[data-rail-group]'))) return;
      setOpen(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const openGroup = open ? groups.find((g) => g.id === open.id) : undefined;
  return (
    <>
      <nav aria-label="메뉴" className="flex flex-1 flex-col items-center gap-1 py-3">
        {showDashboard && (
          <NavLink to="/" end aria-label={m.dashboard.title} title={m.dashboard.title} className={({ isActive }) => cell(isActive)} data-testid="nav-dashboard">
            <GroupIcon id="dashboard" className="h-5 w-5" />
            <span aria-hidden="true">{m.dashboard.title}</span>
          </NavLink>
        )}
        {groups.map((g) => {
          const active = g.items.some((i) => covers(i, pathname));
          const isOpen = open?.id === g.id;
          return (
            <button
              key={g.id}
              type="button"
              aria-label={g.label}
              title={g.label}
              aria-expanded={isOpen}
              aria-haspopup="menu"
              data-rail-group={g.id}
              className={`${cell(active || isOpen)} ${isOpen ? 'ring-1 ring-primary/50' : ''}`}
              data-testid={`nav-rail-${g.id}`}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setOpen(isOpen ? null : { id: g.id, top: r.top });
              }}
            >
              <GroupIcon id={g.id} className="h-5 w-5" />
              <span aria-hidden="true" className="line-clamp-2 break-keep text-center">
                {g.label}
              </span>
              {/* 알림은 글자 아래 줄(글자를 덮지 않게) — 없으면 줄도 없음 */}
              <span className="empty:hidden">
                <GroupAlertBadge items={g.items} />
              </span>
            </button>
          );
        })}
      </nav>
      {/* 판은 body 에 바로 그린다 — 메뉴(sticky) 안에 두면 본문 아래에 깔린다 */}
      {openGroup && open && createPortal(
        <div
          ref={panel}
          role="menu"
          aria-label={openGroup.label}
          className="fixed left-20 z-50 ml-1 w-60 overflow-hidden rounded-box border border-base-300 bg-base-100 text-base-content shadow-lg"
          style={{ top: Math.max(8, Math.min(open.top, window.innerHeight - 48 * (openGroup.items.length + 1) - 16)) }}
          data-testid="nav-rail-panel"
        >
          <p className="flex items-center gap-2 border-b border-base-300 px-4 py-2.5 text-sm font-bold">
            <GroupIcon id={openGroup.id} className="h-4 w-4" />
            {openGroup.label}
          </p>
          <ul className="py-1">
            {openGroup.items.map((item) => {
              const active = covers(item, pathname);
              return (
                <li key={item.to}>
                  <Link
                    role="menuitem"
                    to={item.to}
                    aria-current={active ? 'page' : undefined}
                    className={`mx-1 flex items-center gap-2 rounded px-3 py-[5px] text-sm ${active ? 'font-semibold text-primary' : 'text-base-content/85 hover:text-primary'}`}
                  >
                    {item.label}
                    <MenuItemAlerts to={item.to} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}
