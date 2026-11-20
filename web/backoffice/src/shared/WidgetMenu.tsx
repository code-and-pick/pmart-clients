// 대시보드 위젯 메뉴(2026-11-20 AWS 개편 — 콘솔 홈 위젯의 ⋮ "제거"와 "기본 레이아웃으로 재설정").
// 위젯을 <Widget id> 로 감싸면 그 안의 구역 상자(Section) 제목줄 오른쪽에 ⋮ 가 생기고 "이 위젯 숨기기"를 고를 수 있다.
// 숨긴 위젯은 이 브라우저에만 기억한다(보는 사람 한 명의 편의 — 못 쓰는 환경이면 숨김 없이 모두 보인다).
// 끌어 옮기기는 하지 않는다: 대시보드 기둥 배치가 역할마다 맞춰져 있어 자리 바꾸기는 배치 모델을 새로 정해야 한다.
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';

import { messages as m } from './messages';

const KEY = 'pmart.backoffice.dashboard.hidden';

type Layout = { readonly hidden: ReadonlySet<string>; readonly hide: (id: string) => void; readonly reset: () => void };
const LayoutContext = createContext<Layout | null>(null);
const SlotContext = createContext<string | null>(null);

function read(): string[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(ids: readonly string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // 저장이 막힌 브라우저 — 이번 화면에서만
  }
}

export function DashboardLayoutProvider({ children }: { readonly children: ReactNode }) {
  const [hidden, setHidden] = useState<readonly string[]>(read);
  const hide = (id: string) =>
    setHidden((h) => {
      const next = h.includes(id) ? h : [...h, id];
      write(next);
      return next;
    });
  const reset = () => {
    write([]);
    setHidden([]);
  };
  return <LayoutContext.Provider value={{ hidden: new Set(hidden), hide, reset }}>{children}</LayoutContext.Provider>;
}

/** 위젯 자리 — 숨겼으면 그리지 않는다 */
export function Widget({ id, children }: { readonly id: string; readonly children: ReactNode }) {
  const layout = useContext(LayoutContext);
  if (layout?.hidden.has(id)) return null;
  return <SlotContext.Provider value={id}>{children}</SlotContext.Provider>;
}

/** 숨긴 위젯이 있으면 "숨긴 위젯 N개 · 기본 배치로" */
export function ResetLayout() {
  const layout = useContext(LayoutContext);
  if (!layout || layout.hidden.size === 0) return null;
  return (
    <span className="flex items-center gap-2 text-xs text-base-content/65" data-testid="dash-layout-reset">
      {m.dashboard.layout.hiddenCount(layout.hidden.size)}
      <button type="button" className="btn btn-sm" onClick={layout.reset}>
        {m.dashboard.layout.reset}
      </button>
    </span>
  );
}

/** 구역 상자 제목줄의 ⋮ — 위젯 자리 안에서만 그린다(상세 화면의 구역 상자에는 없음) */
export function WidgetMenuButton() {
  const slot = useContext(SlotContext);
  const layout = useContext(LayoutContext);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!slot || !layout) return null;
  return (
    <div className="relative" ref={box}>
      <button type="button" className="btn btn-ghost btn-sm h-7 w-7 p-0" aria-label={m.dashboard.layout.menu} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid={`widget-menu-${slot}`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>
      {open && (
        <ul role="menu" className="absolute right-0 z-30 mt-1 w-40 rounded-box border border-base-300 bg-base-100 py-1 text-sm shadow-lg">
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="w-full px-3 py-1.5 text-left hover:bg-base-200"
              onClick={() => {
                setOpen(false);
                layout.hide(slot);
              }}
            >
              {m.dashboard.layout.hide}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
