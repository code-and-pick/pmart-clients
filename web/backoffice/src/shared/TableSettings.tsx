// 표 설정 톱니(2026-11-20 AWS "표 설정" — 기준 문서 §3-6). 칸 켜고 끄기·줄 바꿈. 이 브라우저에만 기억(보는 사람 한 명의 편의).
// 어느 표든 id 로 붙는다: 머리 칸(th) 이름을 읽어 목록을 만들고, 숨긴 칸은 그 표에만 CSS 로 감춘다(자료·조회는 그대로).
// 첫 칸(이름·번호 — 줄을 알아보는 칸)은 끌 수 없다. 쪽 크기는 서버 조회 size 라 여기서 바꾸지 않는다.
import { useEffect, useRef, useState } from 'react';

import { messages } from './messages';

const m = messages.tableSettings;
type Saved = { readonly hidden: readonly number[]; readonly wrap: boolean };
const EMPTY: Saved = { hidden: [], wrap: false };

function read(key: string): Saved {
  try {
    const v = JSON.parse(window.localStorage.getItem(`pmart.backoffice.table.${key}`) ?? 'null') as Partial<Saved> | null;
    return { hidden: Array.isArray(v?.hidden) ? v.hidden.filter((n): n is number => typeof n === 'number' && n > 0) : [], wrap: v?.wrap === true };
  } catch {
    return EMPTY;
  }
}
function write(key: string, v: Saved) {
  try {
    window.localStorage.setItem(`pmart.backoffice.table.${key}`, JSON.stringify(v));
  } catch {
    // 저장이 막힌 브라우저 — 이번 화면에서만
  }
}

export function TableSettings({ storeKey, tableId }: { readonly storeKey: string; readonly tableId: string }) {
  const [saved, setSaved] = useState<Saved>(() => read(storeKey));
  const [open, setOpen] = useState(false);
  const [cols, setCols] = useState<readonly string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  // 머리 칸 이름 — 열 때마다 다시 읽는다(역할에 따라 칸이 다를 수 있다)
  const readCols = () => [...document.querySelectorAll<HTMLTableCellElement>(`#${CSS.escape(tableId)} thead th`)].map((th, i) => th.textContent.trim() || m.unnamed(i + 1));
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
  const save = (v: Saved) => {
    setSaved(v);
    write(storeKey, v);
  };
  const sel = `#${CSS.escape(tableId)}`;
  const css = [
    ...saved.hidden.map((i) => `${sel} tr > :nth-child(${i + 1}) { display: none; }`),
    saved.wrap ? `${sel} td, ${sel} th { white-space: normal !important; }` : `${sel} td { white-space: nowrap; }`,
  ].join('\n');
  return (
    <div className="relative" ref={box}>
      <style>{css}</style>
      <button type="button" className="btn btn-ghost btn-sm h-8 w-8 p-0" aria-label={m.open} title={m.open} aria-haspopup="dialog" aria-expanded={open} onClick={() => {
          if (!open) setCols(readCols());
          setOpen((o) => !o);
        }} data-testid={`table-settings-${storeKey}`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      </button>
      {open && (
        <div role="dialog" aria-label={m.title} className="absolute right-0 z-30 mt-1 w-72 space-y-3 rounded-box border border-base-300 bg-base-100 p-4 text-sm shadow-lg">
          <p className="font-bold">{m.title}</p>
          <fieldset className="space-y-1.5">
            <legend className="mb-1 font-semibold text-base-content/80">{m.columns}</legend>
            {cols.map((name, i) => (
              <label key={`${i}-${name}`} className="flex items-center justify-between gap-2">
                <span className={i === 0 ? 'text-base-content/60' : ''}>{name}</span>
                <input
                  type="checkbox"
                  className="toggle toggle-sm toggle-primary"
                  checked={!saved.hidden.includes(i)}
                  disabled={i === 0}
                  aria-label={name}
                  onChange={(e) => save({ ...saved, hidden: e.target.checked ? saved.hidden.filter((x) => x !== i) : [...saved.hidden, i] })}
                />
              </label>
            ))}
          </fieldset>
          <label className="flex items-center justify-between gap-2 border-t border-base-300 pt-3">
            <span className="font-semibold text-base-content/80">{m.wrap}</span>
            <input type="checkbox" className="toggle toggle-sm toggle-primary" checked={saved.wrap} onChange={(e) => save({ ...saved, wrap: e.target.checked })} aria-label={m.wrap} />
          </label>
          <div className="flex justify-end">
            <button type="button" className="btn btn-sm" onClick={() => save(EMPTY)}>
              {m.reset}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
