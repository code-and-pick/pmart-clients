// 왼쪽 메뉴 접기(사용자 2026-11-21 "좁은 화면에서도 메뉴 접히게") — 공용 틀 ConsoleShell 의 collapsed·onToggleMenu 를 쓴다(공용 틀은 고치지 않음).
// 고른 값은 이 브라우저에만(보는 사람 한 명의 편의 — 서버 상태 아님). 고른 적이 없으면 화면 폭으로: 1024px 보다 좁으면 접고,
// 창 폭이 바뀌면 따라간다. 단추로 한 번 고르면 그 뒤로는 고른 대로.
import { useEffect, useState } from 'react';

const KEY = 'pmart.cdc-backoffice.menu';
const NARROW = '(max-width: 1023px)';

function saved(): boolean | null {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === 'collapsed') return true;
    if (v === 'open') return false;
  } catch {
    /* 저장이 막힌 브라우저 — 폭으로 */
  }
  return null;
}

const narrow = () => typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches;

export function useMenuCollapsed(): readonly [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => saved() ?? narrow());
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(NARROW);
    const follow = (e: MediaQueryListEvent) => {
      if (saved() === null) setCollapsed(e.matches);
    };
    mq.addEventListener('change', follow);
    return () => mq.removeEventListener('change', follow);
  }, []);
  const toggle = () => {
    const next = !collapsed;
    try {
      window.localStorage.setItem(KEY, next ? 'collapsed' : 'open');
    } catch {
      /* 기억만 못 할 뿐 접기·펴기는 된다 */
    }
    setCollapsed(next);
  };
  return [collapsed, toggle];
}

const path = (d: string) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** 접었을 때 묶음 아이콘(얇은 선) */
export const groupIcon: Readonly<Record<string, ReturnType<typeof path>>> = {
  overview: path('M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z'),
  outbound: path('M2 6h11v10H2zM13 10h4l4 4v2h-8M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'),
  stock: path('M3 7l9-4 9 4-9 4-9-4ZM3 7v10l9 4 9-4V7M12 11v10'),
  people: path('M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3'),
};
