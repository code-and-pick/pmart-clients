// 센터 운영판 + 예외 처리함(센터 첫 화면, 2026-11-19).
// 원천(모두 기존 API — 새 계약 없음):
// - 출하 약속 초과·임박: mfc-fulfillment `GET /tasks?mfcId=&state=WAITING…BLOCKED`(커서로 끝까지, 최대 TASK_MAX_PAGES 쪽 — 넘으면 "N건 이상"),
//   promisedReadyAt + 작업 상태로만 판정(opsRules.ts). 상세 = 작업 상세(출고·포장·작업 풀기).
// - 피킹 결품·파손 건수: mfc-fulfillment `GET /metrics/picking-lines?from=오늘&to=오늘&mfcId=`(0.19.0, 서버가 센 줄 수 — 사유 SHORT·DAMAGED).
//   건별: 파손은 mfc-quality `GET /quality-incidents?mfcId=&kind=DAMAGE`(열림·판정됨) 중 결품 보고(LineShortageReported)로 열린 것 → 품질 사고 상세.
//   결품(SHORT) 건별 센터 목록은 계약이 없다 → 안내만(막힘·수량 차이를 결품으로 추정하지 않는다).
// - 인계 확인 필요: mfc-fulfillment `GET /packages?mfcId=&checkRequired=true`(전체 목록) → 작업 현황의 확인 필요 포장(확인 버튼은 그 화면).
// 원천마다 따로 읽는다: 하나가 실패해도 나머지는 보이고, 실패한 것은 0건이 아니라 "조회 실패". 센터가 바뀌면 쿼리 키가 바뀌어 이전 센터 값을 보이지 않는다.
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul } from '@pmart/web-ui';
import type { Api } from '../../api/client';
import type { components as QualitySchemas } from '../../api/generated/mfc-quality';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { DisplayNumber, RiderLabel } from '../../shared/displayNumber';
import { messages } from '../../shared/messages';
import { Who } from '../../shared/OperatorLabel';
import {
  DUE_SOON_MINUTES,
  minutesSince,
  minutesText,
  OPEN_TASK_STATES,
  promiseRows,
  seoulToday,
  TASK_MAX_PAGES,
  TASK_PAGE_SIZE,
  type PromiseRow,
  type TaskSummary,
} from './opsRules';

const m = messages.ops;
const REFRESH_MS = 60_000;

type Filter = 'promise' | 'picking' | 'handover';
const FILTERS: readonly Filter[] = ['promise', 'picking', 'handover'];
type Incident = QualitySchemas['schemas']['QualityIncident'];

// ---------------------------------------------------------------- 읽기

async function readOpenTasks(api: Api, mfcId: string) {
  const items: TaskSummary[] = [];
  let cursor: string | undefined;
  let asOf: string | undefined;
  for (let page = 0; page < TASK_MAX_PAGES; page += 1) {
    const r = await request(
      'GET',
      api.fulfillment.GET('/tasks', { params: { query: { mfcId, state: [...OPEN_TASK_STATES], size: TASK_PAGE_SIZE, ...(cursor ? { cursor } : {}) } } }),
    );
    asOf ??= r.asOf?.asOf ?? undefined;
    items.push(...(r.items ?? []));
    cursor = r.page?.nextCursor ?? undefined;
    if (!cursor) return { items, complete: true, asOf };
  }
  return { items, complete: false, asOf };
}

function useOps(mfcId: string) {
  const api = useApi();
  const common = { refetchInterval: REFRESH_MS } as const;
  const tasks = useQuery({ ...common, queryKey: ['ops', mfcId, 'tasks'], queryFn: () => readOpenTasks(api, mfcId) });
  const metrics = useQuery({
    ...common,
    queryKey: ['ops', mfcId, 'picking-lines'],
    queryFn: async () => {
      const today = seoulToday(Date.now());
      const r = await request('GET', api.fulfillment.GET('/metrics/picking-lines', { params: { query: { from: today, to: today, mfcId } } }));
      // 0건 날짜는 줄이 없다(계약) — 그날 줄이 없으면 실제 0.
      const row = (r.items ?? []).find((i) => i.mfcId === mfcId && i.date === today);
      return { short: row?.shortLinesByReason.SHORT ?? 0, damaged: row?.shortLinesByReason.DAMAGED ?? 0, asOf: r.asOf ?? null };
    },
  });
  const damages = useQuery({
    ...common,
    queryKey: ['ops', mfcId, 'damage-incidents'],
    queryFn: async () => {
      const r = await request('GET', api.quality.GET('/quality-incidents', { params: { query: { mfcId, kind: 'DAMAGE', size: 200 } } }));
      // 피킹 결품 보고(DAMAGED)로 열린 사고만 — 직접 등록·다른 원천은 빼고(서버 sourceEvent 값).
      return { items: (r.items ?? []).filter((i) => i.sourceEvent === 'LineShortageReported'), complete: !r.nextCursor };
    },
  });
  const handovers = useQuery({
    ...common,
    queryKey: ['ops', mfcId, 'packages-to-check'],
    queryFn: () => request('GET', api.fulfillment.GET('/packages', { params: { query: { mfcId, checkRequired: true } } })),
  });
  return { tasks, metrics, damages, handovers };
}

// ---------------------------------------------------------------- 화면

/** `/c/:mfcId/ops` — 센터가 바뀌면 화면을 새로(이전 센터 값·필터를 남기지 않는다) */
export function OpsMenu({ mfcId }: { readonly mfcId: string }) {
  return <OpsBoard key={mfcId} mfcId={mfcId} />;
}

function OpsBoard({ mfcId }: { readonly mfcId: string }) {
  const { tasks, metrics, damages, handovers } = useOps(mfcId);
  const [params, setParams] = useSearchParams();
  const raw = params.get('type');
  const filter = (FILTERS as readonly string[]).includes(raw ?? '') ? (raw as Filter) : null;
  const choose = (f: Filter | null) => setParams(f ? { type: f } : {}, { replace: true });

  // 지금 = 서버 기준시각(asOf), 없으면 응답을 받은 시각(렌더 중 시계를 읽지 않는다)
  const nowMs = tasks.data?.asOf ? Date.parse(tasks.data.asOf) : tasks.dataUpdatedAt;
  const promise = tasks.data ? promiseRows(tasks.data.items, nowMs) : null;
  const countText = (n: number, complete: boolean) => (complete ? m.count(n) : m.atLeast(n));
  const refetchAll = () => {
    void tasks.refetch();
    void metrics.refetch();
    void damages.refetch();
    void handovers.refetch();
  };
  const busy = tasks.isFetching || metrics.isFetching || damages.isFetching || handovers.isFetching;

  const asOf = tasks.data?.asOf ?? null;
  const shortN = metrics.data?.short ?? 0;
  const damagedN = metrics.data?.damaged ?? 0;
  const handoverN = (handovers.data?.items ?? []).length;
  const notes = [
    m.card.promiseRule(DUE_SOON_MINUTES),
    ...(promise && promise.noPromise > 0 ? [m.card.noPromise(promise.noPromise)] : []),
    m.card.pickingRule,
    m.card.handoverRule,
  ];

  // 통합 백오피스 대시보드와 같은 짜임(2026-11-19): 제목·기준 줄 → "내 할 일" 숫자 칸(왼쪽 색 띠) → "이상 N" 한 줄 → 예외 처리함
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{m.title}</h1>
          <p className="text-sm text-base-content/60">{asOf ? m.subtitle(formatSeoul(asOf)) : m.intro}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-base-content/60">
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${busy ? 'bg-warning' : 'bg-success'}`} aria-hidden="true" />
            {busy ? m.refreshing : m.autoRefreshNote}
          </span>
          <button type="button" className="btn btn-ghost btn-xs font-bold" onClick={refetchAll} disabled={busy}>
            {m.refresh}
          </button>
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">{m.todoTitle}</h2>
          <span className="text-xs text-base-content/50">{m.todoHint}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Tile
            testId="tile-overdue"
            label={m.tile.overdue}
            tone="error"
            state={tasks}
            value={promise && tasks.data ? countText(promise.overdue, tasks.data.complete) : ''}
            has={(promise?.overdue ?? 0) > 0}
            active={filter === 'promise'}
            onClick={() => choose('promise')}
          />
          <Tile
            testId="tile-due"
            label={m.tile.dueSoon}
            tone="warning"
            state={tasks}
            value={promise && tasks.data ? countText(promise.dueSoon, tasks.data.complete) : ''}
            has={(promise?.dueSoon ?? 0) > 0}
            active={filter === 'promise'}
            onClick={() => choose('promise')}
          />
          <Tile
            testId="tile-short"
            label={m.tile.short}
            tone="warning"
            state={metrics}
            value={m.lines(shortN)}
            has={shortN > 0}
            active={filter === 'picking'}
            onClick={() => choose('picking')}
          />
          <Tile
            testId="tile-damaged"
            label={m.tile.damaged}
            tone="warning"
            state={metrics}
            value={m.lines(damagedN)}
            has={damagedN > 0}
            active={filter === 'picking'}
            onClick={() => choose('picking')}
          />
          <Tile
            testId="tile-handover"
            label={m.tile.handover}
            tone="info"
            state={handovers}
            value={m.count(handoverN)}
            has={handoverN > 0}
            active={filter === 'handover'}
            onClick={() => choose('handover')}
          />
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-base-content/50" data-testid="ops-rules">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>

      <StatusStrip
        onFilter={choose}
        parts={[
          { key: 'promise', state: tasks, n: promise?.overdue ?? 0, text: m.issue.overdue },
          { key: 'handover', state: handovers, n: handoverN, text: m.issue.handover },
          { key: 'picking', state: damages, n: damages.data?.items.length ?? 0, text: m.issue.damaged },
        ]}
      />

      <ExceptionList
        mfcId={mfcId}
        filter={filter}
        onFilter={choose}
        promise={promise}
        tasks={tasks}
        damages={damages}
        handovers={handovers}
      />
    </section>
  );
}

interface QueryLike {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly refetch: () => unknown;
}

/** "내 할 일" 숫자 칸 — 통합 백오피스 WorkTile 과 같은 모양(왼쪽 색 띠는 일이 있을 때만). 누르면 아래 처리함이 그 유형으로 */
function Tile({
  testId,
  label,
  value,
  state,
  tone,
  has,
  active,
  onClick,
}: {
  readonly testId: string;
  readonly label: string;
  readonly value: string;
  readonly state: QueryLike;
  readonly tone: 'error' | 'warning' | 'info';
  readonly has: boolean;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  const [text, stripe] = { error: ['text-error', 'border-l-error'], warning: ['text-warning', 'border-l-warning'], info: ['text-info', 'border-l-info'] }[tone];
  const failed = state.isError;
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={`block rounded-lg border border-l-4 bg-base-100 px-4 py-3 text-left transition hover:bg-base-200/60 ${active ? 'border-primary/40 ring-1 ring-primary/30' : 'border-base-300'} ${has && !failed ? stripe : 'border-l-base-300'}`}
    >
      <p className="text-xs text-base-content/60">{label}</p>
      {state.isPending ? (
        <p className="mt-0.5 text-2xl font-bold text-base-content/40">…</p>
      ) : failed ? (
        <p className="mt-0.5 text-sm font-semibold text-error" data-state="error">
          {m.failed}
        </p>
      ) : (
        <p data-testid={`${testId}-value`} className={`mt-0.5 text-2xl font-bold tabular-nums ${has ? text : 'text-base-content/70'}`}>
          {value}
        </p>
      )}
    </button>
  );
}

/** "이상 없음 / 이상 N" 한 줄(통합 백오피스 DashboardStatus 와 같은 모양) — 서버 숫자만. 못 읽은 원천이 있으면 "이상 없음"이라 하지 않는다 */
function StatusStrip({
  parts,
  onFilter,
}: {
  readonly parts: ReadonlyArray<{ readonly key: Filter; readonly state: QueryLike; readonly n: number; readonly text: (n: number) => string }>;
  readonly onFilter: (f: Filter) => void;
}) {
  const issues = parts.filter((p) => !p.state.isPending && !p.state.isError && p.n > 0);
  const failed = parts.filter((p) => p.state.isError).length;
  const loading = parts.some((p) => p.state.isPending);
  const tone = issues.length > 0 ? 'error' : failed > 0 ? 'warning' : loading ? 'neutral' : 'success';
  const box = { error: 'border-error/30 bg-error/10', warning: 'border-warning/40 bg-warning/10', neutral: 'border-base-300 bg-base-100', success: 'border-success/30 bg-success/10' }[tone];
  const dot = { error: 'bg-error', warning: 'bg-warning', neutral: 'bg-base-content/30', success: 'bg-success' }[tone];
  const title = issues.length > 0 ? m.status.issues(issues.length) : failed > 0 ? m.status.unknown : loading ? m.status.checking : m.status.ok;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-box border px-4 py-2.5 text-sm ${box}`} aria-live="polite" data-testid="ops-status" data-tone={tone}>
      <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
        {tone === 'error' && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${dot}`} />}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dot}`} />
      </span>
      <span className="font-bold">{title}</span>
      {issues.map((p) => (
        <button key={p.key} type="button" className="link link-hover text-error" onClick={() => onFilter(p.key)}>
          {p.text(p.n)}
        </button>
      ))}
      {failed > 0 && <span className="text-xs text-base-content/60">{m.status.failed(failed)}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- 예외 처리함

interface Row {
  readonly key: string;
  readonly group: Filter;
  readonly rank: number;
  readonly type: string;
  readonly id: ReactNode;
  readonly reason: ReactNode;
  readonly elapsed: string;
  readonly assignee: ReactNode;
  readonly next: ReactNode;
}

function ExceptionList({
  mfcId,
  filter,
  onFilter,
  promise,
  tasks,
  damages,
  handovers,
}: {
  readonly mfcId: string;
  readonly filter: Filter | null;
  readonly onFilter: (f: Filter | null) => void;
  readonly promise: ReturnType<typeof promiseRows> | null;
  readonly tasks: ReturnType<typeof useOps>['tasks'];
  readonly damages: ReturnType<typeof useOps>['damages'];
  readonly handovers: ReturnType<typeof useOps>['handovers'];
}) {
  const show = (g: Filter) => filter === null || filter === g;
  const sources = [
    { group: 'promise' as const, q: tasks, label: m.card.promise },
    { group: 'picking' as const, q: damages, label: m.card.picking },
    { group: 'handover' as const, q: handovers, label: m.card.handover },
  ].filter((s) => show(s.group));
  const pending = sources.some((s) => s.q.isPending);
  const failed = sources.filter((s) => s.q.isError);

  const rows: Row[] = [];
  if (show('promise')) rows.push(...(promise?.rows ?? []).map((r) => promiseRow(mfcId, r)));
  if (show('picking')) rows.push(...(damages.data?.items ?? []).map((i) => damageRow(mfcId, i, damages.dataUpdatedAt)));
  if (show('handover')) {
    const asOf = handovers.data?.asOf?.asOf;
    const now = asOf ? Date.parse(asOf) : handovers.dataUpdatedAt;
    rows.push(...(handovers.data?.items ?? []).map((p) => handoverRow(mfcId, p, now)));
  }
  rows.sort((a, b) => a.rank - b.rank);

  return (
    <div className="space-y-2 rounded-box bg-base-100 p-4" data-testid="exception-list">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold">{m.listTitle}</h2>
        {/* 통합 백오피스 대시보드 탭과 같은 밑줄 탭 */}
        <div role="group" className="tabs tabs-border ml-2">
          <button type="button" className={`tab ${filter === null ? 'tab-active font-bold' : ''}`} aria-pressed={filter === null} onClick={() => onFilter(null)}>
            {m.filter.all}
          </button>
          {FILTERS.map((f) => (
            <button key={f} type="button" className={`tab ${filter === f ? 'tab-active font-bold' : ''}`} aria-pressed={filter === f} onClick={() => onFilter(f)}>
              {m.filter[f]}
            </button>
          ))}
        </div>
      </div>
      {failed.map((s) => (
        <p key={s.group} role="alert" className="alert alert-error text-sm" data-testid={`source-failed-${s.group}`}>
          {m.sourceFailed(s.label)}
          <button type="button" className="btn btn-xs" onClick={() => void s.q.refetch()}>
            {m.retry}
          </button>
        </p>
      ))}
      {show('promise') && tasks.data && !tasks.data.complete && (
        <p className="text-warning text-xs">{m.truncated(tasks.data.items.length)}</p>
      )}
      {show('picking') && <p className="text-xs opacity-70">{m.shortListMissing}</p>}
      {pending && rows.length === 0 ? (
        <span className="loading loading-dots loading-sm" aria-label={messages.loading} />
      ) : rows.length === 0 ? (
        failed.length === 0 && (
          <p data-state="empty" className="p-2 opacity-70">
            {m.empty}
          </p>
        )
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>{m.col.type}</th>
                <th>{m.col.id}</th>
                <th>{m.col.reason}</th>
                <th>{m.col.elapsed}</th>
                <th>{m.col.assignee}</th>
                <th>{m.col.next}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-testid="exception-row" data-group={r.group}>
                  <td className="whitespace-nowrap font-semibold">{r.type}</td>
                  <td className="text-xs">{r.id}</td>
                  <td className="text-xs">{r.reason}</td>
                  <td className="whitespace-nowrap text-xs">{r.elapsed}</td>
                  <td className="text-xs">{r.assignee}</td>
                  <td className="text-xs">{r.next}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const taskStage = (t: TaskSummary) =>
  `${messages.tasks.taskType[t.taskType ?? ''] ?? t.taskType ?? m.noInfo} ${messages.tasks.taskState[t.state ?? ''] ?? t.state ?? ''}`.trim();

function promiseRow(mfcId: string, r: PromiseRow): Row {
  const taskId = r.task.taskId ?? '';
  return {
    key: `promise-${r.shipmentId ?? taskId}`,
    group: 'promise',
    // 많이 지난 것 → 인계 → 파손 → 임박(곧 다가오는 순)
    rank: r.kind === 'overdue' ? -r.minutes : 1_000_000 + r.minutes,
    type: r.kind === 'overdue' ? m.type.overdue : m.type.dueSoon,
    id: (
      <>
        <div>
          {`${m.orderLabel} `}
          {r.orderNumber ? <DisplayNumber number={r.orderNumber} /> : m.noInfo}
        </div>
        <div className="font-mono opacity-70">{`${m.taskLabel} ${taskId}`}</div>
      </>
    ),
    reason: m.reason.promise(formatSeoul(r.promisedAt), taskStage(r.task)),
    elapsed: r.kind === 'overdue' ? m.overdueFor(minutesText(r.minutes)) : m.dueIn(minutesText(r.minutes)),
    assignee: <Who id={r.task.assignment?.workerId} empty={messages.tasks.unassigned} />,
    next: (
      <Link className="link" to={centerPath(mfcId, `tasks/${encodeURIComponent(taskId)}`)}>
        {m.next.task}
      </Link>
    ),
  };
}

function damageRow(mfcId: string, i: Incident, nowMs: number): Row {
  const id = i.incidentId ?? '';
  const lots = (i.affectedLots ?? []).map((l) => l.lotId).join(', ') || m.noInfo;
  const min = i.openedAt ? minutesSince(i.openedAt, nowMs) : null;
  return {
    key: `damage-${id}`,
    group: 'picking',
    rank: 600_000 - (min ?? 0),
    type: m.type.damaged,
    id: <div className="font-mono">{`${m.incidentLabel} ${id}`}</div>,
    reason: m.reason.damaged(lots),
    elapsed: min === null ? m.noInfo : minutesText(min),
    // 품질 사고에는 담당자가 없다(계약) — 추정하지 않는다.
    assignee: m.noInfo,
    next: (
      <Link className="link" to={`${centerPath(mfcId, 'quality')}?tab=incidents&incidentId=${encodeURIComponent(id)}`}>
        {m.next.incident}
      </Link>
    ),
  };
}

type Resolution = NonNullable<NonNullable<ReturnType<typeof useOps>['handovers']['data']>['items']>[number];

function handoverRow(mfcId: string, p: Resolution, nowMs: number): Row {
  const expired = p.fence?.expiresAt ?? null;
  const min = expired ? minutesSince(expired, nowMs) : null;
  return {
    key: `handover-${p.packageId ?? ''}`,
    group: 'handover',
    rank: 500_000 - (min ?? 0),
    type: m.type.handover,
    id: (
      <>
        <div>
          {`${m.orderLabel} `}
          <DisplayNumber systemId={p.orderId} />
        </div>
        <div className="font-mono opacity-70">{`${m.packageLabel} ${p.packageId ?? m.noInfo}`}</div>
      </>
    ),
    reason: (
      <>
        <div>{m.reason.handover}</div>
        <div className="opacity-70">
          {p.riderId ? (
            <>
              {`${m.riderPrefix} `}
              <RiderLabel riderId={p.riderId} />
            </>
          ) : (
            m.rider(m.noInfo)
          )}
          {p.packingLocation ? ` · ${p.packingLocation}` : ''}
        </div>
      </>
    ),
    elapsed: min === null ? m.noInfo : minutesText(min),
    // 확인할 사람은 그 센터 작업자·관리자 누구나 — 배정된 담당이 없다(계약).
    assignee: m.noInfo,
    next: (
      <Link className="link" to={`${centerPath(mfcId, 'tasks')}#handover-checks`}>
        {m.next.handover}
      </Link>
    ),
  };
}
