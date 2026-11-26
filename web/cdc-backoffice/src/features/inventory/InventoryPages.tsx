// 재고관리 — [재고 현황 | 재계수 대기] 탭(?tab=). cdc-inventory 0.6.0+.
// - 재고 현황 `GET /cdcs/{cdcId}/stock-snapshot?sku=`(SKU별 현물·적격·예약·보류·가용) — 줄을 펼치면 그 SKU 만 `withPlaces=true` 로 LOT·위치별.
//   안전량 미설정이면 가용이 null — "미설정"으로 보이고 0 으로 바꾸지 않는다.
// - 재계수 대기 `GET /cdcs/{cdcId}/recount-holds?state=`(0.7.0 — 피킹 부족 칸), 풀기 `POST …/{holdId}/releases`(사유 필수, 200 RecountHold).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, formatSeoulDate, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/cdc-inventory';
import { StatCard } from '@pmart/web-ui/standard';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { SkuName } from '../../shared/SkuName';
import { QualityTab } from '../quality/QualityTab';
import { CountTab } from './CountTab';
import { HistoryLink, HistoryTab } from './HistoryTab';
import { LocationStockTable } from './LocationStock';

const t = messages.inventory;
type Tab = keyof typeof t.tabs;
const TABS = Object.keys(t.tabs) as Tab[];
type Availability = components['schemas']['Availability'];
type RecountHold = components['schemas']['RecountHold'];

const invPath = (cdcId: string) => centerPath(cdcId, 'inventory');

/** `/c/:cdcId/inventory/*` */
export function InventoryMenu({ cdcId }: { readonly cdcId: string }) {
  const [params] = useSearchParams();
  const tab = TABS.find((k) => k === params.get('tab')) ?? 'stock';
  return (
    <section className="space-y-4">
      <h1>{messages.menus.inventory}</h1>
      <div role="tablist" className="tabs tabs-box w-fit" data-testid="inventory-tabs">
        {TABS.map((k) => (
          <Link key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'tab-active' : ''}`} to={`${invPath(cdcId)}?tab=${k}`}>
            {t.tabs[k]}
          </Link>
        ))}
      </div>
      {tab === 'stock' && <StockTab cdcId={cdcId} />}
      {tab === 'places' && <PlacesTab cdcId={cdcId} />}
      {tab === 'count' && <CountTab cdcId={cdcId} />}
      {tab === 'recount' && <RecountTab cdcId={cdcId} />}
      {tab === 'quality' && <QualityTab cdcId={cdcId} />}
      {tab === 'history' && <HistoryTab cdcId={cdcId} />}
    </section>
  );
}

/** 칸별 재고 — 칸 코드 앞부분(층·통로)으로 불러온다(한 번에 최대 500줄) */
function PlacesTab({ cdcId }: { readonly cdcId: string }) {
  const l = messages.locStock;
  const [params, setParams] = useSearchParams();
  const prefix = params.get('prefix') ?? '';
  const [draft, setDraft] = useState(prefix || `${cdcId}-`);
  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-3 rounded-box border border-base-300 bg-base-100 p-3"
        data-list-part="top"
        onSubmit={(e) => {
          e.preventDefault();
          const q = new URLSearchParams(params);
          if (draft.trim()) q.set('prefix', draft.trim());
          else q.delete('prefix');
          setParams(q, { replace: true });
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          {l.prefix}
          <input className="input input-sm w-56 font-mono" value={draft} placeholder={l.prefixPlaceholder} onChange={(e) => setDraft(e.target.value)} data-testid="places-prefix" />
        </label>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!draft.trim()}>
          {l.search}
        </button>
        <span className="text-xs text-base-content/55">{l.prefixHint}</span>
      </form>
      {prefix && <LocationStockTable cdcId={cdcId} prefix={prefix} />}
    </div>
  );
}

/** 안전량(PolicyValue 3값) — NOT_SET 은 "미설정"(0 아님), UNAVAILABLE 은 "확인 불가" */
function safetyText(a: Availability): string {
  const s = a.safety;
  if (!s || s.state === 'NOT_SET') return t.notSet;
  if (s.state === 'UNAVAILABLE' || typeof s.value !== 'number') return t.unavailable;
  return messages.qty(s.value);
}

/** 재고 현황 거르기(사용자 2026-11-26 "전체 재고 관리") — 서버 값으로만 판정 */
const FILTERS = ['all', 'noStock', 'expiring', 'held', 'transit', 'handlingOff'] as const;
type StockFilter = (typeof FILTERS)[number];
const EXPIRING_DAYS = 7;
const nearestDays = (a: Availability) => {
  const ds = (a.lots ?? []).map((l) => l.remainingDays).filter((d): d is number => typeof d === 'number');
  return ds.length ? Math.min(...ds) : null;
};
const matches = (a: Availability, f: StockFilter) => {
  switch (f) {
    case 'all':
      return true;
    case 'noStock':
      // 가용 0 인데 적격 현물은 있다(예약·안전량으로 다 묶임) — 가용 미설정(null)은 넣지 않는다
      return a.available === 0 && (a.onHand ?? 0) > 0;
    case 'expiring': {
      const d = nearestDays(a);
      return d !== null && d <= EXPIRING_DAYS;
    }
    case 'held':
      return (a.held ?? 0) > 0;
    case 'transit':
      return (a.transit ?? 0) > 0;
    case 'handlingOff':
      return !a.handlingActive && (a.onHand ?? 0) > 0;
  }
};

function StockTab({ cdcId }: { readonly cdcId: string }) {
  const o = t.overview;
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const filter = (FILTERS as readonly string[]).includes(params.get('f') ?? '') ? (params.get('f') as StockFilter) : 'all';
  const [find, setFind] = useState(params.get('q') ?? '');
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'stock', ''],
    refetchInterval: 60_000,
    queryFn: () => request('GET', api.inventory.GET('/cdcs/{cdcId}/stock-snapshot', { params: { path: { cdcId } } })),
  });
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const sum = (k: 'onHand' | 'reserved' | 'held' | 'transit') => items.reduce((acc, x) => acc + (x[k] ?? 0), 0);
  const notSet = items.filter((x) => x.available === null || x.available === undefined).length;
  const availableSum = items.reduce((acc, x) => acc + (typeof x.available === 'number' ? x.available : 0), 0);
  const needle = find.trim().toLowerCase();
  const shown = items.filter((x) => matches(x, filter) && (!needle || (x.sku ?? '').toLowerCase().includes(needle) || (x.productName ?? '').toLowerCase().includes(needle)));
  const setFilter = (f: StockFilter) => {
    const q = new URLSearchParams(params);
    if (f === 'all') q.delete('f');
    else q.set('f', f);
    setParams(q, { replace: true });
  };
  return (
    <div className="space-y-3">
      <QueryState state={toUiState(query, (d) => (d.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={t.empty}>
        {(data) => (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6" data-testid="stock-cards">
              <StatCard label={o.skus} value={items.filter((x) => (x.onHand ?? 0) > 0).length} />
              <StatCard label={o.onHand} value={messages.qty(sum('onHand'))} />
              <StatCard label={o.available} value={messages.qty(availableSum)} hint={notSet > 0 ? o.availableNote(notSet) : undefined} tone="info" />
              <StatCard label={o.reserved} value={messages.qty(sum('reserved'))} />
              <StatCard label={o.held} value={messages.qty(sum('held'))} tone={sum('held') > 0 ? 'warning' : undefined} />
              <StatCard label={o.transit} value={messages.qty(sum('transit'))} to={centerPath(cdcId, 'mfc-flow')} />
            </div>
            <div className="flex flex-wrap items-end gap-3 rounded-box border border-base-300 bg-base-100 p-3" data-list-part="top">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.filterLabel} data-testid="stock-filters">
                {FILTERS.map((f) => {
                  const n = items.filter((x) => matches(x, f)).length;
                  return (
                    <button key={f} type="button" aria-pressed={filter === f} className={`btn btn-xs ${filter === f ? 'btn-primary' : 'btn-ghost border border-base-300'}`} onClick={() => setFilter(f)}>
                      {t.filters[f]}
                      <span className="badge badge-xs">{n}</span>
                    </button>
                  );
                })}
              </div>
              <label className="ml-auto flex flex-col gap-1 text-sm">
                {t.find}
                <input className="input input-sm w-60" value={find} placeholder={t.findPlaceholder} onChange={(e) => setFind(e.target.value)} data-testid="stock-find" />
              </label>
              {data.asOf?.asOf && (
                <span className={`text-xs ${data.asOf.freshness === 'STALE' ? 'text-warning' : 'text-base-content/55'}`} data-testid="stock-asof">
                  {t.asOf(formatSeoul(data.asOf.asOf))}
                  {data.asOf.freshness === 'STALE' ? ` · ${t.stale}` : ''}
                </span>
              )}
            </div>
            <p className="text-xs text-base-content/55" data-testid="stock-shown">
              {t.shown(shown.length, items.length)}
            </p>
            <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <table className="table table-sm" data-testid="stock-table">
                <thead>
                  <tr>
                    <th>{messages.locStock.product}</th>
                    <th className="text-right">{t.onHand}</th>
                    <th className="text-right">{t.eligible}</th>
                    <th className="text-right">{t.reserved}</th>
                    <th className="text-right">{t.held}</th>
                    <th className="text-right">{t.safety}</th>
                    <th className="text-right">{t.available}</th>
                    <th className="text-right">{t.transit}</th>
                    <th>{t.expires}</th>
                    <th>{t.handling}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => {
                    const k = a.sku ?? '';
                    const isOpen = open === k;
                    const near = nearestDays(a);
                    return (
                      <Fragment key={k}>
                        <tr data-testid="stock-row" className="cursor-pointer hover" onClick={() => setOpen(isOpen ? null : k)} aria-expanded={isOpen}>
                          <td>
                            <span className="inline-flex items-start gap-1">
                              <span aria-hidden className="mt-0.5 inline-block w-3 text-base-content/50">
                                {isOpen ? '▾' : '▸'}
                              </span>
                              <SkuName sku={k} name={a.productName} lookup={false} />
                            </span>
                          </td>
                          <td className="text-right tabular-nums">{messages.qty(a.onHand ?? 0)}</td>
                          <td className="text-right tabular-nums">{messages.qty(a.eligible ?? 0)}</td>
                          <td className="text-right tabular-nums">{messages.qty(a.reserved ?? 0)}</td>
                          <td className={`text-right tabular-nums ${(a.held ?? 0) > 0 ? 'text-warning' : ''}`}>{messages.qty(a.held ?? 0)}</td>
                          <td className="text-right tabular-nums">{safetyText(a)}</td>
                          <td className={`text-right tabular-nums font-semibold ${a.available === 0 ? 'text-error' : ''}`}>{a.available === null || a.available === undefined ? t.notSet : messages.qty(a.available)}</td>
                          <td className="text-right tabular-nums">{messages.qty(a.transit ?? 0)}</td>
                          <td className={near !== null && near <= EXPIRING_DAYS ? 'font-semibold text-warning' : 'text-base-content/60'}>{near === null ? messages.none : t.remain(near)}</td>
                          <td>
                            <span className={`badge badge-sm ${a.handlingActive ? 'badge-success' : 'badge-ghost'}`}>{a.handlingActive ? t.handlingOn : t.handlingOff}</span>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={10} className="pm-detail bg-base-200/50">
                              <Places cdcId={cdcId} sku={k} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}

/** 한 SKU 의 LOT·위치별(withPlaces=true) */
function Places({ cdcId, sku }: { readonly cdcId: string; readonly sku: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'stock', sku, 'places'],
    queryFn: async () => (await request('GET', api.inventory.GET('/cdcs/{cdcId}/stock-snapshot', { params: { path: { cdcId }, query: { sku, withPlaces: true } } }))).items?.[0]?.lots ?? [],
  });
  return (
    <QueryState state={toUiState(query, (lots) => lots.length === 0)} onRetry={() => void query.refetch()} emptyText={t.noPlaces}>
      {(lots) => (
        <table className="table table-xs" data-testid="stock-places">
          <thead>
            <tr>
              <th>{t.lot}</th>
              <th>{t.expires}</th>
              <th>{t.location}</th>
              <th>{t.quality}</th>
              <th className="text-right">{t.onHand}</th>
              <th className="text-right">{t.reserved}</th>
            </tr>
          </thead>
          <tbody>
            {lots.flatMap((lot) =>
              (lot.locations?.length ? lot.locations : [undefined]).map((p, i) => (
                <tr key={`${lot.lot}-${p?.locationCode ?? i}-${p?.qualityState ?? ''}`}>
                  <td className="font-mono">
                    {i === 0 ? (
                      <>
                        {lot.lot} <HistoryLink cdcId={cdcId} sku={sku} lot={lot.lot} testId="places-history" />
                      </>
                    ) : (
                      ''
                    )}
                  </td>
                  <td>{i === 0 && lot.expiresAt ? `${formatSeoulDate(lot.expiresAt)}${lot.remainingDays !== undefined ? ` · ${t.remain(lot.remainingDays)}` : ''}` : ''}</td>
                  <td className="font-mono">
                    {p?.locationCode ?? messages.none} {p?.locationCode && <HistoryLink cdcId={cdcId} loc={p.locationCode} />}
                  </td>
                  <td>{p?.qualityState ? (t.qualityState[p.qualityState] ?? p.qualityState) : messages.none}</td>
                  <td className="text-right tabular-nums">{p ? messages.qty(p.onHand ?? 0) : messages.none}</td>
                  <td className="text-right tabular-nums">{p ? messages.qty(p.reserved ?? 0) : messages.none}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}
    </QueryState>
  );
}

// ---------------------------------------------------------------- 재계수 대기

function RecountTab({ cdcId }: { readonly cdcId: string }) {
  const r = t.recount;
  const api = useApi();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const state = params.get('state') === 'RELEASED' ? 'RELEASED' : params.get('state') === 'all' ? undefined : 'HELD';
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'recount-holds', state ?? 'all'],
    queryFn: async () => (await request('GET', api.inventory.GET('/cdcs/{cdcId}/recount-holds', { params: { path: { cdcId }, query: state ? { state } : {} } }))).items ?? [],
  });
  const [releasing, setReleasing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const release = useCommand(async (v: { readonly holdId: string; readonly reason: string }, key) =>
    request('POST', api.inventory.POST('/cdcs/{cdcId}/recount-holds/{holdId}/releases', { ...commandParams(key, { path: { cdcId, holdId: v.holdId } }), body: { reason: v.reason } })),
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {r.filter}
          <select
            className="select select-sm w-32"
            value={state ?? 'all'}
            onChange={(e) => {
              const q = new URLSearchParams(params);
              q.set('state', e.target.value);
              setParams(q, { replace: true });
            }}
            data-testid="recount-state"
          >
            <option value="HELD">{r.held}</option>
            <option value="RELEASED">{r.released}</option>
            <option value="all">{r.all}</option>
          </select>
        </label>
        <p className="text-xs text-base-content/60">{r.note}</p>
      </div>
      <CommandFeedback command={release}>{(h: RecountHold) => <p role="status" className="alert alert-success text-sm">{r.released_(h.holdId ?? '')}</p>}</CommandFeedback>
      <QueryState state={toUiState(query, (rows) => rows.length === 0)} onRetry={() => void query.refetch()} emptyText={r.empty}>
        {(rows) => (
          <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
            <table className="table table-sm" data-testid="recount-table">
              <thead>
                <tr>
                  <th>{messages.locStock.product}</th>
                  <th>{t.lot}</th>
                  <th>{r.location}</th>
                  <th className="text-right">{r.short}</th>
                  <th>{r.createdAt}</th>
                  <th>{r.releasedAt}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => (
                  <Fragment key={h.holdId}>
                    <tr data-testid="recount-row">
                      <td>
                        <SkuName sku={h.sku ?? ''} />
                      </td>
                      <td className="font-mono text-xs">{h.lot}</td>
                      <td className="font-mono text-xs">
                        {h.locationCode} <HistoryLink cdcId={cdcId} loc={h.locationCode ?? ''} sku={h.sku} lot={h.lot} testId="recount-history" />
                      </td>
                      <td className="text-right tabular-nums font-semibold text-error">{messages.qty(h.shortQty ?? 0)}</td>
                      <td>{h.createdAt ? formatSeoul(h.createdAt) : messages.none}</td>
                      <td>{h.releasedAt ? formatSeoul(h.releasedAt) : messages.none}</td>
                      <td className="text-right">
                        {h.state === 'HELD' && (
                          <Link className="btn btn-xs mr-1" to={`${invPath(cdcId)}?tab=count&loc=${encodeURIComponent(h.locationCode ?? '')}`} data-testid={`recount-count-${h.holdId}`}>
                            {r.countThis}
                          </Link>
                        )}
                        {h.state === 'HELD' && (
                          <button
                            type="button"
                            className="btn btn-xs"
                            onClick={() => {
                              setReleasing(releasing === h.holdId ? null : (h.holdId ?? null));
                              setReason('');
                            }}
                            data-testid={`recount-open-${h.holdId}`}
                          >
                            {r.release}
                          </button>
                        )}
                      </td>
                    </tr>
                    {releasing === h.holdId && (
                      <tr>
                        <td colSpan={7} className="pm-detail bg-base-200/50">
                          <form
                            className="flex flex-wrap items-end gap-2"
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (!reason.trim()) return;
                              void release.run({ holdId: h.holdId ?? '', reason: reason.trim() }).then((phase) => {
                                if (phase.kind === 'done') {
                                  setReleasing(null);
                                  void queryClient.invalidateQueries({ queryKey: ['cdc', cdcId, 'recount-holds'] });
                                }
                              });
                            }}
                          >
                            <label className="flex flex-col gap-1 text-sm">
                              {r.reason}
                              <input className="input input-sm w-72" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="recount-reason" />
                            </label>
                            <button type="submit" className="btn btn-sm btn-primary" disabled={!reason.trim() || release.busy} data-testid="recount-go">
                              {r.release}
                            </button>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </div>
  );
}
