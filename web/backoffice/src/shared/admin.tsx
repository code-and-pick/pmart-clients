// 사본: web/rider-backoffice/src/shared/admin.tsx (PR #93, 461ff31) — 이 앱에서 따로 고친다(PC 5 요청 2026-11-18 방법 B: 공용 web/ui 로 올리지 않음).
// 운영 관리자 화면 공통 부품(2026-11-18, PC 5 — 사용자 "배민 장보기·쇼핑 관리자 가이드의 화면 구성 참고").
// 참고한 구성: 배민 주문접수 주문내역(목록 카드 + 상세 구역 상자), 셀프서비스 가게관리(밑줄 탭 + 구역 상자, 제목 오른쪽 안내).
// - 쪽 머리말: 제목 + 한 줄 설명 + 오른쪽 동작
// - 검색 조건 상자: 왼쪽 회색 항목명 칸 + 입력, 아래 [초기화][조회]
// - 결과 줄: "N건" + 최신순/과거순 토글
// - 표: 회색 머리줄, 줄 전체 누르면 상세
// - 상세: 제목·표시·요약 + 오른쪽 동작 버튼, 그 아래 구역 상자(제목 줄 + 항목명/값 줄), 구역으로 가는 밑줄 탭
import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'accent' | 'ghost';

const toneClass: Record<Tone, string> = {
  neutral: 'badge-neutral',
  info: 'badge-info',
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  accent: 'badge-accent',
  ghost: 'badge-ghost',
};

/** 상태 표시(작은 둥근 꼬리표) */
export function StatusBadge({ tone = 'ghost', children, testId }: { readonly tone?: Tone; readonly children: ReactNode; readonly testId?: string }) {
  return (
    <span className={`badge badge-sm whitespace-nowrap font-medium ${toneClass[tone]}`} data-testid={testId}>
      {children}
    </span>
  );
}

/** 쪽 머리말 — h1 은 화면마다 하나 */
export function PageHeader({ title, description, actions, back }: { readonly title: ReactNode; readonly description?: ReactNode; readonly actions?: ReactNode; readonly back?: { readonly to: string; readonly label: string } }) {
  return (
    <header className="space-y-1">
      {back && (
        <Link to={back.to} className="inline-flex items-center gap-1 text-sm text-base-content/60 hover:text-base-content">
          <span aria-hidden>‹</span>
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-base-content/60">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** 검색 조건 상자 — 줄마다 왼쪽 항목명 칸 */
export function SearchPanel({ onSubmit, onReset, children, submitLabel = '조회', resetLabel = '초기화' }: { readonly onSubmit: (e: FormEvent) => void; readonly onReset: () => void; readonly children: ReactNode; readonly submitLabel?: string; readonly resetLabel?: string }) {
  return (
    <form className="overflow-hidden rounded-box border border-base-300 bg-base-100" onSubmit={onSubmit} aria-label="검색 조건">
      <div className="divide-y divide-base-300">{children}</div>
      <div className="flex justify-center gap-2 border-t border-base-300 bg-base-200/60 px-4 py-3">
        <button type="button" className="btn btn-sm w-24 border-base-300 bg-base-100" onClick={onReset}>
          {resetLabel}
        </button>
        <button type="submit" className="btn btn-sm btn-primary w-24">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

/** 검색 조건 한 줄 */
export function SearchRow({ label, children }: { readonly label: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[9rem_1fr]">
      <div className="flex items-center bg-base-200/60 px-4 py-2 text-sm font-medium">{label}</div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">{children}</div>
    </div>
  );
}

/** 칩 모양 하나 고르기(상태·종류 등) */
export function ChipGroup<T extends string>({ value, options, onChange, label }: { readonly value: T; readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>; readonly onChange: (v: T) => void; readonly label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`btn btn-xs rounded-full px-3 ${o.value === value ? 'btn-neutral' : 'border-base-300 bg-base-100 font-normal'}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 결과 줄: 건수 + 정렬 토글 */
export function ResultBar({ count, more, sort, extra }: { readonly count: number; readonly more?: boolean; readonly sort?: { readonly oldest: boolean; readonly onChange: (oldest: boolean) => void; readonly newest?: string; readonly oldestLabel?: string }; readonly extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
      <p className="text-sm" data-testid="result-count">
        <span className="font-semibold text-primary">{count}</span>
        {more ? '건 이상' : '건'}
      </p>
      <div className="flex items-center gap-3">
        {extra}
        {sort && (
          <div role="radiogroup" aria-label="정렬" className="flex items-center gap-2 text-sm">
            <button type="button" role="radio" aria-checked={!sort.oldest} className={!sort.oldest ? 'font-semibold' : 'text-base-content/50'} onClick={() => sort.onChange(false)}>
              {sort.newest ?? '최신순'}
            </button>
            <span className="text-base-content/30">|</span>
            <button type="button" role="radio" aria-checked={sort.oldest} className={sort.oldest ? 'font-semibold' : 'text-base-content/50'} onClick={() => sort.onChange(true)}>
              {sort.oldestLabel ?? '과거순'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 표 상자 — thead 는 회색, 줄은 테두리로 나눈다 */
export function DataTable({ children, testId }: { readonly children: ReactNode; readonly testId?: string }) {
  return (
    <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100" data-testid={testId}>
      <table className="table table-sm [&_thead_th]:bg-base-200/70 [&_thead_th]:font-semibold [&_thead_th]:text-base-content/80 [&_tbody_tr]:border-base-200 [&_tbody_tr:hover]:bg-base-200/40">{children}</table>
    </div>
  );
}

/** 쪽 넘기기(커서) — 처음으로 / 다음 */
export function CursorPager({ hasPrev, nextCursor, onFirst, onNext, page }: { readonly hasPrev: boolean; readonly nextCursor: string | null | undefined; readonly onFirst: () => void; readonly onNext: (cursor: string) => void; readonly page?: number }) {
  if (!hasPrev && !nextCursor) return null;
  return (
    <nav aria-label="쪽" className="flex items-center justify-center gap-2">
      <button type="button" className="btn btn-sm border-base-300 bg-base-100" disabled={!hasPrev} onClick={onFirst}>
        « 처음으로
      </button>
      {page !== undefined && <span className="px-2 text-sm text-base-content/60">{page}쪽</span>}
      <button type="button" className="btn btn-sm border-base-300 bg-base-100" disabled={!nextCursor} onClick={() => nextCursor && onNext(nextCursor)}>
        다음 ›
      </button>
    </nav>
  );
}

/** 상세 머리: 제목 + 표시 + 요약, 오른쪽 동작 */
export function DetailHeader({ back, title, badges, summary, actions }: { readonly back: { readonly to: string; readonly label: string }; readonly title: ReactNode; readonly badges?: ReactNode; readonly summary?: ReactNode; readonly actions?: ReactNode }) {
  return (
    <header className="space-y-2">
      <Link to={back.to} className="inline-flex items-center gap-1 text-sm text-base-content/60 hover:text-base-content">
        <span aria-hidden>‹</span>
        {back.label}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-box border border-base-300 bg-base-100 px-5 py-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">{title}</h1>
            {badges}
          </div>
          {summary && <p className="text-sm text-base-content/70">{summary}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** 구역으로 가는 밑줄 탭(같은 쪽 안 이동) */
export function SectionTabs({ items }: { readonly items: ReadonlyArray<{ readonly id: string; readonly label: string }> }) {
  return (
    <nav aria-label="구역" className="sticky top-0 z-10 -mx-1 flex gap-1 overflow-x-auto border-b border-base-300 bg-base-200/95 px-1 backdrop-blur">
      {items.map((i) => (
        <a key={i.id} href={`#${i.id}`} className="whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-base-content/70 hover:border-base-content/40 hover:text-base-content">
          {i.label}
        </a>
      ))}
    </nav>
  );
}

/** 구역 상자 — 제목 줄(오른쪽 덧붙임) + 내용 */
export function Section({ id, title, aside, children, testId }: { readonly id?: string; readonly title: ReactNode; readonly aside?: ReactNode; readonly children: ReactNode; readonly testId?: string }) {
  return (
    <section id={id} className="scroll-mt-12 overflow-hidden rounded-box border border-base-300 bg-base-100" data-testid={testId}>
      <div className="flex items-center justify-between gap-2 border-b border-base-300 px-5 py-3">
        <h2 className="font-bold">{title}</h2>
        {aside && <div className="flex items-center gap-2 text-sm">{aside}</div>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/** 항목명/값 줄 묶음 */
export function FieldList({ rows, testId }: { readonly rows: ReadonlyArray<readonly [ReactNode, ReactNode] | false | null | undefined>; readonly testId?: string }) {
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2.5 text-sm" data-testid={testId}>
      {rows.map((r, i) =>
        r ? (
          <div key={i} className="contents">
            <dt className="text-base-content/55">{r[0]}</dt>
            <dd className="min-w-0 break-words">{r[1]}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}

/** 통계 카드 */
export function StatCard({ label, value, hint, to, tone, testId }: { readonly label: ReactNode; readonly value: ReactNode; readonly hint?: ReactNode; readonly to?: string; readonly tone?: 'warning' | 'error'; readonly testId?: string }) {
  const body = (
    <>
      <p className="text-sm text-base-content/60">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone === 'error' ? 'text-error' : tone === 'warning' ? 'text-warning' : ''}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-base-content/50">{hint}</p>}
    </>
  );
  const cls = 'block rounded-box border border-base-300 bg-base-100 px-5 py-4';
  return to ? (
    <Link to={to} className={`${cls} hover:border-primary`} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className={cls} data-testid={testId}>
      {body}
    </div>
  );
}

/** 안내 상자(회색) — 화면 맨 위 설명·서버 대기 안내 */
export function Notice({ children, tone = 'muted' }: { readonly children: ReactNode; readonly tone?: 'muted' | 'warning' }) {
  return (
    <p role="note" className={`rounded-box px-4 py-3 text-sm ${tone === 'warning' ? 'bg-warning/15' : 'bg-base-300/50 text-base-content/75'}`}>
      {children}
    </p>
  );
}
