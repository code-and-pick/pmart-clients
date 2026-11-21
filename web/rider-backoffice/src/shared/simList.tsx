// 라이더 시뮬레이터 모양 목록 부품(2026-11-21 사용자 "UI 고칠 때 기능이나 안에서 볼 수 있는 정보, 내용도 보기 편하게 라이더시뮬레이션 UI처럼 좀 다 바꿔봐").
// 기준: pmart-rider-simulation src/ui/SearchFilterBar.tsx(찾기 칸 + 깔때기 팝업 + 고른 것 ✕ 칩)·console-v2.css(.md-inline 줄 아래 펼침).
// 공용 web/ui 는 다른 백오피스가 써서 고치지 않는다 — admin.tsx 가 이 파일의 SearchPanel·GuideBox·PageHeader 로 공용 것을 덮는다.
// 정보는 줄이지 않는다: 긴 설명은 ⓘ 로 접어 두고(누르면 그대로 보임), 거르기는 모두 팝업 안에 남고, 건 조건은 칩으로 늘 보인다.
import { type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useId, useState } from 'react';
import { Link } from 'react-router';

const t = {
  funnel: '거르기 조건',
  funnelOpen: (n: number) => (n > 0 ? `거르기 조건 열기 (${n}개 걸림)` : '거르기 조건 열기'),
  change: (k: string, v: string) => `${k} ${v} 조건 바꾸기`,
  clear: (k: string) => `${k} 조건 풀기`,
  close: '닫기',
  info: 'ⓘ',
  infoLabel: (open: boolean) => (open ? '화면 설명 접기' : '화면 설명 보기'),
  full: '전체 상세 ›',
} as const;

/** [이름, 값(빈 문자열 = 안 걸림), 풀기] — 풀기가 있으면 칩에 ✕ */
export type SummaryEntry = readonly [string, string] | readonly [string, string, (() => void) | undefined];

/**
 * 검색 조건 — 시뮬레이터처럼 한 줄: [찾기 칸(search)][찾기][깔때기 → 팝업(children: 상태·종류 고르기)][건 조건 칩 ✕][초기화].
 * 공용 SearchPanel 과 같은 이름·속성(덮어 쓰기) — search 를 주지 않은 화면은 입력 칸까지 팝업 안에 있다.
 * 폼은 하나(aria-label=label, data-list-part="top" — '/' 키가 첫 칸으로). 팝업의 입력도 같은 폼이라 Enter 가 찾기다.
 */
export function SearchPanel({
  onSubmit,
  onReset,
  children,
  submitLabel = '조회',
  resetLabel = '초기화',
  submitDisabled = false,
  label = '검색 조건',
  summary,
  submit = true,
  search,
  testId,
}: {
  readonly onSubmit: (e: FormEvent) => void;
  readonly onReset: () => void;
  readonly children?: ReactNode;
  readonly submitLabel?: string;
  readonly resetLabel?: string;
  readonly submitDisabled?: boolean;
  readonly label?: string;
  readonly summary?: ReadonlyArray<SummaryEntry>;
  /** false = 찾기 단추 없음(고르는 즉시 거르는 목록) */
  readonly submit?: boolean;
  /** 공용과 맞춘 이름 — 이 모양에서는 팝업이 늘 닫힌 채 시작한다 */
  readonly startOpen?: boolean;
  /** 왼쪽 찾기 칸(번호·전화 등 글자 입력) — 늘 보인다 */
  readonly search?: ReactNode;
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
      {children !== undefined && children !== null && children !== false && (
        <div className="pm-fwrap">
          <button
            type="button"
            className={`pm-funnel ${active.length > 0 ? 'on' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? popId : undefined}
            aria-label={t.funnelOpen(active.length)}
            title={t.funnel}
            onClick={() => setOpen((o) => !o)}
            data-testid="search-toggle"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M1.5 2.5h13l-5 6v5l-3-1.5v-3.5z" fill="currentColor" />
            </svg>
            {active.length > 0 && <span className="pm-funnel-n">{active.length}</span>}
          </button>
          {open && (
            <>
              <div className="pm-pop-back" onClick={() => setOpen(false)} aria-hidden="true" />
              <div className="pm-pop" id={popId} role="group" aria-label={t.funnel} data-testid="search-popup">
                <div className="pm-pop-grid">{children}</div>
                <div className="pm-pop-foot">
                  <button type="button" className="btn btn-sm btn-ghost" onClick={onReset}>
                    {resetLabel}
                  </button>
                  {!search && submitBtn}
                  <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
                    {t.close}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
      {!search && children == null && submitBtn}
      {active.map(([k, v, clear]) => (
        <span key={k} className="pm-fchip" data-testid="search-chip">
          <button type="button" className="pm-fchip-l" aria-label={t.change(k, v)} onClick={() => setOpen(true)}>
            <span className="pm-fchip-k">{k}</span> {v}
          </button>
          {clear && (
            <button type="button" className="pm-fchip-x" aria-label={t.clear(k)} onClick={clear}>
              ✕
            </button>
          )}
        </span>
      ))}
      {active.length > 0 && (
        <button type="button" className="pm-fbar-reset" onClick={onReset}>
          {resetLabel}
        </button>
      )}
    </form>
  );
}

/** 팝업 안 한 묶음(공용 SearchRow 와 같은 속성) — 작은 회색 머리 + 고르기 목록 */
export function SearchRow({ label, children }: { readonly label: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="pm-pop-sec">
      <div className="pm-pop-h">{label}</div>
      <div className="pm-pop-body">{children}</div>
    </div>
  );
}

/** 쪽 머리 — 제목 옆 ⓘ 에 설명을 접어 둔다(공용 PageHeader 와 같은 속성) */
export function PageHeader({ title, description, actions, back }: { readonly title: ReactNode; readonly description?: ReactNode; readonly actions?: ReactNode; readonly back?: { readonly to: string; readonly label: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="space-y-1">
      {back && (
        <Link to={back.to} className="inline-flex items-center gap-1 text-sm text-base-content/70 underline underline-offset-2 hover:text-primary">
          <span aria-hidden>‹</span>
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 text-xl font-bold">{title}</h1>
          {description && (
            <button type="button" className="pm-info-btn" aria-expanded={open} aria-label={t.infoLabel(open)} title={t.infoLabel(open)} onClick={() => setOpen((o) => !o)} data-testid="page-info">
              {t.info}
            </button>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && open && <p className="pm-info-text">{description}</p>}
    </header>
  );
}

/** 화면 안내 — 상자 대신 작은 "ⓘ 화면 안내" 한 줄, 누르면 글머리(공용 GuideBox 와 같은 속성). 처음엔 접힘 */
export function GuideBox({ title, items, testId, tone = 'info' }: { readonly title: string; readonly items: readonly ReactNode[]; readonly storeKey: string; readonly testId?: string; readonly tone?: 'info' | 'warning' }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pm-guide" data-tone={tone} data-testid={testId}>
      <button type="button" className="pm-guide-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">{tone === 'warning' ? '!' : t.info}</span> {title}
        <span className="pm-guide-caret" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <ul className="pm-guide-list">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 줄 펼침 — 한 번에 한 줄만(시뮬레이터처럼). 상태는 화면 안에만(주소는 거르기·쪽만) */
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

/** 줄 바로 아래 펼친 상세(.md-inline) — 오른쪽 위 "전체 상세 ›" 링크 */
export function InlineDetail({ colSpan, to, linkLabel = t.full, children, testId = 'inline-detail' }: { readonly colSpan: number; readonly to?: string; readonly linkLabel?: string; readonly children: ReactNode; readonly testId?: string }) {
  return (
    <tr className="pm-inline-row">
      <td colSpan={colSpan}>
        <div className="pm-inline" data-testid={testId}>
          {to && (
            <Link className="pm-inline-link" to={to}>
              {linkLabel}
            </Link>
          )}
          {children}
        </div>
      </td>
    </tr>
  );
}

/*
 * 상세 화면 — 보는 구역과 처리하는 구역을 한눈에(2026-11-21 사용자 "각각 뭐를 보여주고 처리하는 박스인지가 직관적으로 안 보인다").
 * 보기 구역(ViewSection) = 조용한 판, 머리 = 아이콘 + 제목 + 한 줄 요약 값. 비었으면 한 줄로 접는다.
 * 처리 구역(ActionSection) = 왼쪽 파랑 띠 + "처리" 머리 + 동사 제목("계정 제한 바꾸기"). 구역 설명·개발 말은 ⓘ 로.
 */
function InfoButton({ open, onToggle }: { readonly open: boolean; readonly onToggle: () => void }) {
  return (
    <button type="button" className="pm-info-btn" aria-expanded={open} aria-label={t.infoLabel(open)} title={t.infoLabel(open)} onClick={onToggle}>
      {t.info}
    </button>
  );
}

export function ViewSection({ id, icon, title, summary, info, empty = false, aside, children, testId }: {
  readonly id?: string;
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  /** 머리 옆 한 줄 요약 값(서버 값만) — 예: "3건 · 진행 중 1" */
  readonly summary?: ReactNode;
  /** 구역 설명(ⓘ 로 접힘) */
  readonly info?: ReactNode;
  /** true 면 몸통 없이 한 줄(요약에 "없음"류 문장) */
  readonly empty?: boolean;
  readonly aside?: ReactNode;
  readonly children?: ReactNode;
  readonly testId?: string;
}) {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <section id={id} className={`pm-vsec ${empty ? 'pm-vsec-empty' : ''}`} data-testid={testId}>
      <div className="pm-sec-head">
        {icon && <span className="pm-sec-icon">{icon}</span>}
        <h2 className="pm-sec-title">{title}</h2>
        {summary !== undefined && summary !== null && summary !== '' && <span className="pm-sec-sum">{summary}</span>}
        {info && <InfoButton open={showInfo} onToggle={() => setShowInfo((o) => !o)} />}
        {aside && <div className="pm-sec-aside">{aside}</div>}
      </div>
      {info && showInfo && <p className="pm-info-text pm-sec-info">{info}</p>}
      {!empty && children !== undefined && <div className="pm-sec-body">{children}</div>}
    </section>
  );
}

export function ActionSection({ id, title, summary, info, aside, children, testId }: {
  readonly aside?: ReactNode;
  readonly id?: string;
  /** 동사로 — "계정 제한 바꾸기" */
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
        <span className="pm-act-tag">처리</span>
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

/** 맨 위 요약 띠(시뮬레이터 라이더 카드처럼) — [이름, 값] 칸들. 값은 이미 읽은 서버 값만 */
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

/**
 * 구역 상자(공용 Section 과 같은 속성으로 덮음) — 모든 상세가 보기/처리 모양을 따르게.
 * action = 처리 구역(왼쪽 띠 + "처리"), info = 구역 설명(ⓘ), summary = 머리 옆 한 줄 요약 값.
 */
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