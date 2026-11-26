// 센터 도면(실시간 관제 메뉴, 2026-11-21 사용자) — 위에서 본 도면을 크게, 랙·작업자를 눌러 오른쪽에서 본다.
// - 랙: 칸 코드 앞부분(센터 도면 floorPlan — 시뮬레이터 평면의 랙 = 서버 칸 코드 앞부분)으로 mfc-inventory `GET /mfcs/{mfcId}/stock-units?locationPrefix=`(0.33.0) — 단·칸별 지금 놓인 상품·수량·LOT·품질,
//   mfc-location 칸(상태·진열 카테고리·고회전). 등록된 칸이 없으면 그렇게 말한다(빈 랙으로 꾸미지 않는다).
// - 작업자: capacity 작업자(이름·사번·고용·휴게·업무) + 끝나지 않은 작업(fulfillment — 진행 중 = IN_PROGRESS, 예정 = ASSIGNED·READY·WAITING 중 이 사람 담당).
//   마지막 스캔 칸·시각은 capacity 0.34.0 worker-positions(도면 점과 같은 조회).
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { FloorMap, POSITIONS_REFRESH_MS, type FloorPick } from '../dashboard/FloorMap';
import { fetchAllLocations, type Location } from '../dashboard/floorQueries';
import { useNow } from '../../shared/motion';
import { OPS_REFRESH_MS, useOpenTasks } from '../ops/opsQueries';
import { StockLiveStatus } from '../stock-stream/useStockStream';

const TEMP_OF: Readonly<Record<string, Location['temperatureZone']>> = { A: 'AMBIENT', C: 'CHILLED', F: 'FROZEN' };
const m = messages.floorPage;

export function FloorMenu({ mfcId }: { readonly mfcId: string }) {
  // 고른 것은 주소에(새로 고침·공유해도 그대로): ?rack=C-P2-03 또는 ?worker=OP-wkr-1
  const [params, setParams] = useSearchParams();
  const rack = params.get('rack');
  const worker = params.get('worker');
  const picked: FloorPick | null = rack ? { kind: 'rack', code: rack, temp: '' } : worker ? { kind: 'worker', id: worker, name: '', role: 'idle' } : null;
  const pick = (p: FloorPick) => setParams(p.kind === 'rack' ? { rack: p.code } : { worker: p.id }, { replace: true });
  const close = () => setParams({}, { replace: true });
  return (
    // 본문 여백을 걷어 내고 머리줄·위치 줄 아래 전체를 도면으로(왼쪽 메뉴만 남김)
    <section className="@container relative -mx-6 -mt-1 -mb-6 h-[calc(100dvh-5.25rem)] min-h-[520px] overflow-hidden bg-base-200" aria-label={messages.menus.floor}>
      <h1 className="sr-only">{messages.menus.floor}</h1>
      <FloorMap mfcId={mfcId} mode="full" picked={picked} onPick={pick} />
      <aside
        className="absolute top-3 right-3 bottom-3 z-[2] flex w-[300px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-box border border-base-300 bg-base-100/92 shadow-xl backdrop-blur"
        aria-label={m.sideAria}
        data-testid="floor-side"
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
          {rack ? (
            <RackPanel mfcId={mfcId} code={rack} temp={TEMP_OF[rack.charAt(0)] ?? null} onClose={close} />
          ) : worker ? (
            <WorkerPanel mfcId={mfcId} workerId={worker} onClose={close} />
          ) : (
            <div className="space-y-2 text-sm text-base-content/70">
              <p className="font-bold text-base-content">{m.emptyTitle}</p>
              <p>{m.emptyRack}</p>
              <p>{m.emptyWorker}</p>
            </div>
          )}
        </div>
        <Actions mfcId={mfcId} rack={rack} worker={worker} />
      </aside>
    </section>
  );
}

/** 고른 것에 할 수 있는 일 — 지금 있는 화면으로 가는 길(새 명령은 만들지 않는다) */
function Actions({ mfcId, rack, worker }: { readonly mfcId: string; readonly rack: string | null; readonly worker: string | null }) {
  const temp = rack ? ({ A: 'AMBIENT', C: 'CHILLED', F: 'FROZEN' } as Readonly<Record<string, string>>)[rack.charAt(0)] : null;
  const links: ReadonlyArray<readonly [string, string]> = rack
    ? [
        [m.act.rackLocations, `${centerPath(mfcId, 'locations')}${temp ? `?temperatureZone=${temp}` : ''}`],
        [m.act.count, `${centerPath(mfcId, 'inventory')}?tab=counts`],
        [m.act.move, centerPath(mfcId, 'moves')],
      ]
    : worker
      ? [
          [m.act.workerDetail, centerPath(mfcId, `workers/${encodeURIComponent(worker)}`)],
          [m.act.workerAssignments, `${centerPath(mfcId, 'assignments')}?workerId=${encodeURIComponent(worker)}`],
          [m.act.assign, `${centerPath(mfcId, 'assignments')}?tab=manual`],
        ]
      : [
          [m.act.tasks, centerPath(mfcId, 'tasks')],
          [m.act.assignments, centerPath(mfcId, 'assignments')],
          [m.act.count, `${centerPath(mfcId, 'inventory')}?tab=counts`],
        ];
  return (
    <div className="border-t border-base-300 p-3" data-testid="floor-actions">
      <p className="mb-2 text-xs font-bold text-base-content/55">{m.act.title}</p>
      <div className="grid gap-1.5">
        {links.map(([label, to]) => (
          <Link key={label} to={to} className="btn btn-sm pm-action justify-start">
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function PanelHead({ title, sub, onClose }: { readonly title: string; readonly sub: string; readonly onClose: () => void }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="truncate text-base font-bold tracking-tight">{title}</h2>
        <p className="text-xs text-base-content/55">{sub}</p>
      </div>
      <button type="button" className="btn btn-ghost btn-xs" onClick={onClose} aria-label={m.close}>
        ✕
      </button>
    </div>
  );
}

/** 랙 — 칸 수 요약, 단(위가 높은 단)마다 칸 카드: 지금 놓인 상품·수량·LOT 번호·유통기한 */
function RackPanel({ mfcId, code, temp, onClose }: { readonly mfcId: string; readonly code: string; readonly temp: Location['temperatureZone'] | null; readonly onClose: () => void }) {
  const api = useApi();
  const prefix = `${code}-`;
  const now = useNow(OPS_REFRESH_MS);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
  const units = useQuery({
    queryKey: ['floor', mfcId, 'stock-units', prefix],
    refetchInterval: OPS_REFRESH_MS,
    queryFn: () => request('GET', api.inventory.GET('/mfcs/{mfcId}/stock-units', { params: { path: { mfcId }, query: { locationPrefix: prefix, size: 200 } } })),
  });
  // 칸 목록은 이 랙 온도대만 끝까지 읽어(칸이 수천 개) 랙 코드로 거른다
  const locations = useQuery({
    queryKey: ['floor', mfcId, 'locations', temp ?? 'ALL'],
    refetchInterval: OPS_REFRESH_MS,
    queryFn: () => fetchAllLocations(api, mfcId, temp ? { temperatureZone: temp } : {}),
  });
  const cells = (locations.data ?? []).filter((l) => l.locationCode.startsWith(prefix));
  const levels = new Map<string, typeof cells>();
  for (const c of cells) {
    const [, , , level = '?'] = c.locationCode.split('-');
    levels.set(level, [...(levels.get(level) ?? []), c].sort((x, y) => x.locationCode.localeCompare(y.locationCode)));
  }
  const levelList = [...levels.entries()].sort((x, y) => y[0].localeCompare(x[0]));
  const all = units.data?.items ?? [];
  const unitsOf = (locationCode: string) => all.filter((u) => u.locationCode === locationCode);
  const filled = cells.filter((c) => unitsOf(c.locationCode).length > 0).length;
  const totalQty = all.reduce((n, u) => n + u.qty, 0);
  const daysLeft = (d: string | null | undefined) => (d ? Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null);
  return (
    <div data-testid="rack-panel">
      <PanelHead title={m.rackTitle(code)} sub={m.rackSub} onClose={onClose} />
      <div className="-mt-2 mb-2">
        <StockLiveStatus mfcId={mfcId} />
      </div>
      {locations.isPending || units.isPending ? (
        <p className="text-sm text-base-content/40">…</p>
      ) : locations.isError || units.isError ? (
        <p role="alert" className="text-sm font-semibold text-error">
          {m.failed}
        </p>
      ) : cells.length === 0 ? (
        <p className="text-sm text-base-content/60" data-testid="rack-empty">
          {m.noCells(code)}
        </p>
      ) : (
        <>
          <dl className="mb-3 grid grid-cols-3 gap-1.5 text-center" data-testid="rack-summary">
            {(
              [
                [m.sumCells, m.cellsN(cells.length)],
                [m.sumFilled, `${filled} / ${cells.length}`],
                [m.sumQty, m.qty(totalQty)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-field bg-base-200/70 px-1 py-1.5">
                <dt className="text-[11px] text-base-content/55">{k}</dt>
                <dd className="pm-mono text-sm font-bold">{v}</dd>
              </div>
            ))}
          </dl>
          <ol className="space-y-2.5">
            {levelList.map(([level, list]) => (
              <li key={level}>
                <p className="mb-1 text-xs font-bold text-base-content/60">{m.level(level)}</p>
                <ul className="grid grid-cols-2 gap-1.5">
                  {list.map((c) => {
                    const here = unitsOf(c.locationCode);
                    const slot = c.locationCode.split('-')[4] ?? c.locationCode;
                    const qty = here.reduce((n, u) => n + u.qty, 0);
                    const first = here[0];
                    return (
                      <li key={c.locationCode} data-testid="rack-cell" data-code={c.locationCode}>
                        <Link
                          to={centerPath(mfcId, `locations/${encodeURIComponent(c.locationId ?? '')}`)}
                          title={c.locationCode}
                          className={`block h-full rounded-field border px-2 py-1.5 transition-colors hover:border-primary/60 ${here.length === 0 ? 'border-dashed border-base-300' : 'border-base-300 bg-base-200/60'}`}
                        >
                          <span className="flex items-center justify-between gap-1 text-[11px] text-base-content/55">
                            <span className="pm-mono">{m.slot(slot)}</span>
                            <span className="flex gap-0.5">
                              {c.highTurnover && <span className="badge badge-primary badge-xs">{m.highTurnover}</span>}
                              {c.state !== 'ACTIVE' && (
                                <span className={`badge badge-xs ${c.state === 'CLOSED' ? 'badge-warning' : c.state === 'COUNT_LOCKED' ? 'badge-info' : 'badge-ghost'}`}>{m.state[c.state ?? ''] ?? c.state}</span>
                              )}
                            </span>
                          </span>
                          {!first ? (
                            <span className="mt-0.5 block text-xs text-base-content/40">{m.emptyCell}</span>
                          ) : (
                            <>
                              <span className="mt-0.5 block truncate text-[13px] font-semibold" data-testid="rack-cell-product">
                                {first.productName ?? first.sku}
                              </span>
                              <span className="pm-mono block text-xs text-base-content/80">
                                {m.qty(qty)}
                                {here.length > 1 && <span className="ml-1 text-base-content/50">{m.lots(here.length)}</span>}
                              </span>
                              {here.map((u) => {
                                const left = daysLeft(u.expiryDate);
                                return (
                                  <span key={u.lotId} className="mt-0.5 flex items-center justify-between gap-1 text-[10.5px] text-base-content/55" data-testid="rack-cell-lot">
                                    <span className="pm-mono truncate">{u.lotNo ?? u.lotId}</span>
                                    <span className="shrink-0">
                                      {u.qualityState !== 'NORMAL' ? (
                                        <span className="badge badge-warning badge-xs">{m.quality[u.qualityState] ?? u.qualityState}</span>
                                      ) : left === null ? (
                                        ''
                                      ) : (
                                        <span className={left <= 3 ? 'font-bold text-warning' : ''}>{m.expiry(left)}</span>
                                      )}
                                    </span>
                                  </span>
                                );
                              })}
                            </>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="mt-3 text-xs text-base-content/45">{m.mappingNote}</p>
    </div>
  );
}

/** 작업자 — 정보 · 진행 중 작업 · 예정 작업 */
function WorkerPanel({ mfcId, workerId, onClose }: { readonly mfcId: string; readonly workerId: string; readonly onClose: () => void }) {
  const api = useApi();
  const workers = useQuery({
    queryKey: ['dashboard', mfcId, 'workers'],
    refetchInterval: OPS_REFRESH_MS,
    queryFn: async () => (await request('GET', api.capacity.GET('/mfcs/{mfcId}/workers', { params: { path: { mfcId }, query: { state: 'ACTIVE' } } }))).items ?? [],
  });
  const tasks = useOpenTasks(mfcId);
  const positions = useQuery({
    queryKey: ['dashboard', mfcId, 'worker-positions'],
    refetchInterval: POSITIONS_REFRESH_MS,
    queryFn: () => request('GET', api.capacity.GET('/mfcs/{mfcId}/worker-positions', { params: { path: { mfcId }, query: { sinceMinutes: 480 } } })),
  });
  const last = positions.data?.items.find((x) => x.workerId === workerId) ?? positions.data?.unplaced.find((x) => x.workerId === workerId);
  const w = workers.data?.find((x) => x.workerId === workerId);
  const mine = (tasks.data?.items ?? []).filter((t) => t.assignment?.workerId === workerId);
  const running = mine.filter((t) => t.state === 'IN_PROGRESS' || t.state === 'BLOCKED');
  const planned = mine.filter((t) => t.state === 'ASSIGNED' || t.state === 'READY' || t.state === 'WAITING');
  const name = w ? (w.name ?? w.displayName ?? m.noName) : workerId;
  return (
    <div data-testid="worker-panel">
      <PanelHead title={name} sub={w?.employeeNo ? `${m.employeeNo} ${w.employeeNo}` : m.workerSub} onClose={onClose} />
      {workers.isPending ? (
        <p className="text-sm text-base-content/40">…</p>
      ) : workers.isError ? (
        <p role="alert" className="text-sm font-semibold text-error">
          {m.failed}
        </p>
      ) : !w ? (
        <p className="text-sm text-base-content/60">{m.workerGone}</p>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-base-content/55">{m.employment}</dt>
            <dd>{messages.workers.employment[w.employmentType ?? ''] ?? w.employmentType ?? messages.none}</dd>
            <dt className="text-base-content/55">{m.now}</dt>
            <dd>{w.onBreak ? <span className="badge badge-warning badge-sm">{m.onBreak}</span> : running.length > 0 ? <span className="badge badge-primary badge-sm">{m.working}</span> : <span className="badge badge-ghost badge-sm">{m.idle}</span>}</dd>
            <dt className="text-base-content/55">{m.lastScan}</dt>
            <dd data-testid="worker-last-scan">
              {positions.isError ? (
                <span className="text-error">{m.lastScanFailed}</span>
              ) : positions.isPending ? (
                '…'
              ) : last ? (
                <>
                  <span className="pm-mono">{last.locationCode}</span> · {messages.tasks.taskType[last.activityType] ?? last.activityType}
                  <span className="block text-xs text-base-content/55">{formatSeoul(last.at)}</span>
                </>
              ) : (
                <span className="text-base-content/55">{m.noScan}</span>
              )}
            </dd>
            <dt className="text-base-content/55">{m.areas}</dt>
            <dd>{(w.workAreas ?? []).map((a) => messages.workers.area[a] ?? a).join(' · ') || messages.none}</dd>
            <dt className="text-base-content/55">{m.duties}</dt>
            <dd>{(w.effectiveTaskTypes ?? []).map((t) => messages.tasks.taskType[t] ?? t).join(' · ') || messages.none}</dd>
            <dt className="text-base-content/55">{m.speed}</dt>
            <dd className="pm-mono">{w.speedFactor !== undefined ? `× ${w.speedFactor}` : messages.none}</dd>
            <dt className="text-base-content/55">{m.workerId}</dt>
            <dd className="pm-mono text-xs leading-5">{w.workerId}</dd>
          </dl>
          {mine.length > 0 && (
            <p className="mt-3 rounded-field bg-base-200/70 px-3 py-2 text-xs text-base-content/70" data-testid="worker-load">
              {m.load(mine.length, mine.reduce((n, t) => n + (t.remainingQty ?? 0), 0))}
            </p>
          )}
          <TaskList title={m.running} empty={m.noRunning} list={running} mfcId={mfcId} failed={tasks.isError} testId="worker-running" />
          <TaskList title={m.planned} empty={m.noPlanned} list={planned} mfcId={mfcId} failed={tasks.isError} testId="worker-planned" />
        </>
      )}
    </div>
  );
}

type Task = NonNullable<ReturnType<typeof useOpenTasks>['data']>['items'][number];

function TaskList({ title, empty, list, mfcId, failed, testId }: { readonly title: string; readonly empty: string; readonly list: readonly Task[]; readonly mfcId: string; readonly failed: boolean; readonly testId: string }) {
  return (
    <div className="mt-4" data-testid={testId}>
      <p className="mb-1.5 flex items-baseline justify-between text-sm font-bold">
        {title}
        <span className="text-xs font-normal text-base-content/50 tabular-nums">{failed ? m.failed : m.count(list.length)}</span>
      </p>
      {!failed && list.length === 0 ? (
        <p className="text-sm text-base-content/45">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((t) => (
            <li key={t.taskId}>
              <Link to={centerPath(mfcId, `tasks/${encodeURIComponent(t.taskId ?? '')}`)} className="flex items-center justify-between gap-2 rounded-field border border-base-300 bg-base-200/50 px-3 py-2 text-sm transition-colors hover:border-primary/50">
                <span className="min-w-0">
                  <span className="block">
                    <b>{messages.tasks.taskType[t.taskType ?? ''] ?? t.taskType}</b>
                    <span className="ml-1.5 text-xs text-base-content/60">{t.orderNumber ? m.order(t.orderNumber) : ''}</span>
                  </span>
                  {t.headline?.productName && (
                    <span className="block truncate text-xs text-base-content/60">
                      {m.headline(t.headline.productName, t.headline.otherLineCount ?? 0)}
                      {t.plannedQty ? <span className="ml-1.5">{' · '}{m.progress(t.completedQty ?? 0, t.plannedQty)}</span> : null}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-base-content/60">
                  {t.state === 'BLOCKED' ? <span className="badge badge-error badge-xs">{messages.tasks.taskState.BLOCKED}</span> : t.promisedReadyAt ? m.promise(formatSeoul(t.promisedReadyAt)) : (messages.tasks.taskState[t.state ?? ''] ?? '')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
