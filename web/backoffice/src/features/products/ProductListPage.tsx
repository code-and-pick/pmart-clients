// 상품 목록(카테고리·판매 상태 필터, 커서는 URL) + SKU·바코드로 찾기.
// 화면(2026-11-18 사용자 "밋밋하다 — Shopify·Medusa 상품 목록처럼"): 한 카드 안에 판매 상태 탭 → 찾기 줄(바로 찾기·카테고리) →
// 표(관리용 명칭 굵게·상품 ID 작게, 판매 상태 점 배지, 버전) → 아래 표시 수·더 보기. 머리말 오른쪽에 등록 버튼.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { PmartFailure } from '@pmart/web-core';
import { SALE_STATES, type SaleState } from '../../api/models';
import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { FailureAlert } from '../../shared/Feedback';
import { messages as m } from '../../shared/messages';
import { QueryState } from '@pmart/web-ui';
import { toUiState } from '@pmart/web-ui';
import { PageHeader, StatusBadge, type Tone, useRowLink } from '../../shared/admin';
import { LineIcon, tableClass, UnderlineTabs } from './parts';

export const SALE_TONE: Readonly<Record<SaleState, Tone>> = {
  ON_SALE: 'success',
  TEMPORARILY_SOLD_OUT: 'warning',
  SALE_STOPPED: 'error',
};

function Lookup() {
  const api = useApi();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [failure, setFailure] = useState<PmartFailure | null>(null);
  const [busy, setBusy] = useState(false);

  const find = async (by: 'sku' | 'barcode') => {
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    setFailure(null);
    try {
      const productId =
        by === 'sku'
          ? (await request('GET', api.product.GET('/skus/{sku}', { params: { path: { sku: v } } }))).productId
          : (await request('GET', api.product.GET('/barcodes/{barcode}', { params: { path: { barcode: v } } }))).productId;
      if (productId) void navigate(`/products/${encodeURIComponent(productId)}`);
    } catch (e) {
      if (e instanceof PmartFailure) setFailure(e);
      else throw e;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-w-0 space-y-2">
      <div className="text-xs font-medium text-base-content/55">{m.products.quickFind}</div>
      <div className="join">
        <label className="input input-sm join-item flex items-center gap-2">
          <LineIcon name="search" className="h-4 w-4 text-base-content/40" />
          <input aria-label={m.products.skuLookup} className="grow" placeholder="E-00000001 / 8801234567890" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <button type="button" className="btn btn-sm join-item" disabled={busy} onClick={() => void find('sku')}>
          {m.products.skuLookup}
        </button>
        <button type="button" className="btn btn-sm join-item" disabled={busy} onClick={() => void find('barcode')}>
          {m.products.barcodeLookup}
        </button>
      </div>
      {failure && <FailureAlert failure={failure} />}
    </div>
  );
}

export function ProductListPage() {
  const api = useApi();
  const rowLink = useRowLink();
  const [params, setParams] = useSearchParams();
  const saleState: SaleState | undefined = SALE_STATES.find((s) => s === params.get('saleState'));
  const categoryId = params.get('categoryId') ?? '';
  const cursor = params.get('cursor') ?? undefined;
  const [categoryInput, setCategoryInput] = useState(categoryId);

  const query = useQuery({
    queryKey: ['product', 'list', saleState, categoryId, cursor],
    queryFn: () =>
      request(
        'GET',
        api.product.GET('/products', {
          params: {
            query: {
              ...(saleState ? { saleState } : {}),
              ...(categoryId ? { categoryId } : {}),
              ...(cursor ? { cursor } : {}),
              size: 50,
            },
          },
        }),
      ),
  });

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'cursor') next.delete('cursor');
    setParams(next);
  };

  return (
    <section className="space-y-4">
      <PageHeader
        title={m.products.listTitle}
        description={m.products.listIntro}
        actions={
          <>
            <Link className="btn btn-sm" to="/products/import">
              {m.products.importTitle}
            </Link>
            <Link className="btn btn-sm btn-primary" to="/products/drafts/new">
              {m.products.draftTitle}
            </Link>
          </>
        }
      />
      <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm" data-testid="product-list-card">
        {/* 판매 상태 탭(밑줄) — URL 의 saleState 그대로 */}
        <UnderlineTabs<SaleState | ''>
          label={m.products.saleState}
          value={saleState ?? ''}
          onChange={(v) => setParam('saleState', v)}
          options={[{ value: '', label: m.approvals.filterAll }, ...SALE_STATES.map((s) => ({ value: s, label: m.products.saleStateName[s] }))]}
        />
        {/* 찾기 줄: 바로 찾기(SKU·바코드) · 카테고리 ID */}
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-base-300 bg-base-200/40 px-4 py-3">
          <Lookup />
          <form
            className="min-w-0 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              setParam('categoryId', categoryInput.trim());
            }}
          >
            <div className="text-xs font-medium text-base-content/55">{m.products.categoryFilter}</div>
            <div className="join">
              <input aria-label={m.products.categoryFilter} placeholder={m.products.categoryFilter} className="input input-sm join-item" value={categoryInput} onChange={(e) => setCategoryInput(e.target.value)} />
              <button type="submit" className="btn btn-sm join-item">
                {m.search}
              </button>
            </div>
          </form>
        </div>

        <QueryState state={toUiState(query, (d) => (d.items?.length ?? 0) === 0)} onRetry={() => void query.refetch()} emptyText={m.products.listEmpty}>
          {(d) => (
            <>
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th>{m.products.internalName}</th>
                      <th>{m.products.primaryCategoryId}</th>
                      <th>{m.products.saleState}</th>
                      <th className="text-right">{m.products.version}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(d.items ?? []).map((p, i) => (
                      <tr key={p.productId ?? i} data-testid="product-row" {...(p.productId ? rowLink(`/products/${encodeURIComponent(p.productId)}`) : {})}>
                        <td className="max-w-xl">
                          <div className="flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-base-200 text-base-content/45" aria-hidden="true">
                              <LineIcon name="box" className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium" title={p.internalName ?? undefined}>
                                {p.internalName ?? m.none}
                              </p>
                              {p.productId ? (
                                <Link className="font-mono text-xs text-base-content/50 hover:text-primary hover:underline" to={`/products/${encodeURIComponent(p.productId)}`}>
                                  {p.productId}
                                </Link>
                              ) : (
                                <span className="text-xs text-base-content/40">{m.none}</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>{p.primaryCategoryId ? <span className="rounded-md bg-base-200 px-2 py-0.5 font-mono text-xs">{p.primaryCategoryId}</span> : m.none}</td>
                        <td>{p.saleState ? <StatusBadge tone={SALE_TONE[p.saleState]}>{m.products.saleStateName[p.saleState]}</StatusBadge> : m.none}</td>
                        <td className="text-right font-mono text-xs text-base-content/60">{p.version === undefined ? m.none : `v${p.version}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-base-300 px-4 py-3 text-sm">
                <span className="text-base-content/55">{m.products.listShown(d.items?.length ?? 0, Boolean(d.page?.nextCursor))}</span>
                {d.page?.nextCursor && (
                  <button type="button" className="btn btn-sm" onClick={() => setParam('cursor', d.page?.nextCursor ?? '')}>
                    {m.more}
                  </button>
                )}
              </div>
            </>
          )}
        </QueryState>
      </div>
    </section>
  );
}
