// UiState 7종(LOADING/READY/EMPTY/PARTIAL/ERROR/FORBIDDEN/RESULT_UNKNOWN) 표시. pmart_ui 의 UiStateView 와 같은 규칙.
import type { ReactNode } from 'react';

import {
  PmartFailure,
  ProblemCode,
  ProblemFailure,
  SessionExpiredFailure,
  UnknownResultFailure,
} from '@pmart/web-core';
import { uiMessages as m } from './messages';

export type UiState<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: T }
  | { readonly kind: 'empty' }
  | { readonly kind: 'partial'; readonly data: T; readonly missing: readonly string[] }
  | { readonly kind: 'error'; readonly failure: PmartFailure }
  | { readonly kind: 'forbidden'; readonly requestId?: string }
  | { readonly kind: 'unknown'; readonly requestId?: string };

/** 실패 → 화면 상태. 조회 실패를 empty 로 바꾸지 않는다. */
export function uiStateFromError<T>(error: unknown): UiState<T> {
  const failure = error instanceof PmartFailure ? error : new PmartFailure(String(error));
  if (failure instanceof UnknownResultFailure) {
    return failure.requestId ? { kind: 'unknown', requestId: failure.requestId } : { kind: 'unknown' };
  }
  if (failure instanceof ProblemFailure && failure.problem.code === ProblemCode.forbidden) {
    return failure.requestId ? { kind: 'forbidden', requestId: failure.requestId } : { kind: 'forbidden' };
  }
  return { kind: 'error', failure };
}

interface Props<T> {
  readonly state: UiState<T>;
  readonly children: (data: T) => ReactNode;
  readonly onRetry?: () => void;
  readonly onCheckAgain?: () => void;
  readonly emptyText?: string;
}

function RequestId({ id }: { readonly id: string | undefined }) {
  return id ? <p className="text-xs opacity-70 select-all">{m.requestId(id)}</p> : null;
}

export function QueryState<T>({ state, children, onRetry, onCheckAgain, emptyText }: Props<T>) {
  switch (state.kind) {
    case 'loading':
      return (
        <div role="status" data-state="loading" className="flex items-center justify-center gap-3 rounded-box border border-base-300 bg-base-100 p-10 text-sm text-base-content/60">
          <span className="loading loading-spinner loading-sm" />
          {m.loading}
        </div>
      );
    case 'ready':
      return <>{children(state.data)}</>;
    case 'empty':
      return (
        <p data-state="empty" className="flex flex-col items-center justify-center gap-2 rounded-box border border-dashed border-base-300 bg-base-100 px-6 py-10 text-center text-sm text-base-content/60">
          {/* 빈 상자 그림(2026-11-18 화면 다듬기) */}
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8 fill-none stroke-current text-base-content/30" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 13h4l1.5 2.5h5L16 13h4M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5Z" />
          </svg>
          {emptyText ?? m.empty}
        </p>
      );
    case 'partial':
      return (
        <div data-state="partial">
          <div role="alert" className="alert alert-warning mb-4 flex flex-wrap items-center gap-2">
            <span>{`${m.unavailableSources}: ${state.missing.join(', ')}`}</span>
            {onRetry && (
              <button type="button" className="btn btn-sm" onClick={onRetry}>
                {m.retry}
              </button>
            )}
          </div>
          {children(state.data)}
        </div>
      );
    case 'error': {
      const f = state.failure;
      const title =
        f instanceof SessionExpiredFailure
          ? m.sessionExpired
          : f instanceof ProblemFailure && f.problem.code === ProblemCode.configRequired
            ? m.configRequired
            : m.errorTitle;
      return (
        <div role="alert" data-state="error" className="alert alert-error flex flex-col items-start gap-1">
          <h2 className="font-bold">{title}</h2>
          <p className="break-keep">{m.errorBody}</p>
          <RequestId id={f.requestId} />
          {onRetry && (
            <button type="button" className="btn btn-sm mt-1" onClick={onRetry}>
              {m.retry}
            </button>
          )}
        </div>
      );
    }
    case 'forbidden':
      return (
        <div role="alert" data-state="forbidden" className="alert flex flex-col items-start gap-1">
          <h2 className="font-bold">{m.forbiddenTitle}</h2>
          <p className="break-keep">{m.forbiddenBody}</p>
          <RequestId id={state.requestId} />
        </div>
      );
    case 'unknown':
      return (
        <div role="alert" data-state="unknown" className="alert alert-info flex flex-col items-start gap-1">
          <h2 className="font-bold">{m.unknownTitle}</h2>
          <p className="break-keep">{m.unknownBody}</p>
          <RequestId id={state.requestId} />
          {onCheckAgain && (
            <button type="button" className="btn btn-sm btn-outline mt-1" onClick={onCheckAgain}>
              {m.checkAgain}
            </button>
          )}
        </div>
      );
  }
}
