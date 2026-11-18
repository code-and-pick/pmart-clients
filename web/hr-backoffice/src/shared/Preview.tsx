// 사본: web/backoffice (2026-11-19 사용자 "백오피스 화면이랑 같게") — 이 앱에서 따로 고친다.
// 목록 미리보기 칸(2026-11-18 사용자 "직관적으로 — 참고 사이트·Eum" — Shopify·Medusa 목록, Refine 옆 패널 참고).
// 줄을 누르면 목록을 떠나지 않고 오른쪽에 요약이 열린다. 줄 안의 번호 링크는 그대로 상세로 간다.
// 열린 것은 주소 `?preview=<ID>` 에 둔다(새로 고침·링크 보내기에도 그대로, 다른 조건은 건드리지 않는다).
// ↑↓ 로 앞뒤 줄, Esc 로 닫기(입력 칸에 있을 때는 키를 가로채지 않는다). 내용은 상세와 같은 조회 키라 상세로 가도 다시 읽지 않는다.
import { useEffect, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { messages as m } from './messages';

export function usePreview() {
  const [params, setParams] = useSearchParams();
  const id = params.get('preview');
  const set = (next: string | null) =>
    setParams(
      (p) => {
        const q = new URLSearchParams(p);
        if (next) q.set('preview', next);
        else q.delete('preview');
        return q;
      },
      { replace: true },
    );
  /** 줄에 붙인다 — 줄 안의 링크·단추·입력을 누른 것은 그대로 둔다 */
  const row = (rowId: string | null | undefined) =>
    rowId
      ? {
          className: `cursor-pointer ${id === rowId ? 'bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)]' : ''}`,
          'aria-selected': id === rowId,
          onClick: (e: { readonly target: EventTarget | null }) => {
            if (e.target instanceof Element && e.target.closest('a,button,input,select,textarea,label,summary')) return;
            set(rowId);
          },
        }
      : {};
  return { id, open: set, close: () => set(null), row };
}

export function PreviewDrawer({
  id,
  ids,
  onMove,
  onClose,
  title,
  detailTo,
  children,
}: {
  readonly id: string;
  /** 목록 줄 순서 — ↑↓·이전/다음 */
  readonly ids: readonly string[];
  readonly onMove: (id: string) => void;
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly detailTo: string;
  readonly children: ReactNode;
}) {
  const at = ids.indexOf(id);
  const prev = at > 0 ? ids[at - 1] : undefined;
  const next = at >= 0 && at < ids.length - 1 ? ids[at + 1] : undefined;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowUp' && prev) {
        e.preventDefault();
        onMove(prev);
      } else if (e.key === 'ArrowDown' && next) {
        e.preventDefault();
        onMove(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onClose, onMove]);

  return (
    <aside
      aria-label={m.preview.label}
      className="fixed bottom-0 right-0 top-14 z-30 flex w-[26rem] max-w-full flex-col border-l border-base-300 bg-base-100 shadow-2xl"
      data-testid="preview-drawer"
    >
      <div className="flex items-center gap-1 border-b border-base-300 px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate text-base font-bold">{title}</h2>
        <button type="button" className="btn btn-ghost btn-xs" disabled={!prev} onClick={() => prev && onMove(prev)} aria-label={m.preview.prev} title={`${m.preview.prev} (↑)`}>
          ↑
        </button>
        <button type="button" className="btn btn-ghost btn-xs" disabled={!next} onClick={() => next && onMove(next)} aria-label={m.preview.next} title={`${m.preview.next} (↓)`}>
          ↓
        </button>
        <button type="button" className="btn btn-ghost btn-xs" onClick={onClose} aria-label={m.preview.close} title={`${m.preview.close} (Esc)`}>
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
      <div className="flex items-center justify-between gap-2 border-t border-base-300 px-4 py-3">
        <span className="text-xs text-base-content/50">{at >= 0 ? m.preview.position(at + 1, ids.length) : ''}</span>
        <Link className="btn btn-primary btn-sm" to={detailTo}>
          {m.preview.openDetail}
        </Link>
      </div>
    </aside>
  );
}

/** 미리보기 안의 이름·값 줄 */
export function PreviewFacts({ rows }: { readonly rows: ReadonlyArray<readonly [ReactNode, ReactNode] | null | false> }) {
  return (
    <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-sm">
      {rows.filter((r): r is readonly [ReactNode, ReactNode] => Boolean(r)).map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-base-content/55">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
