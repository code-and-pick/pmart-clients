// 상품·가격·콘텐츠·취급 화면이 같이 쓰는 작은 화면 부품(2026-11-18 사용자 "밋밋하다 — Shopify·Medusa 관리자처럼").
// 동작은 없고 모양만 — 카드(제목·안내·오른쪽 덧붙임), 단계 표시, 빈 상태, 상대 시각.
import { type ReactNode, useState } from 'react';

import { messages as m } from '../../shared/messages';

/** 제목 줄이 있는 카드. 폼 묶음·오른쪽 요약 카드에 쓴다. */
export function Card({ title, hint, aside, children, footer, testId, label, id, className = '' }: { readonly title?: ReactNode; readonly hint?: ReactNode; readonly aside?: ReactNode; readonly children: ReactNode; readonly footer?: ReactNode; readonly testId?: string; readonly label?: string; readonly id?: string; readonly className?: string }) {
  // 2026-11-20 AWS 개편: 제목 왼쪽 ∨ 로 구역 접기(처음엔 펼침). 접어도 입력값은 그대로(숨기기만)
  const [open, setOpen] = useState(true);
  return (
    // 2026-11-20 AWS 개편(Container): 머리 아래 선·그림자 없이 20px 굵은 제목, 바닥 단추 줄도 회색 띠 없이
    <section id={id} className={`scroll-mt-4 rounded-box border border-base-300 bg-base-100 ${className}`} data-testid={testId} aria-label={label}>
      {(title || aside) && (
        <div className="flex flex-wrap items-start justify-between gap-2 px-5 pb-1 pt-4">
          <div className="min-w-0 space-y-0.5">
            {title && (
              <h2 className="flex items-center gap-1.5 text-lg font-bold">
                <button type="button" className="grid h-6 w-6 place-items-center rounded hover:bg-base-200" aria-expanded={open} aria-label={open ? m.products.collapse : m.products.expand} onClick={() => setOpen((o) => !o)}>
                  <svg viewBox="0 0 24 24" className={`h-4 w-4 fill-none stroke-current transition-transform ${open ? '' : '-rotate-90'}`} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {title}
              </h2>
            )}
            {hint && <p className="text-sm text-base-content/65">{hint}</p>}
          </div>
          {aside && <div className="flex flex-wrap items-center gap-2 text-sm">{aside}</div>}
        </div>
      )}
      <div className="space-y-4 px-5 pb-5 pt-3" hidden={!open}>{children}</div>
      {footer && open && <div className="flex flex-wrap items-center justify-end gap-2 px-5 pb-5">{footer}</div>}
    </section>
  );
}

/** 단계 표시(① → ② → ③) — now = 지금 단계(0부터) */
export function Steps({ steps, now, label = m.products.stepsLabel }: { readonly steps: readonly string[]; readonly now: number; readonly label?: string }) {
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label={label}>
      {steps.map((st, i) => (
        <li key={st} className="flex items-center gap-1">
          <span className={`relative flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${i < now ? 'bg-success text-white' : i === now ? 'bg-primary text-primary-content' : 'bg-base-200 text-base-content/50'}`}>
            {/* 진행 중 표시(2026-11-19) — 지금 단계에서만 */}
            {i === now && <span className="step-pulse text-primary" aria-hidden="true" data-testid="step-pulse" />}
            {i < now ? <svg viewBox="0 0 24 24" className="h-3 w-3 fill-none stroke-current" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-testid="step-check"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg> : i + 1}
          </span>
          <span className={i <= now ? 'font-medium' : 'text-base-content/50'}>{st}</span>
          {i < steps.length - 1 && <span className="px-1 text-base-content/30">→</span>}
        </li>
      ))}
    </ol>
  );
}

const ICON: Readonly<Record<'box' | 'tag' | 'store' | 'image' | 'search', string>> = {
  box: 'M4 8l8-4 8 4-8 4-8-4Zm0 0v8l8 4 8-4V8m-8 4v8',
  tag: 'M4 12l8-8h8v8l-8 8-8-8Zm11-4h.01',
  store: 'M4 9l1.5-5h13L20 9M4 9h16M4 9v11h16V9M9 20v-6h6v6',
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 2-4-4',
};

export function LineIcon({ name, className = 'h-5 w-5' }: { readonly name: keyof typeof ICON; readonly className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`${className} fill-none stroke-current`} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d={ICON[name]} />
    </svg>
  );
}

/** 빈 상태·처음 상태 — 아이콘 + 한 줄 안내 */
export function EmptyState({ icon, children }: { readonly icon: keyof typeof ICON; readonly children: ReactNode }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 py-8 text-center text-sm text-base-content/55">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-base-200 text-base-content/40">
        <LineIcon name={icon} className="h-6 w-6" />
      </span>
      {children}
    </div>
  );
}

/** 숫자 카드(작은) */
export function MiniStat({ label, value, tone, testId }: { readonly label: ReactNode; readonly value: ReactNode; readonly tone?: 'success' | 'error' | 'warning' | 'muted'; readonly testId?: string }) {
  const color = tone === 'success' ? 'text-success' : tone === 'error' ? 'text-error' : tone === 'warning' ? 'text-warning' : tone === 'muted' ? 'text-base-content/50' : '';
  return (
    <div className="rounded-box border border-base-300 bg-base-100 px-4 py-3 shadow-sm" data-testid={testId}>
      <p className="text-xs text-base-content/55">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

/** 시각을 "방금·N분 전·N시간 전·N일 전"으로(보기용 — 정확한 시각은 함께 보인다) */
export function ago(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(min) || min < 1) return m.approvals.ago.now;
  if (min < 60) return m.approvals.ago.min(min);
  if (min < 60 * 24) return m.approvals.ago.hour(Math.floor(min / 60));
  return m.approvals.ago.day(Math.floor(min / (60 * 24)));
}

/** 밑줄 탭 한 줄(URL 필터용) */
export function UnderlineTabs<T extends string>({ value, options, onChange, label }: { readonly value: T; readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>; readonly onChange: (v: T) => void; readonly label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-base-300 px-3">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value || 'all'}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${on ? 'border-primary font-semibold text-base-content' : 'border-transparent text-base-content/55 hover:text-base-content'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 제목 = 사람이 읽는 이름 + 옆에 작은 ID(2026-11-18 사용자 "직관적이지 않다" — 제목이 ID 뿐이면 무엇인지 모른다) */
export function TitleWithId({ title, id, testId = 'title-id' }: { readonly title: ReactNode; readonly id: string; readonly testId?: string }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span>{title}</span>{' '}
      <span className="font-mono text-sm font-normal text-base-content/50" data-testid={testId}>
        {id}
      </span>
    </span>
  );
}

/** 다음 할 일 카드의 바로 가기 — 같은 쪽 안 구역으로 내려간다(새 동작 없음) */
export function JumpLink({ to, children }: { readonly to: string; readonly children: ReactNode }) {
  return (
    <a href={`#${to}`} className="btn btn-sm btn-primary">
      {children}
    </a>
  );
}

/** 표 공통 클래스(카드 안 표 — 바깥 테두리 없음) */
export const tableClass =
  'table [&_tbody_tr:hover]:bg-base-200/60 [&_tbody_tr]:border-base-300/70 [&_tbody_td]:py-3 [&_thead_th]:bg-base-200/50 [&_thead_th]:text-xs [&_thead_th]:font-medium [&_thead_th]:text-base-content/50';
