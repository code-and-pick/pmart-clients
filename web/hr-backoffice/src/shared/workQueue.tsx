// 목록 순서대로 직원 상세 넘기기(2026-11-19 사용자 "일단 다 넣어" — 백오피스 workQueue 와 같게, 이 앱에서 따로 고친다).
// 직원 목록이 지금 순서(운영자 ID)를 이 탭에만(sessionStorage) 기억하고, 상세는 "‹ 이전 · 3 / 12 · 다음 ›"을 보인다. [ · ] 키로도.
// 순서는 마지막으로 본 목록 그대로 — 서버 상태가 아니다. 이름·메일 같은 찾기 말(q)은 기억하지 않는다.
import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';

import { messages } from './messages';

const m = messages.queue;
const KEY = 'pmart.hr-backoffice.queue.employees';
const PII_PARAMS = ['q', 'phone', 'contact'];
const detailPath = (id: string) => `/employees/${encodeURIComponent(id)}`;

interface Queue {
  readonly ids: readonly string[];
  readonly from: string;
}

export function safeFrom(from: string): string {
  const [path = '', query = ''] = from.split('?');
  const p = new URLSearchParams(query);
  for (const k of PII_PARAMS) p.delete(k);
  const rest = p.toString();
  return rest ? `${path}?${rest}` : path;
}

function read(): Queue | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (!Array.isArray(o.ids) || typeof o.from !== 'string') return null;
    return { ids: o.ids.filter((x): x is string => typeof x === 'string'), from: o.from };
  } catch {
    return null;
  }
}

/** 목록: 지금 보이는 순서를 기억 */
export function useRememberQueue(ids: readonly string[] | undefined, from: string) {
  const key = ids?.join('|');
  useEffect(() => {
    if (!ids || ids.length === 0) return;
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify({ ids, from: safeFrom(from) }));
    } catch {
      // 저장이 막힌 브라우저 — 띠 없이 동작
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, from]);
}

/** 상세 "‹ 직원 목록"이 갈 곳 — 기억한 목록(거른 조건 그대로)에 이 직원이 있으면 그 목록, 없으면 undefined(2026-11-20: "보던 목록으로" 링크와 둘이 겹쳐 하나로) */
export function useQueueFrom(id: string): string | undefined {
  const q = useMemo(() => read(), []);
  return q && q.ids.includes(id) ? q.from : undefined;
}

/** 상세: 기억한 목록 안에 이 직원이 있으면 이전·다음 띠(목록으로 돌아가기는 상세 머리 링크가 한다) */
export function QueueNav({ id }: { readonly id: string }) {
  const navigate = useNavigate();
  const q = useMemo(() => read(), []);
  const at = q ? q.ids.indexOf(id) : -1;
  const prev = q && at > 0 ? q.ids[at - 1] : undefined;
  const next = q && at >= 0 && at < q.ids.length - 1 ? q.ids[at + 1] : undefined;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '[' && prev) void navigate(detailPath(prev));
      else if (e.key === ']' && next) void navigate(detailPath(next));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, navigate]);
  if (!q || at < 0 || q.ids.length < 2) return null;
  const btn = 'btn btn-ghost btn-xs';
  return (
    <nav aria-label={m.label} className="flex flex-wrap items-center justify-end gap-1 text-xs text-base-content/60" data-testid="queue-nav">
      {prev ? (
        <Link to={detailPath(prev)} className={btn} title={`${m.prev} ([)`} data-testid="queue-prev">
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
        <Link to={detailPath(next)} className={btn} title={`${m.next} (])`} data-testid="queue-next">
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
