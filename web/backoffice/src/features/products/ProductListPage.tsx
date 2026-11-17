// 상품 목록(카테고리·판매 상태 필터, 커서는 URL) + SKU·바코드로 찾기.
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
import { DataTable, PageHeader, SearchRow } from '../../shared/admin';

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
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input
          aria-label={m.products.skuLookup}
          className="input input-sm"
          placeholder="E-00000001 / 8801234567890"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void find('sku')}>
          {m.products.skuLookup}
        </button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void find('barcode')}>
          {m.products.barcodeLookup}
        </button>
      </div>
      {failure && <FailureAlert failure={failure} />}
    </div>
  );
}

export function ProductListPage() {
  const api = useApi();
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
      <PageHeader title={m.products.listTitle} />
      {/* 관리자 형식(2026-11-18): 검색 조건 상자 — 줄마다 왼쪽 항목명 */}
      <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 divide-y divide-base-300">
      <SearchRow label={m.products.quickFind}>
        <Lookup />
      </SearchRow>
      <SearchRow label={m.products.saleState}>
        <select
          aria-label={m.products.saleState}
          className="select select-sm w-40"
          value={saleState ?? ''}
          onChange={(e) => setParam('saleState', e.target.value)}
        >
          <option value="">{`${m.products.saleState}: ${m.approvals.filterAll}`}</option>
          {SALE_STATES.map((s) => (
            <option key={s} value={s}>
              {m.products.saleStateName[s]}
            </option>
          ))}
        </select>
      </SearchRow>
      <SearchRow label={m.products.categoryFilter}>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setParam('categoryId', categoryInput.trim());
          }}
        >
          <input
            aria-label={m.products.categoryFilter}
            placeholder={m.products.categoryFilter}
            className="input input-sm"
            value={categoryInput}
            onChange={(e) => setCategoryInput(e.target.value)}
          />
          <button type="submit" className="btn btn-sm">
            {m.search}
          </button>
        </form>
      </SearchRow>
      </div>
      <QueryState state={toUiState(query, (d) => (d.items?.length ?? 0) === 0)} onRetry={() => void query.refetch()}>
        {(d) => (
          <>
            <DataTable>
              <thead>
                <tr>
                  <th>{m.products.productId}</th>
                  <th>{m.products.internalName}</th>
                  <th>{m.products.primaryCategoryId}</th>
                  <th>{m.products.saleState}</th>
                  <th>{m.products.version}</th>
                </tr>
              </thead>
              <tbody>
                {(d.items ?? []).map((p, i) => (
                  <tr key={p.productId ?? i}>
                    <td>
                      {p.productId ? (
                        <Link className="link" to={`/products/${encodeURIComponent(p.productId)}`}>
                          {p.productId}
                        </Link>
                      ) : (
                        m.none
                      )}
                    </td>
                    <td>{p.internalName ?? m.none}</td>
                    <td>{p.primaryCategoryId ?? m.none}</td>
                    <td>{p.saleState ? m.products.saleStateName[p.saleState] : m.none}</td>
                    <td>{p.version ?? m.none}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            {d.page?.nextCursor && (
              <button type="button" className="btn btn-sm" onClick={() => setParam('cursor', d.page?.nextCursor ?? '')}>
                {m.more}
              </button>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}
