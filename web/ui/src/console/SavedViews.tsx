// 공용 @pmart/web-ui/console(2026-11-20 — web/backoffice 에서 올림, ADR-0004 넓히기). 고칠 때는 이 파일을 고친다(앱마다 사본 아님).
// 목록 "내 보기"(2026-11-18 사용자 "참고 사이트 조합" — Saleor 대시보드의 저장된 필터 참고).
// 목록 필터는 이미 주소(URL 쿼리)에 있으니, 지금 주소의 조건에 이름을 붙여 저장하고 한 번에 다시 연다.
// 저장은 이 브라우저에만(localStorage — 보는 사람 한 명의 편의, 서버·다른 사람과 나누지 않음). 못 쓰는 환경이면 조용히 빈 목록.
// 개인정보: 주소 쿼리에 연락처 같은 값이 있으면 저장하지 않는다(PII_PARAMS).
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';

import { messages } from './messages';

const m = messages.savedViews;
const MAX = 12;
/** 주소에 있어도 내 보기로 저장하지 않는 조건(개인정보·한 건만 가리키는 값) */
const PII_PARAMS = ['phone', 'receiverPhone', 'contact', 'q'];

export interface SavedView {
  readonly name: string;
  readonly search: string;
}

const storeKey = (listKey: string) => `pmart.backoffice.views.${listKey}`;

export function loadViews(listKey: string): SavedView[] {
  try {
    const raw = window.localStorage.getItem(storeKey(listKey));
    const v: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(v)) return [];
    return v.filter((x: unknown): x is SavedView => {
      if (typeof x !== 'object' || x === null) return false;
      const o = x as Record<string, unknown>;
      return typeof o['name'] === 'string' && typeof o['search'] === 'string';
    });
  } catch {
    return [];
  }
}

function saveViews(listKey: string, views: readonly SavedView[]): void {
  try {
    window.localStorage.setItem(storeKey(listKey), JSON.stringify(views));
  } catch {
    // 저장 못 하는 환경(사생활 보호 창 등) — 이번 화면에서만 보인다
  }
}

/** 저장할 주소 조건 — 쪽(cursor·page)과 개인정보 조건은 뺀다. 남는 게 없으면 빈 문자열 */
export function cleanSearch(search: string): string {
  const p = new URLSearchParams(search);
  for (const k of ['cursor', 'page', 'preview', ...PII_PARAMS]) p.delete(k);
  p.sort();
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * 저장한 보기 — 2026-11-20 AWS "저장된 필터 세트 ▾"처럼 한 칸 고르기(펼치면 목록·지우기·지금 조건 저장).
 * 예전엔 목록 위 한 줄을 따로 차지했다 — 속성 필터가 있는 목록은 검색칸 왼쪽(PropertyFilter lead)에 둔다. 이 브라우저에만 기억.
 */
export function SavedViews({ listKey }: { readonly listKey: string }) {
  const { pathname, search } = useLocation();
  const [views, setViews] = useState<SavedView[]>(() => loadViews(listKey));
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const current = cleanSearch(search);
  const now = views.find((v) => v.search === current);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const update = (next: SavedView[]) => {
    setViews(next);
    saveViews(listKey, next);
  };
  const add = () => {
    const n = name.trim();
    if (!n || !current) return;
    update([...views.filter((v) => v.name !== n), { name: n, search: current }].slice(-MAX));
    setName('');
    setNaming(false);
  };
  return (
    <div className="relative shrink-0 text-sm" data-testid="saved-views" ref={box}>
      <button
        type="button"
        className="btn btn-sm min-w-36 justify-between font-normal"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        data-testid="saved-views-toggle"
      >
        <span className="truncate">
          <span className="text-base-content/60">{m.title}</span> {now ? <b className="font-semibold">{now.name}</b> : null}
        </span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div role="dialog" aria-label={m.title} className="absolute left-0 z-30 mt-1 w-64 space-y-1 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
          {views.length === 0 && <p className="px-2 py-1.5 text-base-content/55">{m.empty}</p>}
          {views.map((v) => {
            const on = v.search === current;
            return (
              <div key={v.name} className={`flex items-center rounded ${on ? 'bg-primary/10' : 'hover:bg-base-200'}`}>
                <Link to={`${pathname}${v.search}`} className={`min-w-0 flex-1 truncate px-2 py-1.5 ${on ? 'font-semibold text-primary' : ''}`} aria-current={on ? 'true' : undefined} onClick={() => setOpen(false)}>
                  {v.name}
                </Link>
                <button type="button" className="px-2 py-1 text-base-content/40 hover:text-error" aria-label={m.remove(v.name)} onClick={() => update(views.filter((x) => x.name !== v.name))}>
                  ✕
                </button>
              </div>
            );
          })}
          <div className="border-t border-base-300 pt-1.5">
            {naming ? (
              <span className="flex items-center gap-1 px-1">
                <input
                  className="input input-sm min-w-0 flex-1"
                  aria-label={m.nameLabel}
                  placeholder={m.namePlaceholder}
                  value={name}
                  maxLength={20}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') add();
                    if (e.key === 'Escape') setNaming(false);
                  }}
                />
                <button type="button" className="btn btn-primary btn-sm" disabled={!name.trim()} onClick={add}>
                  {m.save}
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm w-full justify-start" disabled={!current} title={current ? undefined : m.noFilter} onClick={() => setNaming(true)}>
                {m.add}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
