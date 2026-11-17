// 지원센터·접수 건 화면 부품(2026-11-18, PC 5 — 배민 주문접수 "처리중/완료" 밑줄 탭·상담 대화 참고).
// 색은 테마 변수만 쓴다. 공통 부품(shared/admin)으로 안 되는 것만 둔다.
import type { ReactNode } from 'react';

import type { Tone } from '../../shared/admin';

/** 목록 위 상태 밑줄 탭(처리 중 / 처리 끝남 등) — role=tab */
export function StateTabs<T extends string>({ value, options, onChange, label }: { readonly value: T; readonly options: ReadonlyArray<{ readonly value: T; readonly label: ReactNode }>; readonly onChange: (v: T) => void; readonly label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-base-300">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${on ? 'border-primary font-semibold text-base-content' : 'border-transparent text-base-content/60 hover:text-base-content'}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 대화 말풍선 하나 — 지원센터(오른쪽, 브랜드색) / 라이더(왼쪽, 회색) */
export function ChatBubble({ mine, who, at, children, footer }: { readonly mine: boolean; readonly who: string; readonly at: string; readonly children: ReactNode; readonly footer?: ReactNode }) {
  return (
    <li className={mine ? 'chat chat-end' : 'chat chat-start'}>
      <div className="chat-header mb-0.5 text-xs text-base-content/60">
        <span className="font-medium">{who}</span>
        <time className="ml-1.5 text-base-content/45">{at}</time>
      </div>
      <div className={`chat-bubble whitespace-pre-wrap text-sm ${mine ? 'chat-bubble-primary' : 'bg-base-200 text-base-content'}`}>{children}</div>
      {footer && <div className="chat-footer mt-0.5">{footer}</div>}
    </li>
  );
}

/** 대화 칸 — 위로 쌓이고, 길면 이 칸만 스크롤 */
export function ChatBox({ children, testId, empty }: { readonly children: ReactNode; readonly testId: string; readonly empty: boolean }) {
  return (
    <div className="max-h-[28rem] min-h-40 overflow-y-auto rounded-box bg-base-200/40 px-3 py-3">
      {empty && <p className="py-8 text-center text-sm text-base-content/50">아직 주고받은 말이 없어요.</p>}
      <ol className="space-y-1" data-testid={testId}>
        {children}
      </ol>
    </div>
  );
}

/** 상태 → 꼬리표 색 */
export const helpTone = (s: string | null | undefined): Tone => (s === 'OPEN' ? 'warning' : s === 'IN_PROGRESS' ? 'info' : s === 'RESOLVED' ? 'success' : 'ghost');
export const inquiryTone = (s: string | null | undefined): Tone => (s === 'RECEIVED' ? 'warning' : s === 'ANSWERED' ? 'info' : 'ghost');
export const caseTone = (s: string | null | undefined): Tone =>
  s === 'CLOSED' ? 'ghost' : s === 'OPEN' || s === 'REOPENED' ? 'warning' : s === 'RESOLUTION_REVIEW' ? 'accent' : 'info';
