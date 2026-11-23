// 처리 대기(BO-12, 백엔드 요청 backoffice/2026-11-16-request-case-inbox-and-pending-work §2 — bff 0.2.0). OPERATOR_ADMIN.
// - 목록 `GET /backoffice/views/pending-work`(ComposedView): 멈춘 주문 처리(STUCK_SAGA)·이행 확인 필요(FULFILLMENT_ISSUE). unavailableSources 는 "일부 원천을 읽지 못함".
// - 버튼은 항목의 allowedActions 에 있는 것만:
//   REQUERY_RESULT → bff `POST /backoffice/commands/order-orchestration-service/saga-requery` {targetRef: refId, reason?, payload: {}}
//   MARK_RESOLVED  → bff `…/saga-resolve`(사유 필수 — 목록에서 빠질 뿐 주문·재고는 그대로)
//   ACKNOWLEDGE    → order-service `POST /fulfillment-issues/{refId}/acknowledgements` {note}
//   RETRY          → bff `…/commands/mfc-fulfillment-service/stop-retry`(MFC_STOP_FAILED)·`handover-retry`(MFC_HANDOVER_REJECTED), 사유 필수
//                    (bff 0.4.0, 백엔드 알림 notice-pending-work-mfc-retry). REJECTED = 다시 실패(원인 고친 뒤 다시). 메모는 아직 MFC 에 저장되지 않는다 — "기록됨"이라 쓰지 않는다.
//   MFC 두 종류 목록은 MFC 목록 API(F-4) 전까지 서버 설정으로 꺼져 있다 — sources 에 mfc-fulfillment-service 가 없으면 "아직 꺼져 있음" 안내(장애 아님).
//   bff 명령 응답은 CommandResponse(ACCEPTED ≠ 성공). APPLIED·REJECTED 만 확정하고, ACCEPTED·UNKNOWN_RESULT·시간 초과는 목록을 다시 읽어 "목록에서 확인" 안내(결과 불명 — 같은 키 재전송).
//   bff 0.12.0(백엔드 알림 notice-command-result): 결과 불명이면 "결과 확인" → `GET …/commands/{ts}/{cmd}/{requestId}?targetRef=`(관리자만, 누를 때만 — 자동 반복 없음).
//     saga-requery·saga-resolve·stop-retry 만. handover-retry 는 422(원천 단건 조회 없음)라 버튼 없이 같은 키 재전송만.
//     200 APPLIED → 반영, REJECTED(nextAction 없음 — 사가 FAILED) → 실패 확정,
//     REJECTED + FIX_AND_RETRY(중지 요청 아직 PENDING + lastError) → 실패 확정 아님: 원인(detail.lastError)을 고친 뒤 새 요청으로 다시 보내기 버튼, ACCEPTED → 아직 처리 중, UNKNOWN_RESULT(원천 시간 초과·5xx, confidence UNKNOWN) → 모름·잠시 뒤 다시.
//     404 = 명령이 원천에 닿지 않음 → "같은 요청으로 다시 보내기"(같은 키) 안내. 503·연결 끊김 = 모름·잠시 뒤 다시 확인. 어느 것도 성공으로 보이지 않는다.
//   422 NOT_REQUERYABLE·NOT_RESOLVABLE = 이미 바뀜(새로고침).
// - 사유·메모에 개인정보를 적지 않게 안내하고, 로그에 남기지 않는다.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { CommandRejectedFailure, ProblemFailure, UnknownResultFailure, request } from '@pmart/web-core';
import { CommandFeedback, QueryState, uiStateFromError, useCommand, type UiState } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components, paths } from '../../api/generated/backoffice-bff';
import { AllCentersTag, useCenterScope } from '../../shared/centerScope';
import { useApi } from '../../app/ApiContext';
import { messages as m, messages } from '../../shared/messages';
import { DisplayNumber } from '../../shared/displayNumber';
import { label, text, when } from '../../shared/ops';
import { SourceStamps } from '../../shared/SourceStamps';
import { CodeLabel, NextAction, StatCard, StatStrip, AllDone, ListHeader, refreshOf } from '../../shared/admin';
import { PENDING_KINDS } from '../../app/listCounts';
import { stopErrorName, stopErrorText } from '../../shared/blockReason';

type Item = components['schemas']['PendingWorkItem'];
type View = components['schemas']['ComposedView'] & { items?: Item[]; truncated?: boolean; centerUnfilteredSources?: string[] };
type Action = 'REQUERY_RESULT' | 'MARK_RESOLVED' | 'ACKNOWLEDGE' | 'RETRY';
type CheckResult = paths['/commands/{targetService}/{command}/{requestId}']['get']['responses'][200]['content']['application/json'];

const ORCHESTRATION = 'order-orchestration-service';
const MFC = 'mfc-fulfillment-service';
const COMMAND: Record<'REQUERY_RESULT' | 'MARK_RESOLVED', string> = { REQUERY_RESULT: 'saga-requery', MARK_RESOLVED: 'saga-resolve' };
/** RETRY 명령은 종류마다 다르다 */
const RETRY_COMMAND: Readonly<Record<string, string>> = { MFC_STOP_FAILED: 'stop-retry', MFC_HANDOVER_REJECTED: 'handover-retry' };

const ACTION_LABEL: Record<Action, string> = { REQUERY_RESULT: m.pending.requery, MARK_RESOLVED: m.pending.resolve, ACKNOWLEDGE: m.pending.acknowledge, RETRY: m.pending.retry };
const isAction = (a: string): a is Action => a === 'REQUERY_RESULT' || a === 'MARK_RESOLVED' || a === 'ACKNOWLEDGE' || a === 'RETRY';
/** 버튼으로 보일 조치: 서버가 허락했고, RETRY 는 화면이 아는 종류일 때만 */
const actionsOf = (item: Item): Action[] => item.allowedActions.filter(isAction).filter((a) => a !== 'RETRY' || !!RETRY_COMMAND[item.kind]);

/**
 * bff 명령을 한 번 보낸다 — 짝 조회(지금 501) 대신 목록 다시 읽기.
 * APPLIED → 그대로, REJECTED → 거절. ACCEPTED·UNKNOWN_RESULT·시간 초과 → 목록을 다시 읽고 결과 불명(같은 키 재전송만 허용).
 */
async function sendBffOnce<S extends { readonly status?: string; readonly requestId?: string; readonly nextAction?: string }>(
  send: () => Promise<S>,
  keyValue: string,
  reread: () => Promise<unknown>,
): Promise<S> {
  let first: S | undefined;
  try {
    first = await send();
  } catch (e) {
    if (!(e instanceof UnknownResultFailure)) throw e;
  }
  if (first?.status === 'APPLIED') return first;
  if (first?.status === 'REJECTED') throw new CommandRejectedFailure(first.nextAction, first.requestId);
  await reread();
  throw new UnknownResultFailure(undefined, first?.requestId || keyValue);
}

/** 결과 확인으로 알 수 있는 명령인지(bff 0.12.0) — handover-retry 는 원천 조회가 없어 422 */
const CHECKABLE = new Set(['saga-requery', 'saga-resolve', 'stop-retry']);

type Check =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'applied' | 'rejected' | 'fixAndRetry' | 'accepted' | 'unknown'; readonly result: CheckResult }
  | { readonly kind: 'notReached' | 'unavailable' | 'forbidden' | 'failed' };

const CHECK_TEXT: Readonly<Record<Exclude<Check['kind'], 'idle' | 'checking'>, string>> = {
  applied: m.pending.checkApplied,
  rejected: m.pending.checkRejected,
  fixAndRetry: m.pending.checkFixAndRetry,
  accepted: m.pending.checkAccepted,
  unknown: m.pending.checkUnknown,
  notReached: m.pending.checkNotReached,
  unavailable: m.pending.checkUnavailable,
  forbidden: m.pending.checkForbidden,
  failed: m.pending.checkFailed,
};

/** 결과 불명 → 원천을 다시 읽어 결과 확인(누를 때만). 반영·거절이 확정되면 onSettled */
function ResultCheck({
  targetService,
  command,
  requestId,
  targetRef,
  onSettled,
  onRetry,
}: {
  readonly targetService: string;
  readonly command: string;
  readonly requestId: string;
  readonly targetRef: string;
  readonly onSettled: () => void;
  /** 원인을 고친 뒤 새 요청(새 키)으로 다시 보내기 */
  readonly onRetry: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [check, setCheck] = useState<Check>({ kind: 'idle' });
  const run = async () => {
    setCheck({ kind: 'checking' });
    let next: Check;
    try {
      const r = await request('GET', api.bff.GET('/commands/{targetService}/{command}/{requestId}', { params: { path: { targetService, command, requestId }, query: { targetRef } } }));
      next =
        r.status === 'APPLIED'
          ? { kind: 'applied', result: r }
          : r.status === 'REJECTED'
            ? { kind: r.nextAction === 'FIX_AND_RETRY' ? 'fixAndRetry' : 'rejected', result: r }
            : r.status === 'ACCEPTED'
              ? { kind: 'accepted', result: r }
              : { kind: 'unknown', result: r };
    } catch (e) {
      const status = e instanceof ProblemFailure ? e.problem.status : 0;
      next = status === 404 ? { kind: 'notReached' } : status === 403 ? { kind: 'forbidden' } : status === 503 || status === 0 ? { kind: 'unavailable' } : { kind: 'failed' };
    }
    setCheck(next);
    if (next.kind === 'applied' || next.kind === 'rejected' || next.kind === 'fixAndRetry') {
      onSettled();
      await queryClient.invalidateQueries({ queryKey: ['bff', 'pending-work'] });
    }
  };
  const settled = check.kind === 'applied' || check.kind === 'rejected' || check.kind === 'fixAndRetry';
  const lastError = check.kind === 'fixAndRetry' ? check.result.detail?.['lastError'] : undefined;
  return (
    <div className="space-y-1" data-testid="result-check">
      {!settled && (
        <button type="button" className="btn btn-xs btn-outline" disabled={check.kind === 'checking'} onClick={() => void run()}>
          {m.pending.check}
        </button>
      )}
      {check.kind !== 'idle' && check.kind !== 'checking' && (
        <p role="status" className={`text-xs ${check.kind === 'applied' ? 'text-success' : check.kind === 'rejected' ? 'text-warning' : 'opacity-80'}`} data-testid="result-check-outcome" data-outcome={check.kind}>
          {CHECK_TEXT[check.kind]}
        </p>
      )}
      {check.kind === 'fixAndRetry' && (
        <>
          {typeof lastError === 'string' && lastError !== '' && (
            <p className="text-xs" data-testid="result-check-last-error">
              {m.pending.checkLastError(stopErrorText(lastError))}
            </p>
          )}
          <button type="button" className="btn btn-xs btn-primary" onClick={onRetry}>
            {m.pending.retryAgain}
          </button>
        </>
      )}
      {'result' in check && check.result.source && <SourceStamps sources={[check.result.source]} />}
    </div>
  );
}

function ActionForm({ item, action, onClose, onRestart }: { readonly item: Item; readonly action: Action; readonly onClose: () => void; readonly onRestart: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [text_, setText] = useState('');
  // 결과 확인(bff 0.12.0)으로 반영·거절이 확정됐는지 — 그러면 결과 불명 안내를 내리고 닫을 수 있다
  const [settled, setSettled] = useState(false);
  const targetService = action === 'RETRY' ? MFC : ORCHESTRATION;
  const command = action === 'RETRY' ? (RETRY_COMMAND[item.kind] ?? '') : action === 'ACKNOWLEDGE' ? '' : COMMAND[action];
  const cmd = useCommand(async (v: { text: string }, key) => {
    let r: unknown;
    try {
      if (action === 'ACKNOWLEDGE') {
        r = await request('POST', api.orders.POST('/fulfillment-issues/{issueId}/acknowledgements', { ...commandParams(key, { path: { issueId: item.refId } }), body: { note: v.text } }));
      } else {
        r = await sendBffOnce(
          () =>
            request(
              'POST',
              api.bff.POST('/commands/{targetService}/{command}', {
                ...commandParams(key, { path: { targetService, command } }),
                body: { targetRef: item.refId, payload: {}, ...(v.text ? { reason: v.text } : {}) },
              }),
            ),
          key.value,
          () => queryClient.invalidateQueries({ queryKey: ['bff', 'pending-work'] }),
        );
      }
    } finally {
      // 거절(REJECTED)이어도 MFC 에 재시도 기록이 남는다(bff 0.8.0 lastRetry) — 목록을 다시 읽는다
      await queryClient.invalidateQueries({ queryKey: ['bff', 'pending-work'] });
    }
    return r;
  });
  const required = action !== 'REQUERY_RESULT';
  const ok = (!required || text_.trim().length >= 1) && text_.trim().length <= 500;
  return (
    <form
      className="space-y-1"
      aria-label={`${ACTION_LABEL[action]} ${item.orderNumber ?? ''}`.trim()}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        if (cmd.phase.kind === 'rejected') cmd.reset();
        void cmd.run({ text: text_.trim() });
      }}
    >
      {action === 'RETRY' && item.kind === 'MFC_HANDOVER_REJECTED' && (
        <p role="note" className="text-xs text-warning">
          {m.pending.handoverRetryGuide}
        </p>
      )}
      {action === 'MARK_RESOLVED' && (
        <p role="alert" className="text-xs text-warning">
          {m.pending.resolveWarn}
        </p>
      )}
      <label className="flex flex-col gap-1 text-xs">
        {action === 'ACKNOWLEDGE' ? m.pending.note : action === 'MARK_RESOLVED' ? m.pending.resolveReason : action === 'RETRY' ? m.pending.retryReason : m.pending.requeryReason}
        <textarea className="textarea textarea-xs w-64" maxLength={500} value={text_} onChange={(e) => setText(e.target.value)} />
      </label>
      <p className="text-xs text-base-content/60">{action === 'ACKNOWLEDGE' ? m.pending.noteHint : action === 'RETRY' ? m.pending.retryHint : m.pending.reasonHint}</p>
      <div className="flex gap-1">
        <button type="submit" className="btn btn-xs btn-primary" disabled={!ok || cmd.busy}>
          {m.pending.confirm}
        </button>
        <button type="button" className="btn btn-xs" disabled={cmd.busy && !settled} onClick={onClose}>
          {m.pending.cancel}
        </button>
      </div>
      {action === 'RETRY' && cmd.phase.kind === 'rejected' && (
        <p className="text-xs text-warning" data-testid="retry-rejected">
          {m.pending.retryRejected}
        </p>
      )}
      {!settled && (
        <CommandFeedback command={cmd} {...(action === 'ACKNOWLEDGE' ? {} : { unknown: { body: CHECKABLE.has(command) ? m.pending.unknownCheck : m.pending.unknownReread } })}>
          {() => <span className="text-xs text-success">{m.pending.done}</span>}
        </CommandFeedback>
      )}
      {cmd.phase.kind === 'unknown' && CHECKABLE.has(command) && (
        <ResultCheck targetService={targetService} command={command} requestId={cmd.phase.failure.requestId ?? ''} targetRef={item.refId} onSettled={() => setSettled(true)} onRetry={onRestart} />
      )}
    </form>
  );
}

/** 주문 칸 — MFC 거절 인계는 주문 번호가 없을 수 있다(bff 0.9.2). 없으면 "—"(빈 링크를 만들지 않는다) */
/** 주문 칸 — 화면 주문번호(bff 0.19.0 orderNumber, ADR-0070 덧붙임). 시스템 ID 는 링크 대상으로만 */
function OrderCell({ orderId, orderNumber }: { readonly orderId: string | null | undefined; readonly orderNumber?: string | null | undefined }) {
  if (!orderId) return <span className="opacity-70">{m.none}</span>;
  return (
    <Link className="link" to={`/orders/${encodeURIComponent(orderId)}`}>
      <DisplayNumber number={orderNumber} systemId={orderId} />
    </Link>
  );
}

/** 직원 — bff 가 준 "이름 · 사번"(lastRetry.operator). 없으면 "직원" */
const operatorText = (o: { readonly name?: string | null; readonly employeeNo?: string | null } | null | undefined) =>
  o?.name ? `${o.name}${o.employeeNo ? ` · ${o.employeeNo}` : ''}` : messages.displayNumber.staffUnknown;

function Actions({ item }: { readonly item: Item }) {
  const [open, setOpen] = useState<Action | null>(null);
  // 새로 열 때마다 새 폼 = 새 요청(새 키). 결과 확인에서 "원인 고친 뒤 다시"를 누르면 다시 연다
  const [round, setRound] = useState(0);
  const actions = actionsOf(item);
  if (open) return <ActionForm key={round} item={item} action={open} onClose={() => setOpen(null)} onRestart={() => setRound((n) => n + 1)} />;
  return (
    <div className="flex flex-wrap gap-1">
      {actions.map((a) => (
        <button key={a} type="button" className={`btn btn-xs ${a === 'MARK_RESOLVED' ? 'btn-outline btn-warning' : ''}`} onClick={() => setOpen(a)}>
          {ACTION_LABEL[a]}
        </button>
      ))}
    </div>
  );
}

export function PendingPage() {
  const api = useApi();
  const centerId = useCenterScope(); // 머리줄 센터 고르기(2026-11-23, bff 0.24.0 BF-4) — 고침 뒤 다시 읽기는 ['bff','pending-work'] 앞부분으로 모두
  const query = useQuery({
    queryKey: ['bff', 'pending-work', centerId],
    queryFn: async (): Promise<View> => request('GET', api.bff.GET('/views/pending-work', centerId ? { params: { query: { centerId } } } : {})),
  });
  const state: UiState<View> = query.isPending
    ? { kind: 'loading' }
    : query.isError
      ? uiStateFromError(query.error)
      : (query.data.unavailableSources?.length ?? 0) > 0
        ? { kind: 'partial', data: query.data, missing: query.data.unavailableSources ?? [] }
        : (query.data.items?.length ?? 0) === 0
          ? { kind: 'empty' }
          : { kind: 'ready', data: query.data };

  // "다 처리했어요"는 서버가 다 읽고 0건이라 했을 때만 — 일부 원천 실패·MFC 꺼짐이면 0건이어도 끝났다고 하지 않는다
  const pendingAllDone = query.isSuccess && (query.data.items ?? []).length === 0 && !query.data.truncated && (query.data.unavailableSources ?? []).length === 0 && (query.data.sources ?? []).some((x) => x.system === MFC);
  return (
    <section className="space-y-4">
      <ListHeader title={m.pending.title} count={query.data ? `${(query.data.items ?? []).length}${query.data.truncated ? '+' : ''}` : undefined} refresh={refreshOf(query)} />
      {/* 숫자 띠(2026-11-19 관제 형식) — 이 화면이 읽은 목록을 종류별로(대시보드 "확인이 필요한 문제"와 같은 조회·기준). 잘렸으면 "N+" */}
      {query.data && (
        <StatStrip label={m.listStrip.pending} testId="pending-strip">
          {PENDING_KINDS.map((k) => {
            const n = (query.data.items ?? []).filter(k.match).length;
            return <StatCard key={k.id} label={m.dashboard.risk[k.id === 'payment' ? 'paymentUnknown' : k.id]} value={`${n}${query.data.truncated ? '+' : ''}`} tone={n > 0 ? k.tone : undefined} testId={`pending-strip-${k.id}`} />;
          })}
        </StatStrip>
      )}
      {/* 처리 대기가 서버 0건이고 모든 원천을 읽었을 때(잘림·못 읽은 원천·꺼진 MFC 없음)만 "다 처리했어요"(2026-11-19) */}
      {pendingAllDone && <AllDone title={m.allDone.pending} body={m.allDone.pendingBody} testId="pending-all-done" />}
      {!(pendingAllDone) && (
      <QueryState state={state} onRetry={() => void query.refetch()} emptyText={m.pending.empty}>
        {(view) => (
          <>
            <SourceStamps sources={view.sources} unavailableSources={view.unavailableSources} />
            {/* bff 0.9.1 — MFC 목록이 1,000건을 넘어 뒤를 못 읽었다 */}
            {view.truncated && (
              <p role="alert" className="alert alert-warning alert-soft text-sm" data-testid="pending-truncated">
                {m.pending.truncated}
              </p>
            )}
            <PendingNext items={view.items ?? []} />
            {/* 종류별 묶음(2026-11-18): 위 숫자 카드(누르면 그 묶음으로) → 묶음 카드마다 항목 줄 */}
            <PendingGroups items={view.items ?? []} unfiltered={view.centerUnfilteredSources ?? []} />
          </>
        )}
      </QueryState>
      )}
      {query.isSuccess && !(query.data.sources ?? []).some((s) => s.system === MFC) && !(query.data.unavailableSources ?? []).includes(MFC) && (
        <p className="text-xs text-base-content/60" data-testid="pending-not-yet">
          {m.pending.notYet}
        </p>
      )}
    </section>
  );
}

/** 종류 → 원천(bff 0.24.0 centerUnfilteredSources 와 맞춰 "모든 센터" 꼬리) — 멈춘 주문 처리는 사가에 센터가 없다 */
const KIND_SOURCE: Readonly<Record<string, string>> = { STUCK_SAGA: ORCHESTRATION };

/** 종류 색 — 이름이 있는 종류만 색을 준다. 모르는 종류는 회색 */
const KIND_STYLE: Readonly<Record<string, { readonly chip: string; readonly bar: string; readonly icon: string }>> = {
  STUCK_SAGA: { chip: 'bg-error/10 text-error', bar: 'border-l-error', icon: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z' },
  FULFILLMENT_ISSUE: { chip: 'bg-warning/15 text-warning', bar: 'border-l-warning', icon: 'M4 8l8-4 8 4-8 4-8-4Zm0 0v8l8 4 8-4V8' },
  MFC_STOP_FAILED: { chip: 'bg-accent/15 text-accent', bar: 'border-l-accent', icon: 'M6 6h12v12H6z' },
  MFC_HANDOVER_REJECTED: { chip: 'bg-info/10 text-info', bar: 'border-l-info', icon: 'M7 17 17 7M17 7H9m8 0v8' },
};
const OTHER_STYLE = { chip: 'bg-base-200 text-base-content/70', bar: 'border-l-base-300', icon: 'M12 8v4m0 4h.01' };

function KindIcon({ d }: { readonly d: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/** 다음 할 일 — 서버 순서(오래된 것부터)의 첫 항목 묶음으로. 판정은 하지 않는다(서버가 준 목록·순서 그대로) */
function PendingNext({ items }: { readonly items: readonly Item[] }) {
  const first = items[0];
  if (!first) return null;
  return (
    <NextAction tone="warning" title={m.pending.nextTitle(items.length)} body={m.pending.nextBody(label(m.pending.kindName, first.kind), when(first.since))}>
      <a href={`#pending-${first.kind}`} className="btn btn-sm btn-primary">
        {m.pending.nextGo}
      </a>
    </NextAction>
  );
}

function PendingGroups({ items, unfiltered }: { readonly items: readonly Item[]; readonly unfiltered: readonly string[] }) {
  // 묶음 차례 = 서버 순서(오래된 것부터)에서 처음 나온 차례, 묶음 안도 서버 순서 그대로
  const kinds = [...new Set(items.map((i) => i.kind))];
  const groups = kinds.map((k) => ({ kind: k, items: items.filter((i) => i.kind === k) }));
  return (
    <>
      <div className="pm-stat-strip flex flex-wrap gap-px overflow-hidden rounded-box border border-base-300 bg-base-300">
        {groups.map((g) => {
          const st = KIND_STYLE[g.kind] ?? OTHER_STYLE;
          return (
            <a key={g.kind} href={`#pending-${g.kind}`} className="flex items-center gap-3 bg-base-100 px-5 py-4 transition-colors hover:bg-base-200/50" data-testid="pending-kind-count">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${st.chip}`}>
                <KindIcon d={st.icon} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs text-base-content/60">{label(m.pending.kindName, g.kind)}</span>
                <span className="text-[22px] font-semibold leading-tight tracking-tight">{m.pending.count(g.items.length)}</span>
              </span>
            </a>
          );
        })}
      </div>
      {groups.map((g) => {
        const st = KIND_STYLE[g.kind] ?? OTHER_STYLE;
        return (
          <section key={g.kind} id={`pending-${g.kind}`} className="scroll-mt-4 overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm" aria-label={label(m.pending.kindName, g.kind)}>
            <div className="flex items-center gap-2 border-b border-base-300 px-5 py-3">
              <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${st.chip}`}>
                <KindIcon d={st.icon} />
              </span>
              <h2 className="font-semibold">{label(m.pending.kindName, g.kind)}</h2>
              {KIND_SOURCE[g.kind] !== undefined && unfiltered.includes(KIND_SOURCE[g.kind]!) && <AllCentersTag />}
              <span className="badge badge-ghost badge-sm">{g.items.length}</span>
            </div>
            <ul className="divide-y divide-base-300/70">
              {g.items.map((i) => (
                <li key={`${i.kind}:${i.refId}`} className={`grid gap-x-6 gap-y-3 border-l-4 px-5 py-4 text-sm md:grid-cols-[minmax(0,1fr)_minmax(16rem,auto)] ${st.bar}`} data-testid="pending-item" data-kind={i.kind}>
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{i.reasonCode ? i.kind === 'FULFILLMENT_ISSUE' ? <CodeLabel code={i.reasonCode} names={m.pending.reasonName} /> : <span title={i.reasonCode}>{stopErrorName(i.reasonCode)}</span> : m.none}</span>
                      {i.state && (
                        <span className="badge badge-sm badge-ghost" data-testid="pending-state">
                          <CodeLabel code={i.state} names={m.pending.stateNameByKind[i.kind] ?? {}} />
                        </span>
                      )}
                    </div>
                    {i.reasonMessage && <p className="text-xs text-base-content/65">{i.reasonMessage}</p>}
                    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs [&_dt]:text-base-content/50">
                      <div className="flex gap-1.5">
                        <dt>{m.pending.since}</dt>
                        <dd>{when(i.since)}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt>{m.pending.orderId}</dt>
                        <dd>
                          <OrderCell orderId={i.orderId} orderNumber={i.orderNumber} />
                        </dd>
                      </div>
                      {i.sagaType && (
                        <div className="flex gap-1.5">
                          <dt>{m.pending.saga}</dt>
                          <dd>
                            {/* 사가 표기 "74939255 재발송"(ADR-0070 덧붙임) */}
                            {`${i.orderNumber ? `${i.orderNumber} ` : ''}${label(m.pending.sagaTypeName, i.sagaType)}`}
                            {i.step && (
                              <>
                                {' · '}
                                <CodeLabel code={i.step} names={m.pending.stepName} />
                              </>
                            )}
                          </dd>
                        </div>
                      )}
                      {i.mfcId && (
                        <div className="flex gap-1.5">
                          <dt>{m.pending.mfc}</dt>
                          <dd className="font-mono">{i.mfcId}</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                  <div className="min-w-0 space-y-1 md:border-l md:border-base-300/70 md:pl-6">
                    <p className="text-xs font-medium text-base-content/50">{m.pending.actions}</p>
                    <Actions item={i} />
                    {/* bff 0.8.0 — 최근 운영자 재시도(MFC 에 남은 기록). 없으면 줄 없음 */}
                    {i.lastRetry && (
                      <p className="mt-1 text-xs text-base-content/60" data-testid="pending-last-retry">
                        {m.pending.lastRetry(operatorText(i.lastRetry.operator), when(i.lastRetry.retriedAt), text(i.lastRetry.reason))}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
