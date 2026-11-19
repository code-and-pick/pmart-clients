// 상품별 판매가 요약(2026-11-19 상품 조회 — 쿠팡 윙 "판매가 47,500원~" 참고).
// 계약만: 상품 상세 GET /products/{id}(skus — 상품 상세 화면과 같은 queryKey) → SKU 일괄 가격 GET /prices?skus=(100건씩, 미설정은 notSet).
// 값은 서버 값 그대로 — 가장 낮은 기본가와 가장 높은 기본가, 미설정 SKU 수. 못 읽으면 failed(0원·미설정으로 바꾸지 않는다).
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import { request } from '@pmart/web-core';
import type { ProductDetail } from '../../api/models';
import { useApi } from '../../app/ApiContext';

const BATCH = 100;

export interface ProductPrice {
  readonly skus: readonly string[];
  readonly min: number | undefined;
  readonly max: number | undefined;
  readonly notSet: number;
  readonly loading: boolean;
  readonly failed: boolean;
}

export function useProductPrices(productIds: readonly string[]): ReadonlyMap<string, ProductPrice> {
  const api = useApi();
  const details = useQueries({
    queries: productIds.map((productId) => ({
      queryKey: ['product', 'detail', productId],
      queryFn: () => request('GET', api.product.GET('/products/{productId}', { params: { path: { productId } } })),
    })),
  });
  const detailKey = details.map((d) => d.dataUpdatedAt).join('|');
  const idsKey = productIds.join('|');
  const skusOf = useMemo(
    () => new Map(productIds.map((id, i) => [id, ((details[i]?.data as ProductDetail | undefined)?.skus ?? []).map((s) => s.sku)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idsKey, detailKey],
  );
  const all = useMemo(() => [...skusOf.values()].flat(), [skusOf]);
  const batches = useMemo(() => Array.from({ length: Math.ceil(all.length / BATCH) }, (_, i) => all.slice(i * BATCH, i * BATCH + BATCH)), [all]);
  const prices = useQueries({
    queries: batches.map((b) => ({
      queryKey: ['pricing', 'list', b.join(',')],
      queryFn: () => request('GET', api.pricing.GET('/prices', { params: { query: { skus: b } } })),
    })),
  });
  return new Map(
    productIds.map((id, i) => {
      const d = details[i];
      const skus = skusOf.get(id) ?? [];
      const qs = skus.map((s) => prices[batches.findIndex((b) => b.includes(s))]);
      const amounts = skus.flatMap((s, j) => {
        const p = qs[j]?.data?.items?.find((x) => x.sku === s);
        return p ? [p.basePrice] : [];
      });
      const notSet = skus.filter((s, j) => qs[j]?.data?.notSet?.includes(s)).length;
      return [
        id,
        {
          skus,
          min: amounts.length ? Math.min(...amounts) : undefined,
          max: amounts.length ? Math.max(...amounts) : undefined,
          notSet,
          loading: !d || d.isPending || qs.some((q) => !q || q.isPending),
          failed: Boolean(d?.isError) || qs.some((q) => q?.isError),
        },
      ];
    }),
  );
}
