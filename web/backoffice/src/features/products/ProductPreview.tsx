// 상품 조회 오른쪽 미리보기 안 내용(2026-11-20 사용자 "오른쪽 탭 공간 널널한데 SKU·바코드·버전을 왜 안 보여 주나 — 제대로 띄우든가 없애든가").
// 줄 어디를 눌러도 이 미리보기가 열리고(이름도 링크가 아님), 상세 화면은 미리보기 위 "상세 열기"·Enter·줄의 "상품 수정"으로 간다.
// 값은 상세 화면과 같은 조회(['product','detail',id] — 목록이 이미 읽어 둔 캐시)와 SKU 가격 조회. 못 읽으면 0·빈 값으로 바꾸지 않는다.
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { request } from '@pmart/web-core';
import { formatKrw, formatSeoul } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { StatusBadge } from '../../shared/admin';
import { messages as m } from '../../shared/messages';
import { AuthedImage } from '../contents/AuthedImage';
import { SALE_TONE } from './ProductListPage';
import { LineIcon } from './parts';

const l = m.products.preview;

function Fact({ k, children }: { readonly k: string; readonly children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-base-content/55">{k}</p>
      <div className="truncate text-sm font-medium">{children}</div>
    </div>
  );
}

export function ProductPreviewBody({ productId, category, imageId, customerName }: { readonly productId: string; readonly category: string; readonly imageId: string | undefined; readonly customerName: string | undefined }) {
  const api = useApi();
  const q = useQuery({
    queryKey: ['product', 'detail', productId],
    queryFn: () => request('GET', api.product.GET('/products/{productId}', { params: { path: { productId } } })),
  });
  const skus = (q.data?.skus ?? []).map((s) => s.sku);
  const prices = useQuery({
    queryKey: ['pricing', 'list', skus.join(',')],
    enabled: skus.length > 0,
    queryFn: () => request('GET', api.pricing.GET('/prices', { params: { query: { skus } } })),
  });
  const priceOf = (sku: string): string => {
    if (prices.isError) return '?';
    if (!prices.data) return '…';
    const p = prices.data.items?.find((x) => x.sku === sku);
    if (p) return formatKrw(p.basePrice);
    return prices.data.notSet?.includes(sku) ? l.notSet : '?';
  };

  if (q.isPending) return <p className="text-sm text-base-content/55">…</p>;
  if (q.isError || !q.data) return <p className="text-sm text-error">{l.failed}</p>;
  const p = q.data;
  const pSkus = p.skus ?? [];
  return (
    <div className="space-y-5" data-testid="product-preview">
      {/* 머리 — 큰 대표 이미지 + 고객용 이름·카테고리 */}
      <div className="flex gap-4">
        <span className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-base-300 bg-base-200 text-base-content/40">
          {imageId ? <AuthedImage imageId={imageId} width={240} alt={p.internalName ?? ''} className="h-full w-full object-cover" /> : <LineIcon name="box" className="h-8 w-8" />}
        </span>
        <div className="min-w-0 space-y-1.5">
          {p.saleState && <StatusBadge tone={SALE_TONE[p.saleState]}>{m.products.saleStateName[p.saleState]}</StatusBadge>}
          {customerName && customerName !== p.internalName && <p className="truncate text-sm">{l.customerName(customerName)}</p>}
          <p className="truncate text-xs text-base-content/60">{category}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 rounded-box bg-base-200/50 px-4 py-3">
        <Fact k={l.version}>{p.version === undefined ? m.none : `v${p.version}`}</Fact>
        <Fact k={l.published}>{p.publishedAt ? formatSeoul(p.publishedAt) : m.none}</Fact>
        <Fact k={l.skuCount}>{l.count(pSkus.length)}</Fact>
      </div>

      {/* SKU 마다 한 칸 — SKU 번호·단위·가격·판매 상태, 중량·내용량·보관, 바코드 */}
      <section className="space-y-2">
        <h3 className="text-sm font-bold">{l.skus}</h3>
        <ul className="space-y-2">
          {pSkus.map((s) => (
            <li key={s.sku} className="rounded-box border border-base-300 bg-base-100 px-4 py-3" data-testid="preview-sku">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-sm font-semibold">{s.sku}</span>
                <span className="flex items-center gap-2">
                  <span className="font-bold tabular-nums" data-testid="preview-sku-price">
                    {priceOf(s.sku)}
                  </span>
                  <StatusBadge tone={SALE_TONE[s.saleState]}>{m.products.saleStateName[s.saleState]}</StatusBadge>
                </span>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-3">
                <Fact k={l.unit}>{`${m.products.unitName[s.unitType]} × ${s.unitsPerSku}`}</Fact>
                <Fact k={l.weight}>{s.weightG === undefined || s.weightG === null ? m.notSet : `${s.weightG.toLocaleString('ko-KR')}g`}</Fact>
                <Fact k={m.products.net.label}>{s.netContent ? m.products.net.show(s.netContent.amount, s.netContent.unit) : m.none}</Fact>
                <Fact k={l.storage}>{s.logistics?.storageType ? m.products.storageName[s.logistics.storageType] : m.none}</Fact>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="preview-sku-barcodes">
                <span className="text-[11px] text-base-content/55">{l.barcodes}</span>
                {(s.barcodes ?? []).length === 0 ? (
                  <span className="text-xs">{m.none}</span>
                ) : (
                  (s.barcodes ?? []).map((b) => (
                    <span key={b} className="rounded bg-base-200 px-1.5 py-0.5 font-mono text-xs">
                      {b}
                    </span>
                  ))
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
