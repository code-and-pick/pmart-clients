// 사본: web/backoffice (2026-11-18 인사팀 백오피스에 같은 화면 규칙 적용) — 이 앱에서 따로 고친다.
// 처리 결과 알림(토스트, 2026-11-18 — Eum Toast 참고). 새 라이브러리 없이 이 파일의 작은 목록 하나.
// 화면 아래 칸의 결과 글(CommandFeedback)은 그대로 두고, 놓치지 않게 오른쪽 아래에 한 번 더 알린다.
// 서버가 확정한 것만 "됐어요" — 접수(ACCEPTED)는 "확인하고 있어요", 결과 불명은 "아직 몰라요"(실패로 확정하지 않는다).
import { useSyncExternalStore } from 'react';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';
export interface Toast {
  readonly id: number;
  readonly tone: ToastTone;
  readonly title: string;
  readonly body?: string;
}

let toasts: readonly Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

const LIFE_MS: Readonly<Record<ToastTone, number>> = { success: 4000, info: 6000, warning: 8000, error: 8000 };

export function pushToast(t: Omit<Toast, 'id'>) {
  const id = ++seq;
  toasts = [...toasts.slice(-3), { ...t, id }]; // 한 번에 4개까지
  emit();
  setTimeout(() => dismissToast(id), LIFE_MS[t.tone]);
}

export function dismissToast(id: number) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
    () => toasts,
  );
}

/** 시험마다 비운다(test/setup) — 앞 시험의 알림이 남지 않게 */
export function clearToasts() {
  toasts = [];
  emit();
}
