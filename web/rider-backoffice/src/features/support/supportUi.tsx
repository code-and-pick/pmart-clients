// 지원센터·접수 건 화면 부품(2026-11-18, PC 5 — 배민 주문접수 "처리중/완료" 밑줄 탭·상담 대화 참고).
// 색은 테마 변수만 쓴다. 공통 부품(shared/admin)으로 안 되는 것만 둔다.
import { ui } from '../../shared/uiMessages';
import type { ReactNode } from 'react';

import type { Tone } from '../../shared/admin';

/** 목록 위 상태 밑줄 탭(처리 중 / 처리 끝남 등) — role=tab */
export function StateTabs<T extends string>({ value, options, onChange, label }: { readonly value: T; readonly options: ReadonlyArray<{ readonly value: T; readonly label: ReactNode }>; readonly onChange: (v: T) => void; readonly label: string }) {
  return (
    // 2026-11-24 사용자 "탭이 중요한데 얇게 안 보이게 왼쪽에 쳐박아놨네" — 크고 굵은 탭, 고른 탭은 파란 굵은 밑줄
    <div role="tablist" aria-label={label} className="flex gap-2 border-b-2 border-base-300">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            className={`-mb-0.5 border-b-[3px] px-5 py-2.5 text-base font-bold ${on ? 'border-primary text-primary' : 'border-transparent text-base-content/70 hover:text-base-content'}`}
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
// fresh(2026-11-19 통합 백오피스처럼): 대화를 연 뒤 새로 들어온 메시지 — 미끄러져 들어오고, 라이더가 보낸 것이면 "새 메시지" 점(움직임 줄이기면 CSS 가 끈다)
export function ChatBubble({ mine, who, at, children, footer, fresh = false }: { readonly mine: boolean; readonly who: string; readonly at: string; readonly children: ReactNode; readonly footer?: ReactNode; readonly fresh?: boolean }) {
  return (
    <li className={`${mine ? 'chat chat-end' : 'chat chat-start'} ${fresh ? 'msg-new' : ''}`}>
      <div className="chat-header mb-0.5 text-xs text-base-content/60">
        <span className="font-medium">{who}</span>
        <time className="ml-1.5 text-base-content/45">{at}</time>
        {fresh && !mine && (
          <span className="ml-1.5 inline-flex items-center gap-1 font-semibold text-primary" data-testid="new-message">
            <span className="breathe h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
            {ui.newMessage}
          </span>
        )}
      </div>
      <div className={`chat-bubble whitespace-pre-wrap text-sm ${mine ? 'chat-bubble-primary' : 'bg-base-200 text-base-content'}`}>{children}</div>
      {footer && <div className="chat-footer mt-0.5">{footer}</div>}
    </li>
  );
}

/** 대화 칸 — 위로 쌓이고, 길면 이 칸만 스크롤 */
/**
 * 라이더 앱 "채팅 상담"으로 연 문의 — 앱이 제목을 이 글로 정해 보낸다(rider_app liveChatTitle). 서버에는 라이더 문의의
 * 경로(채널) 칸이 없어 제목으로 가른다(2026-11-23 사용자 "목록에 채팅 표시를 달고, 누르면 대화 칸이 크게 먼저"). 경로 칸이 생기면 그것으로 바꾼다.
 */
export const LIVE_CHAT_TITLE = '실시간 채팅 상담';
export const isLiveChat = (title: string | null | undefined) => title === LIVE_CHAT_TITLE;

/** [tall] 이면 채팅 상담처럼 대화가 주인공인 화면 — 더 높게 */
export function ChatBox({ children, testId, empty, tall = false }: { readonly children: ReactNode; readonly testId: string; readonly empty: boolean; readonly tall?: boolean }) {
  return (
    <div className={`${tall ? 'h-[min(62vh,40rem)] min-h-72' : 'max-h-[28rem] min-h-40'} overflow-y-auto rounded-box bg-base-200/40 px-3 py-3`}>
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
