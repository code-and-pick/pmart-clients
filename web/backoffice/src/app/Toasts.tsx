// 오른쪽 아래 처리 결과 알림 자리(2026-11-18 — Eum Toast 참고). 화면 아래 칸의 결과 글을 한 번 더 알리는 것이라
// 읽기 도구에는 aria-live 로만 알리고 role=status/alert 는 쓰지 않는다(같은 내용을 두 번 읽지 않게).
import { messages as m } from '../shared/messages';
import { dismissToast, useToasts, type ToastTone } from '../shared/toast';

const TONE: Readonly<Record<ToastTone, string>> = {
  success: 'border-success/40 bg-success/10 text-success',
  info: 'border-info/40 bg-info/10 text-info',
  warning: 'border-warning/50 bg-warning/15 text-warning',
  error: 'border-error/40 bg-error/10 text-error',
};
const ICON: Readonly<Record<ToastTone, string>> = { success: 'M5 12l5 5L20 7', info: 'M12 8h.01M11 12h1v4h1', warning: 'M12 9v4M12 17h.01', error: 'M6 6l12 12M18 6L6 18' };

export function Toasts() {
  const list = useToasts();
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" data-testid="toasts">
      {list.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-start gap-2.5 rounded-box border bg-base-100 px-3.5 py-3 text-sm shadow-lg" data-testid="toast" data-tone={t.tone}>
          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${TONE[t.tone]}`} aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-3 w-3 fill-none stroke-current" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d={ICON[t.tone]} />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t.title}</p>
            {t.body && <p className="text-xs text-base-content/65">{t.body}</p>}
          </div>
          <button type="button" className="btn btn-ghost btn-xs h-5 min-h-0 w-5 p-0 text-base-content/45" onClick={() => dismissToast(t.id)} aria-label={m.toast.close}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
