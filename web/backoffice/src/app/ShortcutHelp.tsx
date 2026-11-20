// 단축키 안내(2026-11-19 — Ctrl+K·↑↓·Esc 가 있는데 화면 어디에도 적혀 있지 않았다. Linear·Shopify 처럼 "?" 로 연다).
// 입력 칸에 있을 때 누른 "?" 는 가로채지 않는다(그대로 글자). 안내는 화면 안 상자(브라우저 창 띄우지 않음).
import { useEffect, useState } from 'react';

import { messages as m } from '../shared/messages';

export function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.key === '?') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // 이 화면 속성 필터(2026-11-20 AWS 개편) 또는 검색 조건(SearchPanel)의 첫 입력 칸으로(2026-11-19). 둘 다 없는 화면이면 아무 일 없음
        const first =
          document.querySelector<HTMLElement>('main [role=combobox][aria-label="속성으로 거르기"]') ??
          document.querySelector<HTMLElement>('main form[data-list-part="top"] :is(input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea):not([disabled])');
        if (first) {
          e.preventDefault();
          first.focus();
        }
      } else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      <button type="button" className="btn btn-ghost btn-xs h-8 w-8 p-0 text-sm font-bold" onClick={() => setOpen(true)} aria-label={m.shortcuts.open} title={`${m.shortcuts.open} (?)`} data-testid="shortcut-help-button">
        ?
      </button>
      {open && (
        <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="shortcut-help-title" data-testid="shortcut-help" onClick={() => setOpen(false)}>
          <div className="modal-box max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 id="shortcut-help-title" className="text-base font-bold">
              {m.shortcuts.title}
            </h3>
            <dl className="mt-4 space-y-2.5 text-sm">
              {m.shortcuts.items.map((it) => (
                <div key={it.what} className="flex items-center justify-between gap-4">
                  <dt className="text-base-content/75">{it.what}</dt>
                  <dd className="flex shrink-0 gap-1">
                    {it.keys.map((k) => (
                      <kbd key={k} className="kbd kbd-sm">
                        {k}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="modal-action mt-5">
              <button type="button" className="btn btn-sm" onClick={() => setOpen(false)} autoFocus>
                {m.shortcuts.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
