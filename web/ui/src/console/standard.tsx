// 백오피스 화면 기준 부품(@pmart/web-ui/standard, 2026-11-25 — PC 5 요청 docs/operations/2026-11-25-notice-backoffice-ui-standard.md, PC 2 사용자 "(가)로 진행").
// 정본은 라이더 백오피스 shared/simList.tsx·shared/admin.tsx(라이더 시뮬레이터 모양 — 2026-11-21~24 라이더 사용자 지적 반영)에서 올렸다.
// 앱은 shared/admin.tsx 에서 `export * from '@pmart/web-ui/console'` 다음에 `export { … } from '@pmart/web-ui/standard'` 로 같은 이름을 덮는다
// (직접 내보낸 이름이 export * 보다 먼저). 모양은 web/ui/src/standard.css — 앱 index.css 가 console.css 다음에 읽는다.
// 정보·기능은 줄이지 않는다: 긴 설명은 ⓘ 로 접고(누르면 그대로), 거르기는 모두 팝업 안에 남고, 건 조건은 칩으로 늘 보인다.
import { type ComponentProps, type CSSProperties, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode, useContext, useEffect, useId, useState } from 'react';
import { Link } from 'react-router';

import { SectionMenuContext, StatCard as ConsoleStatCard, type Tone } from './parts';

const t = {
  funnel: '거르기 조건',
  filterWord: '필터',
  funnelOpen: (n: number) => (n > 0 ? `거르기 조건 열기 (${n}개 걸림)` : '거르기 조건 열기'),
  change: (k: string, v: string) => `${k} ${v} 조건 바꾸기`,
  clear: (k: string) => `${k} 조건 풀기`,
  close: '닫기',
  clearAll: '모두 지우기',
  info: 'ⓘ',
  infoLabel: (open: boolean) => (open ? '화면 설명 접기' : '화면 설명 보기'),
  full: '전체 상세 ›',
  act: '처리',
  nextAction: '다음 할 일',
  guide: '화면 안내',
} as const;

// ---- 상태·빈 줄·숫자 칸 ----

/** 상태 = 작은 점(7px) + 글자. 평상시 값(정상·완료·회색)은 보조 글색, 색 글자는 문제(빨강)·주의(주황)·진행 중(파랑)에만 */
export function StatusText({ tone = 'ghost', children, testId }: { readonly tone?: Tone; readonly children: ReactNode; readonly testId?: string | undefined }) {
  return (
    <span className="pm-status" data-tone={tone} data-testid={testId}>
      {children}
    </span>
  );
}

/** 상태 꼬리표도 같은 점 + 글자(알약 꼬리표 없음) */
export function StatusBadge(p: { readonly tone?: Tone; readonly children: ReactNode; readonly testId?: string }) {
  return <StatusText {...p} />;
}

/**
 * 할 일 0건 — 초록 체크로 성공처럼 칠하지 않고 판 위 회색 한 줄(라이더 사용자 2026-11-21 "성공한 것처럼 … 고쳐라").
 * 제목이 있으면 굵게, 본문은 " · " 뒤에 — 글자는 그대로 남는다.
 */
export function AllDone({ title, body, testId = 'all-done' }: { readonly title: string; readonly body?: string; readonly testId?: string }) {
  return (
    <p role="status" className="pm-empty-line" data-testid={testId}>
      <span className="font-semibold text-base-content">{title}</span>
      {body && ` · ${body}`}
    </p>
  );
}

/** 숫자 칸 — 이름은 굵고 진하게, 값이 0 이면 숫자를 보조 글색으로(색은 0 이 아닐 때만). 숫자 바뀜 표시가 돌도록 값은 그대로 */
export function StatCard(p: ComponentProps<typeof ConsoleStatCard>) {
  const zero = p.value === 0 || p.value === '0';
  const name = <span className="font-semibold text-base-content">{p.label}</span>;
  return zero ? <ConsoleStatCard {...p} tone={undefined} label={<span data-zero="">{name}</span>} /> : <ConsoleStatCard {...p} label={name} />;
}

// ---- 알림(안내 띠·다음 할 일) — 판 색 + 왼쪽 3px 띠, 꽉 채우지 않음 ----

/** 안내 띠(role=note) — 판 색 + 왼쪽 띠(정보 = 파랑, 주의 = 주황) */
export function Notice({ children, tone = 'muted' }: { readonly children: ReactNode; readonly tone?: 'muted' | 'warning' }) {
  return (
    <p role="note" className="pm-note" data-tone={tone === 'warning' ? 'warning' : 'info'}>
      {children}
    </p>
  );
}

/** 다음 할 일 — 상세 맨 위 하나. 판 색 + 왼쪽 띠 + 작은 회색 머리 "다음 할 일", 오른쪽 단추 */
export function NextAction({ tone = 'info', title, body, children, testId = 'next-action' }: { readonly tone?: 'info' | 'warning' | 'error' | 'success'; readonly title: ReactNode; readonly body?: ReactNode; readonly children?: ReactNode; readonly testId?: string }) {
  return (
    <section aria-label={t.nextAction} className="pm-note pm-next" data-tone={tone} data-testid={testId}>
      <div className="min-w-0 flex-1">
        <p className="pm-next-k">{t.nextAction}</p>
        <p className="font-bold">{title}</p>
        {body && <p className="pm-next-body">{body}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </section>
  );
}

// ---- 쪽 머리·화면 안내 — 회색 설명은 ⓘ 로 접는다 ----

function InfoButton({ open, onToggle }: { readonly open: boolean; readonly onToggle: () => void }) {
  return (
    <button type="button" className="pm-info-btn" aria-expanded={open} aria-label={t.infoLabel(open)} title={t.infoLabel(open)} onClick={onToggle}>
      {t.info}
    </button>
  );
}

/** 쪽 머리 — 제목 + ⓘ(설명이 있을 때, 누르면 한 줄) + 오른쪽 주 동작. 뒤로·nav 줄은 공용 콘솔과 같다 */
export function PageHeader({ title, description, actions, back, nav }: { readonly title: ReactNode; readonly description?: ReactNode; readonly actions?: ReactNode; readonly back?: { readonly to: string; readonly label: string }; readonly nav?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="space-y-1">
      {(back || nav) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {back ? (
            <Link to={back.to} className="inline-flex items-center gap-1 text-sm text-base-content/70 underline underline-offset-2 hover:text-primary">
              <span aria-hidden>‹</span>
              {back.label}
            </Link>
          ) : (
            <span />
          )}
          {nav && <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{nav}</div>}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 text-2xl font-bold">{title}</h1>
          {description && <InfoButton open={open} onToggle={() => setOpen((o) => !o)} />}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && open && <p className="pm-info-text">{description}</p>}
    </header>
  );
}

/** 화면 안내 — 상자 대신 "ⓘ 화면 안내" 한 줄, 누르면 글머리 목록(처음엔 접힘, 글은 그대로) */
export function GuideBox({ title = t.guide, items, testId, tone = 'info' }: { readonly title?: string; readonly items: readonly ReactNode[]; readonly storeKey?: string; readonly testId?: string; readonly tone?: 'info' | 'warning' }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="pm-guide" data-tone={tone} data-testid={testId}>
      <button type="button" className="pm-guide-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">{t.info}</span>
        {title}
        <span className="pm-guide-caret" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <ul className="pm-guide-list">
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- 찾기 줄: [찾기 칸][찾기][필터 → 팝업][건 조건 칩 ✕] ----

/** [이름, 값(빈 문자열 = 안 걸림), 풀기] — 풀기가 있으면 칩에 ✕ */
export type SummaryEntry = readonly [string, string] | readonly [string, string, (() => void) | undefined];

/**
 * 검색 조건 한 줄 — [찾기 칸(search)][찾기][필터 → 팝업(children)][건 조건 칩 ✕]. 공용 SearchPanel 과 같은 이름·속성(덮어 쓰기).
 * search 를 주지 않은 화면은 입력 칸까지 팝업 안. 폼은 하나(팝업의 입력도 같은 폼이라 Enter 가 찾기).
 * 팝업 안 입력은 닫아도 지우지 않는다(닫으면 숨김만) — 고르던 값이 남는다.
 */
export function SearchPanel({
  onSubmit,
  onReset,
  children,
  submitLabel = '조회',
  submitDisabled = false,
  label = '검색 조건',
  summary,
  submit = true,
  search,
  filters,
  testId,
}: {
  readonly onSubmit: (e: FormEvent) => void;
  readonly onReset: () => void;
  readonly children?: ReactNode;
  readonly submitLabel?: string;
  /** 공용과 맞춘 이름 — 이 모양은 팝업 안 "모두 지우기" */
  readonly resetLabel?: string;
  readonly submitDisabled?: boolean;
  readonly label?: string;
  readonly summary?: ReadonlyArray<SummaryEntry>;
  /** false = 찾기 단추 없음(고르는 즉시 거르는 목록) */
  readonly submit?: boolean;
  /** 공용과 맞춘 이름 — 이 모양에서는 팝업이 늘 닫힌 채 시작한다 */
  readonly startOpen?: boolean;
  /** 왼쪽 찾기 칸(번호·이름 등 글자 입력) — 늘 보인다 */
  readonly search?: ReactNode;
  /** 늘 보이는 거르기(고르기 하나뿐인 화면) */
  readonly filters?: ReactNode;
  readonly active?: boolean;
  readonly testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const popId = useId();
  const active = (summary ?? []).filter(([, v]) => v !== '');
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const submitBtn = submit && (
    <button type="submit" className="btn btn-sm btn-primary" disabled={submitDisabled}>
      {submitLabel}
    </button>
  );
  const hasPop = children !== undefined && children !== null && children !== false;
  return (
    <form
      className="pm-fbar"
      aria-label={label}
      data-list-part="top"
      data-search=""
      data-testid={testId}
      onSubmit={(e) => {
        onSubmit(e);
        setOpen(false);
      }}
    >
      {search && <div className="pm-fbar-q">{search}</div>}
      {search && submitBtn}
      {filters && <div className="pm-fbar-filters">{filters}</div>}
      {hasPop && (
        <div className="pm-fwrap">
          <button
            type="button"
            className={`pm-funnel ${active.length > 0 ? 'on' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={popId}
            aria-label={t.funnelOpen(active.length)}
            title={t.funnel}
            onClick={() => setOpen((o) => !o)}
            data-testid="search-toggle"
          >
            <span aria-hidden="true">{t.filterWord}</span>
            {active.length > 0 && <span className="pm-funnel-n">{active.length}</span>}
          </button>
          {open && <div className="pm-pop-back" onClick={() => setOpen(false)} aria-hidden="true" />}
          <div className="pm-pop" id={popId} role="group" aria-label={t.funnel} data-testid="search-popup" data-open={open ? '' : undefined}>
            <div className="pm-pop-grid">{children}</div>
            <div className="pm-pop-foot">
              <button type="button" className="btn btn-sm btn-ghost" onClick={onReset}>
                {t.clearAll}
              </button>
              {!search && submitBtn}
              <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
                {t.close}
              </button>
            </div>
          </div>
        </div>
      )}
      {!search && !hasPop && submitBtn}
      {active.map(([k, v, clear]) => (
        <span key={k} className="pm-fchip" data-testid="search-chip">
          <button type="button" className="pm-fchip-l" aria-label={t.change(k, v)} title={k} onClick={() => setOpen(true)}>
            {v}
          </button>
          {clear && (
            <button type="button" className="pm-fchip-x" aria-label={t.clear(k)} onClick={clear}>
              ✕
            </button>
          )}
        </span>
      ))}
    </form>
  );
}

/** 팝업 안 한 묶음(공용 SearchRow 와 같은 속성) — 작은 회색 머리 + 고르기 */
export function SearchRow({ label, children }: { readonly label: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="pm-pop-sec">
      <div className="pm-pop-h">{label}</div>
      <div className="pm-pop-body">{children}</div>
    </div>
  );
}

// ---- 줄 아래 펼침 ----

/** 줄 펼침 — 한 번에 한 줄만. 상태는 화면 안에만 */
export function useInlineOpen() {
  const [openKey, setOpenKey] = useState<string | null>(null);
  return {
    isOpen: (k: string) => openKey === k,
    toggle: (k: string) => setOpenKey((o) => (o === k ? null : k)),
  };
}

const interactive = (el: EventTarget | null) => el instanceof Element && !!el.closest('a, button, input, select, textarea, label, summary, [role="radio"]');

/** 펼치는 줄에 붙일 속성 — 줄을 누르거나 Enter·Space 로 펼친다(줄 안 링크·단추는 그대로) */
export function expandRowProps(open: boolean, onToggle: () => void) {
  return {
    'aria-expanded': open,
    tabIndex: 0,
    'data-open': open ? '' : undefined,
    onClick: (e: MouseEvent<HTMLTableRowElement>) => {
      if (interactive(e.target)) return;
      onToggle();
    },
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle();
      }
    },
  } as const;
}

/** 줄 앞 ▸/▾ */
export function Caret({ open }: { readonly open: boolean }) {
  return (
    <span className="pm-caret" aria-hidden="true">
      {open ? '▾' : '▸'}
    </span>
  );
}

/** 펼친 칸 위 단추 색 — 표 첫 칸 링크 규칙(점선 밑줄)·앱 전체 a { color: inherit } 를 이긴다 */
export const inlineMainButton: CSSProperties = { backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-content)', textDecoration: 'none' };

/** 줄 바로 아래 펼친 상세 — 위쪽 오른쪽 한 줄에 [actions]·"전체 상세 ›" */
export function InlineDetail({ colSpan, to, linkLabel = t.full, actions, children, testId = 'inline-detail' }: { readonly colSpan: number; readonly to?: string; readonly linkLabel?: string; readonly actions?: ReactNode; readonly children: ReactNode; readonly testId?: string }) {
  return (
    <tr className="pm-inline-row">
      <td colSpan={colSpan}>
        <div className="pm-inline" data-testid={testId}>
          {(actions || to) && (
            <div className="pm-inline-bar">
              {actions}
              {to && (
                <Link className="btn btn-sm border-0" style={inlineMainButton} to={to}>
                  {linkLabel}
                </Link>
              )}
            </div>
          )}
          {children}
        </div>
      </td>
    </tr>
  );
}

// ---- 상세: 보기 구역 · 처리 구역 · 요약 띠 ----

/** 보기 구역 — 조용한 판, 머리 = 아이콘 + 제목 + 한 줄 요약, 설명은 ⓘ. 비었으면 한 줄로 접힘 */
export function ViewSection({ id, icon, title, summary, info, empty = false, aside, children, testId }: {
  readonly id?: string;
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  readonly summary?: ReactNode;
  readonly info?: ReactNode;
  readonly empty?: boolean;
  readonly aside?: ReactNode;
  readonly children?: ReactNode;
  readonly testId?: string;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const sectionMenu = useContext(SectionMenuContext);
  return (
    <section id={id} className={`pm-vsec ${empty ? 'pm-vsec-empty' : ''}`} data-testid={testId}>
      <div className="pm-sec-head">
        {icon && <span className="pm-sec-icon">{icon}</span>}
        <h2 className="pm-sec-title">{title}</h2>
        {summary !== undefined && summary !== null && summary !== '' && <span className="pm-sec-sum">{summary}</span>}
        {info && <InfoButton open={showInfo} onToggle={() => setShowInfo((o) => !o)} />}
        {(aside || sectionMenu) && (
          <div className="pm-sec-aside flex items-center gap-2">
            {aside}
            {sectionMenu}
          </div>
        )}
      </div>
      {info && showInfo && <p className="pm-info-text pm-sec-info">{info}</p>}
      {!empty && children !== undefined && <div className="pm-sec-body">{children}</div>}
    </section>
  );
}

/** 처리 구역 — 왼쪽 파랑 띠 + "처리" 머리 + 동사 제목 */
export function ActionSection({ id, title, summary, info, aside, children, testId }: {
  readonly aside?: ReactNode;
  readonly id?: string;
  readonly title: ReactNode;
  readonly summary?: ReactNode;
  readonly info?: ReactNode;
  readonly children?: ReactNode;
  readonly testId?: string;
}) {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <section id={id} className="pm-act" data-testid={testId}>
      <div className="pm-sec-head">
        <span className="pm-act-tag">{t.act}</span>
        <h2 className="pm-sec-title">{title}</h2>
        {summary !== undefined && summary !== null && summary !== '' && <span className="pm-sec-sum">{summary}</span>}
        {info && <InfoButton open={showInfo} onToggle={() => setShowInfo((o) => !o)} />}
        {aside && <div className="pm-sec-aside">{aside}</div>}
      </div>
      {info && showInfo && <p className="pm-info-text pm-sec-info">{info}</p>}
      {children !== undefined && <div className="pm-sec-body">{children}</div>}
    </section>
  );
}

/** 맨 위 요약 띠 — [이름, 값] 칸들. 값은 이미 읽은 서버 값만 */
export function SummaryBar({ items, label, testId }: { readonly items: ReadonlyArray<readonly [string, ReactNode] | false | null | undefined>; readonly label: string; readonly testId?: string }) {
  return (
    <dl className="pm-sumbar" aria-label={label} data-testid={testId}>
      {items.map((it) =>
        it ? (
          <div key={it[0]} className="pm-sumbar-cell">
            <dt>{it[0]}</dt>
            <dd>{it[1]}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}

/** 구역 상자(공용 Section 과 같은 속성으로 덮음) — action = 처리 구역, info = 설명(ⓘ), summary = 머리 옆 한 줄 요약 */
export function Section({ id, title, aside, children, testId, action = false, info, summary }: {
  readonly id?: string;
  readonly title: ReactNode;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly testId?: string;
  readonly action?: boolean;
  readonly info?: ReactNode;
  readonly summary?: ReactNode;
}) {
  const common = { title, info, summary, aside, children, ...(id ? { id } : {}), ...(testId ? { testId } : {}) };
  return action ? <ActionSection {...common} /> : <ViewSection {...common} />;
}
