// 날짜·시각 칸(2026-11-24 사용자 "시간 선택하는 거 다른 방식 없음? … 마우스 스크롤로 내릴 수 있게, 분이 59분 넘기면 시간이 +1시간,
// 오전 오후도 알아서 바뀌게"). 브라우저 기본 datetime-local 달력(분 60개 목록·오전/오후 따로 누르기) 대신.
// - 값은 datetime-local 과 같은 'YYYY-MM-DDTHH:mm'(시간대 없음 — 부르는 쪽이 지금처럼 서울 시각으로 바꾼다), 빈 값은 ''.
// - 시·분·오전/오후 세 줄은 휠로 돌린다. 셋 다 "전체 시각"에 ±1분·±1시간·±12시간을 더하는 것이라
//   59분 → 00분이면 시가 오르고, 11시 → 12시면 오전/오후가 바뀌고, 오후 11시 → 오전 12시면 날짜가 다음 날로 넘어간다.
// - 칸에 직접 쳐도 된다(2026-11-24 13:00 · 2026-11-24 오후 1:00 · 2026-11-24T13:00).
// - min 보다 이른 시각으로는 돌아가지 않고, min 날짜 앞 날은 고를 수 없다.
// - 펼친 칸은 이름표(label) 밖 — body(대화 상자 안이면 그 상자)에 띄운다. label 안에 두면 달력 단추까지 칸 이름을 달고 누를 때 칸이 눌린다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal, flushSync } from 'react-dom';

const T = {
  placeholder: '연도-월-일 --:--',
  prevMonth: '이전 달',
  nextMonth: '다음 달',
  hour: '시',
  minute: '분',
  half: '오전/오후',
  am: '오전',
  pm: '오후',
  clear: '지우기',
  now: '지금',
  week: ['일', '월', '화', '수', '목', '금', '토'],
} as const;

const p2 = (n: number) => String(n).padStart(2, '0');
const MIN = 60_000;

/** 'YYYY-MM-DDTHH:mm' → 분 단위 시각(UTC 로 셈 — 시간대·서머타임 없이 글자 그대로) */
export function parseLocal(v: string): number | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!r) return null;
  const [y, mo, d, h, mi] = r.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const t = Date.UTC(y, mo - 1, d, h, mi);
  return new Date(t).getUTCDate() === d ? t : null; // 2월 30일 같은 날 막기
}
export function formatLocal(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
/** 칸에 보이는 글자: 2026-11-24 오전 09:53 */
export function displayLocal(v: string): string {
  const t = parseLocal(v);
  if (t === null) return '';
  const d = new Date(t);
  const h = d.getUTCHours();
  return `${v.slice(0, 10)} ${h < 12 ? T.am : T.pm} ${p2(h % 12 === 0 ? 12 : h % 12)}:${p2(d.getUTCMinutes())}`;
}
/** 친 글자 → 값. 2026-11-24 13:00 · 2026-11-24 오후 1:00 · 2026-11-24T13:00 · 2026.11.24 13:00 */
export function parseTyped(s: string): string | null {
  const r = /^\s*(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?\s*(?:T|\s)\s*(?:(오전|오후|AM|PM|am|pm)\s*)?(\d{1,2}):(\d{2})\s*$/.exec(s);
  if (!r) return null;
  const [, y, mo, d, half, hh, mm] = r as unknown as [string, string, string, string, string | undefined, string, string];
  let h = Number(hh);
  if (half) {
    if (h < 1 || h > 12) return null;
    const pm = half === '오후' || half.toLowerCase() === 'pm';
    h = (h % 12) + (pm ? 12 : 0);
  }
  const v = `${y}-${p2(Number(mo))}-${p2(Number(d))}T${p2(h)}:${mm}`;
  return parseLocal(v) === null ? null : v;
}
/** 지금(이 기기 시각, 분 단위) */
const nowLocal = () => {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes());
};

/** 휠 한 칸 = 마우스 한 눈금(≈100px). 터치패드는 잘게 와서 모은다. */
const WHEEL_STEP = 100;
const ROW = 32; // 줄 한 칸 높이(px)
/** 휠 한 번에 몇 칸인지 — px·줄·쪽 단위를 px 로 */
const wheelPx = (e: WheelEvent) => (e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY);

/** 달력 달 넘기기처럼 칸만 세는 휠(움직임 없음) */
function useWheelSteps(onStep: (n: number) => void) {
  const acc = useRef(0);
  const cb = useRef(onStep);
  useLayoutEffect(() => {
    cb.current = onStep;
  });
  // React onWheel 은 passive 라 페이지 스크롤을 막지 못한다 — 직접 붙인다
  return useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const on = (e: WheelEvent) => {
      e.preventDefault();
      acc.current += wheelPx(e);
      const n = Math.trunc(acc.current / WHEEL_STEP);
      if (n) {
        acc.current -= n * WHEEL_STEP;
        cb.current(n);
      }
    };
    el.addEventListener('wheel', on, { passive: false });
    return () => el.removeEventListener('wheel', on);
  }, []);
}

/** 지금 그려진 세로 이동(px) — 넘어가는 중이면 그 순간 자리 */
const shownY = (el: HTMLElement) => {
  if (typeof DOMMatrixReadOnly === 'undefined') return 0;
  const t = getComputedStyle(el).transform;
  return t && t !== 'none' ? new DOMMatrixReadOnly(t).m42 : 0;
};

/**
 * 돌리는 줄 하나(2026-11-24 사용자 "시간 내릴 때 자연스럽게 내려가게"): 가운데가 지금 값, 위아래 두 칸씩 보인다.
 * 줄 묶음(7칸)을 미끄러뜨려 움직인다 — 마우스 한 눈금이면 한 칸이 스르륵, 터치패드는 손가락을 따라가다 가까운 칸에 멈춘다.
 * 값이 바뀌면 새 줄이 그려지므로, 그려지기 직전 자리(한 칸 아래)에서 제자리로 옮겨 이어 보이게 한다.
 */
function Wheel({ label, rows, onStep, testId }: { readonly label: string; readonly rows: readonly string[]; readonly onStep: (n: number) => void; readonly testId: string }) {
  const list = useRef<HTMLDivElement>(null);
  const acc = useRef(0); // 아직 한 칸이 안 된 휠 양(px)
  const pending = useRef(0); // 값이 바뀌어 새로 그릴 때 더할 자리(px)
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cb = useRef(onStep);
  useLayoutEffect(() => {
    cb.current = onStep;
  });
  const key = rows.join('|');
  const lastKey = useRef(key);

  const move = useCallback((from: number | null, to: number) => {
    const el = list.current;
    if (!el) return;
    if (from !== null) {
      el.style.transition = 'none';
      el.style.transform = `translateY(${from}px)`;
      void el.offsetHeight; // 시작 자리를 먼저 그리게
    }
    el.style.transition = 'transform 160ms ease-out';
    el.style.transform = `translateY(${to}px)`;
  }, []);
  const step = useCallback(
    (n: number) => {
      if (!n) return;
      pending.current += n * ROW;
      // 바로 다시 그려 새 줄이 그려진 자리에서 이어 움직이게(아래 useLayoutEffect) — 기다리면 한 칸이 툭 바뀐다
      flushSync(() => cb.current(n));
      // 값이 그대로면(min 에 막힘) 새로 그려지지 않는다 — 제자리로만
      if (pending.current) {
        pending.current = 0;
        move(null, -(acc.current / WHEEL_STEP) * ROW);
      }
    },
    [move],
  );

  // 값이 바뀌어 새 줄이 그려졌다 — 방금 보이던 자리에서 이어 움직이기
  useLayoutEffect(() => {
    if (key === lastKey.current) return;
    lastKey.current = key;
    const el = list.current;
    if (el && pending.current) {
      const from = shownY(el) + pending.current;
      pending.current = 0;
      move(from, -(acc.current / WHEEL_STEP) * ROW);
    }
  }, [key, move]);

  const wheelRef = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      const on = (e: WheelEvent) => {
        e.preventDefault();
        acc.current += wheelPx(e);
        const n = Math.trunc(acc.current / WHEEL_STEP);
        acc.current -= n * WHEEL_STEP;
        if (n) step(n);
        else move(null, -(acc.current / WHEEL_STEP) * ROW);
        // 멈추면 가까운 칸에 선다
        clearTimeout(idle.current);
        idle.current = setTimeout(() => {
          const a = acc.current;
          acc.current = 0;
          if (Math.abs(a) >= WHEEL_STEP / 2) step(Math.sign(a));
          else move(null, 0);
        }, 160);
      };
      el.addEventListener('wheel', on, { passive: false });
      return () => {
        el.removeEventListener('wheel', on);
        clearTimeout(idle.current);
      };
    },
    [move, step],
  );

  return (
    <div
      ref={wheelRef}
      role="spinbutton"
      aria-label={label}
      aria-valuetext={rows[3]}
      tabIndex={0}
      data-testid={testId}
      className="relative h-40 w-14 cursor-ns-resize select-none overflow-hidden rounded outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      onKeyDown={(e) => {
        const n = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'PageDown' ? 10 : e.key === 'PageUp' ? -10 : 0;
        if (n) {
          e.preventDefault();
          step(n);
        }
      }}
    >
      {/* 7칸 — 위아래 한 칸씩은 창 밖(움직일 때 들어온다) */}
      <div ref={list} className="absolute inset-x-0 -top-8 flex flex-col">
        {rows.map((r, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            aria-hidden={i !== 3}
            className={`relative h-8 shrink-0 text-sm tabular-nums ${i === 3 ? 'font-semibold text-primary' : Math.abs(i - 3) === 1 ? 'text-base-content/70 hover:text-base-content' : 'text-base-content/35 hover:text-base-content/70'}`}
            onClick={() => i !== 3 && r !== '' && step(i - 3)}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}

const PANEL_W = 420;
const PANEL_H = 268;

export function DateTimeField({
  value,
  onChange,
  min,
  disabled,
  className = 'input input-sm',
  id,
  'aria-label': ariaLabel,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** 이보다 이른 시각은 고르지 않는다('YYYY-MM-DDTHH:mm') */
  readonly min?: string | undefined;
  readonly disabled?: boolean | undefined;
  /** 칸(input) 모양 — 지금 쓰던 input 클래스 그대로 */
  readonly className?: string;
  readonly id?: string;
  readonly 'aria-label'?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null); // 펼친 칸을 붙일 곳(열 때 정한다)
  const [draft, setDraft] = useState<string | null>(null); // 치는 중인 글자
  const cur = parseLocal(value);
  const minT = min ? parseLocal(min) : null;
  const [month, setMonth] = useState(() => {
    const d = new Date(cur ?? nowLocal());
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });
  const [pos, setPos] = useState<CSSProperties | null>(null);

  const clamp = (t: number) => (minT !== null && t < minT ? minT : t);
  const set = (t: number) => {
    const c = clamp(t);
    onChange(formatLocal(c));
    const d = new Date(c);
    setMonth({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  };
  /** 시각 줄을 돌린다 — 빈 칸이면 지금부터 */
  const shift = (minutes: number) => set((cur ?? nowLocal()) + minutes * MIN);

  const isDisabled = () => !!input.current?.matches(':disabled');
  const openPanel = () => {
    if (isDisabled() || open) return;
    const d = new Date(cur ?? nowLocal());
    setMonth({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
    setHost(input.current?.closest('dialog') ?? document.body);
    setOpen(true);
  };

  // 자리: 칸 바로 아래(모자라면 위), 화면 오른쪽을 넘지 않게. fixed — 카드의 overflow 에 잘리지 않는다.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = input.current?.getBoundingClientRect();
      if (!r) return;
      const up = window.innerHeight - r.bottom < PANEL_H + 8 && r.top > window.innerHeight - r.bottom;
      setPos({
        position: 'fixed',
        zIndex: 60,
        left: Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8)),
        ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  // 바깥을 누르거나 Esc 면 닫기
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        input.current?.focus();
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const monthWheel = useWheelSteps((n) => setMonth(({ y, m }) => ({ y: y + Math.floor((m + n) / 12), m: (((m + n) % 12) + 12) % 12 })));

  // 달력 6주
  const first = Date.UTC(month.y, month.m, 1);
  const start = first - new Date(first).getUTCDay() * 86_400_000;
  const days = Array.from({ length: 42 }, (_, i) => start + i * 86_400_000);
  const curDay = cur !== null ? formatLocal(cur).slice(0, 10) : '';
  const today = formatLocal(nowLocal()).slice(0, 10);
  const minDay = minT !== null ? formatLocal(minT).slice(0, 10) : '';
  const pickDay = (dayT: number) => {
    const timePart = cur !== null ? cur % 86_400_000 : 0; // 시각은 그대로(빈 칸이면 0시)
    set(dayT + timePart);
  };

  // 시각 줄에 보일 글자(가운데 = 지금 값)
  const base = cur ?? nowLocal();
  const rowsOf = (stepMin: number, fmt: (t: number) => string) => [-3, -2, -1, 0, 1, 2, 3].map((k) => fmt(base + k * stepMin * MIN));
  const hourRows = rowsOf(60, (t) => {
    const h = new Date(t).getUTCHours() % 12;
    return p2(h === 0 ? 12 : h);
  });
  const minuteRows = rowsOf(1, (t) => p2(new Date(t).getUTCMinutes()));
  const halfOf = (t: number) => (new Date(t).getUTCHours() < 12 ? T.am : T.pm);
  const halfRows = ['', '', halfOf(base - 12 * 60 * MIN), halfOf(base), halfOf(base + 12 * 60 * MIN), '', ''];

  return (
    <span ref={box} className="relative inline-flex w-fit max-w-full">
      <input
        ref={input}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        placeholder={T.placeholder}
        className={`${className} pr-8`}
        value={draft ?? displayLocal(value)}
        disabled={disabled}
        onClick={openPanel}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            openPanel();
          } else if (e.key === 'Tab') setOpen(false);
          else if (e.key === 'Enter' && draft !== null) {
            e.preventDefault();
            setDraft(null);
          }
        }}
        onChange={(e) => {
          const s = e.target.value;
          if (s.trim() === '') {
            setDraft(null);
            onChange('');
            return;
          }
          const v = parseTyped(s);
          if (v) {
            setDraft(null);
            const t = parseLocal(v)!;
            onChange(formatLocal(clamp(t)));
          } else setDraft(s);
        }}
        onBlur={() => setDraft(null)}
      />
      {/* 달력 표시(누르면 칸을 누른 것과 같다) */}
      <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/60" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="5" width="17" height="15" rx="2" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </svg>
      {open && pos && host && createPortal(
        <div ref={panel} role="dialog" aria-label={ariaLabel ?? T.placeholder} data-testid="datetime-panel" style={{ ...pos, width: PANEL_W }} className="flex rounded-md border border-base-300 bg-base-100 text-base-content shadow-lg">
          {/* 달력 */}
          <div ref={monthWheel} className="flex w-[244px] flex-col p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-semibold">
                {month.y}년 {month.m + 1}월
              </span>
              <span className="flex">
                <button type="button" className="btn btn-ghost btn-xs h-7 w-7 p-0" aria-label={T.prevMonth} onClick={() => setMonth(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}>
                  ‹
                </button>
                <button type="button" className="btn btn-ghost btn-xs h-7 w-7 p-0" aria-label={T.nextMonth} onClick={() => setMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}>
                  ›
                </button>
              </span>
            </div>
            <div className="grid grid-cols-7 text-center text-xs">
              {T.week.map((w, i) => (
                <span key={w} className={`py-1 ${i === 0 ? 'text-error/80' : 'text-base-content/55'}`}>
                  {w}
                </span>
              ))}
              {days.map((t) => {
                const key = formatLocal(t).slice(0, 10);
                const d = new Date(t);
                const inMonth = d.getUTCMonth() === month.m;
                const picked = key === curDay;
                const blocked = minDay !== '' && key < minDay;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={blocked}
                    aria-label={key}
                    aria-pressed={picked}
                    onClick={() => pickDay(t)}
                    className={`m-px h-7 rounded text-xs tabular-nums disabled:cursor-not-allowed disabled:opacity-30 ${picked ? 'bg-primary font-semibold text-primary-content' : key === today ? 'font-semibold text-primary ring-1 ring-inset ring-primary/40 hover:bg-base-200' : inMonth ? 'hover:bg-base-200' : 'text-base-content/35 hover:bg-base-200'}`}
                  >
                    {d.getUTCDate()}
                  </button>
                );
              })}
            </div>
            <div className="mt-auto flex justify-between pt-1 text-xs">
              <button type="button" className="text-primary hover:underline disabled:opacity-40" disabled={!value} onClick={() => onChange('')}>
                {T.clear}
              </button>
              <button type="button" className="text-primary hover:underline" onClick={() => set(nowLocal())}>
                {T.now}
              </button>
            </div>
          </div>
          {/* 시각: 시 · 분 · 오전/오후 — 휠로 돌린다 */}
          <div className="flex flex-1 flex-col border-l border-base-300 p-3">
            <div className="mb-1 flex justify-around text-xs text-base-content/55">
              <span className="w-14 text-center">{T.hour}</span>
              <span className="w-14 text-center">{T.minute}</span>
              <span className="w-14 text-center">&nbsp;</span>
            </div>
            <div className="relative flex justify-around">
              {/* 고른 줄: 세 줄을 잇는 옅은 띠 + 파란 굵은 글자(2026-11-24 사용자 "파란색 배경 눈 아픈데" — 진한 파랑 칸 세 개 대신) */}
              <span aria-hidden data-testid="wheel-band" className="pointer-events-none absolute inset-x-0 top-16 h-8 rounded-md bg-primary/10" />
              <Wheel label={T.hour} testId="wheel-hour" rows={hourRows} onStep={(n) => shift(n * 60)} />
              <Wheel label={T.minute} testId="wheel-minute" rows={minuteRows} onStep={(n) => shift(n)} />
              <Wheel label={T.half} testId="wheel-half" rows={halfRows} onStep={(n) => shift(Math.sign(n) * 12 * 60)} />
            </div>
          </div>
        </div>,
        host,
      )}
    </span>
  );
}
