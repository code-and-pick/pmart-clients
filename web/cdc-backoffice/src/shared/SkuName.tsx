// SKU 옆 상품 이름(사용자 2026-11-26 "B-0000006 이런 거 적혀있는데 무슨 상품인지는 안 적히나?").
// CDC 응답에는 이름이 없어(백엔드에 productName 요청 — P-1) product-service `GET /products?q=<SKU>`(0.5.0 PD-4 — SKU 코드 완전 일치)로
// 관리용 명칭(internalName)을 찾는다. 몇 줄짜리 화면(TRF 상세·작업 상세·칸 재고)에서만 쓴다 — 재고 현황 전체(수백 SKU)에는 쓰지 않는다.
// 못 찾거나 조회가 실패하면 SKU 만(이름을 지어내지 않는다). 서버가 이름을 주면(`name`) 그것을 먼저 쓴다.
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { useApi } from '../app/ApiContext';

export function useSkuName(sku: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: ['product', 'name-by-sku', sku],
    enabled: enabled && sku.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const page = await request('GET', api.product.GET('/products', { params: { query: { q: sku, size: 1 } } }));
      return page.items?.[0]?.internalName ?? null;
    },
  });
}

/** 상품 이름(굵게) + SKU(작게). 이름을 모르면 SKU 만 */
/** lookup=false 면 묻지 않고 SKU 만(줄이 많은 표 — 한 번에 수백 번 묻지 않게) */
export function SkuName({ sku, name, lookup = true }: { readonly sku: string; readonly name?: string | null | undefined; readonly lookup?: boolean }) {
  const q = useSkuName(sku, lookup && !name);
  const shown = name ?? q.data ?? null;
  return (
    <span className="inline-flex min-w-0 flex-col leading-tight" data-testid="sku-name">
      {shown && <span className="whitespace-normal text-sm font-medium">{shown}</span>}
      <span className={`font-mono ${shown ? 'text-[11px] text-base-content/55' : 'text-xs'}`}>{sku}</span>
    </span>
  );
}
