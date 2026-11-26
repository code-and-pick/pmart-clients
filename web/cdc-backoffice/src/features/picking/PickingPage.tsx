// 피킹·분배 — 진행 중 Wave 의 피킹 작업을 통로 피킹 방식(cdc-outbound Task.pickMethod — FC·DPS·박스 피킹·분배·라인 DAS, 방식 없음 = 팔레트 랙)별 탭으로.
// 백엔드 계획서 §2 #8 "피킹·분배(FC·DPS·AutoStore·분배·DAS·Wheel Sorter·자키) — 한 메뉴 탭, 작업 화면만". 새 API 없이 기존 조회만:
//   `GET /cdcs/{cdcId}/waves`(진행 중 = RELEASED·IN_PROGRESS, 최근 20개) → Wave 마다 `GET /cdcs/{cdcId}/tasks?waveId=`(첫 200건).
// 설비 상태·표시등·로봇·소터 가동은 그리지 않는다(사용자 "설비센서자산 같은 건 제외"). 자키(팔레트 운반)는 작업 종류가 없어 탭이 없다.
// 보기만 — 배정·착수·실적은 현장 PDA.
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import { StatCard } from '@pmart/web-ui/standard';
import type { components } from '../../api/generated/cdc-outbound';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { Who } from '../../shared/OperatorLabel';
import { TaskStateBadge } from '../tasks/TaskPages';
import { Shortages } from './Shortages';

const t = messages.picking;
type Task = components['schemas']['Task'];
const TABS = ['ALL', 'FC', 'DPS', 'BOX_PICK', 'DISTRIBUTION', 'LINE', 'NONE'] as const;
type Tab = (typeof TABS)[number];
const OPEN = new Set(['CREATED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'PARTIAL']);

const methodOf = (task: Task): Exclude<Tab, 'ALL'> => (task.pickMethod ?? 'NONE');
const sum = (task: Task, k: 'plannedQty' | 'pickedQty' | 'shortQty') => (task.lines ?? []).reduce((a, l) => a + (l[k] ?? 0), 0);

/** `/c/:cdcId/picking` */
export function PickingMenu({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get('m') ?? '') ? (params.get('m') as Tab) : 'ALL';
  const waves = useQuery({
    queryKey: ['cdc', cdcId, 'waves', 'active'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const page = await request('GET', api.outbound.GET('/cdcs/{cdcId}/waves', { params: { path: { cdcId }, query: { size: 100 } } }));
      return page.items.filter((v) => v.state === 'RELEASED' || v.state === 'IN_PROGRESS').slice(0, 20);
    },
  });
  const taskQueries = useQueries({
    queries: (waves.data ?? []).map((v) => ({
      queryKey: ['cdc', cdcId, 'tasks', v.waveId, 'picking'],
      refetchInterval: 30_000,
      queryFn: async () => (await request('GET', api.outbound.GET('/cdcs/{cdcId}/tasks', { params: { path: { cdcId }, query: { waveId: v.waveId ?? '', size: 200 } } }))).items ?? [],
    })),
  });
  const failed = taskQueries.some((q) => q.isError);
  const loading = taskQueries.some((q) => q.isPending);
  const all = useMemo(() => taskQueries.flatMap((q) => q.data ?? []).filter((x) => x.kind === 'PICK'), [taskQueries]);
  const shown = tab === 'ALL' ? all : all.filter((x) => methodOf(x) === tab);
  const count = (m: Tab) => (m === 'ALL' ? all : all.filter((x) => methodOf(x) === m)).filter((x) => OPEN.has(x.state ?? '')).length;
  const setTab = (m: Tab) => {
    const q = new URLSearchParams(params);
    if (m === 'ALL') q.delete('m');
    else q.set('m', m);
    setParams(q, { replace: true });
  };
  const open = shown.filter((x) => OPEN.has(x.state ?? ''));
  return (
    <section className="space-y-4">
      <div>
        <h1>{messages.menus.picking}</h1>
        <p className="text-sm text-base-content/60">{t.lead}</p>
      </div>
      <div role="tablist" className="tabs tabs-box w-fit flex-wrap" data-testid="picking-tabs">
        {TABS.map((m) => (
          <button key={m} type="button" role="tab" aria-selected={tab === m} className={`tab gap-1.5 ${tab === m ? 'tab-active' : ''}`} onClick={() => setTab(m)}>
            {t.methods[m]}
            {waves.data && !loading && <span className="badge badge-xs">{count(m)}</span>}
          </button>
        ))}
      </div>
      <p className="text-xs text-base-content/55">{t.methodHint[tab]}</p>
      <QueryState state={toUiState(waves, (d) => d.length === 0)} onRetry={() => void waves.refetch()} emptyText={t.noWaves}>
        {(ws) => (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="picking-cards">
              <StatCard label={t.cards.open} value={loading ? '…' : open.length} tone="info" />
              <StatCard label={t.cards.unassigned} value={loading ? '…' : open.filter((x) => !x.assigneeId).length} tone={open.some((x) => !x.assigneeId) ? 'warning' : undefined} />
              <StatCard label={t.cards.exception} value={loading ? '…' : shown.filter((x) => x.state === 'EXCEPTION' || x.state === 'PARTIAL').length} tone={shown.some((x) => x.state === 'EXCEPTION') ? 'error' : undefined} />
              <StatCard label={t.cards.waves} value={ws.length} />
            </div>
            {failed && (
              <p role="alert" className="alert alert-warning text-sm">
                {t.someFailed}
              </p>
            )}
            {!loading && shown.length === 0 ? (
              <p className="rounded-box border border-dashed border-base-300 p-6 text-center text-sm text-base-content/60" data-testid="picking-empty">
                {t.empty}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
                <table className="table table-sm" data-testid="picking-table">
                  <thead>
                    <tr>
                      <th>{messages.task.fields.taskId}</th>
                      <th>{t.method}</th>
                      <th>{messages.task.fields.mode}</th>
                      <th>{messages.task.fields.place}</th>
                      <th>{messages.task.fields.dueAt}</th>
                      <th>{messages.task.fields.state}</th>
                      <th>{messages.task.fields.assignee}</th>
                      <th className="text-right">{messages.task.fields.progress}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...shown]
                      .sort((a, b) => Number(OPEN.has(b.state ?? '')) - Number(OPEN.has(a.state ?? '')) || (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))
                      .map((x) => {
                        const short = sum(x, 'shortQty');
                        return (
                          <tr key={x.taskId} data-testid="picking-row">
                            <td>
                              <Link className="link text-sm" to={centerPath(cdcId, `tasks/${encodeURIComponent(x.taskId ?? '')}`)} title={x.taskId}>
                                {messages.task.titleOf(messages.task.kind[x.kind ?? ''] ?? messages.task.taskWord, [x.zone, x.floor ? `${x.floor}층` : null, x.aisle].filter(Boolean).join(' · ') || messages.none)}
                              </Link>
                            </td>
                            <td>{t.methods[methodOf(x)]}</td>
                            <td>
                              {x.pickMode ? (messages.task.mode[x.pickMode] ?? x.pickMode) : messages.none}
                              {x.regionCode && <span className="ml-1 text-xs text-base-content/55">{x.regionCode}</span>}
                            </td>
                            <td>{[x.zone, x.floor ? `${x.floor}층` : null, x.aisle].filter(Boolean).join(' · ') || messages.none}</td>
                            <td>{x.dueAt ? formatSeoul(x.dueAt) : messages.none}</td>
                            <td>
                              <TaskStateBadge state={x.state} />
                            </td>
                            <td>{x.assigneeId ? <Who id={x.assigneeId} /> : <span className="text-warning">{messages.task.unassigned}</span>}</td>
                            <td className="text-right tabular-nums">
                              {`${messages.qty(sum(x, 'pickedQty'))} / ${messages.qty(sum(x, 'plannedQty'))}`}
                              {short > 0 && <span className="ml-1 font-semibold text-error">{`(${messages.task.fields.short} ${messages.qty(short)})`}</span>}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </QueryState>
      <Shortages cdcId={cdcId} />
    </section>
  );
}
