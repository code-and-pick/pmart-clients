// 대시보드 덧붙임(사용자 2026-11-26 "대시보드에 보여줄 주요 정보가 더 없어?") — 주의할 일 · MFC 별 오늘 · 층별 작업자.
// 숫자는 각 목록 조회의 서버 값만(첫 200건까지 — 더 있으면 "200+"). 못 읽은 칸은 "?"(0 으로 꾸미지 않는다).
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { MfcName } from '../../shared/MfcName';

const t = messages.dashboard;
const REFRESH = 30_000;
const EXPIRING_DAYS = 7;

type Counted = { readonly n: number; readonly more: boolean };

/**
 * 지금 손봐야 할 것(사용자 2026-11-27 "실시간 흐름을 파악하기가 너무 어렵다" → 4) — 사람이 봐야 하는 일만 문장으로.
 * 건수가 있는 것을 위에(무엇이·왜·어디서 처리), 0 인 것은 맨 아래 한 줄 "문제 없음". 못 읽은 것은 "못 읽음"(0 으로 꾸미지 않음).
 */
export function Attention({ cdcId }: { readonly cdcId: string }) {
  const a = messages.todo;
  const api = useApi();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const [shortages, recount, decide, mismatch, waves, allocFailed, receiptBad, late] = useQueries({
    queries: [
      {
        refetchInterval: REFRESH,
        queryKey: ['cdc', cdcId, 'shortages', 'PENDING', 'count'],
        queryFn: (): Promise<Counted> =>
          request('GET', api.outbound.GET('/cdcs/{cdcId}/shortages', { params: { path: { cdcId }, query: { state: 'PENDING', size: 200 } } })).then((d) => ({ n: d.items.length, more: d.hasNext })),
      },
      {
        refetchInterval: REFRESH,
        queryKey: ['cdc', cdcId, 'recount-holds', 'HELD', 'count'],
        queryFn: (): Promise<Counted> =>
          request('GET', api.inventory.GET('/cdcs/{cdcId}/recount-holds', { params: { path: { cdcId }, query: { state: 'HELD' } } })).then((d) => ({ n: (d.items ?? []).length, more: false })),
      },
      {
        refetchInterval: REFRESH,
        queryKey: ['cdc', cdcId, 'count-sessions', 'PENDING_APPROVAL', 'count'],
        queryFn: (): Promise<Counted> =>
          request('GET', api.inventory.GET('/cdcs/{cdcId}/count-sessions', { params: { path: { cdcId }, query: { state: 'PENDING_APPROVAL', size: 200 } } })).then((d) => ({ n: d.items.length, more: d.hasNext })),
      },
      {
        refetchInterval: REFRESH,
        queryKey: ['cdc', cdcId, 'departures', 'MISMATCHED', 'count'],
        queryFn: (): Promise<Counted> =>
          request('GET', api.outbound.GET('/cdcs/{cdcId}/departures', { params: { path: { cdcId }, query: { result: 'MISMATCHED', size: 200 } } })).then((d) => ({ n: d.items.length, more: d.hasNext })),
      },
      {
        refetchInterval: REFRESH,
        queryKey: ['cdc', cdcId, 'waves', 'held', 'count'],
        queryFn: (): Promise<Counted> =>
          request('GET', api.outbound.GET('/cdcs/{cdcId}/waves', { params: { path: { cdcId }, query: { size: 200 } } })).then((d) => ({ n: d.items.filter((w) => !!w.hold).length, more: d.hasNext })),
      },
      {
        refetchInterval: REFRESH,
        queryKey: ['cdc', cdcId, 'transfers', 'ALLOCATION_FAILED', 'count'],
        queryFn: (): Promise<Counted> =>
          request('GET', api.outbound.GET('/cdcs/{cdcId}/transfers', { params: { path: { cdcId }, query: { state: 'ALLOCATION_FAILED', size: 200 } } })).then((d) => ({ n: d.items.length, more: d.hasNext })),
      },
      {
        refetchInterval: REFRESH,
        queryKey: ['cdc', cdcId, 'transits', 'RECEIPT_POSTED_AWAITING_ACK', 'count'],
        queryFn: (): Promise<Counted> =>
          request('GET', api.inventory.GET('/cdcs/{cdcId}/transits', { params: { path: { cdcId }, query: { state: 'RECEIPT_POSTED_AWAITING_ACK', size: 200 } } })).then((d) => ({ n: d.items.length, more: d.hasNext })),
      },
      {
        refetchInterval: REFRESH,
        queryKey: ['cdc', cdcId, 'trips', today, 'delayed', 'count'],
        queryFn: (): Promise<Counted> =>
          request('GET', api.transportExecution.GET('/cdcs/{cdcId}/trips', { params: { path: { cdcId }, query: { shipDate: today, size: 200 } } })).then((d) => ({
            n: d.items.filter((tr) => tr.state !== 'CANCELLED' && tr.state !== 'COMPLETED' && !!tr.delayed).length,
            more: false,
          })),
      },
    ],
  });
  const snapshot = useQuery({
    refetchInterval: 60_000,
    queryKey: ['cdc', cdcId, 'stock', ''],
    queryFn: () => request('GET', api.inventory.GET('/cdcs/{cdcId}/stock-snapshot', { params: { path: { cdcId } } })),
  });
  type Cell = { readonly n: number | null; readonly more: boolean; readonly failed: boolean };
  const cell = (q: { readonly data?: Counted | undefined; readonly isError: boolean }): Cell => ({ n: q.data ? q.data.n : null, more: !!q.data?.more, failed: q.isError });
  const rows = snapshot.data?.items;
  const stockCell = (n: number | undefined): Cell => ({ n: n ?? null, more: false, failed: snapshot.isError });
  const noStock = rows?.filter((x) => x.available === 0 && (x.onHand ?? 0) > 0).length;
  const expiring = rows?.reduce((acc, x) => acc + (x.lots ?? []).filter((l) => typeof l.remainingDays === 'number' && l.remainingDays <= EXPIRING_DAYS).length, 0);
  const inv = centerPath(cdcId, 'inventory');
  const items: { key: string; c: Cell; to: string }[] = [
    { key: 'allocFailed', c: cell(allocFailed), to: `${centerPath(cdcId, 'trf-wave')}?state=ALLOCATION_FAILED` },
    { key: 'shortages', c: cell(shortages), to: centerPath(cdcId, 'picking') },
    { key: 'mismatch', c: cell(mismatch), to: `${centerPath(cdcId, 'shipping')}?result=MISMATCHED` },
    { key: 'late', c: cell(late), to: centerPath(cdcId, 'transport') },
    { key: 'receiptBad', c: cell(receiptBad), to: `${centerPath(cdcId, 'mfc-flow')}?receipt=MISMATCH` },
    { key: 'held', c: cell(waves), to: `${centerPath(cdcId, 'trf-wave')}?view=waves` },
    { key: 'recount', c: cell(recount), to: `${inv}?tab=recount` },
    { key: 'countDecide', c: cell(decide), to: `${inv}?tab=count` },
    { key: 'noStock', c: stockCell(noStock), to: `${inv}?f=noStock` },
    { key: 'expiring', c: stockCell(expiring), to: `${inv}?f=expiring` },
  ];
  const busy = items.filter((x) => (x.c.n ?? 0) > 0 || x.c.failed);
  const clear = items.filter((x) => x.c.n === 0 && !x.c.failed);
  const pending = items.filter((x) => x.c.n === null && !x.c.failed);
  return (
    <section className="space-y-2 rounded-box border border-base-300 bg-base-100 p-4" data-testid="dash-attention">
      <div>
        <h2 className="text-base font-semibold">{a.title}</h2>
        <p className="text-xs text-base-content/60">{a.lead}</p>
      </div>
      {busy.length === 0 && pending.length === 0 && <p className="text-sm text-success">{a.allClear}</p>}
      {busy.length > 0 && (
        <ul className="divide-y divide-base-300 rounded-box border border-base-300">
          {busy.map((x) => (
            <li key={x.key}>
              <Link className="flex items-center gap-3 px-3 py-2.5 hover:bg-base-200" to={x.to} data-testid={`attn-${x.key}`}>
                <span className={`min-w-12 text-center text-lg font-semibold tabular-nums ${x.c.failed ? 'text-base-content/50' : 'text-warning'}`}>
                  {x.c.failed ? '?' : `${x.c.n}${x.c.more ? '+' : ''}`}
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold">{a.items[x.key]?.label}</span>
                  <span className="block text-xs text-base-content/60">{x.c.failed ? a.failed : a.items[x.key]?.why}</span>
                </span>
                <span aria-hidden className="text-base-content/40">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(clear.length > 0 || pending.length > 0) && (
        <p className="text-xs text-base-content/55" data-testid="attn-clear">
          {clear.length > 0 && `${a.clearTitle}: ${clear.map((x) => a.items[x.key]?.label).join(' · ')}`}
          {pending.length > 0 && ` ${a.loading}`}
        </p>
      )}
    </section>
  );
}

type MfcRow = { readonly mfcId: string; readonly transferCount: number; readonly approvedQty: number; readonly pickedQty: number; readonly shortQty: number };

/** MFC 별 오늘(outbound-summary byMfc — 0.18.0) */
export function ByMfc({ cdcId, rows }: { readonly cdcId: string; readonly rows: readonly MfcRow[] | null }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-4" data-testid="dash-bymfc">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t.byMfc}</h2>
        <Link className="link text-xs" to={centerPath(cdcId, 'mfc-flow')}>
          {t.more}
        </Link>
      </div>
      {!rows || rows.length === 0 ? (
        <p className="text-sm text-base-content/55">{t.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>MFC</th>
                <th className="text-right">TRF</th>
                <th className="text-right">{t.approved}</th>
                <th className="text-right">{t.picked}</th>
                <th className="text-right">{t.short}</th>
                <th className="w-1/3">{t.progress}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = r.approvedQty > 0 ? Math.round((r.pickedQty / r.approvedQty) * 100) : null;
                return (
                  <tr key={r.mfcId} data-testid="dash-bymfc-row">
                    <td className="text-xs">
                      <MfcName id={r.mfcId} />
                    </td>
                    <td className="text-right">{r.transferCount}</td>
                    <td className="text-right tabular-nums">{messages.qty(r.approvedQty)}</td>
                    <td className="text-right tabular-nums">{messages.qty(r.pickedQty)}</td>
                    <td className={`text-right tabular-nums ${r.shortQty > 0 ? 'font-semibold text-error' : ''}`}>{messages.qty(r.shortQty)}</td>
                    <td>
                      {pct === null ? (
                        <span className="text-xs text-base-content/50">{t.noProgress}</span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <progress className="progress progress-primary h-1.5 flex-1" value={pct} max={100} aria-label={`${r.mfcId} ${t.progress}`} />
                          <span className="w-9 text-right text-xs tabular-nums">{`${pct}%`}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 층별 작업자(workers byFloor — PDA 스캔 위치, 10분 지나면 빠짐). 누르면 평면도 */
export function WorkersByFloor({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'workers'],
    refetchInterval: REFRESH,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/workers', { params: { path: { cdcId } } })),
  });
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-4" data-testid="dash-workers">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t.workers}</h2>
        <Link className="link text-xs" to={centerPath(cdcId, 'floor')}>
          {t.more}
        </Link>
      </div>
      <QueryState state={toUiState(query, (d) => d.byFloor.length === 0)} onRetry={() => void query.refetch()} emptyText={t.workersEmpty}>
        {(d) => (
          <ul className="space-y-1">
            {[...d.byFloor]
              .sort((x, y) => x.key.localeCompare(y.key))
              .map((f) => (
                <li key={f.key} className="flex items-center justify-between px-1 py-0.5">
                  <span className="text-sm">{t.floorLabel(f.key)}</span>
                  <span className="text-sm font-semibold tabular-nums">{t.people(f.count)}</span>
                </li>
              ))}
          </ul>
        )}
      </QueryState>
      <p className="mt-2 text-xs text-base-content/50">{t.workersHint}</p>
    </div>
  );
}
