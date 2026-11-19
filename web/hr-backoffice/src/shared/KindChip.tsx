// 종류 꼬리표(아이콘 + 이름, 2026-11-19 — 백오피스 KindChip 과 같은 모양). 고용 형태·소속 종류처럼 "무엇인지"를 한눈에.
import type { ReactNode } from 'react';

const ICON = {
  regular: 'M4 7h16v12H4zM9 7V5h6v2',
  part: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  daily: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4',
  hq: 'M4 21V5l8-2 8 2v16M9 21v-5h6v5M8 9h2m4 0h2M8 13h2m4 0h2',
  center: 'M3 9.5 12 4l9 5.5V20H3V9.5ZM7 20v-7h10v7',
  role: 'M12 3 4 6v6c0 4.5 3.4 8.4 8 9 4.6-.6 8-4.5 8-9V6l-8-3Z',
} as const;
export type ChipIcon = keyof typeof ICON;

export function KindChip({ icon, children, testId }: { readonly icon: ChipIcon; readonly children: ReactNode; readonly testId?: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-base-300 bg-base-200/50 px-1.5 py-0.5 text-xs text-base-content/80" data-testid={testId}>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 fill-none stroke-current opacity-70" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={ICON[icon]} />
      </svg>
      {children}
    </span>
  );
}
