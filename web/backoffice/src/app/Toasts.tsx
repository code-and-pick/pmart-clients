// 처리 결과 알림 자리(2026-11-18 — Eum Toast 참고, 2026-11-20 AWS Flashbar 모양으로). 화면 아래 칸의 결과 글을 한 번 더 알리는 것이라
// 읽기 도구에는 aria-live 로만 알리고 role=status/alert 는 쓰지 않는다(같은 내용을 두 번 읽지 않게).
import { messages as m } from '../shared/messages';
import { dismissToast, useToasts, type ToastTone } from '../shared/toast';

// 2026-11-20 AWS Flashbar: 오른쪽 아래 흰 카드 대신 머리줄 아래 가운데 색 띠(성공 초록·정보 파랑·주의 노랑·실패 빨강), 아이콘·굵은 제목·설명·✕.
const TONE: Readonly<Record<ToastTone, string>> = {
  success: 'bg-success text-success-content',
  info: 'bg-info text-info-content',
  warning: 'bg-warning text-warning-content',
  error: 'bg-error text-error-content',
};
const ICON: Readonly<Record<ToastTone, string>> = { success: 'M8 12.5l2.5 2.5L16 9.5', info: 'M12 11v5M12 8h.01', warning: 'M12 8v5M12 16h.01', error: 'M9 9l6 6M15 9l-6 6' };

export function Toasts() {
  const list = useToasts();
  return (
    <div aria-live="polite" className="pointer-events-none fixed left-1/2 top-14 z-50 flex w-[min(52rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-1.5" data-testid="toasts">
      {list.map((t) => (
        <div key={t.id} className={`pointer-events-auto flex items-start gap-3 rounded-box px-4 py-3 text-sm shadow-md ${TONE[t.tone]}`} data-testid="toast" data-tone={t.tone}>
          <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d={ICON[t.tone]} />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="font-bold">{t.title}</p>
            {t.body && <p className="opacity-90">{t.body}</p>}
          </div>
          <button type="button" className="grid h-6 w-6 shrink-0 place-items-center rounded opacity-80 hover:bg-black/10 hover:opacity-100" onClick={() => dismissToast(t.id)} aria-label={m.toast.close}>
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
