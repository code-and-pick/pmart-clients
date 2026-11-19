// 메뉴 묶음 선 아이콘 — 통합 백오피스(web/backoffice/src/app/groupIcons.tsx)와 같은 24 격자·굵기 1.6 선(인라인 SVG, 아이콘 라이브러리 없음).
// 앱끼리 import 하지 않아 이 앱 묶음 것만 따로 둔다. 모르는 묶음은 네모 칸.
const PATHS: Readonly<Record<string, string>> = {
  dashboard: 'M4 13h6V4H4v9ZM14 20h6v-9h-6v9ZM4 20h6v-4H4v4ZM14 4v4h6V4h-6Z',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5a6 6 0 0 1 3 5.5',
  work: 'M9 4h6v3H9zM6 5.5H5a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-1M8 12.5l2.5 2.5 5-5',
  delivery: 'M2.5 6.5h11v10h-11zM13.5 10h4l3 3.5v3h-7M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  stock: 'M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3ZM4 7.5l8 4.5 8-4.5M12 12v9',
  center: 'M3 21h18M5 21V9l7-5 7 5v12M9.5 21v-6h5v6',
};
const FALLBACK = 'M5 5h14v14H5z';

export function GroupIcon({ id, className = 'h-5 w-5' }: { readonly id: string; readonly className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`fill-none stroke-current ${className}`} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[id] ?? FALLBACK} />
    </svg>
  );
}
