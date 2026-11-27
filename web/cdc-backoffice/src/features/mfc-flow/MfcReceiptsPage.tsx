// MFC 입고 확인(사용자 2026-11-27 "mfc에 정상도착 및 입고 완료 정보 받아서 연동후에 이 정보도 볼 수 있는 곳이 따로 있어야겠는데").
// 출발한 TRF 마다 MFC 가 수령을 확정해 재고에 반영했는지 — cdc-inventory 0.22.0 `GET /cdcs/{cdcId}/transits`(출발 최신 순).
// 줄을 누르면 상품별 보낸·받은(정상·격리·미판정)·손실·안 맞음과 시각(출발·처음/마지막 반영·맞춰 끝남·MFC 입고 종결)을 펼친다.
// 거르기(상태·출발일)는 주소 쿼리로 서버에 보낸다. 15초마다 다시 읽는다. TRF 화면 번호는 cdc-outbound 가 정본이라 TRF 목록·상세에서 찾는다.
import { useQuery } from '@tanstack/react-query';
import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { MfcName } from '../../shared/MfcName';
import { SkuName } from '../../shared/SkuName';
import { TrfNo } from '../../shared/TrfNo';
import { trfWavePath } from '../trf-wave/TrfWavePages';
import { ReceiptChip } from './ReceiptChip';
import { receiptOf, transitsKey, type CenterTransit, type TransitState } from './transits';

const r = messages.receipt;
const REFRESH = 15_000;
const PAGE_SIZE = 50;
const STATES: readonly TransitState[] = ['TRANSIT_OPEN', 'RECEIPT_POSTED_AWAITING_ACK', 'TRANSIT_RECONCILED'];

/** `/c/:cdcId/mfc-receipts` */
export function MfcReceiptsMenu({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const stateParam = params.get('state') ?? '';
  const state = (STATES as readonly string[]).includes(stateParam) ? (stateParam as TransitState) : undefined;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : '';
  const page = Math.max(0, Number(params.get('page') ?? '0') || 0);
  const [open, setOpen] = useState<string | null>(null);
  const setQuery = (next: Record<string, string>) => {
    const q = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    setParams(q, { replace: true });
    setOpen(null);
  };
  const query = useQuery({
    queryKey: [...transitsKey(cdcId), state ?? '', date, page],
    refetchInterval: REFRESH,
    queryFn: () =>
      request(
        'GET',
        api.inventory.GET('/cdcs/{cdcId}/transits', {
          params: { path: { cdcId }, query: { page, size: PAGE_SIZE, ...(state ? { state } : {}), ...(date ? { date } : {}) } },
        }),
      ),
  });
  // TRF 화면 번호·받는 MFC — 최근 TRF 200건(MFC 재고 이동과 같은 조회)에서, 없으면 TRF 상세로
  const transfers = useQuery({
    queryKey: ['cdc', cdcId, 'transfers', 'flow'],
    refetchInterval: REFRESH,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/transfers', { params: { path: { cdcId }, query: { size: 200 } } })),
  });
  const numbers = useMemo(() => new Map((transfers.data?.items ?? []).map((x) => [x.trfId, x.trfNumber ?? null])), [transfers.data]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1>{messages.menus.mfcReceipts}</h1>
          <p className="text-sm text-base-content/60">{r.lead}</p>
        </div>
        {query.dataUpdatedAt > 0 && <span className="text-xs text-base-content/55">{messages.mfcFlow.asOf(formatSeoul(new Date(query.dataUpdatedAt).toISOString()))}</span>}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-base-content/70" data-testid="receipt-legend">
        <li>
          <span className="badge badge-sm badge-ghost mr-1">{r.chipWaiting}</span>
          {r.legend.WAITING}
        </li>
        <li>
          <span className="badge badge-sm badge-warning mr-1">{r.chipMismatchShort}</span>
          {r.legend.MISMATCH}
        </li>
        <li>
          <span className="badge badge-sm badge-success mr-1">{r.chipDone}</span>
          {r.legend.DONE}
        </li>
      </ul>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {r.filterState}
          <select className="select select-sm w-44" value={state ?? ''} onChange={(e) => setQuery({ state: e.target.value, page: '' })} data-testid="receipt-state">
            <option value="">{r.all}</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {r.stateLabel[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {r.filterDate}
          <input type="date" className="input input-sm w-40" value={date} onChange={(e) => setQuery({ date: e.target.value, page: '' })} data-testid="receipt-date" />
        </label>
      </div>
      <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={r.empty}>
        {(d) => (
          <>
            <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <table className="table table-sm" data-testid="receipt-table">
                <thead>
                  <tr>
                    <th>{r.col.departed}</th>
                    <th>{r.col.trf}</th>
                    <th>{r.col.mfc}</th>
                    <th className="text-right">{r.col.sent}</th>
                    <th className="text-right">{r.col.received}</th>
                    <th className="text-right" title={r.col.diffHint}>
                      {r.col.diff}
                    </th>
                    <th>{r.col.state}</th>
                    <th>{r.col.receivedAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((ct) => {
                    const tr = ct.transit;
                    const key = `${tr.departureId ?? ''}-${tr.trfId ?? ''}`;
                    const isOpen = open === key;
                    const diff = ct.totals.unreconciledQty ?? 0;
                    const no = tr.trfId ? numbers.get(tr.trfId) : undefined;
                    return (
                      <Fragment key={key}>
                        <tr className="cursor-pointer hover" data-testid="receipt-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>
                          <td className="whitespace-nowrap">
                            <span aria-hidden className="mr-1 inline-block w-3 text-base-content/50">
                              {isOpen ? '▾' : '▸'}
                            </span>
                            {tr.departedAt ? formatSeoul(tr.departedAt) : messages.none}
                          </td>
                          <td className="font-mono text-xs font-semibold">{no ? <span title={tr.trfId}>{no}</span> : tr.trfId ? <TrfNo cdcId={cdcId} trfId={tr.trfId} /> : messages.none}</td>
                          <td>{tr.mfcId ? <MfcName id={tr.mfcId} /> : messages.none}</td>
                          <td className="text-right tabular-nums">{messages.qty(ct.totals.departedQty ?? 0)}</td>
                          <td className="text-right tabular-nums">{messages.qty(ct.totals.receivedQty ?? 0)}</td>
                          <td className={`text-right tabular-nums ${diff > 0 ? 'font-semibold text-warning' : 'text-base-content/50'}`}>{messages.qty(diff)}</td>
                          <td>
                            <ReceiptChip ct={ct} loading={false} failed={false} />
                            {ct.closure && <span className="ml-1 text-xs text-base-content/60">{r.closed}</span>}
                          </td>
                          <td className="whitespace-nowrap text-xs text-base-content/70">{tr.lastReceiptAt ? formatSeoul(tr.lastReceiptAt) : messages.none}</td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={8} className="bg-base-200/40 p-0">
                              <ReceiptDetail cdcId={cdcId} ct={ct} trfLabel={no ?? null} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2 text-sm">
              <span data-testid="receipt-page">{r.page(page)}</span>
              <button type="button" className="btn btn-sm" disabled={page === 0} onClick={() => setQuery({ page: page > 1 ? String(page - 1) : '' })}>
                {r.prev}
              </button>
              <button type="button" className="btn btn-sm" disabled={!d.hasNext} onClick={() => setQuery({ page: String(page + 1) })}>
                {r.next}
              </button>
            </div>
          </>
        )}
      </QueryState>
      <p role="note" className="text-xs text-base-content/55">
        {r.note}
      </p>
    </section>
  );
}

/** 펼친 줄 — 시각과 상품별 수량, 안 맞으면 어떻게 정리되는지 */
function ReceiptDetail({ cdcId, ct, trfLabel }: { readonly cdcId: string; readonly ct: CenterTransit; readonly trfLabel: string | null }) {
  const tr = ct.transit;
  const kind = receiptOf(ct);
  const hm = (iso: string | null | undefined) => (iso ? formatSeoul(iso) : null);
  const points = [
    { key: 'dep', label: r.detail.departed, time: hm(tr.departedAt) },
    { key: 'first', label: r.detail.firstReceipt, time: hm(tr.firstReceiptAt) },
    { key: 'last', label: r.detail.lastReceipt, time: hm(tr.lastReceiptAt) },
    { key: 'rec', label: r.detail.reconciled, time: hm(tr.reconciledAt) },
    { key: 'close', label: r.detail.closed, time: hm(ct.closure?.closedAt) },
  ];
  const t = ct.totals;
  return (
    <div className="space-y-3 px-4 py-3 text-sm" data-testid="receipt-detail">
      <ol className="flex flex-wrap items-start gap-x-2 gap-y-2">
        {points.map((pt, i) => (
          <li key={pt.key} className="flex items-center gap-2">
            <span className={`flex flex-col rounded-box px-3 py-1.5 ${pt.time ? 'bg-success/15' : 'bg-base-100'}`}>
              <span className={`text-xs ${pt.time ? 'text-success' : 'text-base-content/60'}`}>
                {pt.time ? '✓ ' : ''}
                {pt.label}
              </span>
              <span className="font-medium tabular-nums">{pt.time ?? messages.none}</span>
            </span>
            {i < points.length - 1 && <span className="text-base-content/30">→</span>}
          </li>
        ))}
      </ol>
      <p data-testid="receipt-story">
        {kind === 'DONE'
          ? r.detail.storyDone(t.departedQty ?? 0, t.receivedQty ?? 0, t.lossQty ?? 0)
          : kind === 'MISMATCH'
            ? r.detail.storyMismatch(t.departedQty ?? 0, t.receivedQty ?? 0, t.unreconciledQty ?? 0)
            : r.detail.storyWaiting(t.departedQty ?? 0)}
        {(t.quarantinedQty ?? 0) + (t.pendingQty ?? 0) > 0 && ` ${r.detail.quality(t.receivedNormalQty ?? 0, t.quarantinedQty ?? 0, t.pendingQty ?? 0)}`}
      </p>
      {(tr.lines ?? []).length > 0 && (
        <table className="table table-sm rounded-box bg-base-100" data-testid="receipt-lines">
          <thead>
            <tr>
              <th>{r.detail.product}</th>
              <th>LOT</th>
              <th className="text-right">{r.col.sent}</th>
              <th className="text-right">{r.detail.normal}</th>
              <th className="text-right">{r.detail.quarantined}</th>
              <th className="text-right">{r.detail.pending}</th>
              <th className="text-right">{r.detail.loss}</th>
              <th className="text-right">{r.col.diff}</th>
            </tr>
          </thead>
          <tbody>
            {(tr.lines ?? []).map((l) => (
              <tr key={`${l.sku ?? ''}-${l.lot ?? ''}`}>
                <td>{l.sku ? <SkuName sku={l.sku} /> : messages.none}</td>
                <td className="font-mono text-xs">{l.lot ?? messages.none}</td>
                <td className="text-right tabular-nums">{messages.qty(l.q ?? 0)}</td>
                <td className="text-right tabular-nums">{messages.qty(l.normalQty ?? 0)}</td>
                <td className="text-right tabular-nums">{messages.qty(l.quarantinedQty ?? 0)}</td>
                <td className="text-right tabular-nums">{messages.qty(l.pendingQty ?? 0)}</td>
                <td className="text-right tabular-nums">{messages.qty(l.l ?? 0)}</td>
                <td className={`text-right tabular-nums ${(l.t ?? 0) > 0 ? 'font-semibold text-warning' : ''}`}>{messages.qty(l.t ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tr.trfId && (
        <Link className="link text-xs" to={trfWavePath(cdcId, `trf/${encodeURIComponent(tr.trfId)}`)}>
          {r.detail.toTrf(trfLabel)}
        </Link>
      )}
    </div>
  );
}
