// 목록 순서대로 상세 넘기기(2026-11-19 사용자 "더 넣어") — 처리할 일을 차례로 볼 때 목록으로 돌아가지 않게.
// 목록이 지금 보이는 순서(시스템 ID)를 이 탭에만(sessionStorage) 기억하고, 상세는 "‹ 이전 · 3 / 12 · 다음 ›"을 보인다.
// 순서는 마지막으로 본 목록 그대로 — 서버 상태가 아니다(그 사이 처리된 건도 그대로 남아 있고, 열면 상세가 서버의 지금 상태를 보인다).
// 저장하는 것은 시스템 ID 와 목록 주소뿐(이름·연락처 없음). 저장이 막힌 브라우저면 조용히 띠를 그리지 않는다.
import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';

import { messages } from './messages';
import { recentPath, type RecentKind } from './recentViews';

const m = messages.queue;
const keyOf = (kind: RecentKind) => `pmart.backoffice.queue.${kind}`;
/** 목록 주소에 있어도 기억하지 않는 조건(연락처 같은 개인정보 — 주문 조회는 고객 전화로 찾는다) */
const PII_PARAMS = ['phone', 'receiverPhone', 'contact', 'customerPhone', 'riderPhone', 'q'];

/** 목록 주소에서 개인정보 조건을 뺀다 — 빼면 '보던 목록으로'는 조건 없는 목록으로 간다 */
export function safeFrom(from: string): string {
  const [path = '', query = ''] = from.split('?');
  const p = new URLSearchParams(query);
  for (const k of PII_PARAMS) p.delete(k);
  const rest = p.toString();
  return rest ? `${path}?${rest}` : path;
}

interface Queue {
  readonly ids: readonly string[];
  readonly from: string;
}

function read(kind: RecentKind): Queue | null {
  try {
    const raw = window.sessionStorage.getItem(keyOf(kind));
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (!Array.isArray(o.ids) || typeof o.from !== 'string') return null;
    return { ids: o.ids.filter((x): x is string => typeof x === 'string'), from: o.from };
  } catch {
    return null;
  }
}

/** 목록: 지금 보이는 순서를 기억(ids 가 바뀔 때만 쓴다) */
export function useRememberQueue(kind: RecentKind, ids: readonly string[] | undefined, from: string) {
  const key = ids?.join('|');
  useEffect(() => {
    if (!ids || ids.length === 0) return;
    try {
      window.sessionStorage.setItem(keyOf(kind), JSON.stringify({ ids, from: safeFrom(from) }));
    } catch {
      // 저장이 막힌 브라우저 — 띠 없이 동작
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, key, from]);
}

/** 목록 줄을 그리는 콜백 안에서도 쓰게(훅을 부를 수 없는 자리) — 아무것도 그리지 않는다 */
export function RememberQueue({ kind, ids, from }: { readonly kind: RecentKind; readonly ids: readonly string[]; readonly from: string }) {
  useRememberQueue(kind, ids, from);
  return null;
}

/** 상세: 기억한 목록 안에 이 건이 있으면 이전·다음 띠. [ · ] 키로도 넘긴다 */
/**
 * 상세 머리의 뒤로 가기 — 목록에서 왔으면 "보던 목록으로"(거른 조건 그대로), 아니면 fallback(2026-11-23 사용자 "복잡하게 해놨네" —
 * 뒤로 가기가 두 줄이던 것을 하나로). 이전·다음은 QueueNav 가 같은 줄 오른쪽에.
 */
export function useQueueBack(kind: RecentKind, id: string, fallback: { readonly to: string; readonly label: string }): { readonly to: string; readonly label: string } {
  const q = useMemo(() => read(kind), [kind]);
  return q && q.ids.includes(id) ? { to: q.from, label: m.backToList.replace(/^‹\s*/, '') } : fallback;
}

export function QueueNav({ kind, id }: { readonly kind: RecentKind; readonly id: string }) {
  const navigate = useNavigate();
  const q = useMemo(() => read(kind), [kind]);
  const at = q ? q.ids.indexOf(id) : -1;
  const prev = q && at > 0 ? q.ids[at - 1] : undefined;
  const next = q && at >= 0 && at < q.ids.length - 1 ? q.ids[at + 1] : undefined;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '[' && prev) void navigate(recentPath[kind](prev));
      else if (e.key === ']' && next) void navigate(recentPath[kind](next));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kind, prev, next, navigate]);
  if (!q || at < 0 || q.ids.length < 2) return null;
  const btn = 'btn btn-ghost btn-xs';
  return (
    // 뒤로 가기는 머리의 뒤로 가기 줄(useQueueBack)이 맡는다 — 여기는 이전·위치·다음만
    <nav aria-label={m.label} className="flex flex-wrap items-center justify-end gap-1 text-xs text-base-content/60" data-testid="queue-nav">
      {prev ? (
        <Link to={recentPath[kind](prev)} className={btn} title={`${m.prev} ([)`} data-testid="queue-prev">
          ‹ {m.prev}
        </Link>
      ) : (
        <span className={`${btn} btn-disabled`} aria-disabled="true">
          ‹ {m.prev}
        </span>
      )}
      <span className="tabular-nums" data-testid="queue-pos">
        {m.position(at + 1, q.ids.length)}
      </span>
      {next ? (
        <Link to={recentPath[kind](next)} className={btn} title={`${m.next} (])`} data-testid="queue-next">
          {m.next} ›
        </Link>
      ) : (
        <span className={`${btn} btn-disabled`} aria-disabled="true">
          {m.next} ›
        </span>
      )}
    </nav>
  );
}
