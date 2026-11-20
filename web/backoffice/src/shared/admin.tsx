// 사본: web/rider-backoffice/src/shared/admin.tsx (PR #93, 461ff31) — 이 앱에서 따로 고친다(PC 5 요청 2026-11-18 방법 B: 공용 web/ui 로 올리지 않음).
// 운영 관리자 화면 공통 부품(2026-11-18, PC 5 — 사용자 "배민 장보기·쇼핑 관리자 가이드의 화면 구성 참고").
// 참고한 구성: 배민 주문접수 주문내역(목록 카드 + 상세 구역 상자), 셀프서비스 가게관리(밑줄 탭 + 구역 상자, 제목 오른쪽 안내).
// - 쪽 머리말: 제목 + 한 줄 설명 + 오른쪽 동작
// - 검색 조건 상자: 왼쪽 회색 항목명 칸 + 입력, 아래 [초기화][조회]
// - 결과 줄: "N건" + 최신순/과거순 토글
// - 표: 회색 머리줄, 줄 전체 누르면 상세
// - 상세: 제목·표시·요약 + 오른쪽 동작 버튼, 그 아래 구역 상자(제목 줄 + 항목명/값 줄), 구역으로 가는 밑줄 탭
// 목록 부품 SearchPanel·StatStrip·GuideBox·AllDone 는 공용(@pmart/web-ui listParts, 2026-11-19)으로 옮김 — 이 파일에서 그대로 가져다 쓰게 다시 내보낸다
// SearchPanel 은 2026-11-20 AWS 개편 때 이 앱 사본으로(아래) — 공용 web/ui 는 그대로(다른 앱이 씀)
export { StatStrip, GuideBox, AllDone } from '@pmart/web-ui';
import { StickyTitle, useScrolledPast } from './StickyTitle';
import { useStatChange } from './motion';
import { type FormEvent, type ReactNode, useId, useRef, useState } from 'react';

import { formatSeoul } from '@pmart/web-ui';
import { messages as lm } from './messages';
import { WidgetMenuButton } from './WidgetMenu';
import { TableSettings } from './TableSettings';
import { Link, useNavigate } from 'react-router';


export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'accent' | 'ghost';


/** 상태 표시 — 2026-11-20 AWS 개편: 둥근 꼬리표 대신 아이콘 + 색 글자(StatusText 와 같은 모양, 모든 화면에 한 번에) */
export function StatusBadge({ tone = 'ghost', children, testId }: { readonly tone?: Tone; readonly children: ReactNode; readonly testId?: string }) {
  return (
    <StatusText tone={tone} testId={testId}>
      {children}
    </StatusText>
  );
}

/**
 * 목록 줄 전체를 누르면 상세로(2026-11-18 사용자 작업 따라 해 보기 — "굵은 제목은 안 눌리고 작은 번호만 눌린다").
 * 줄 안의 링크·버튼·입력·체크박스를 누르면 그쪽 동작만. 키보드는 줄 안의 링크(번호)로 그대로 간다.
 */
export function useRowLink() {
  const navigate = useNavigate();
  return (to: string) => ({
    className: 'cursor-pointer',
    onClick: (e: { readonly target: EventTarget | null }) => {
      if (e.target instanceof Element && e.target.closest('a,button,input,select,textarea,label,summary')) return;
      void navigate(to);
    },
  });
}

/** 쪽 머리말 — h1 은 화면마다 하나. 2026-11-20 AWS 개편: 아이콘 타일 없이 24px 굵은 제목 + 오른쪽 동작 */
export function PageHeader({ title, actions, back }: { readonly title: ReactNode; readonly actions?: ReactNode; readonly back?: { readonly to: string; readonly label: string } }) {
  return (
    <header className="space-y-1">
      {back && (
        <Link to={back.to} className="inline-flex items-center gap-1 text-sm text-base-content/70 underline underline-offset-2 hover:text-primary">
          <span aria-hidden>‹</span>
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="min-w-0 text-2xl font-bold">{title}</h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}


/** 검색 조건 한 줄 */
export function SearchRow({ label, children }: { readonly label: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="text-sm font-semibold text-base-content/85">{label}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** 하나 고르기(상태·종류 등) — 2026-11-20 AWS 개편: 붙은 단추 줄(Segmented control), 고른 칸은 파랑. count 는 서버가 센 값만 */
export function ChipGroup<T extends string>({ value, options, onChange, label }: { readonly value: T; readonly options: ReadonlyArray<{ readonly value: T; readonly label: string; readonly count?: string | undefined }>; readonly onChange: (v: T) => void; readonly label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap overflow-hidden rounded-field border border-base-content/40">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={`px-3 py-1 text-sm transition-colors ${i > 0 ? 'border-l border-base-content/25' : ''} ${on ? 'bg-primary font-semibold text-primary-content' : 'bg-base-100 hover:bg-base-200'}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={`ml-1 tabular-nums ${on ? 'opacity-80' : 'text-base-content/50'}`} aria-hidden="true" data-testid={`chip-count-${o.value}`}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** 결과 줄: 건수 + 정렬 토글 — 2026-11-20 AWS 개편: 흰 상자 안 얇은 줄 */
export function ResultBar({ count, more, sort, extra }: { readonly count: number; readonly more?: boolean; readonly sort?: { readonly oldest: boolean; readonly onChange: (oldest: boolean) => void; readonly newest?: string; readonly oldestLabel?: string }; readonly extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-box border border-base-300 bg-base-100 px-5 py-2" data-list-part="mid">
      <p className="text-sm text-base-content/70" data-testid="result-count">
        <span className="font-bold text-base-content">{count}</span>
        {more ? '건 이상' : '건'}
      </p>
      <div className="flex items-center gap-3">
        {extra}
        {sort && (
          <div role="radiogroup" aria-label="정렬" className="flex items-center gap-2 text-sm">
            <button type="button" role="radio" aria-checked={!sort.oldest} className={!sort.oldest ? 'font-bold text-primary' : 'text-base-content/60 hover:text-primary'} onClick={() => sort.onChange(false)}>
              {sort.newest ?? '최신순'}
            </button>
            <span className="text-base-content/30">|</span>
            <button type="button" role="radio" aria-checked={sort.oldest} className={sort.oldest ? 'font-bold text-primary' : 'text-base-content/60 hover:text-primary'} onClick={() => sort.onChange(true)}>
              {sort.oldestLabel ?? '과거순'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 표 상자 — 2026-11-20 AWS 개편: 흰 상자 + 1px, 머리·줄은 index.css 토큰, 첫 칸 링크는 점선 밑줄(이름), 다른 링크는 파랑 */
export function DataTable({ children, testId, settingsKey }: { readonly children: ReactNode; readonly testId?: string; readonly settingsKey?: string }) {
  // 표 설정 톱니(settingsKey 를 주면) — 표 오른쪽 위, 칸 켜고 끄기·줄 바꿈(이 브라우저에만)
  const tid = `tbl-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  return (
    <div className="relative overflow-x-auto rounded-box border border-base-300 bg-base-100" data-testid={testId} data-list-part="table">
      {settingsKey && (
        <div className="absolute right-1 top-1 z-10">
          <TableSettings storeKey={settingsKey} tableId={tid} />
        </div>
      )}
      <table id={tid} className="table [&_tbody_td:first-child]:font-medium [&_tbody_tr:hover]:bg-base-200/60 [&_td_a.link]:text-primary [&_td_a.link]:no-underline [&_td_a.link:hover]:underline [&_tbody_td:first-child_a]:text-base-content [&_tbody_td:first-child_a]:underline [&_tbody_td:first-child_a]:decoration-dotted [&_tbody_td:first-child_a]:underline-offset-2">{children}</table>
    </div>
  );
}

/** 쪽 넘기기(커서) — 처음으로 / 다음. 2026-11-20 AWS 개편: 오른쪽 정렬 작은 글자 단추 */
export function CursorPager({ hasPrev, nextCursor, onFirst, onNext, page }: { readonly hasPrev: boolean; readonly nextCursor: string | null | undefined; readonly onFirst: () => void; readonly onNext: (cursor: string) => void; readonly page?: number }) {
  if (!hasPrev && !nextCursor) return null;
  return (
    <nav aria-label="쪽" className="flex items-center justify-end gap-1 text-sm">
      <button type="button" className="btn btn-ghost btn-sm" disabled={!hasPrev} onClick={onFirst}>
        « 처음으로
      </button>
      {page !== undefined && <span className="px-2 font-bold">{page}쪽</span>}
      <button type="button" className="btn btn-ghost btn-sm" disabled={!nextCursor} onClick={() => nextCursor && onNext(nextCursor)}>
        다음 ›
      </button>
    </nav>
  );
}

/** 상세 머리 — 2026-11-20 AWS 개편: 상자 없이 24px 제목 + 표시, 아래 회색 요약 한 줄, 오른쪽 동작(흰 테두리 단추·주 단추 검정) */
export function DetailHeader({ back, title, badges, summary, actions }: { readonly back: { readonly to: string; readonly label: string }; readonly title: ReactNode; readonly badges?: ReactNode; readonly summary?: ReactNode; readonly actions?: ReactNode }) {
  // 제목이 화면 위로 지나가면 위에 얇은 제목 띠(2026-11-19)
  const card = useRef<HTMLDivElement>(null);
  const past = useScrolledPast(card);
  return (
    <header className="space-y-1">
      <StickyTitle show={past} title={title} badges={badges} />
      <Link to={back.to} className="inline-flex items-center gap-1 text-sm text-base-content/70 underline underline-offset-2 hover:text-primary">
        <span aria-hidden>‹</span>
        {back.label}
      </Link>
      <div ref={card} className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">{title}</h1>
            {badges}
          </div>
          {summary && <p className="text-sm text-base-content/70">{summary}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** 구역으로 가는 탭(같은 쪽 안 이동) — 2026-11-20 AWS 개편: 굵은 글자 탭, 사이 세로 선, 파랑으로 바뀜 */
export function SectionTabs({ items }: { readonly items: ReadonlyArray<{ readonly id: string; readonly label: string }> }) {
  return (
    <nav aria-label="구역" className="sticky top-0 z-10 flex overflow-x-auto border-b border-base-300 bg-base-200/95 backdrop-blur">
      {items.map((i, n) => (
        <a key={i.id} href={`#${i.id}`} className={`-mb-px whitespace-nowrap border-b-2 border-transparent px-4 py-2.5 text-sm font-bold text-base-content/70 hover:border-primary hover:text-primary ${n > 0 ? 'relative before:absolute before:inset-y-3 before:left-0 before:w-px before:bg-base-300' : ''}`}>
          {i.label}
        </a>
      ))}
    </nav>
  );
}

/** 구역 상자 — 2026-11-20 AWS 개편(Container): 흰 상자 + 1px, 회색 머리 띠 없이 20px 굵은 제목, 오른쪽 덧붙임 */
export function Section({ id, title, aside, children, testId }: { readonly id?: string; readonly title: ReactNode; readonly aside?: ReactNode; readonly children: ReactNode; readonly testId?: string }) {
  return (
    <section id={id} className="scroll-mt-12 rounded-box border border-base-300 bg-base-100" data-testid={testId}>
      <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-4">
        <h2 className="text-lg font-bold">{title}</h2>
        <div className="flex items-center gap-2 text-sm">
          {aside}
          {/* 대시보드 위젯 자리 안이면 ⋮(숨기기) — 2026-11-20 AWS 위젯 메뉴 */}
          <WidgetMenuButton />
        </div>
      </div>
      <div className="px-5 pb-5 pt-1">{children}</div>
    </section>
  );
}

/** 항목명/값 — 2026-11-20 AWS 개편(Key-value pairs): 이름은 굵은 회갈색, 값은 아래, 넓으면 2~4칸 + 칸 사이 세로 선 */
export function FieldList({ rows, testId }: { readonly rows: ReadonlyArray<readonly [ReactNode, ReactNode] | false | null | undefined>; readonly testId?: string }) {
  return (
    <dl className="grid gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-4 [&>div]:pr-4 sm:[&>div]:border-l sm:[&>div]:border-base-300 sm:[&>div]:pl-4" data-testid={testId}>
      {rows.map((r, i) =>
        r ? (
          <div key={i} className="min-w-0 space-y-0.5">
            <dt className="font-semibold text-base-content/80">{r[0]}</dt>
            <dd className="min-w-0 break-words">{r[1]}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}

/**
 * 숫자 칸 — 2026-11-20 AWS 개편(대시보드 숫자 칸): 흰 상자 + 1px, 회색 이름, 큰 숫자(누르면 목록 — 숫자에 점선 밑줄), 색은 tone 이 있을 때 숫자에만.
 * active 면 지금 고른 거르기라는 파란 테두리. layout 'row' 는 이름 왼쪽·숫자 오른쪽.
 */
export function StatCard({ label, value, hint, to, tone, testId, active = false, layout = 'stack' }: { readonly label: ReactNode; readonly value: ReactNode; readonly hint?: ReactNode; readonly to?: string; readonly tone?: 'warning' | 'error' | 'info' | 'success' | undefined; readonly testId?: string; readonly active?: boolean; readonly layout?: 'stack' | 'row' }) {
  const ch = useStatChange(value); // 방금 바뀐 칸만 잠깐 빛남 + ▲▼(2026-11-19)
  const valueCls = `${tone === 'error' ? 'text-error' : tone === 'warning' ? 'text-[color-mix(in_oklab,var(--color-warning)_60%,var(--color-base-content))]' : ''} ${to ? 'underline decoration-dotted decoration-2 underline-offset-4' : ''}`;
  const body =
    layout === 'row' ? (
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-sm text-base-content/70">{label}</span>
          {hint && <span className="mt-0.5 block truncate text-xs text-base-content/55">{hint}</span>}
        </span>
        <span className={`shrink-0 text-3xl font-bold leading-none tabular-nums ${valueCls}`}>
          {value}
          {ch.badge}
        </span>
      </span>
    ) : (
      <>
        <p className="truncate text-sm text-base-content/70">{label}</p>
        <p className={`text-2xl font-bold leading-tight tabular-nums ${valueCls}`}>
          {value}
          {ch.badge}
        </p>
        {hint && <p className="truncate text-xs text-base-content/55">{hint}</p>}
      </>
    );
  const cls = `relative block space-y-1 rounded-box border bg-base-100 px-4 py-3 ${layout === 'row' ? 'min-h-20 py-4' : ''} ${active ? 'border-primary outline outline-1 outline-primary' : 'border-base-300'} ${ch.cls}`;
  return to ? (
    <Link to={to} className={`${cls} transition-colors hover:border-primary/60`} data-testid={testId} aria-current={active ? 'true' : undefined}>
      {body}
    </Link>
  ) : (
    <div className={cls} data-testid={testId}>
      {body}
    </div>
  );
}


/** 숫자 칸 글자 — 서버 개수(50 넘으면 "N+"), 읽는 중 "…", 못 읽음 "?"(0 이 아님) */
export const countCell = (q: { readonly data?: { readonly n: number; readonly more: boolean } | undefined; readonly isError: boolean }): string => (q.data ? `${q.data.n}${q.data.more ? '+' : ''}` : q.isError ? '?' : '…');

const alertTone = {
  info: { box: 'border-info bg-info/5', icon: 'text-info', d: 'M12 11v5M12 8h.01' },
  warning: { box: 'border-warning bg-warning/10', icon: 'text-[color-mix(in_oklab,var(--color-warning)_60%,var(--color-base-content))]', d: 'M12 8v5M12 16h.01' },
  error: { box: 'border-error bg-error/5', icon: 'text-error', d: 'M9 9l6 6M15 9l-6 6' },
  success: { box: 'border-success bg-success/5', icon: 'text-success', d: 'M8 12.5l2.5 2.5L16 9.5' },
} as const;

/**
 * 다음 할 일 — 상세 화면 맨 위에 하나만(2026-11-18 사용자 "지금 뭘 해야 하는지 안 보인다").
 * 무엇을 보일지는 화면이 서버 상태로만 고른다. 할 일이 없으면 그리지 않는다.
 * 2026-11-20 AWS 개편(Alert): 색 테두리 + 옅은 바탕 + 원 아이콘, 오른쪽 단추.
 */
export function NextAction({ tone = 'info', title, body, children, testId = 'next-action' }: { readonly tone?: 'info' | 'warning' | 'error' | 'success'; readonly title: ReactNode; readonly body?: ReactNode; readonly children?: ReactNode; readonly testId?: string }) {
  const t = alertTone[tone];
  return (
    <section aria-label="다음 할 일" className={`flex flex-wrap items-start gap-3 rounded-box border-2 px-4 py-3 ${t.box}`} data-testid={testId}>
      <svg viewBox="0 0 24 24" className={`mt-0.5 h-5 w-5 shrink-0 fill-none stroke-current ${t.icon}`} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d={t.d} />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-base-content/60">다음 할 일</p>
        <p className="font-bold">{title}</p>
        {body && <p className="text-sm text-base-content/75">{body}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </section>
  );
}

/** 코드 값 — 한국어 이름을 보이고 원래 코드는 마우스를 올리면(이름이 없으면 코드 그대로) */
export function CodeLabel({ code, names }: { readonly code: string; readonly names: Readonly<Record<string, string>> }) {
  const name = names[code];
  return name ? <span title={code}>{name}</span> : <span className="font-mono text-xs">{code}</span>;
}

/** 안내 띠 — 2026-11-20 AWS 개편(Alert): 정보는 파랑 테두리·옅은 파랑, 주의는 노랑 */
export function Notice({ children, tone = 'muted' }: { readonly children: ReactNode; readonly tone?: 'muted' | 'warning' }) {
  const t = alertTone[tone === 'warning' ? 'warning' : 'info'];
  return (
    <p role="note" className={`flex items-start gap-2 rounded-box border px-4 py-2.5 text-sm ${t.box}`}>
      <svg viewBox="0 0 24 24" className={`mt-0.5 h-4 w-4 shrink-0 fill-none stroke-current ${t.icon}`} strokeWidth={2} strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d={t.d} />
      </svg>
      <span>{children}</span>
    </p>
  );
}



// ---- AWS 콘솔 목록 부품(2026-11-20 개편 3단계, ADR-0004 · docs/apps/backoffice-ui-guide.md §3) — 시범: 승인함부터 ----

/**
 * 목록 제목줄: "이름 (개수)" · 파랑 "정보"(도움말 패널) · 오른쪽 읽은 시각 + 새로 고침 + 동작.
 * 개수는 서버가 준 줄 수만(못 읽었으면 넘기지 않는다 — 0 으로 보이지 않게). h1 은 이름만(시험·읽기 도구가 찾는 이름 그대로).
 */
export function ListHeader({ title, count, onInfo, refresh, actions }: {
  readonly title: string;
  readonly count?: string | undefined;
  readonly onInfo?: (() => void) | undefined;
  readonly refresh?: { readonly onClick: () => void; readonly busy: boolean; readonly readAt?: number | undefined } | undefined;
  readonly actions?: ReactNode;
}) {
  const readAt = refresh?.readAt ? new Date(refresh.readAt) : null;
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="text-2xl font-bold">{title}</h1>
        {count !== undefined && (
          <span className="text-2xl text-base-content/50 tabular-nums" data-testid="list-count">
            ({count})
          </span>
        )}
        {onInfo && (
          <button type="button" className="text-xs font-bold text-primary hover:underline" onClick={onInfo} data-testid="list-info">
            {lm.listUi.info}
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {readAt && (
          <span className="text-xs text-base-content/55" title={formatSeoul(readAt.toISOString())} data-testid="list-read-at">
            {lm.listUi.readAt(readAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }))}
          </span>
        )}
        {refresh && (
          <button type="button" className="btn btn-sm h-8 w-8 p-0" aria-label={lm.listUi.refresh} title={lm.listUi.refresh} disabled={refresh.busy} onClick={refresh.onClick} data-testid="list-refresh">
            <svg viewBox="0 0 24 24" className={`h-4 w-4 fill-none stroke-current ${refresh.busy ? 'animate-spin' : ''}`} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
            </svg>
          </button>
        )}
        {actions}
      </div>
    </header>
  );
}

/** 속성 — options 가 있으면 값 고르기, text 가 있으면 값을 직접 쳐서 Enter(번호·연락처 등, 2026-11-20 목록 전면 적용) */
export type FilterProp = {
  readonly key: string;
  readonly label: string;
  /** chip: 칩에 보일 말(목록 이름에 건수 등이 붙어 있을 때) */
  readonly options?: ReadonlyArray<{ readonly value: string; readonly label: string; readonly chip?: string }>;
  readonly text?: { readonly hint?: string; readonly maxLength?: number; readonly numeric?: boolean; /** 칩에 보일 말(시스템 ID 를 그대로 보이지 않게, ADR-0070) */ readonly show?: (v: string) => string };
};

/**
 * 속성 필터(AWS Property filter): 검색칸을 누르면 속성 목록 → 속성을 고르면 값 목록 → 고르면 칸 아래 "속성 = 값 ✕" 칩.
 * 속성마다 값 하나(서버 조건이 하나씩만 받는다). 글자를 치면 목록을 좁힌다 — 줄을 글자로 찾는 검색이 아니다(계약에 글자 검색 없음).
 * 연산자는 "=" 하나뿐이라 고르는 단계를 두지 않는다.
 */
export function PropertyFilter({ props, value, onChange, testId, aside }: {
  readonly props: readonly FilterProp[];
  readonly value: Readonly<Record<string, string | undefined>>;
  readonly onChange: (patch: Readonly<Record<string, string | null>>) => void;
  readonly testId?: string;
  /** 검색칸 오른쪽(기간·정렬 등 — AWS 의 시간 범위 고르기 자리) */
  readonly aside?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [prop, setProp] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [hi, setHi] = useState(0);
  const listId = useId();
  const current = prop ? props.find((p) => p.key === prop) : undefined;
  const q = text.trim();
  const items: ReadonlyArray<{ readonly id: string; readonly label: string }> = current
    ? current.text
      ? q
        ? [{ id: q, label: `${current.label} = ${q}` }]
        : []
      : (current.options ?? []).filter((o) => !q || o.label.includes(q)).map((o) => ({ id: o.value, label: o.label }))
    : props.filter((p) => !q || p.label.includes(q)).map((p) => ({ id: p.key, label: p.label }));
  const reset = () => {
    setProp(null);
    setText('');
    setHi(0);
  };
  const choose = (id: string) => {
    if (!current) {
      setProp(id);
      setText('');
      setHi(0);
      return;
    }
    onChange({ [current.key]: id });
    reset();
    setOpen(false);
  };
  const chips = props.flatMap((p) => {
    const v = value[p.key];
    if (!v) return [];
    if (p.text) return [{ key: p.key, text: `${p.label} = ${p.text.show ? p.text.show(v) : v}` }];
    const o = p.options?.find((x) => x.value === v);
    return o ? [{ key: p.key, text: `${p.label} = ${o.chip ?? o.label}` }] : [];
  });
  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-3">
      <div
        className="relative w-full max-w-xl"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            setOpen(false);
            reset();
          }
        }}
      >
        <label className="input input-sm w-full">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current opacity-60" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          {current && <span className="shrink-0 text-xs font-semibold text-base-content/70">{current.label} =</span>}
          <input
            role="combobox"
            aria-label={lm.listUi.filterPlaceholder}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            className="grow placeholder:italic placeholder:text-base-content/55"
            placeholder={current ? '' : lm.listUi.filterPlaceholder}
            value={text}
            maxLength={current?.text?.maxLength}
            inputMode={current?.text?.numeric ? 'numeric' : undefined}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(e) => {
              setText(e.target.value);
              setHi(0);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setOpen(false);
                reset();
              } else if (e.key === 'Backspace' && !text && prop) {
                setProp(null);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
                setHi((h) => Math.min(h + 1, Math.max(items.length - 1, 0)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHi((h) => Math.max(h - 1, 0));
              } else if (e.key === 'Enter' && open && items[hi]) {
                e.preventDefault();
                choose(items[hi].id);
              }
            }}
          />
        </label>
        {open && (
          <ul id={listId} role="listbox" aria-label={current ? current.label : lm.listUi.filterPlaceholder} className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-box border border-base-300 bg-base-100 py-1 shadow-lg">
            {current && (
              <li className="px-3 pb-1 pt-0.5 text-xs text-base-content/55">
                <button type="button" className="hover:text-primary" onMouseDown={(e) => e.preventDefault()} onClick={() => reset()}>
                  ‹ {lm.listUi.filterBack}
                </button>
              </li>
            )}
            {items.length === 0 ? (
              <li className="px-3 py-1.5 text-sm text-base-content/55">{current?.text ? (current.text.hint ?? lm.listUi.typeValue) : lm.listUi.noMatch}</li>
            ) : (
              items.map((it, i) => (
                <li
                  key={it.id}
                  role="option"
                  aria-selected={i === hi}
                  className={`cursor-pointer px-3 py-1.5 text-sm ${i === hi ? 'bg-primary/10 text-primary' : 'hover:bg-base-200'}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => choose(it.id)}
                >
                  {it.label}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      {aside}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-testid={testId ? `${testId}-chips` : undefined}>
          {chips.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1 rounded border border-base-300 bg-base-100 py-0.5 pl-2 pr-1 text-xs" data-testid="filter-chip">
              {c.text}
              <button type="button" className="grid h-5 w-5 place-items-center rounded hover:bg-base-200" aria-label={lm.listUi.removeChip(c.text)} onClick={() => onChange({ [c.key]: null })}>
                <svg viewBox="0 0 24 24" className="h-3 w-3 fill-none stroke-current" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </span>
          ))}
          {chips.length > 1 && (
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => onChange(Object.fromEntries(chips.map((c) => [c.key, null])))}>
              {lm.listUi.clearAll}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const statusTextClass: Record<Tone, string> = {
  success: 'text-success',
  error: 'text-error',
  warning: 'text-[color-mix(in_oklab,var(--color-warning)_60%,var(--color-base-content))]',
  info: 'text-info',
  accent: 'text-info',
  neutral: 'text-base-content/70',
  ghost: 'text-base-content/60',
};

/** 상태 = 아이콘 + 색 글자(AWS Status indicator) — 둥근 꼬리표 대신. 시범: 승인함부터, 다른 화면은 StatusBadge 그대로 */
export function StatusText({ tone = 'ghost', children, testId }: { readonly tone?: Tone; readonly children: ReactNode; readonly testId?: string | undefined }) {
  const icon =
    tone === 'success' ? <path d="M8 12.5l2.5 2.5L16 9.5" /> : tone === 'error' ? <path d="M9 9l6 6M15 9l-6 6" /> : tone === 'warning' ? <path d="M12 8v5M12 16h.01" /> : tone === 'info' || tone === 'accent' ? <path d="M12 7v5l3 2" /> : <path d="M8 12h8" />;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium ${statusTextClass[tone]}`} data-testid={testId}>
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        {icon}
      </svg>
      {children}
    </span>
  );
}

/**
 * 검색 조건 상자 — 2026-11-20 AWS 개편 때 공용(@pmart/web-ui listParts)에서 이 앱 사본으로 옮김(공용은 다른 앱이 써서 그대로).
 * AWS 필터 줄처럼: 흰 상자 + 1px, 항목 이름은 굵게 칸 위, 오른쪽 아래 "지우기"(흰 단추)·"찾기"(검정 주 단추).
 * summary 를 주면 조건을 건 뒤에는 "속성 = 값" 칩 줄로 접히고 "검색 열기"로 편다. 동작은 공용과 같다(시험 그대로).
 */
export function SearchPanel({ onSubmit, onReset, children, submitLabel = '조회', resetLabel = '초기화', submitDisabled = false, label = '검색 조건', summary }: { readonly onSubmit: (e: FormEvent) => void; readonly onReset: () => void; readonly children: ReactNode; readonly submitLabel?: string; readonly resetLabel?: string; readonly submitDisabled?: boolean; readonly label?: string; readonly summary?: ReadonlyArray<readonly [string, string]> }) {
  const active = (summary ?? []).filter(([, v]) => v !== '');
  const [open, setOpen] = useState(active.length === 0);
  const form = (
    <form
      className={`flex flex-wrap items-end gap-x-5 gap-y-3 rounded-box border border-base-300 bg-base-100 px-5 py-4 [&_label>span:first-child]:font-semibold [&_label>span:first-child]:text-base-content/80 ${summary ? 'rounded-t-none border-t-0' : ''}`}
      onSubmit={(e) => {
        onSubmit(e);
        if (summary) setOpen(false);
      }}
      aria-label={label}
      data-list-part="top"
      hidden={summary !== undefined && !open}
    >
      {children}
      <div className="ml-auto flex gap-2">
        <button type="button" className="btn btn-sm" onClick={onReset}>
          {resetLabel}
        </button>
        <button type="submit" className="btn btn-sm btn-primary min-w-20" disabled={submitDisabled}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
  if (!summary) return form;
  return (
    <div data-testid="search-summary-panel">
      <div className={`flex flex-wrap items-center gap-2 rounded-box border border-base-300 bg-base-100 px-5 py-2.5 ${open ? 'rounded-b-none' : ''}`}>
        <span className="inline-flex items-center gap-1.5 text-sm font-bold">
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
            <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 2-4-4" />
          </svg>
          {label}
        </span>
        {summary.map(([k, v]) => (
          <button
            key={k}
            type="button"
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs ${v ? 'border-base-content/40 bg-base-100' : 'border-base-300 bg-base-100 text-base-content/60'}`}
            onClick={() => setOpen(true)}
            data-testid="search-chip"
          >
            <span className="font-semibold">{k}</span>
            <span aria-hidden="true">=</span>
            <span className={v ? 'text-primary' : ''}>{v || '전체'}</span>
          </button>
        ))}
        <button type="button" className="btn btn-sm ml-auto" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="search-toggle">
          {open ? '검색 닫기 ▴' : '검색 열기 ▾'}
        </button>
      </div>
      {form}
    </div>
  );
}

/**
 * 목록 개수(제목줄 "이름 (개수)") — 서버가 준 줄만 센다. 다음 쪽이 있으면 "N+". 못 읽었거나 읽는 중이면 undefined(0 으로 보이지 않게).
 * 모양: 한 쪽 { items, page: { hasNext | nextCursor } } 또는 이어 붙이는 쪽 { pages: [...] }(useInfiniteQuery).
 */
type ListPage = { readonly items?: readonly unknown[] | null; readonly page?: { readonly hasNext?: boolean | null; readonly nextCursor?: string | null } | null };
export function listCount(q: { readonly data?: unknown; readonly hasNextPage?: boolean }): string | undefined {
  const d = q.data as (ListPage & { readonly pages?: readonly ListPage[] }) | undefined;
  if (!d) return undefined;
  const pages: readonly ListPage[] | undefined = d.pages;
  if (pages) {
    const n = pages.reduce((sum: number, p: ListPage) => sum + (p.items?.length ?? 0), 0);
    return `${n}${q.hasNextPage ? '+' : ''}`;
  }
  if (!Array.isArray(d.items)) return undefined;
  return `${d.items.length}${d.page?.hasNext || d.page?.nextCursor ? '+' : ''}`;
}

/** 제목줄 새로 고침 — 같은 조회를 다시, 읽은 시각은 그 조회가 받은 때 */
export const refreshOf = (q: { readonly refetch: () => Promise<unknown>; readonly isFetching: boolean; readonly dataUpdatedAt: number }) => ({ onClick: () => void q.refetch(), busy: q.isFetching, readAt: q.dataUpdatedAt || undefined });
