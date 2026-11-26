// 대시보드 덧붙임(사용자 2026-11-26 "대시보드에 보여줄 주요 정보가 더 없어?") — 주의할 일 · MFC 별 오늘 · 층별 작업자.
// 숫자는 각 목록 조회의 서버 값만(첫 200건까지 — 더 있으면 "200+"). 못 읽은 칸은 "?"(0 으로 꾸미지 않는다).
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import { StatCard } from '@pmart/web-ui/standard';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';

const t = messages.dashboard;
const REFRESH = 30_000;
const EXPIRING_DAYS = 7;

type Counted = { readonly n: number; readonly more: boolean };

/** 주의할 일 — 지금 손이 가야 하는 건수, 누르면 그 화면 */
export function Attention({ cdcId }: { readonly cdcId: string }) {
  const a = t.attn;
  const api = useApi();
  const [shortages, recount, decide, mismatch, waves] = useQueries({
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
    ],
  });
  const snapshot = useQuery({
    refetchInterval: 60_000,
    queryKey: ['cdc', cdcId, 'stock', ''],
    queryFn: () => request('GET', api.inventory.GET('/cdcs/{cdcId}/stock-snapshot', { params: { path: { cdcId } } })),
  });
  const cell = (q: { readonly data?: Counted | undefined; readonly isError: boolean }) => (q.data ? `${q.data.n}${q.data.more ? '+' : ''}` : q.isError ? '?' : '…');
  const rows = snapshot.data?.items;
  const stockCell = (n: number | undefined) => (n !== undefined ? String(n) : snapshot.isError ? '?' : '…');
  const noStock = rows?.filter((x) => x.available === 0 && (x.onHand ?? 0) > 0).length;
  const expiring = rows?.reduce((acc, x) => acc + (x.lots ?? []).filter((l) => typeof l.remainingDays === 'number' && l.remainingDays <= EXPIRING_DAYS).length, 0);
  const inv = centerPath(cdcId, 'inventory');
  const items = [
    { key: 'shortages', label: a.shortages, value: cell(shortages), to: centerPath(cdcId, 'picking') },
    { key: 'recount', label: a.recount, value: cell(recount), to: `${inv}?tab=recount` },
    { key: 'countDecide', label: a.countDecide, value: cell(decide), to: `${inv}?tab=count` },
    { key: 'mismatch', label: a.mismatch, value: cell(mismatch), to: `${centerPath(cdcId, 'shipping')}?result=MISMATCHED` },
    { key: 'held', label: a.held, value: cell(waves), to: `${centerPath(cdcId, 'trf-wave')}?view=waves` },
    { key: 'noStock', label: a.noStock, value: stockCell(noStock), to: `${inv}?f=noStock` },
    { key: 'expiring', label: a.expiring, value: stockCell(expiring), to: `${inv}?f=expiring` },
  ];
  const busy = (v: string) => v !== '0' && v !== '…' && v !== '?';
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{t.attention}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7" data-testid="dash-attention">
        {items.map((x) => (
          <StatCard key={x.key} label={x.label} value={x.value} to={x.to} tone={busy(x.value) ? 'warning' : undefined} testId={`attn-${x.key}`} />
        ))}
      </div>
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
                    <td className="font-mono text-xs">{r.mfcId}</td>
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
