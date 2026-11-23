// 보드(칸반) 보기 — 2026-11-20 사용자 "칸반 보드로 대시보드는?" → "보드로 보기"(대시보드 탭·접수 건·승인함).
// 보기 전용: 칸은 서버가 판정해 준 값(담당 없음·내 담당·기한 넘김·심사 상태 등)으로만 나누고, 카드를 누르면 상세로 간다.
// 끌어서 상태를 바꾸지 않는다 — 상태 변경은 사유·결과를 적는 명령이라 상세에서(서버가 확정한 것만 화면에 확정으로).
// 개수는 서버가 준 한 쪽 안의 수(다음 쪽이 있으면 "N+"), 읽는 중 "…", 못 읽으면 "?" — 0 이나 빈 칸으로 보이지 않게.
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { StatusText, type Tone } from './admin';
import { messages } from './messages';

const m = messages.board;

export type BoardCard = {
  readonly key: string;
  readonly to: string;
  readonly title: string;
  readonly sub?: string | undefined;
  readonly meta?: string | undefined;
  /** 카드 위 작은 표시(종류 등) */
  readonly tag?: string | undefined;
  readonly status?: { readonly text: string; readonly tone: Tone } | undefined;
};

export type BoardColumn = {
  readonly id: string;
  readonly title: string;
  readonly tone?: Tone;
  readonly cards: readonly BoardCard[] | undefined;
  readonly more: boolean;
  readonly isError: boolean;
  readonly onRetry?: () => void;
  /** 이 칸 전체를 보는 목록 */
  readonly listTo?: string;
};

const SHOW = 20;

export function KanbanBoard({ columns, label, testId = 'kanban' }: { readonly columns: readonly BoardColumn[]; readonly label: string; readonly testId?: string }) {
  return (
    <div className="overflow-x-auto pb-2" role="region" aria-label={label} data-testid={testId}>
      <div className="grid auto-cols-[minmax(12.5rem,1fr)] grid-flow-col gap-3">
        {columns.map((c) => (
          <Column key={c.id} c={c} />
        ))}
      </div>
    </div>
  );
}

function Column({ c }: { readonly c: BoardColumn }) {
  const count = c.cards ? `${c.cards.length}${c.more ? '+' : ''}` : c.isError ? '?' : '…';
  const tone = c.tone === 'error' ? 'text-error' : c.tone === 'warning' ? 'text-[color-mix(in_oklab,var(--color-warning)_60%,var(--color-base-content))]' : 'text-base-content/60';
  let body: ReactNode;
  if (!c.cards) {
    body = c.isError ? (
      <p className="px-1 py-4 text-sm text-warning" role="alert">
        {m.failed}{' '}
        {c.onRetry && (
          <button type="button" className="link" onClick={c.onRetry}>
            {m.retry}
          </button>
        )}
      </p>
    ) : (
      <p className="px-1 py-4 text-sm text-base-content/50">…</p>
    );
  } else if (c.cards.length === 0) {
    body = <p className="px-1 py-4 text-sm text-base-content/50">{m.empty}</p>;
  } else {
    body = (
      <ul className="space-y-2">
        {c.cards.slice(0, SHOW).map((card) => (
          <li key={card.key}>
            <Link to={card.to} className="block rounded-box border border-base-300 bg-base-100 px-3 py-2.5 transition-colors hover:border-primary/60" data-testid="board-card">
              {card.tag && <span className="block text-xs text-base-content/60">{card.tag}</span>}
              <span className="block truncate text-sm font-medium" title={card.title}>
                {card.title}
              </span>
              <span className="mt-1.5 flex items-center justify-between gap-2 text-xs text-base-content/60">
                <span className="min-w-0 truncate">{card.status ? <StatusText tone={card.status.tone}>{card.status.text}</StatusText> : card.sub}</span>
                {card.meta && <span className="shrink-0 tabular-nums">{card.meta}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  const hidden = c.cards ? c.cards.length - Math.min(c.cards.length, SHOW) : 0;
  return (
    <section className="flex min-h-40 flex-col rounded-box border border-base-300 bg-base-200/60 p-3" aria-label={c.title} data-testid={`board-col-${c.id}`}>
      <h3 className="mb-2 flex items-baseline justify-between gap-2 px-1 text-sm font-bold">
        <span className={tone}>{c.title}</span>
        <span className="tabular-nums text-base-content/60" data-testid={`board-count-${c.id}`}>
          {count}
        </span>
      </h3>
      {body}
      {c.listTo && (hidden > 0 || c.more) && (
        <Link to={c.listTo} className="mt-2 px-1 text-xs text-primary hover:underline">
          {m.more}
        </Link>
      )}
    </section>
  );
}

/** 표 / 보드 바꾸기(붙은 단추 줄) — 주소의 layout=board 로 기억 */
export function LayoutToggle({ board, onChange }: { readonly board: boolean; readonly onChange: (board: boolean) => void }) {
  const cls = (on: boolean) => `px-3 py-1 text-sm ${on ? 'bg-primary font-semibold text-primary-content' : 'bg-base-100 hover:bg-base-200'}`;
  return (
    <div role="radiogroup" aria-label={m.layout} className="inline-flex overflow-hidden rounded-field border border-base-content/40">
      <button type="button" role="radio" aria-checked={!board} className={cls(!board)} onClick={() => onChange(false)}>
        {m.table}
      </button>
      <button type="button" role="radio" aria-checked={board} className={`${cls(board)} border-l border-base-content/25`} onClick={() => onChange(true)} data-testid="layout-board">
        {m.board}
      </button>
    </div>
  );
}
