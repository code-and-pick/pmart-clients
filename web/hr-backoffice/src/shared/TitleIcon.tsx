// 구역 제목 아이콘(2026-11-19 — 백오피스 구역 제목처럼 "무슨 구역인지" 아이콘으로).
const PATH = {
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  key: 'M15 7a4 4 0 1 1-3.8 5.3L4 19.5V16h3v-3h3l1.2-1.2A4 4 0 0 1 15 7Z',
  shield: 'M12 3 4 6v6c0 4.5 3.4 8.4 8 9 4.6-.6 8-4.5 8-9V6l-8-3Z',
  briefcase: 'M4 7h16v12H4zM9 7V5h6v2M4 12h16',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
} as const;
export type TitleIconName = keyof typeof PATH;

export function TitleIcon({ name }: { readonly name: TitleIconName }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d={PATH[name]} />
      </svg>
    </span>
  );
}
