// 화면 틀 보탬 — MFC 백오피스 PageChrome 사본(2026-11-25) — 이 앱에서 따로 고친다.
// 1) 브라우저 탭 제목 "화면 | DC백오피스" 2) 인터넷 끊김 띠 3) '/' 키 → 이 화면 검색 조건 첫 칸 4) '?' 단축키 안내.
import { useEffect, useState, useSyncExternalStore } from 'react';

import { messages } from '../shared/messages';

const m = messages.chrome;
const BACK_MS = 4_000;
const TAB_APP = 'DC백오피스';

export function useDocumentTitle(screen: string | null) {
  const title = `${screen ? `${screen} | ` : ''}${TAB_APP}`;
  useEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(
    () => () => {
      document.title = TAB_APP;
    },
    [],
  );
}

const FIELD = ':is(input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea):not([disabled])';

/** '/' → 검색 조건 첫 칸 */
export function useSlashToSearch() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const form = document.querySelector<HTMLFormElement>('main form[data-list-part="top"]');
      if (!form) return;
      e.preventDefault();
      const focus = () => form.querySelector<HTMLElement>(FIELD)?.focus();
      if (form.hidden) {
        form.parentElement?.querySelector<HTMLButtonElement>('[data-testid="search-toggle"]')?.click();
        setTimeout(focus, 0);
      } else focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

const subscribe = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

export function ConnectionBanner() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  const [wasOffline, setWasOffline] = useState(false);
  const [back, setBack] = useState(false);
  if (!online && !wasOffline) setWasOffline(true);
  if (online && wasOffline) {
    setWasOffline(false);
    setBack(true);
  }
  useEffect(() => {
    if (!back) return;
    const t = setTimeout(() => setBack(false), BACK_MS);
    return () => clearTimeout(t);
  }, [back]);
  if (!online)
    return (
      <div role="alert" className="flex items-center gap-2 border-b border-warning/40 bg-warning/15 px-6 py-2 text-sm" data-testid="offline-banner">
        <span className="breathe h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden="true" />
        <strong>{m.offline}</strong>
        <span className="text-base-content/70">{m.offlineHint}</span>
      </div>
    );
  if (back)
    return (
      <div role="status" className="border-b border-success/30 bg-success/10 px-6 py-2 text-sm text-success" data-testid="online-again">
        {m.onlineAgain}
      </div>
    );
  return null;
}

/** 단축키 안내 — "?" 로 연다(입력 칸에서는 가로채지 않는다) */
export function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.key === '?') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const s = messages.shortcuts;
  return (
    <>
      <button type="button" className="btn btn-ghost btn-xs h-7 w-7 p-0 font-bold" onClick={() => setOpen(true)} aria-label={s.open} title={`${s.open} (?)`} data-testid="shortcut-help-button">
        ?
      </button>
      {open && (
        <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="shortcut-help-title" data-testid="shortcut-help" onClick={() => setOpen(false)}>
          <div className="modal-box max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 id="shortcut-help-title" className="text-base font-bold">
              {s.title}
            </h3>
            <dl className="mt-4 space-y-2.5 text-sm">
              {s.items.map((it) => (
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
                {s.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
