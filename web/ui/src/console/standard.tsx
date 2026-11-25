// 백오피스 화면 기준 부품(@pmart/web-ui/standard, 2026-11-25 — PC 5 요청 docs/operations/2026-11-25-notice-backoffice-ui-standard.md, PC 2 사용자 "(가)로 진행").
// 정본은 라이더 백오피스 shared/simList.tsx·shared/admin.tsx(라이더 시뮬레이터 모양 — 2026-11-21~24 라이더 사용자 지적 반영)에서 올렸다.
// 앱은 shared/admin.tsx 에서 `export * from '@pmart/web-ui/console'` 다음에 `export { … } from '@pmart/web-ui/standard'` 로 같은 이름을 덮는다
// (직접 내보낸 이름이 export * 보다 먼저). 모양은 web/ui/src/standard.css — 앱 index.css 가 console.css 다음에 읽는다.
// 정보·기능은 줄이지 않는다: 긴 설명은 ⓘ 로 접고(누르면 그대로), 거르기는 모두 팝업 안에 남고, 건 조건은 칩으로 늘 보인다.
import { type ComponentProps, type CSSProperties, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router';

import { formatSeoul } from '../format';
import { messages as lm } from './messages';
import { type FilterProp, SectionMenuContext, StatCard as ConsoleStatCard, type Tone } from './parts';
import { DETAIL_BAR_SLOT, useScrolledPast } from './StickyTitle';

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
  // 기본은 가로(이름 왼쪽 위 굵게·숫자 오른쪽 28px) — 목록마다 같은 모양(2026-11-25 라이더 사용자 지적, PC 5 전달)
  const layout = p.layout ?? 'row';
  return zero ? <ConsoleStatCard {...p} layout={layout} tone={undefined} label={<span data-zero="">{name}</span>} /> : <ConsoleStatCard {...p} layout={layout} label={name} />;
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

/**
 * 뒤로 — 앱 안에서 넘어왔으면 브라우저 뒤로(목록의 거르기·스크롤·펼친 줄 그대로), 주소로 바로 열었으면 그 목록으로.
 * React Router 가 history.state.idx 에 앱 안 이동 순번을 적는다(0 = 이 탭의 첫 화면). 라이더 백오피스 useGoBack 과 같다.
 */
export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { readonly idx?: number } | null)?.idx ?? 0;
    if (idx > 0) void navigate(-1);
    else void navigate(fallback);
  };
}

/** 제목 왼쪽 둥근 ‹ 단추 — 이름은 읽기 도구·마우스 올리면만("홈 진열 편성으로") */
export function BackButton({ onClick, label, small = false }: { readonly onClick: () => void; readonly label: string; readonly small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid="detail-back"
      className={`btn btn-circle shrink-0 border-base-300 bg-base-100 ${small ? 'btn-xs text-base' : 'btn-sm text-xl'} leading-none`}
    >
      <span aria-hidden className="-mt-0.5">
        ‹
      </span>
    </button>
  );
}

/** 내려서 제목이 지나가면 위에 얇은 제목 띠(작은 ‹ + 제목 + 표시) — 단추(명령)는 복제하지 않는다 */
function StickyBand({ show, title, badges, onBack, backLabel }: { readonly show: boolean; readonly title: ReactNode; readonly badges?: ReactNode; readonly onBack?: () => void; readonly backLabel?: string }) {
  const slot = typeof document === 'undefined' ? null : document.getElementById(DETAIL_BAR_SLOT);
  if (!show || !slot) return null;
  return createPortal(
    <div className="flex items-center gap-3 border-b border-base-300 bg-base-100/95 px-6 py-2 backdrop-blur" data-testid="sticky-title">
      {onBack && backLabel && <BackButton onClick={onBack} label={backLabel} small />}
      <p className="min-w-0 truncate text-sm font-semibold">{title}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">{badges}</div>
    </div>,
    slot,
  );
}

/**
 * 쪽 머리 — 제목이 맨 위, 뒤로는 제목 왼쪽 둥근 ‹(제목 위 "‹ 목록" 글자 링크 없음). 오른쪽 이전·다음(nav)·주 동작.
 * 화면 설명(description)은 받기만 하고 그리지 않는다(라이더 사용자 2026-11-24 "제목 옆 안내 버튼 없애" — 도움말은 머리줄 도움 단추로).
 */
export function PageHeader({ title, actions, back, nav }: { readonly title: ReactNode; readonly description?: ReactNode; readonly actions?: ReactNode; readonly back?: { readonly to: string; readonly label: string }; readonly nav?: ReactNode }) {
  const goBack = useGoBack(back?.to ?? '/');
  return (
    <header className="pm-head">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {back && <BackButton onClick={goBack} label={back.label} />}
          <h1 className="min-w-0 text-2xl font-bold">{title}</h1>
        </div>
        {(nav || actions) && (
          <div className="flex flex-wrap items-center gap-2">
            {nav}
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

/**
 * 상세 머리 — 한 줄 [‹][제목][상태 점·꼬리표] … 오른쪽 위 이전·n/N·다음(nav)·동작. 제목 밑 요약은 8px 띄워 작고 옅게.
 * 내려서 제목이 지나가면 위에 얇은 제목 띠(작은 ‹ + 제목). 라이더 백오피스 DetailHeader 와 같은 모양(공용 콘솔과 같은 속성).
 */
export function DetailHeader({ back, title, badges, summary, actions, nav }: { readonly back: { readonly to: string; readonly label: string }; readonly title: ReactNode; readonly badges?: ReactNode; readonly summary?: ReactNode; readonly actions?: ReactNode; readonly nav?: ReactNode }) {
  const card = useRef<HTMLDivElement>(null);
  const past = useScrolledPast(card);
  const goBack = useGoBack(back.to);
  return (
    <header className="pm-head pm-head-detail">
      <StickyBand show={past} title={title} badges={badges} onBack={goBack} backLabel={back.label} />
      <div ref={card} className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <BackButton onClick={goBack} label={back.label} />
            <h1 className="text-2xl font-bold">{title}</h1>
            {badges}
          </div>
          {summary && <p className="text-sm text-base-content/60">{summary}</p>}
        </div>
        {(nav || actions) && (
          <div className="flex flex-col items-end gap-2">
            {nav && <div className="flex flex-wrap items-center justify-end gap-3 text-sm">{nav}</div>}
            {actions && <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>}
          </div>
        )}
      </div>
    </header>
  );
}

/** 화면 안내 — 그리지 않는다(라이더 사용자 2026-11-24 "화면 안내 … 다른 탭에서도 다 없애"). 부르는 쪽은 그대로 둬도 된다 */
export function GuideBox(props: { readonly title?: string; readonly items: readonly ReactNode[]; readonly storeKey?: string; readonly testId?: string; readonly tone?: 'info' | 'warning' }) {
  void props;
  return null;
}

/**
 * 항목명/값 — 항목명은 작은 회색, 값은 조금 크고 굵은 짙은 글자. 칸 폭 최소 11rem 으로 들어가는 만큼만 칸(두 줄 꺾임 없게), 칸 사이 왼쪽 선.
 * columns 는 공용과 맞춘 이름(받기만 — 칸 수는 폭이 정한다).
 */
export function FieldList({ rows, testId }: { readonly rows: ReadonlyArray<readonly [ReactNode, ReactNode] | false | null | undefined>; readonly testId?: string; readonly columns?: 2 | 4 }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-y-4 text-sm [&>div]:border-l [&>div]:border-base-300 [&>div]:pl-4 [&>div]:pr-4" data-testid={testId}>
      {rows.map((r, i) =>
        r ? (
          <div key={i} className="min-w-0 space-y-0.5">
            <dt className="text-xs font-medium text-base-content/55">{r[0]}</dt>
            <dd className="min-w-0 break-words text-[15px] font-semibold text-base-content">{r[1]}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}

/** 결과 줄 — 건수 알약 + 오른쪽 작은 정렬 글자(공용 ResultBar 와 같은 속성) */
export function ResultBar({ count, more, sort, extra, unit = '건' }: { readonly unit?: string; readonly count: number; readonly more?: boolean; readonly sort?: { readonly oldest: boolean; readonly onChange: (oldest: boolean) => void; readonly newest?: string; readonly oldestLabel?: string }; readonly extra?: ReactNode }) {
  return (
    <>
      {(sort || extra) && <ResultTools sort={sort} extra={extra} />}
      {/* 건수는 표 상자 안 머리줄 왼쪽 — 바로 뒤 표(data-list-part)와 한 상자로 붙는다 */}
      <p className="pm-resbar-head" data-list-part="mid" data-testid="result-count">
        <span className="font-bold text-base-content">{count}</span>
        {more ? `${unit} 이상` : unit}
      </p>
    </>
  );
}

function ResultTools({ sort, extra }: { readonly sort?: { readonly oldest: boolean; readonly onChange: (oldest: boolean) => void; readonly newest?: string; readonly oldestLabel?: string } | undefined; readonly extra?: ReactNode }) {
  return (
    <div className="pm-resbar-tools">
      <div className="flex items-center gap-3">
        {extra}
        {sort && (
          <div role="radiogroup" aria-label="정렬" className="flex items-center">
            <button type="button" role="radio" aria-checked={!sort.oldest} onClick={() => sort.onChange(false)}>
              {sort.newest ?? '최신순'}
            </button>
            <button type="button" role="radio" aria-checked={sort.oldest} onClick={() => sort.onChange(true)}>
              {sort.oldestLabel ?? '과거순'}
            </button>
          </div>
        )}
      </div>
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
  void onReset;
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
              {/* "모두 지우기"는 없앴다(라이더 사용자 2026-11-24) — 칩마다 ✕, 고른 값을 다시 누르면 풀림 */}
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

const pf = {
  field: '찾을 항목',
  box: '찾기 칸',
  find: '찾기',
  hint: (label: string) => `${label}로 찾기`,
} as const;

/**
 * 속성 필터(공용 PropertyFilter 와 같은 이름·속성으로 덮음 — 목록 화면마다 한 번에 같은 틀).
 * 한 줄: [lead(저장한 보기)][찾을 항목 ▾][찾기 칸][찾기] | [필터 → 팝업: 속성마다 값 목록(✓)][건 조건 칩 ✕] … [aside][tail].
 * - 글자 값 속성(text — 번호·연락처 등)은 왼쪽 찾기 칸. 여럿이면 "찾을 항목"을 고른다. 찾기를 누르거나 Enter 면 그 속성 = 친 값.
 * - 값 고르기 속성(options)은 필터 팝업 안. 고르면 바로 걸리고, 건 값을 한 번 더 누르면 풀린다. 팝업은 늘 그려 두고 닫히면 숨김.
 * - 속성마다 값 하나(서버 조건이 하나씩) — 예전과 같다. 칩 = "속성 값 ✕".
 */
export function PropertyFilter({ props, value, onChange, testId, aside, lead, tail }: {
  readonly props: readonly FilterProp[];
  readonly value: Readonly<Record<string, string | undefined>>;
  readonly onChange: (patch: Readonly<Record<string, string | null>>) => void;
  readonly testId?: string;
  readonly aside?: ReactNode;
  readonly lead?: ReactNode;
  readonly tail?: ReactNode;
}) {
  const textProps = props.filter((p) => p.text);
  const optionProps = props.filter((p) => !p.text && (p.options ?? []).length > 0);
  // 찾기 칸은 지금 걸린 글자 값을 그대로 보인다(칩에 두 번 보이지 않게) — 처음엔 값이 걸린 첫 글자 속성.
  // 단 show 로 바꿔 보이는 값(시스템 ID 를 그대로 보이지 않게, ADR-0070 — "한 고객" 등)은 칸에 넣지 않고 칩으로 남긴다.
  const inBox = (p: FilterProp, v: string | undefined) => !!v && (!p.text?.show || p.text.show(v) === v);
  const [field, setField] = useState((textProps.find((p) => inBox(p, value[p.key])) ?? textProps[0])?.key ?? '');
  const fieldProp = textProps.find((p) => p.key === field);
  const shownValue = fieldProp && inBox(fieldProp, value[field]) ? (value[field] ?? '') : '';
  const [text, setText] = useState(shownValue);
  const [synced, setSynced] = useState(shownValue);
  if (synced !== shownValue) {
    setSynced(shownValue);
    setText(shownValue);
  }
  const [open, setOpen] = useState(false);
  const popId = useId();
  const cur = textProps.find((p) => p.key === field) ?? textProps[0];
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const chips = props.flatMap((p) => {
    const v = value[p.key];
    // 찾기 칸에 보이는 값은 칩으로 다시 보이지 않는다(라이더 사용자 2026-11-24)
    if (!v || (p.key === field && inBox(p, v))) return [];
    if (p.text) return [{ key: p.key, label: p.label, shown: p.text.show ? p.text.show(v) : v }];
    const o = p.options?.find((x) => x.value === v);
    return o ? [{ key: p.key, label: p.label, shown: o.chip ?? o.label }] : [];
  });
  const optionChips = chips.filter((c) => optionProps.some((p) => p.key === c.key)).length;
  const find = () => {
    if (!cur) return;
    const q = text.trim();
    // 칸을 비우고 찾기 = 그 조건 풀기
    onChange({ [cur.key]: q || null });
  };
  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="pm-fbar" role="search" aria-label={lm.listUi.filterPlaceholder}>
        {lead}
        {cur && (
          <>
            <div className="pm-fbar-q">
              {textProps.length > 1 && (
                <select className="select select-sm w-auto" aria-label={pf.field} value={cur.key} onChange={(e) => setField(e.target.value)}>
                  {textProps.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              )}
              <label className="input input-sm w-64">
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current opacity-60" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  type="search"
                  className="grow"
                  aria-label={pf.box}
                  placeholder={cur.text?.hint ?? pf.hint(cur.label)}
                  value={text}
                  maxLength={cur.text?.maxLength}
                  inputMode={cur.text?.numeric ? 'numeric' : undefined}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      find();
                    }
                  }}
                />
              </label>
            </div>
            <button type="button" className="btn btn-sm btn-primary" onClick={find}>
              {pf.find}
            </button>
          </>
        )}
        {optionProps.length > 0 && (
          <div className="pm-fwrap">
            <button
              type="button"
              className={`pm-funnel ${optionChips > 0 ? 'on' : ''}`}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-controls={popId}
              aria-label={t.funnelOpen(optionChips)}
              title={t.funnel}
              onClick={() => setOpen((o) => !o)}
              data-testid="filter-toggle"
            >
              <span aria-hidden="true">{t.filterWord}</span>
              {optionChips > 0 && <span className="pm-funnel-n">{optionChips}</span>}
            </button>
            {open && <div className="pm-pop-back" onClick={() => setOpen(false)} aria-hidden="true" />}
            <div className="pm-pop" id={popId} role="group" aria-label={t.funnel} data-testid="filter-popup" data-open={open ? '' : undefined}>
              <div className="pm-pop-grid">
                {optionProps.map((p) => (
                  <div key={p.key} className="pm-pop-sec">
                    <div className="pm-pop-h">{p.label}</div>
                    <div role="radiogroup" aria-label={p.label}>
                      {(p.options ?? []).map((o) => {
                        const on = value[p.key] === o.value;
                        return (
                          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange({ [p.key]: on ? null : o.value })}>
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="pm-pop-foot">
                <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
                  {t.close}
                </button>
              </div>
            </div>
          </div>
        )}
        {chips.map((c) => (
          <span key={c.key} className="pm-fchip" data-testid="filter-chip">
            <span className="pm-fchip-k">{c.label}</span>
            <span className="ml-1">{c.shown}</span>
            <button type="button" className="pm-fchip-x" aria-label={lm.listUi.removeChip(`${c.label} = ${c.shown}`)} onClick={() => onChange({ [c.key]: null })}>
              ✕
            </button>
          </span>
        ))}
        {(aside || tail) && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {aside}
            {tail}
          </div>
        )}
      </div>
    </div>
  );
}

/** 목록 머리(공용 ListHeader 와 같은 속성) — 제목 + (개수) + ⓘ(도움말 패널), 오른쪽 읽은 시각·새로 고침·주 동작 */
export function ListHeader({ title, count, onInfo, refresh, actions }: {
  readonly title: string;
  readonly count?: string | undefined;
  readonly onInfo?: (() => void) | undefined;
  readonly refresh?: { readonly onClick: () => void; readonly busy: boolean; readonly readAt?: number | undefined } | undefined;
  readonly actions?: ReactNode;
}) {
  const readAt = refresh?.readAt ? new Date(refresh.readAt) : null;
  void onInfo;
  return (
    <header className="pm-head flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="text-2xl font-bold">{title}</h1>
        {count !== undefined && (
          <span className="text-xl text-base-content/50 tabular-nums" data-testid="list-count">
            ({count})
          </span>
        )}
        {/* 제목 옆 ⓘ 는 그리지 않는다(라이더 사용자 2026-11-24) — 도움말은 머리줄 도움 단추(help-toggle). onInfo 는 받기만 */}
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
