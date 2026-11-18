// 메뉴 묶음 선 아이콘(2026-11-18 사용자 — "앱 런처처럼, 지금 UI 가 밋밋해서"). 홈 타일·앱 바꾸기 "이 앱 메뉴" 칸이 같이 쓴다.
// 24 격자·굵기 1.6 선 — 인라인 SVG(새 아이콘 라이브러리 없음). 모르는 묶음은 네모 칸.
const PATHS: Readonly<Record<string, string>> = {
  catalog: 'M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3ZM4 7.5l8 4.5 8-4.5M12 12v9',
  approval: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.5 12.5l2.5 2.5 4.5-5',
  lookup: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM16 16l4.5 4.5',
  cs: 'M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v5H5a1 1 0 0 1-1-1v-4ZM20 14h-3v5h2a1 1 0 0 0 1-1v-4Z',
  riderOps: 'M2.5 6.5h11v10h-11zM13.5 10h4l3 3.5v3h-7M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  support: 'M6 16v-5a6 6 0 1 1 12 0v5l2 2H4l2-2ZM10 21h4',
  pending: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3 2',
  audit: 'M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3ZM9 12l2 2 4-4',
  assistant: 'M4 5h16v11H8l-4 4V5ZM8 9.5h8M8 12.5h5',
};
const FALLBACK = 'M5 5h14v14H5z';

export function GroupIcon({ id, className = 'h-6 w-6' }: { readonly id: string; readonly className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`fill-none stroke-current ${className}`} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[id] ?? FALLBACK} />
    </svg>
  );
}
