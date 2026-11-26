// 재고관리 — [재고 현황 | 재계수 대기] 탭(?tab=). cdc-inventory 0.6.0+.
// - 재고 현황 `GET /cdcs/{cdcId}/stock-snapshot?sku=`(SKU별 현물·적격·예약·보류·가용) — 줄을 펼치면 그 SKU 만 `withPlaces=true` 로 LOT·위치별.
//   안전량 미설정이면 가용이 null — "미설정"으로 보이고 0 으로 바꾸지 않는다.
// - 재계수 대기 `GET /cdcs/{cdcId}/recount-holds?state=`(0.7.0 — 피킹 부족 칸), 풀기 `POST …/{holdId}/releases`(사유 필수, 200 RecountHold).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, formatSeoulDate, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/cdc-inventory';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { SkuName } from '../../shared/SkuName';
import { CountTab } from './CountTab';
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

function StockTab({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const sku = params.get('sku') ?? '';
  const [draft, setDraft] = useState(sku);
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'stock', sku],
    queryFn: () => request('GET', api.inventory.GET('/cdcs/{cdcId}/stock-snapshot', { params: { path: { cdcId }, query: sku ? { sku } : {} } })),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = new URLSearchParams(params);
    if (draft.trim()) q.set('sku', draft.trim());
    else q.delete('sku');
    setParams(q, { replace: true });
  };
  return (
    <div className="space-y-3">
      <form className="flex flex-wrap items-end gap-3 rounded-box border border-base-300 bg-base-100 p-3" onSubmit={submit} data-list-part="top">
        <label className="flex flex-col gap-1 text-sm">
          {t.skuFilter}
          <input className="input input-sm w-48" value={draft} placeholder={t.skuPlaceholder} onChange={(e) => setDraft(e.target.value)} data-testid="stock-sku" />
        </label>
        <button type="submit" className="btn btn-sm btn-primary">
          {t.search}
        </button>
        {query.data?.asOf?.asOf && (
          <span className={`ml-auto text-xs ${query.data.asOf.freshness === 'STALE' ? 'text-warning' : 'text-base-content/55'}`} data-testid="stock-asof">
            {t.asOf(formatSeoul(query.data.asOf.asOf))}
            {query.data.asOf.freshness === 'STALE' ? ` · ${t.stale}` : ''}
          </span>
        )}
      </form>
      <QueryState state={toUiState(query, (d) => (d.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={t.empty}>
        {(data) => (
          <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
            <table className="table table-sm" data-testid="stock-table">
              <thead>
                <tr>
                  <th>{t.sku}</th>
                  <th className="text-right">{t.onHand}</th>
                  <th className="text-right">{t.eligible}</th>
                  <th className="text-right">{t.reserved}</th>
                  <th className="text-right">{t.held}</th>
                  <th className="text-right">{t.safety}</th>
                  <th className="text-right">{t.available}</th>
                  <th className="text-right">{t.transit}</th>
                  <th>{t.handling}</th>
                </tr>
              </thead>
              <tbody>
                {(data.items ?? []).map((a) => {
                  const k = a.sku ?? '';
                  const isOpen = open === k;
                  return (
                    <Fragment key={k}>
                      <tr data-testid="stock-row" className="cursor-pointer hover" onClick={() => setOpen(isOpen ? null : k)} aria-expanded={isOpen}>
                        <td className="font-mono text-xs">
                          <span aria-hidden className="mr-1 inline-block w-3 text-base-content/50">
                            {isOpen ? '▾' : '▸'}
                          </span>
                          {k}
                        </td>
                        <td className="text-right tabular-nums">{messages.qty(a.onHand ?? 0)}</td>
                        <td className="text-right tabular-nums">{messages.qty(a.eligible ?? 0)}</td>
                        <td className="text-right tabular-nums">{messages.qty(a.reserved ?? 0)}</td>
                        <td className="text-right tabular-nums">{messages.qty(a.held ?? 0)}</td>
                        <td className="text-right tabular-nums">{safetyText(a)}</td>
                        <td className="text-right tabular-nums font-semibold">{a.available === null || a.available === undefined ? t.notSet : messages.qty(a.available)}</td>
                        <td className="text-right tabular-nums">{messages.qty(a.transit ?? 0)}</td>
                        <td>
                          <span className={`badge badge-sm ${a.handlingActive ? 'badge-success' : 'badge-ghost'}`}>{a.handlingActive ? t.handlingOn : t.handlingOff}</span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={9} className="bg-base-200/50">
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
                  <td className="font-mono">{i === 0 ? lot.lot : ''}</td>
                  <td>{i === 0 && lot.expiresAt ? `${formatSeoulDate(lot.expiresAt)}${lot.remainingDays !== undefined ? ` · ${t.remain(lot.remainingDays)}` : ''}` : ''}</td>
                  <td className="font-mono">{p?.locationCode ?? messages.none}</td>
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
                      <td className="font-mono text-xs">{h.locationCode}</td>
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
                        <td colSpan={7} className="bg-base-200/50">
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
