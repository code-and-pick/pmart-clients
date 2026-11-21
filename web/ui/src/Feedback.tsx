// 명령 결과·거절 사유 표시. 문구는 Problem code 로만 고른다(title·detail 문자열 비교 금지).
import type { ReactNode } from 'react';

import {
  CommandRejectedFailure,
  type PmartFailure,
  ProblemFailure,
  SessionExpiredFailure,
} from '@pmart/web-core';
import { uiMessages as m } from './messages';
import { useUiText } from './UiText';
import type { Command } from './useCommand';

export function failureCode(failure: PmartFailure): string | undefined {
  if (failure instanceof ProblemFailure) return failure.problem.code;
  if (failure instanceof CommandRejectedFailure) return 'COMMAND_REJECTED';
  return undefined;
}

export function FailureAlert({ failure }: { readonly failure: PmartFailure }) {
  const { problem, reason } = useUiText();
  const reasonText = (r: string | undefined) => (r ? (reason[r] ?? r) : m.none);
  const code = failureCode(failure);
  const text =
    failure instanceof SessionExpiredFailure ? m.sessionExpired : code ? (problem[code] ?? m.rejectedTitle) : m.rejectedTitle;
  const details = failure instanceof ProblemFailure ? failure.problem.details : [];
  return (
    <div role="alert" data-state="rejected" data-code={code} className="alert alert-error flex flex-col items-start gap-1">
      <span className="font-bold">{text}</span>
      {code && <span className="text-xs opacity-70">{code}</span>}
      {details.length > 0 && (
        <ul className="list-disc pl-5 text-sm">
          {details.map((d, i) => (
            <li key={`${d.field ?? ''}-${i}`}>{`${d.field ?? ''} ${reasonText(d.reason)}`.trim()}</li>
          ))}
        </ul>
      )}
      {failure.requestId && <span className="text-xs opacity-70 select-all">{m.requestId(failure.requestId)}</span>}
    </div>
  );
}

/** 명령 진행·거절·불명 표시. 완료 표시는 화면이 children 으로 그린다(ACCEPTED 를 완료로 그리지 않게). */
export function CommandFeedback<V, T>({
  command,
  children,
  unknown,
}: {
  readonly command: Command<V, T>;
  readonly children?: (result: T) => ReactNode;
  /** 결과 불명 표시 조정. 상태를 남기지 않는 명령(로그인)은 본문을 바꾸고 "같은 요청으로 결과 확인"을 뺀다. */
  readonly unknown?: { readonly body?: string; readonly resend?: boolean };
}) {
  const { phase } = command;
  switch (phase.kind) {
    case 'idle':
      return null;
    case 'running':
      return (
        <div role="status" className="flex items-center gap-2 text-sm">
          <span className="loading loading-spinner loading-sm" />
          {m.running}
        </div>
      );
    case 'done':
      return <>{children?.(phase.result)}</>;
    case 'rejected':
      return <FailureAlert failure={phase.failure} />;
    case 'unknown':
      return (
        // 좁은 폼(로그인)에서도 길게 늘어지지 않게: 작은 글자, 문의 번호는 줄바꿈 허용, 버튼은 작게.
        <div
          role="alert"
          data-state="unknown"
          className="alert alert-info alert-soft alert-vertical items-start gap-1 py-3 text-sm sm:alert-horizontal sm:items-center"
        >
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="font-bold">{m.unknownTitle}</p>
            <p>{unknown?.body ?? m.unknownBody}</p>
            {phase.failure.requestId && (
              <p className="text-xs break-all opacity-70 select-all">{m.requestId(phase.failure.requestId)}</p>
            )}
          </div>
          {(unknown?.resend ?? true) && (
            <button type="button" className="btn btn-xs btn-outline shrink-0" onClick={() => void command.resend()}>
              {m.resend}
            </button>
          )}
        </div>
      );
  }
}
