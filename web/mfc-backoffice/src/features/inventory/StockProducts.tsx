// 재고 > 상품별 재고 — 목록·카드(2026-11-25 사용자 "상품별 재고 탭도 카드, 리스트로 볼 수 있고. 들어가면 귀속된 로트정보 및 상품정보 보이게").
// - 목록: 센터 재고 `GET /mfcs/{mfcId}/stock-units`(수량 > 0 단위 행, 품질·위치 앞부분은 서버 거르기)를 상품(SKU)별로 묶는다. 상품명·코드 글자는 받은 목록 안에서.
// - 사진·고객용 이름: sku → productId 는 이 센터 취급 목록(`sku-handlings`, SKU 투영 전체), 사진은 product-content(shared/productCards).
// - 보유·가용·격리(2026-11-26 화면 검토 "격리가 보유에 드는지, 가용이 얼마인지 목록에서 안 읽힌다"): 지금 쪽 상품만 `GET /mfcs/{mfcId}/stocks?sku=`(1~100)로
//   LOT 합 — 보유 H(격리 포함), 가용 A = 판매 가능 E − 예약 R(격리·보류·이동 중 빠짐), 격리 Q. 센터 전체 값이라 품질·위치 거르기와 무관(거르면 "거른 칸" 칸을 따로).
// - 누르면(?sku=) 상품 정보(product-service `GET /skus/{sku}` — 판매 단위·중량·용량·바코드·본사 판매 상태, 이 센터 취급 ON/OFF) + 아래에 지금처럼 LOT 별 요약·위치·상태별 재고.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { paths as InvPaths } from '../../api/generated/mfc-inventory';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { Pager, usePage } from '../../shared/Pager';
import { ProductThumb, useProductCards, useProductView, ViewToggle } from '../../shared/productCards';
import { InlineFields, ResultBar, SearchPanel, SearchRow } from '../../shared/simList';

const m = messages.inventory.stockProducts;
const mv = messages.moves;
const LIST_PAGE = 200;
const LIST_MAX_PAGES = 20;
const ROWS = 24;
type UnitRow = InvPaths['/mfcs/{mfcId}/stock-units']['get']['responses']['200']['content']['application/json']['items'][number];

interface SkuTotals {
  readonly onHand: number;
  readonly available: number;
  readonly quarantined: number;
}

/** 지금 쪽 상품의 센터 합계(LOT 합) — stocks 는 한 번에 100개까지 */
function useSkuTotals(mfcId: string, skus: readonly string[]) {
  const api = useApi();
  return useQuery({
    queryKey: ['list', 'stock-units', mfcId, 'totals', skus.join(',')],
    enabled: skus.length > 0,
    queryFn: async () => {
      const out = new Map<string, SkuTotals>();
      for (let i = 0; i < skus.length; i += 100) {
        const page = await request('GET', api.inventory.GET('/mfcs/{mfcId}/stocks', { params: { path: { mfcId }, query: { sku: skus.slice(i, i + 100) } } }));
        for (const s of page.items ?? []) {
          const sum = (k: 'onHand' | 'available' | 'quarantined') => (s.lots ?? []).reduce((a, l) => a + (l[k] ?? 0), 0);
          out.set(s.sku, { onHand: sum('onHand'), available: Math.max(0, sum('available')), quarantined: sum('quarantined') });
        }
      }
      return out;
    },
  });
}

interface ProductRow {
  readonly sku: string;
  readonly productName: string | null;
  readonly qty: number;
  readonly quarantined: number;
  readonly lots: number;
  readonly places: number;
}

/** sku → 이 센터 취급(ON/OFF)·productId — sku-handlings 전체(SKU 투영, 200개씩) */
export function useSkuHandlings(mfcId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['handlings', mfcId, 'by-sku'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const out = new Map<string, { readonly productId: string | null; readonly enabled: boolean }>();
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await request('GET', api.inventory.GET('/mfcs/{mfcId}/sku-handlings', { params: { path: { mfcId }, query: { size: 200, ...(cursor ? { cursor } : {}) } } }));
        for (const h of page.items ?? []) out.set(h.sku, { productId: h.productId ?? null, enabled: h.handlingEnabled });
        cursor = page.page?.nextCursor ?? undefined;
        pages += 1;
      } while (cursor && pages < 50);
      return out;
    },
  });
}

function groupBySku(rows: readonly UnitRow[], q: string): ProductRow[] {
  const needle = q.trim().toLowerCase();
  const by = new Map<string, { productName: string | null; qty: number; quarantined: number; lots: Set<string>; places: Set<string> }>();
  for (const u of rows) {
    const r = by.get(u.sku) ?? { productName: u.productName ?? null, qty: 0, quarantined: 0, lots: new Set<string>(), places: new Set<string>() };
    by.set(u.sku, {
      productName: r.productName ?? u.productName ?? null,
      qty: r.qty + u.qty,
      quarantined: r.quarantined + (u.qualityState === 'QUARANTINED' ? u.qty : 0),
      lots: new Set([...r.lots, u.lotId]),
      places: new Set([...r.places, u.locationCode]),
    });
  }
  return [...by.entries()]
    .map(([sku, r]) => ({ sku, productName: r.productName, qty: r.qty, quarantined: r.quarantined, lots: r.lots.size, places: r.places.size }))
    .filter((r) => !needle || [r.productName, r.sku].some((x) => x?.toLowerCase().includes(needle)))
    .sort((a, b) => (a.productName ?? a.sku).localeCompare(b.productName ?? b.sku));
}

export function StockProductList({ mfcId, onOpen }: { readonly mfcId: string; readonly onOpen: (sku: string) => void }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const q = params.get('pq') ?? '';
  const quality = params.get('pquality') ?? '';
  const prefix = params.get('ploc') ?? '';
  const [draft, setDraft] = useState(q);
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    setParams(next, { replace: true });
  };
  const [view, setView] = useProductView();
  // 'list','stock-units',mfcId 로 시작 — 재고 실시간 반영이 같이 다시 읽는다
  const units = useQuery({
    queryKey: ['list', 'stock-units', mfcId, 'by-sku', quality, prefix],
    queryFn: async () => {
      const rows: UnitRow[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await request(
          'GET',
          api.inventory.GET('/mfcs/{mfcId}/stock-units', {
            params: {
              path: { mfcId },
              query: { size: LIST_PAGE, ...(quality ? { qualityState: quality as UnitRow['qualityState'] } : {}), ...(prefix ? { locationPrefix: prefix } : {}), ...(cursor ? { cursor } : {}) },
            },
          }),
        );
        rows.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        pages += 1;
      } while (cursor && pages < LIST_MAX_PAGES);
      return { rows, cut: !!cursor };
    },
  });
  const products = units.data ? groupBySku(units.data.rows, q) : [];
  const paging = usePage(products.length, ROWS);
  const shown = products.slice(paging.from, paging.to);
  const totals = useSkuTotals(mfcId, shown.map((p) => p.sku));
  const filteredView = !!(quality || prefix);
  const num = (p: ProductRow, k: keyof SkuTotals) => {
    const t = totals.data?.get(p.sku);
    if (t) return t[k];
    if (totals.isError && k === 'onHand' && !filteredView) return p.qty; // 합계를 못 읽으면 보유만 단위 행 합으로
    return null;
  };
  const dash = (v: number | null) => (v === null ? <span className="text-base-content/40">—</span> : v);
  const handlings = useSkuHandlings(mfcId);
  const cards = useProductCards(shown.map((p) => handlings.data?.get(p.sku)?.productId));
  const infoOf = (sku: string) => {
    const id = handlings.data?.get(sku)?.productId;
    return id ? cards.data?.get(id) : undefined;
  };
  const nameOf = (p: ProductRow) => p.productName ?? infoOf(p.sku)?.name ?? p.sku;
  const qualityBadge = (p: ProductRow) =>
    p.quarantined > 0 ? <span className="badge badge-sm badge-warning">{m.quarantined(p.quarantined)}</span> : <span className="badge badge-sm badge-success">{mv.quality.NORMAL}</span>;
  return (
    <div className="space-y-4" data-testid="stock-products">
      <SearchPanel
        label={m.search}
        submitLabel={messages.inventory.lookup}
        onSubmit={(e) => {
          e.preventDefault();
          set({ pq: draft.trim() });
        }}
        onReset={() => {
          setDraft('');
          set({ pq: '', pquality: '', ploc: '' });
        }}
        summary={[
          [m.quality, quality ? (mv.quality[quality] ?? quality) : '', () => set({ pquality: '' })],
          [m.location, prefix, () => set({ ploc: '' })],
        ]}
        search={<input type="search" className="input input-sm w-60" maxLength={64} value={draft} placeholder={m.placeholder} aria-label={m.placeholder} onChange={(e) => setDraft(e.target.value)} />}
      >
        <SearchRow label={m.quality}>
          <select className="select select-sm w-36" aria-label={m.quality} value={quality} onChange={(e) => set({ pquality: e.target.value })}>
            <option value="">{m.all}</option>
            {['NORMAL', 'QUARANTINED'].map((x) => (
              <option key={x} value={x}>
                {mv.quality[x] ?? x}
              </option>
            ))}
          </select>
        </SearchRow>
        <SearchRow label={m.location}>
          <input className="input input-sm w-40 font-mono" aria-label={m.location} maxLength={64} value={prefix} placeholder="C-B1" onChange={(e) => set({ ploc: e.target.value.trim().toUpperCase() })} />
        </SearchRow>
      </SearchPanel>
      <div className="flex justify-end">
        <ViewToggle view={view} onChange={setView} />
      </div>
      <QueryState state={toUiState(units, (d) => groupBySku(d.rows, q).length === 0)} onRetry={() => void units.refetch()} emptyText={m.empty}>
        {(d) => (
          <>
            {view === 'card' ? (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3" data-testid="stock-product-cards">
                {shown.map((p) => (
                  <li key={p.sku}>
                    <button type="button" className="flex h-full w-full flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-3 text-left hover:border-primary" onClick={() => onOpen(p.sku)} data-testid="stock-product-card">
                      <ProductThumb info={infoOf(p.sku)} fallback={nameOf(p)} size="card" />
                      <span className="line-clamp-2 font-semibold">{nameOf(p)}</span>
                      <span className="font-mono text-xs text-base-content/60">{p.sku}</span>
                      <span className="mt-auto flex flex-wrap items-center gap-2 text-xs">
                        <span className="w-full">{m.cardTotals(num(p, 'onHand'), num(p, 'available'), num(p, 'quarantined'))}</span>
                        <span className="text-base-content/60">{`${m.lotsText(p.lots)} · ${m.placesText(p.places)}`}</span>
                        {qualityBadge(p)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="pm-list-box">
                <ResultBar count={products.length} />
                <p className="px-4 pb-1 text-xs text-base-content/60">{totals.isError ? m.totalsFailed : m.availableHint}</p>
                <div className="overflow-x-auto" data-list-part="table">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>{m.col.product}</th>
                        <th className="text-right">{m.col.onHand}</th>
                        <th className="text-right" title={m.availableHint}>{m.col.available}</th>
                        <th className="text-right">{m.col.quarantinedQty}</th>
                        {filteredView && <th className="text-right">{m.col.filteredQty}</th>}
                        <th className="text-right">{m.col.lots}</th>
                        <th className="text-right">{m.col.places}</th>
                        <th>{m.col.quality}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((p) => (
                        <tr key={p.sku} data-testid="stock-product-row">
                          <td>
                            <button type="button" className="flex items-center gap-2 text-left" onClick={() => onOpen(p.sku)}>
                              <ProductThumb info={infoOf(p.sku)} fallback={nameOf(p)} size="row" />
                              <span className="min-w-0">
                                <span className="block underline decoration-dotted underline-offset-2">{nameOf(p)}</span>
                                <span className="font-mono text-xs text-base-content/60">{p.sku}</span>
                              </span>
                            </button>
                          </td>
                          <td className="text-right">{dash(num(p, 'onHand'))}</td>
                          <td className="text-right font-semibold" data-testid="stock-product-available">{dash(num(p, 'available'))}</td>
                          <td className="text-right">{dash(num(p, 'quarantined'))}</td>
                          {filteredView && <td className="text-right">{p.qty}</td>}
                          <td className="text-right">{p.lots}</td>
                          <td className="text-right">{p.places}</td>
                          <td>{qualityBadge(p)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <Pager testId="stock-product-pager" unit="개" page={paging.page} pageCount={paging.pageCount} total={products.length} from={paging.from} to={paging.to} onChange={paging.set} />
            {d.cut && <p className="text-xs text-base-content/60">{m.more(d.rows.length)}</p>}
          </>
        )}
      </QueryState>
    </div>
  );
}

/** 상품 정보 — product-service SKU(판매 단위·중량·용량·바코드·본사 판매 상태) + 대표 사진·이름 + 이 센터 취급 */
export function StockProductInfo({ mfcId, sku, stockName }: { readonly mfcId: string; readonly sku: string; readonly stockName: string | null }) {
  const api = useApi();
  const detail = useQuery({
    queryKey: ['sku-detail', sku],
    staleTime: 10 * 60_000,
    queryFn: () => request('GET', api.product.GET('/skus/{sku}', { params: { path: { sku } } })),
  });
  const handlings = useSkuHandlings(mfcId);
  const productId = detail.data?.productId ?? handlings.data?.get(sku)?.productId ?? null;
  const cards = useProductCards([productId]);
  const info = productId ? cards.data?.get(productId) : undefined;
  const d = detail.data;
  const handling = handlings.data?.get(sku);
  const name = info?.name ?? stockName ?? sku;
  return (
    <section className="flex flex-wrap gap-4 rounded-box border border-base-300 bg-base-100 p-4" data-testid="stock-product-info">
      <div className="w-40 shrink-0">
        <ProductThumb info={info} fallback={name} size="card" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <h2 className="text-lg font-bold">{name}</h2>
        {detail.isError && <p className="text-xs text-warning">{m.infoFailed}</p>}
        <InlineFields
          rows={[
            [m.fields.sku, <span key="s" className="font-mono">{sku}</span>],
            [m.fields.unit, d ? m.unitText(d.unitType, d.unitsPerSku) : '…'],
            [m.fields.weight, d?.weightG != null ? `${d.weightG}g` : messages.none],
            [m.fields.volume, d?.volumeMl != null ? `${d.volumeMl}mL` : messages.none],
            [m.fields.sale, d ? (messages.inventory.catalog.saleName[d.saleState] ?? d.saleState) : '…'],
            [m.fields.barcodes, d?.barcodes?.length ? d.barcodes.join(', ') : messages.none],
            [m.fields.handling, handling ? (handling.enabled ? m.handlingOn : m.handlingOff) : '…'],
          ]}
        />
      </div>
    </section>
  );
}
