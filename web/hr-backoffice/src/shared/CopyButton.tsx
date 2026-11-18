// 사본: web/backoffice (2026-11-18 인사팀 백오피스에 같은 화면 규칙 적용) — 이 앱에서 따로 고친다.
// 번호 복사 단추(2026-11-18 사용자 "UI 보충 — 추천 다"). 상세 제목 옆 번호·"시스템 번호" 칸에 둔다.
// 복사하는 값은 화면에 이미 보이는 번호·ID 뿐이다(이름·전화 같은 개인정보에는 두지 않는다).
// 클립보드를 쓸 수 없으면(권한·http) "복사하지 못했어요" — 된 척하지 않는다.
import { useEffect, useState } from 'react';

import { messages as m } from './messages';

export function CopyButton({ value, label }: { readonly value: string; readonly label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 1500);
    return () => clearTimeout(t);
  }, [state]);
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(value);
      setState('done');
    } catch {
      setState('failed');
    }
  };
  const tip = state === 'done' ? m.copy.done : state === 'failed' ? m.copy.failed : m.copy.copy;
  return (
    <span className={`tooltip tooltip-bottom ${state === 'idle' ? '' : 'tooltip-open'}`} data-tip={tip}>
      <button
        type="button"
        className={`btn btn-ghost btn-xs h-6 min-h-0 w-6 p-0 align-middle ${state === 'done' ? 'text-success' : state === 'failed' ? 'text-error' : 'text-base-content/45'}`}
        aria-label={m.copy.aria(label ?? value)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void copy();
        }}
        data-testid="copy-button"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {state === 'done' ? (
            <path d="m5 12 5 5L20 7" />
          ) : (
            <>
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </>
          )}
        </svg>
      </button>
      <span className="sr-only" role="status">
        {state === 'idle' ? '' : tip}
      </span>
    </span>
  );
}
