// 여러 개 고르는 드롭다운. 평소에는 닫힌 한 줄(고른 개수)로 보이고, 누르면 체크박스 목록이 펼쳐진다.
// 바깥을 누르거나 Esc 로 닫는다. 고른 값의 순서는 목록 순서를 따른다(목록에 없는 기존 값은 맨 앞에 그대로 둔다).
// 항목이 많으면(SEARCH_FROM 개 넘게) 펼친 목록 맨 위에 찾기 칸(2026-11-19 사용자 "데이터가 많아지면 일일이 찾기 힘들다") — 화면에서 거르기, 한글 초성도.
// 찾기로 가려진 항목도 고른 상태는 그대로다(거르기는 보이는 것만 바꾼다).
import { useEffect, useId, useRef, useState } from 'react';

import { useFloatingPanel } from './floatingPanel';

const SEARCH_FROM = 8;
const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const norm = (s: string) => s.toLowerCase().replace(/s+/g, '');
const chosungOf = (s: string) =>
  [...s]
    .map((ch) => {
      const c = ch.charCodeAt(0) - 0xac00;
      return c >= 0 && c <= 11171 ? CHO[Math.floor(c / 588)] : ch;
    })
    .join('');
/** 찾기 말이 이 항목 이름에 맞나(띄어쓰기·대소문자 무시, 자음만 넣으면 초성으로) */
export function optionMatches(label: string, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  const l = norm(label);
  return l.includes(q) || (/^[ㄱ-ㅎ]+$/.test(q) && chosungOf(l).includes(q));
}

export interface MultiSelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export function MultiSelectDropdown({
  label,
  options,
  value,
  onChange,
  placeholder,
  selectedText,
  disabled = false,
  className = '',
}: {
  readonly label: string;
  readonly options: readonly MultiSelectOption[];
  readonly value: readonly string[];
  readonly onChange: (next: string[]) => void;
  /** 아무것도 고르지 않았을 때 */
  readonly placeholder: string;
  /** 고른 개수 표시 */
  readonly selectedText: (count: number) => string;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchable = options.length > SEARCH_FROM;
  const shown = searchable ? options.filter((o) => optionMatches(o.label, query)) : options;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // 펼친 판은 화면 고정 자리(position: fixed)에 — 카드(overflow-hidden) 가장자리에서 잘리지 않게(2026-11-19)
  const float = useFloatingPanel(trigger, open);
  const labelId = useId();
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (root.current && !root.current.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const chosen = new Set(value);
  const known = new Set(options.map((o) => o.value));
  const toggle = (v: string) => {
    const next = new Set(chosen);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange([...value.filter((x) => !known.has(x)), ...options.filter((o) => next.has(o.value)).map((o) => o.value)]);
  };

  return (
    <div ref={root} className={`relative flex flex-col gap-1 text-sm ${className}`}>
      <span id={labelId}>{label}</span>
      <button
        ref={trigger}
        type="button"
        className="select select-sm w-full items-center text-left"
        aria-labelledby={labelId}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o);
          setQuery('');
        }}
      >
        <span className={value.length === 0 ? 'opacity-60' : ''}>{value.length === 0 ? placeholder : selectedText(value.length)}</span>
      </button>
      {open &&
        (
        <div ref={panel} style={float ?? { position: 'fixed', visibility: 'hidden' }} className="flex flex-col overflow-hidden rounded-box border border-base-300 bg-base-100 shadow">
          {searchable && (
            <div className="shrink-0 border-b border-base-300 p-1">
              <input
                type="search"
                className="input input-sm w-full"
                aria-label={`${label} 찾기`}
                placeholder="찾기 (초성도 돼요)"
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          <ul id={panelId} role="group" aria-labelledby={labelId} className="min-h-0 flex-1 overflow-auto p-1">
          {shown.length === 0 && <li className="px-2 py-1 text-base-content/50">맞는 것이 없어요.</li>}
          {shown.map((o) => (
            <li key={o.value}>
              <label className={`flex items-center gap-2 rounded px-2 py-1 ${o.disabled ? 'opacity-50' : 'cursor-pointer hover:bg-base-200'}`}>
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={chosen.has(o.value)}
                  disabled={o.disabled}
                  onChange={() => toggle(o.value)}
                />
                {o.label}
              </label>
            </li>
          ))}
          </ul>
        </div>
      )}
    </div>
  );
}
