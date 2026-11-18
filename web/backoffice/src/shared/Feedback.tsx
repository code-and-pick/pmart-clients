// 명령 결과·거절 사유 표시(공통: @pmart/web-ui) + 백오피스의 사유 code → 문구.
// 2026-11-18: 결과가 나오면 오른쪽 아래 알림(토스트)도 한 번 — 공유 CommandFeedback 은 그대로 감싸기만 한다(PC 3·PC 5 앱 영향 없음).
import { useEffect, useRef, type ComponentProps } from 'react';

import { CommandFeedback as SharedCommandFeedback, failureCode } from '@pmart/web-ui';
import { messages as m } from './messages';
import { pushToast } from './toast';

export { FailureAlert, failureCode } from '@pmart/web-ui';

export const reasonText = (code: string | null | undefined) => (code ? (m.reason[code] ?? code) : m.none);

/** 서버 결과 → 알림 한 줄. CommandResponse(status 4값)면 그 값대로, 자원을 돌려받았으면 서버가 만든(고친) 것 = 반영 */
function toastOf(result: unknown): { tone: 'success' | 'info' | 'warning' | 'error'; title: string } {
  const status = typeof result === 'object' && result !== null && 'status' in result ? (result as { status?: unknown }).status : undefined;
  switch (status) {
    case 'ACCEPTED':
      return { tone: 'info', title: m.toast.accepted };
    case 'REJECTED':
      return { tone: 'error', title: m.toast.rejected };
    case 'UNKNOWN_RESULT':
      return { tone: 'warning', title: m.toast.unknown };
    default:
      return { tone: 'success', title: m.toast.applied };
  }
}

export function CommandFeedback<V, T>(props: ComponentProps<typeof SharedCommandFeedback<V, T>>) {
  const { phase } = props.command;
  const seen = useRef(phase);
  useEffect(() => {
    if (seen.current === phase) return;
    seen.current = phase;
    if (phase.kind === 'done') pushToast(toastOf(phase.result));
    else if (phase.kind === 'rejected') pushToast({ tone: 'error', title: m.toast.rejected, body: reasonText(failureCode(phase.failure)) });
    else if (phase.kind === 'unknown') pushToast({ tone: 'warning', title: m.toast.unknown });
  }, [phase]);
  return <SharedCommandFeedback {...props} />;
}
