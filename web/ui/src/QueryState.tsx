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
  return id ? <p className="text-xs text-base-content/55 select-all">{m.requestId(id)}</p> : null;
}

/**
 * 못 읽음·권한 없음·확인 중 상자 — 아이콘 · 굵은 제목 · 짧은 한 줄 · 오른쪽 단추(2026-11-25 백오피스 화면 기준,
 * 라이더 백오피스 LoadWarning — 라이더 사용자 2026-11-24 "불러오지 못했다고 적어놓으면 되지 … 너무 없어보인다"). 모든 웹 앱 공용.
 */
const boxTone = {
  error: { box: 'border-error/60 bg-error/10', icon: 'bg-error/15 text-error' },
  warning: { box: 'border-warning/60 bg-warning/10', icon: 'bg-warning/20 text-warning' },
  info: { box: 'border-info/50 bg-info/5', icon: 'bg-info/15 text-info' },
  muted: { box: 'border-base-300 bg-base-100', icon: 'bg-base-200 text-base-content/60' },
} as const;

function StateBox({ state, tone, title, body, requestId, action }: { readonly state: string; readonly tone: keyof typeof boxTone; readonly title: string; readonly body: string; readonly requestId?: string | undefined; readonly action?: ReactNode }) {
  const t = boxTone[tone];
  return (
    <div role="alert" data-state={state} className={`flex flex-wrap items-center gap-4 rounded-box border px-5 py-4 ${t.box}`}>
      <span className={`grid size-9 shrink-0 place-items-center rounded-full text-lg font-bold ${t.icon}`} aria-hidden="true">
        {tone === 'info' ? 'i' : '!'}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <h2 className="font-bold">{title}</h2>
        <p className="break-keep text-sm text-base-content/70">{body}</p>
        <RequestId id={requestId} />
      </div>
      {action}
    </div>
  );
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
          <div role="alert" className={`mb-4 flex flex-wrap items-center gap-4 rounded-box border px-5 py-3 ${boxTone.warning.box}`}>
            <span className={`grid size-8 shrink-0 place-items-center rounded-full font-bold ${boxTone.warning.icon}`} aria-hidden="true">
              !
            </span>
            <span className="min-w-0 flex-1 text-sm">{`${m.unavailableSources}: ${state.missing.join(', ')}`}</span>
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
      // 없는 건(404) — 다시 해도 같으니 "잠시 후 다시" 대신 번호 확인 안내, 다시 시도 단추 없음(2026-11-23 점검)
      if (f instanceof ProblemFailure && f.problem.status === 404) return <StateBox state="not-found" tone="muted" title={m.notFoundTitle} body={m.notFoundBody} />;
      const title =
        f instanceof SessionExpiredFailure
          ? m.sessionExpired
          : f instanceof ProblemFailure && f.problem.code === ProblemCode.configRequired
            ? m.configRequired
            : m.errorTitle;
      return (
        <StateBox
          state="error"
          tone="error"
          title={title}
          body={m.errorBody}
          requestId={f.requestId}
          action={
            onRetry && (
              <button type="button" className="btn btn-sm btn-primary" onClick={onRetry}>
                {m.retry}
              </button>
            )
          }
        />
      );
    }
    case 'forbidden':
      return <StateBox state="forbidden" tone="muted" title={m.forbiddenTitle} body={m.forbiddenBody} requestId={state.requestId} />;
    case 'unknown':
      return (
        <StateBox
          state="unknown"
          tone="info"
          title={m.unknownTitle}
          body={m.unknownBody}
          requestId={state.requestId}
          action={
            onCheckAgain && (
              <button type="button" className="btn btn-sm btn-outline" onClick={onCheckAgain}>
                {m.checkAgain}
              </button>
            )
          }
        />
      );
  }
}
