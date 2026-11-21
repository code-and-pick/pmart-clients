// 메뉴·머리줄 선 아이콘(2026-11-19 — 카페24 관리자처럼 묶음마다 아이콘). 색은 currentColor(테마 따라), 그림 파일·라이브러리 없이 SVG 로.
import type { ReactNode } from 'react';

export type IconName = 'home' | 'radar' | 'rider' | 'truck' | 'headset' | 'won' | 'megaphone' | 'search' | 'collapse' | 'expand' | 'external' | 'clock' | 'list' | 'alert' | 'card' | 'shield';

const paths: Record<IconName, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  radar: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 12 19 5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  rider: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </>
  ),
  truck: (
    <>
      <path d="M2 6h12v10H2z" />
      <path d="M14 10h4l4 4v2h-8z" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
  headset: (
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <path d="M4 14h3v6H5a1 1 0 0 1-1-1zM20 14h-3v6h2a1 1 0 0 0 1-1z" />
    </>
  ),
  won: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M7 9l2 7 3-6 3 6 2-7M6.5 12h11" />
    </>
  ),
  megaphone: (
    <>
      <path d="M3 10v4h3l7 4V6L6 10z" />
      <path d="M17 9a4 4 0 0 1 0 6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  collapse: <path d="M11 6 5 12l6 6M19 6l-6 6 6 6" />,
  expand: <path d="M13 6l6 6-6 6M5 6l6 6-6 6" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  alert: (
    <>
      <path d="M12 3 2 20h20z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
    </>
  ),
  shield: <path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
};

export function Icon({ name, className = 'h-5 w-5' }: { readonly name: IconName; readonly className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {paths[name]}
    </svg>
  );
}
