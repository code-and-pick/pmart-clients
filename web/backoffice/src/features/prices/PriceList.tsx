// 가격 관리 목록(2026-11-19 사용자 "쿠팡 윙 판매자 사이트 가격관리를 참고해 업그레이드").
// 레퍼런스 모양: 상태 숫자 카드(누르면 그 상태로 거름) → 안내 상자 → 회색 검색 띠 → 목록 머리줄(총 N개 · 선택 · 일괄 행동 · 정렬) → 줄마다 상품·현재가·예약·상태·행동.
// 데이터(계약만): 상품 목록 GET /products(쪽) → 상품 상세 GET /products/{id} 의 skus → SKU 일괄 가격 GET /prices?skus=(100건씩, 미설정은 notSet).
//   목록 줄(ProductSummary)에 SKU 가 없어 상품마다 상세를 한 번씩 읽는다(상품 상세 화면과 같은 queryKey — 한 번 읽으면 다시 안 읽음).
// 숫자 카드는 "불러온 상품 기준"이다(서버가 전체를 세 주지 않는다) — 카드 아래에 그렇게 적는다. 금액은 서버 값 그대로, 미설정은 0원이 아니라 "미설정".
import { useInfiniteQuery, useQueries } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatKrw, formatSeoul } from '@pmart/web-ui';
import type { Price, ProductDetail as Product } from '../../api/models';
import { useApi } from '../../app/ApiContext';
import { DataTable, StatCard, StatStrip, StatusBadge, type Tone } from '../../shared/admin';
import { messages as m } from '../../shared/messages';
import { LineIcon } from '../products/parts';

const PRODUCT_PAGE = 50;
const PRICE_BATCH = 100;
const l = m.prices.list;

export type PriceView = 'all' | 'onSale' | 'notSet' | 'scheduled';
type Sort = 'product' | 'high' | 'low';

export interface PriceRow {
  readonly sku: string;
  readonly productId: string;
  readonly productName: string;
  readonly saleState: string | undefined;
  readonly unitsPerSku: number | undefined;
  /** undefined = 아직 읽는 중, null = 미설정(notSet), Price = 서버 값 */
  readonly price: Price | null | undefined;
  /** 이 SKU 가격 조회가 실패했나(0원·미설정으로 바꾸지 않는다) */
  readonly priceFailed: boolean;
}

const chunk = <T,>(xs: readonly T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** 가격 상태 — 표시용(서버 값에서만) */
function priceState(r: PriceRow): { readonly key: 'loading' | 'failed' | 'notSet' | 'scheduled' | 'effective'; readonly tone: Tone } {
  if (r.priceFailed) return { key: 'failed', tone: 'ghost' };
  if (r.price === undefined) return { key: 'loading', tone: 'ghost' };
  if (r.price === null) return { key: 'notSet', tone: 'error' };
  if (r.price.nextChange?.basePrice !== undefined) return { key: 'scheduled', tone: 'info' };
  return { key: 'effective', tone: 'success' };
}

function usePriceRows() {
  const api = useApi();
  const products = useInfiniteQuery({
    queryKey: ['prices', 'products'],
    initialPageParam: '',
    queryFn: ({ pageParam }) => request('GET', api.product.GET('/products', { params: { query: { size: PRODUCT_PAGE, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });
  const ids = useMemo(() => (products.data?.pages ?? []).flatMap((p) => (p.items ?? []).flatMap((x) => (x.productId ? [x.productId] : []))), [products.data]);
  const details = useQueries({
    queries: ids.map((productId) => ({
      queryKey: ['product', 'detail', productId],
      queryFn: () => request('GET', api.product.GET('/products/{productId}', { params: { path: { productId } } })),
    })),
  });
  const detailFailed = details.filter((d) => d.isError).length;
  // 상세를 다 받을 때마다 다시 만든다(받은 시각들을 열쇠로)
  const detailKey = details.map((d) => d.dataUpdatedAt).join('|');
  const skus = useMemo(
    () => details.flatMap((d) => ((d.data as Product | undefined)?.skus ?? []).map((s) => ({ sku: s.sku, product: d.data as Product, saleState: s.saleState, unitsPerSku: s.unitsPerSku }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detailKey],
  );
  const batches = useMemo(() => chunk(skus.map((s) => s.sku), PRICE_BATCH), [skus]);
  const prices = useQueries({
    queries: batches.map((b) => ({
      queryKey: ['pricing', 'list', b.join(',')],
      queryFn: () => request('GET', api.pricing.GET('/prices', { params: { query: { skus: b } } })),
    })),
  });
  const rows: PriceRow[] = skus.map((s) => {
    const at = batches.findIndex((b) => b.includes(s.sku));
    const q = prices[at];
    const found = q?.data?.items?.find((p) => p.sku === s.sku);
    const notSet = q?.data?.notSet?.includes(s.sku) ?? false;
    return {
      sku: s.sku,
      productId: s.product.productId ?? '',
      productName: s.product.internalName ?? m.none,
      saleState: s.saleState,
      unitsPerSku: s.unitsPerSku,
      price: found ?? (notSet ? null : undefined),
      priceFailed: Boolean(q?.isError),
    };
  });
  const loading = products.isPending || details.some((d) => d.isPending) || prices.some((p) => p.isPending);
  const refetch = () => {
    void products.refetch();
    for (const p of prices) void p.refetch();
  };
  const updatedAt = Math.max(products.dataUpdatedAt, ...prices.map((p) => p.dataUpdatedAt));
  return { rows, products, loading, detailFailed, priceFailed: prices.some((p) => p.isError), refetch, updatedAt };
}

const hhmm = (t: number) => (t > 0 ? new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }) : '…');

export function PriceList({ onChange, onOpen, openSku }: { readonly onChange: (skus: string[]) => void; readonly onOpen: (sku: string, ids: readonly string[], productId: string) => void; readonly openSku: string }) {
  const { rows, products, loading, detailFailed, priceFailed, refetch, updatedAt } = usePriceRows();
  const [params, setParams] = useSearchParams();
  const view = (['all', 'onSale', 'notSet', 'scheduled'] as const).find((v) => v === params.get('view')) ?? 'all';
  const sale = params.get('sale') ?? '';
  const [text, setText] = useState('');
  const [sort, setSort] = useState<Sort>('product');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  const setParam = (k: string, v: string) =>
    setParams(
      (p) => {
        const q = new URLSearchParams(p);
        if (v && v !== 'all') q.set(k, v);
        else q.delete(k);
        return q;
      },
      { replace: true },
    );

  const counts = {
    all: rows.length,
    onSale: rows.filter((r) => r.saleState === 'ON_SALE').length,
    notSet: rows.filter((r) => r.price === null).length,
    scheduled: rows.filter((r) => r.price?.nextChange?.basePrice !== undefined).length,
  };
  const q = text.trim().toLowerCase().replace(/\s+/g, '');
  const shown = rows
    .filter((r) => (view === 'onSale' ? r.saleState === 'ON_SALE' : view === 'notSet' ? r.price === null : view === 'scheduled' ? r.price?.nextChange?.basePrice !== undefined : true))
    .filter((r) => !sale || r.saleState === sale)
    .filter((r) => !q || `${r.productName}${r.sku}`.toLowerCase().replace(/\s+/g, '').includes(q))
    .sort((a, b) => (sort === 'product' ? 0 : ((sort === 'high' ? -1 : 1) * ((a.price?.basePrice ?? -1) - (b.price?.basePrice ?? -1)))));
  const allPicked = shown.length > 0 && shown.every((r) => picked.has(r.sku));
  const toggle = (sku: string) => {
    const next = new Set(picked);
    if (next.has(sku)) next.delete(sku);
    else next.add(sku);
    setPicked(next);
  };
  const cardNum = (n: number) => (loading ? '…' : String(n));
  const filtered = view !== 'all' || sale !== '' || q !== '';

  return (
    <div className="space-y-4">
      {/* 상태 숫자 카드 — 누르면 그 상태로 거른다(쿠팡 윙 가격관리 첫 줄) */}
      <div className="space-y-1.5">
        <StatStrip label={l.countsLabel} testId="price-counts">
          <StatCard layout="row" label={l.card.all} value={cardNum(counts.all)} to={`/prices`} active={view === 'all'} testId="price-count-all" />
          <StatCard layout="row" label={l.card.onSale} value={cardNum(counts.onSale)} tone={counts.onSale > 0 ? 'success' : undefined} to="/prices?view=onSale" active={view === 'onSale'} testId="price-count-onSale" />
          <StatCard layout="row" label={l.card.notSet} value={cardNum(counts.notSet)} tone={counts.notSet > 0 ? 'error' : undefined} hint={l.card.notSetHint} to="/prices?view=notSet" active={view === 'notSet'} testId="price-count-notSet" />
          <StatCard layout="row" label={l.card.scheduled} value={cardNum(counts.scheduled)} tone={counts.scheduled > 0 ? 'info' : undefined} hint={l.card.scheduledHint} to="/prices?view=scheduled" active={view === 'scheduled'} testId="price-count-scheduled" />
        </StatStrip>
        <p className="text-xs text-base-content/50">{l.basis(products.data?.pages.flatMap((p) => p.items ?? []).length ?? 0, Boolean(products.hasNextPage))}</p>
      </div>


      {/* 회색 검색 띠 — 바로 걸러진다(불러온 목록 안에서) */}
      <div className="flex flex-wrap items-end gap-3 rounded-box bg-base-300/40 px-4 py-3" role="group" aria-label={l.filters}>
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs font-medium text-base-content/60">
          {l.search}
          <span className="input input-sm flex w-full max-w-md items-center gap-2 bg-base-100">
            <LineIcon name="search" className="h-4 w-4 text-base-content/40" />
            <input className="grow" placeholder={l.searchHint} value={text} onChange={(e) => setText(e.target.value)} aria-label={l.search} />
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-base-content/60">
          {l.saleState}
          <select className="select select-sm w-36 bg-base-100" value={sale} onChange={(e) => setParam('sale', e.target.value)} aria-label={l.saleState}>
            <option value="">{l.all}</option>
            {Object.entries(m.products.saleStateName).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-sm btn-ghost text-base-content/60"
          disabled={!filtered}
          onClick={() => {
            setText('');
            setParams({}, { replace: true });
          }}
        >
          {l.reset} ⟳
        </button>
      </div>

      {/* 목록 머리줄: 이름 · 총 N개 · 선택 · 일괄 행동 | 정렬 · 새로 읽기 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 pb-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <h2 className="text-base font-bold">{l.card[view]}</h2>
          <span className="text-base-content/60">{l.total(shown.length)}</span>
          <span className="h-3 w-px bg-base-300" aria-hidden="true" />
          <span className="text-base-content/60">{l.picked(picked.size)}</span>
          <button type="button" className="btn btn-outline btn-primary btn-xs" disabled={picked.size === 0} onClick={() => onChange([...picked])} data-testid="price-bulk-change">
            {l.bulkChange}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {(['product', 'high', 'low'] as const).map((s) => (
            <button key={s} type="button" className={`btn btn-xs rounded-full ${sort === s ? 'btn-primary btn-outline' : 'btn-ghost border border-base-300'}`} aria-pressed={sort === s} onClick={() => setSort(s)}>
              {l.sort[s]}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-xs border border-base-300" onClick={refetch} title={l.refresh} data-testid="price-refresh">
          ⟳ {l.recent(hhmm(updatedAt))}
        </button>
      </div>

      {(detailFailed > 0 || priceFailed) && (
        <p role="alert" className="alert alert-warning alert-soft text-sm">
          {detailFailed > 0 ? l.detailFailed(detailFailed) : l.priceFailed}
        </p>
      )}

      <DataTable testId="price-list" settingsKey="prices">
        <thead>
          <tr>
            <th className="w-10">
              <input type="checkbox" className="checkbox checkbox-xs" aria-label={l.pickAll} checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(shown.map((r) => r.sku)))} />
            </th>
            <th>
              {l.col.product}
              <span className="block text-[11px] font-normal text-base-content/40">{l.col.productSub}</span>
            </th>
            <th>{l.col.saleState}</th>
            <th className="text-right">
              {l.col.current}
              <span className="block text-[11px] font-normal text-base-content/40">{l.col.currentSub}</span>
            </th>
            <th>{l.col.next}</th>
            <th>{l.col.state}</th>
            <th className="w-40" />
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 && (
            <tr>
              <td colSpan={7} className="py-10 text-center text-sm text-base-content/50">
                {m.loading}
              </td>
            </tr>
          )}
          {!loading && shown.length === 0 && (
            <tr>
              <td colSpan={7} className="py-12 text-center text-sm text-base-content/60" data-testid="price-empty">
                {l.empty}{' '}
                {filtered && (
                  <Link className="link link-primary" to="/prices" onClick={() => setText('')}>
                    {l.showAll}
                  </Link>
                )}
              </td>
            </tr>
          )}
          {shown.map((r) => {
            const st = priceState(r);
            return (
              <tr key={r.sku} data-testid="price-row" className={`cursor-pointer ${openSku === r.sku ? 'bg-primary/5' : ''}`} onClick={() => onOpen(r.sku, shown.map((x) => x.sku), r.productId)}>
                <td onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="checkbox checkbox-xs" aria-label={l.pickOne(r.productName, r.sku)} checked={picked.has(r.sku)} onChange={() => toggle(r.sku)} />
                </td>
                <td className="max-w-md">
                  <span className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-base-200 text-base-content/40" aria-hidden="true">
                      <LineIcon name="box" className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      {/* 이름도 줄과 같게 — 누르면 오른쪽 서랍(2026-11-20, 상품 조회와 같은 규칙). 상품으로는 서랍 아래 "상품 가격 탭" */}
                      <span className="block truncate font-semibold">{r.productName}</span>
                      <span className="block text-xs text-base-content/50">
                        <span className="font-mono">{r.sku}</span>
                        {r.unitsPerSku !== undefined && r.unitsPerSku > 1 && ` · ${l.units(r.unitsPerSku)}`}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="text-sm">{r.saleState ? (m.products.saleStateName[r.saleState as keyof typeof m.products.saleStateName] ?? r.saleState) : m.none}</td>
                <td className="text-right">
                  {r.price ? (
                    <>
                      <span className="block text-base font-bold tabular-nums">{formatKrw(r.price.basePrice)}</span>
                      <span className="block text-xs text-base-content/50">{l.since(formatSeoul(r.price.effectiveFrom))}</span>
                    </>
                  ) : r.price === null ? (
                    <span className="font-semibold text-error">{l.notSet}</span>
                  ) : (
                    <span className="text-base-content/40">{r.priceFailed ? '?' : '…'}</span>
                  )}
                </td>
                <td className="text-sm">
                  {r.price?.nextChange?.basePrice !== undefined ? (
                    <span className="inline-flex flex-col rounded-lg border border-info/30 bg-info/5 px-2.5 py-1">
                      <span className="font-semibold tabular-nums text-info">{`→ ${formatKrw(r.price.nextChange.basePrice)}`}</span>
                      {r.price.nextChange.effectiveFrom && <span className="text-xs text-base-content/55">{formatSeoul(r.price.nextChange.effectiveFrom)}</span>}
                    </span>
                  ) : (
                    <span className="text-base-content/35">—</span>
                  )}
                </td>
                <td>
                  <StatusBadge tone={st.tone}>{l.state[st.key]}</StatusBadge>
                </td>
                <td className="text-right" onClick={(e) => e.stopPropagation()}>
                  {/* 단추 하나 — 줄을 눌러도 같은 서랍(지금 가격·이력·바로 바꾸기). "이력" 단추는 같은 일이라 뺐다(2026-11-20) */}
                  <button type="button" className="btn btn-sm" onClick={() => onOpen(r.sku, shown.map((x) => x.sku), r.productId)} data-testid="price-row-change">
                    {l.change}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
      {products.hasNextPage && (
        <div className="text-center">
          <button type="button" className="btn btn-sm" disabled={products.isFetchingNextPage} onClick={() => void products.fetchNextPage()}>
            {l.more}
          </button>
        </div>
      )}
    </div>
  );
}
