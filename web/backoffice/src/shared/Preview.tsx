// 목록 미리보기 칸(2026-11-18 사용자 "직관적으로 — 참고 사이트·Eum" — Shopify·Medusa 목록, Refine 옆 패널 참고).
// 줄을 누르면 목록을 떠나지 않고 오른쪽에 요약이 열린다. 줄 안의 번호 링크는 그대로 상세로 간다.
// 열린 것은 주소 `?preview=<ID>` 에 둔다(새로 고침·링크 보내기에도 그대로, 다른 조건은 건드리지 않는다).
// ↑↓ 로 앞뒤 줄, Esc 로 닫기(입력 칸에 있을 때는 키를 가로채지 않는다). 내용은 상세와 같은 조회 키라 상세로 가도 다시 읽지 않는다.
import { useEffect, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { messages as m } from './messages';

/**
 * direct 를 주면 미리보기 없이 줄을 누르면 바로 그 상세로 간다(2026-11-20 사용자 "상세 열기 오른쪽 탭 필요 없는 곳도 계속 나와서 터치 2번").
 * 미리보기 안에서 일을 끝낼 수 없는 목록(승인·접수 건·클레임·문의·주문·배송·라이더 컴플레인 — 결정·답변·처리는 상세에서)은 direct.
 * 미리보기를 남긴 곳: 상품 조회(SKU·바코드 훑기)·가격 관리(서랍에서 바로 바꾸기).
 */
export function usePreview(direct?: (rowId: string) => string) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const id = direct ? null : params.get('preview');
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
            if (direct) void navigate(direct(rowId));
            else set(rowId);
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
  detailLabel,
  children,
}: {
  readonly id: string;
  /** 목록 줄 순서 — ↑↓·이전/다음 */
  readonly ids: readonly string[];
  readonly onMove: (id: string) => void;
  readonly onClose: () => void;
  readonly title: ReactNode;
  /** 아래 단추로 갈 곳(없으면 단추 없음) */
  readonly detailTo?: string;
  /** 아래 단추 이름(기본 "상세 열기") */
  readonly detailLabel?: string;
  readonly children: ReactNode;
}) {
  const navigate = useNavigate();
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
      } else if (detailTo && e.key === 'Enter' && !(t instanceof HTMLElement && ['A', 'BUTTON', 'SUMMARY'].includes(t.tagName)) && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        // Enter = 미리보던 건의 상세 열기(2026-11-19). 단추·링크에 초점이 있으면 그 단추가 먼저(가로채지 않는다)
        e.preventDefault();
        void navigate(detailTo);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onClose, onMove, navigate, detailTo]);

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
        {detailTo && (
          <Link className="btn btn-primary btn-sm" to={detailTo}>
            {detailLabel ?? m.preview.openDetail}
          </Link>
        )}
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
