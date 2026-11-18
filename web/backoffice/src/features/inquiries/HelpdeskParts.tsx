// 고객센터 화면(문의·전화 접수·후속 처리) 공통 작은 부품(2026-11-18 사용자 "밋밋하다" — 헬프데스크 도구처럼).
// 보기만 바꾸는 부품이다 — 서버 값을 고치거나 지어내지 않는다.
import type { ReactNode } from 'react';

import { messages as m } from '../../shared/messages';

/** 얇은 선 아이콘(그림 경로만 받는다) */
export const ICON = {
  inbox: 'M4 13h4l1.5 3h5L16 13h4M5 6h14l1 7v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5l1-7Z',
  chat: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  phone: 'M6 4h3l1.5 4-2 1.2a10 10 0 0 0 6.3 6.3L16 13.5l4 1.5v3a2 2 0 0 1-2 2A15 15 0 0 1 4 6a2 2 0 0 1 2-2Z',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  bag: 'M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  check: 'M5 12.5 10 17l9-10',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  shield: 'M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z',
  note: 'M6 4h9l3 3v13H6zM9 10h6M9 14h6',
  star: 'M12 4l2.5 5 5.5.8-4 3.9.9 5.5L12 16.6 7.1 19.2 8 13.7 4 9.8 9.5 9 12 4Z',
  task: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
} as const;

export function Icon({ d, className = 'h-4 w-4' }: { readonly d: string; readonly className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`${className} shrink-0 fill-none stroke-current`} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/** 빈 상태 — 아이콘 + 한 줄 안내 */
export function EmptyBox({ icon, children, hint }: { readonly icon: string; readonly children: ReactNode; readonly hint?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-base-200 text-base-content/40">
        <Icon d={icon} className="h-6 w-6" />
      </span>
      <p className="text-sm font-medium text-base-content/70">{children}</p>
      {hint && <p className="text-xs text-base-content/50">{hint}</p>}
    </div>
  );
}

/** 제목 줄이 있는 카드(오른쪽 정보 칸·폼 묶음) */
export function Card({ title, icon, aside, children, className = '', bodyClass = 'px-4 py-3.5', testId, label }: {
  readonly title?: ReactNode;
  readonly icon?: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly bodyClass?: string;
  readonly testId?: string;
  readonly label?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm ${className}`} data-testid={testId} aria-label={label}>
      {title && (
        <div className="flex items-center justify-between gap-2 border-b border-base-300 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {icon && <Icon d={icon} className="h-4 w-4 text-base-content/50" />}
            {title}
          </h2>
          {aside && <div className="flex items-center gap-2 text-xs">{aside}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

/** 옆 칸 항목 줄(이름 왼쪽 작게, 값 오른쪽) — 헬프데스크 오른쪽 정보 칸처럼 */
export function MetaList({ rows }: { readonly rows: ReadonlyArray<readonly [ReactNode, ReactNode, string?] | false | null | undefined> }) {
  return (
    <dl className="divide-y divide-base-200 text-sm">
      {rows.map((r, i) =>
        r ? (
          <div key={i} className="flex items-start justify-between gap-4 py-2 first:pt-0 last:pb-0">
            <dt className="shrink-0 text-xs text-base-content/55">{r[0]}</dt>
            <dd className="min-w-0 break-words text-right" data-testid={r[2]}>
              {r[1]}
            </dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}

/** 머리글자 동그라미 */
export function Avatar({ letter, tone = 'neutral' }: { readonly letter: string; readonly tone?: 'neutral' | 'primary' }) {
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${tone === 'primary' ? 'bg-primary text-primary-content' : 'bg-base-300 text-base-content/70'}`}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

/** 시각을 "방금·N분 전·N시간 전·N일 전"으로(보기용 — 정확한 시각은 곁에 함께 보인다) */
export function ago(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  const a = m.inquiries.ago;
  if (!Number.isFinite(min) || min < 1) return a.now;
  if (min < 60) return a.min(min);
  if (min < 60 * 24) return a.hour(Math.floor(min / 60));
  return a.day(Math.floor(min / (60 * 24)));
}
