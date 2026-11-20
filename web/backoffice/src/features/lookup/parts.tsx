// 조회·현황·고객센터 화면 공통 작은 부품(2026-11-18 사용자 "밋밋하다 — Shopify·Medusa 관리자처럼").
// 승인함 목록(ApprovalListPage)·카테고리 트리 화면의 짜임을 따른다: 한 카드 목록, 밑줄 탭, 굵은 첫 줄 + 작은 ID,
// 머리글자 동그라미, "N일 전" + 정확한 시각, 점 타임라인, 숫자 카드, 그림 있는 빈 상자.
// 값은 서버가 준 것만 보인다 — 여기서 금액·자격을 계산하지 않는다(건수 세기는 읽은 줄 기준 표시만).
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { formatSeoul } from '@pmart/web-ui';
import { labelText, useEmployeeLabel } from '../../shared/employeeLabels';
import { messages } from '../../shared/messages';
import type { Tone } from '../../shared/admin';

/** 지난 시각을 "방금·N분 전·N시간 전·N일 전"으로(보기용 — 정확한 시각은 옆·아래에 함께) */
export function ago(iso: string): string {
  const a = messages.approvals.ago;
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(min) || min < 1) return a.now;
  if (min < 60) return a.min(min);
  if (min < 60 * 24) return a.hour(Math.floor(min / 60));
  return a.day(Math.floor(min / (60 * 24)));
}

/** 시각 칸: 위 "N일 전", 아래 정확한 서울 시각. 값이 없으면 "-" */
export function When({ iso, align = 'left' }: { readonly iso: string | null | undefined; readonly align?: 'left' | 'right' }) {
  if (!iso) return <span className="text-base-content/40">{messages.none}</span>;
  return (
    <span className={`block whitespace-nowrap ${align === 'right' ? 'text-right' : ''}`}>
      <span className="block text-sm">{ago(iso)}</span>
      <span className="block text-xs text-base-content/45">{formatSeoul(iso)}</span>
    </span>
  );
}

/**
 * 직원 — 머리글자 동그라미 + "이름 · 사번"(ADR-0070 덧붙임 2026-11-19, hr employee-labels). OP-… 는 글자로 보이지 않는다(상세의 시스템 번호 칸에서만).
 * 못 읽으면 "직원 · 확인 불가", 모르는 ID 면 "직원 · 이름 없음"(없는 것과 못 읽은 것을 섞지 않는다). to 가 있으면 링크
 */
export function Person({ id, to }: { readonly id: string | null | undefined; readonly to?: string | undefined }) {
  const q = useEmployeeLabel(id);
  if (!id) return <span className="text-base-content/40">{messages.none}</span>;
  const text = q.data ? labelText(q.data) : q.isError ? messages.displayNumber.staffFailed : q.isPending ? '…' : messages.displayNumber.staffUnknown;
  const letter = q.data?.name.replace(/^\[목\]\s*/, '').charAt(0) || '?';
  return (
    <span className="flex items-center gap-2" data-testid="staff-label">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-base-300 text-[11px] font-bold text-base-content/70" aria-hidden="true">
        {letter}
      </span>
      {to ? (
        <Link className="max-w-[14rem] truncate text-sm hover:text-primary hover:underline" to={to}>
          {text}
        </Link>
      ) : (
        <span className={`max-w-[14rem] truncate text-sm ${q.isError ? 'text-warning' : ''}`}>{text}</span>
      )}
    </span>
  );
}

/** 직원 이름 · 사번 글자만(문장 안에 넣을 때, ADR-0070 덧붙임) */
export function StaffName({ id }: { readonly id: string | null | undefined }) {
  const q = useEmployeeLabel(id);
  if (!id) return <>{messages.none}</>;
  return <>{q.data ? labelText(q.data) : q.isError ? messages.displayNumber.staffFailed : q.isPending ? '…' : messages.displayNumber.staffUnknown}</>;
}

const iconPaths = {
  box: 'M4 8l8-4 8 4-8 4-8-4Zm0 0v8l8 4 8-4V8M12 12v8',
  truck: 'M3 6h11v9H3zM14 9h4l3 3v3h-7M7 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4',
  alert: 'M12 4 3 20h18L12 4Zm0 6v4m0 3h.01',
  return: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  check: 'M5 12l4 4 10-10',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4l3 2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  store: 'M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6m-6 4h6',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
} as const;
export type IconName = keyof typeof iconPaths;

export function Icon({ name, className = 'h-4 w-4' }: { readonly name: IconName; readonly className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`${className} shrink-0 fill-none stroke-current`} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d={iconPaths[name]} />
    </svg>
  );
}

// 2026-11-20 AWS 색 줄이기: 바탕 없는 그림 + 글자. 색은 주의·실패에만(나머지는 회색 글자)
const chipTone: Record<Tone, string> = {
  neutral: 'text-base-content/80',
  info: 'text-base-content/80',
  success: 'text-base-content/80',
  warning: 'text-[color-mix(in_oklab,var(--color-warning)_60%,var(--color-base-content))]',
  error: 'text-error',
  accent: 'text-base-content/80',
  ghost: 'text-base-content/70',
};

/** 종류 꼬리표(네모, 색 + 그림) — 상태 점 꼬리표(StatusBadge)와 모양을 달리해 종류와 상태가 섞여 보이지 않게 */
export function KindChip({ tone = 'ghost', icon, children }: { readonly tone?: Tone; readonly icon?: IconName; readonly children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-sm ${chipTone[tone]}`} data-tone={tone}>
      {icon && <Icon name={icon} className="h-3.5 w-3.5" />}
      {children}
    </span>
  );
}

/**
 * 빈·처음 상자 — 2026-11-20 AWS 빈 화면: 그림 없이 "무엇이 없다(굵게) / 왜·어디(회색, 있으면) / 단추(있으면)" 세 줄, 실선 상자.
 * icon 은 예전 호출 자리를 그대로 두려고 받기만 한다(그리지 않는다).
 */
export function EmptyBox({ children, hint, action, testId, listPart = false }: { readonly icon?: IconName; readonly children: ReactNode; readonly hint?: ReactNode; readonly action?: ReactNode; readonly testId?: string; readonly listPart?: boolean }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1.5 rounded-box border border-base-300 bg-base-100 px-6 py-10 text-center"
      data-testid={testId}
      data-empty-box
      {...(listPart ? { 'data-list-part': 'table' } : {})}
    >
      <span className="text-sm font-bold text-base-content">{children}</span>
      {hint && <span className="text-sm text-base-content/65">{hint}</span>}
      {action && <span className="mt-2">{action}</span>}
    </div>
  );
}

/** 목록 카드 맨 아래 줄(건수·더 보기·쪽) — 위 결과 줄·표와 한 카드로 붙는다(index.css 의 data-list-part) */
export function ListFoot({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-box border border-base-300 bg-base-100 px-4 py-2.5 text-sm shadow-sm" data-list-part="foot">
      {children}
    </div>
  );
}

/** 밑줄 탭(바로 적용되는 거르기) — 승인함 목록의 심사 상태 탭과 같은 모양 */
export function UnderlineTabs<T extends string>({ label, value, options, onChange }: { readonly label: string; readonly value: T; readonly options: ReadonlyArray<{ readonly value: T; readonly label: ReactNode }>; readonly onChange: (v: T) => void }) {
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

/** 숫자 카드 — 읽어 온 줄을 센 값만(조회 실패면 카드를 그리지 않는다) */
export function Kpi({ label, value, hint, tone, icon, testId }: { readonly label: ReactNode; readonly value: ReactNode; readonly hint?: ReactNode | undefined; readonly tone?: 'warning' | 'error' | 'success' | 'info' | undefined; readonly icon?: IconName; readonly testId?: string }) {
  const toneText = tone === 'error' ? 'text-error' : tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : tone === 'info' ? 'text-info' : '';
  const toneBg = tone === 'error' ? 'bg-error/10' : tone === 'warning' ? 'bg-warning/15' : tone === 'success' ? 'bg-success/10' : tone === 'info' ? 'bg-info/10' : 'bg-primary/10 text-primary';
  return (
    <div className="flex items-start gap-3 rounded-box border border-base-300 bg-base-100 px-4 py-3 shadow-sm" data-testid={testId}>
      {icon && (
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${toneBg} ${toneText}`}>
          <Icon name={icon} className="h-5 w-5" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs text-base-content/55">{label}</p>
        <p className={`text-2xl font-bold tabular-nums ${toneText}`}>{value}</p>
        {hint && <p className="text-xs text-base-content/50">{hint}</p>}
      </div>
    </div>
  );
}

const dotTone: Record<Tone, string> = {
  neutral: 'bg-base-content/60',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  accent: 'bg-accent',
  ghost: 'bg-base-300',
};

/** 세로 점 타임라인(위 → 아래 순서는 받은 순서 그대로) */
export function Timeline({ items, testId }: { readonly items: ReadonlyArray<{ readonly key: string; readonly title: ReactNode; readonly meta?: ReactNode; readonly body?: ReactNode; readonly tone?: Tone }>; readonly testId?: string }) {
  return (
    <ol className="relative space-y-4 border-l border-base-300 pl-5" data-testid={testId}>
      {items.map((i) => (
        <li key={i.key} className="relative">
          <span className={`absolute -left-[1.6rem] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-base-100 ${dotTone[i.tone ?? 'neutral']}`} aria-hidden="true" />
          <div className="text-sm font-medium">{i.title}</div>
          {i.meta && <div className="text-xs text-base-content/50">{i.meta}</div>}
          {i.body && <div className="mt-1 text-sm text-base-content/75">{i.body}</div>}
        </li>
      ))}
    </ol>
  );
}

/** 옆 칸 카드의 항목 목록(한 줄에 하나 — 이름은 위에 작게, 값은 아래) */
export function SideFields({ rows, testId }: { readonly rows: ReadonlyArray<readonly [ReactNode, ReactNode] | false | null | undefined>; readonly testId?: string }) {
  return (
    <dl className="space-y-3 text-sm" data-testid={testId}>
      {rows.map((r, i) =>
        r ? (
          <div key={i} className="min-w-0 space-y-0.5">
            <dt className="text-xs text-base-content/50">{r[0]}</dt>
            <dd className="min-w-0 break-words font-medium">{r[1]}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}
