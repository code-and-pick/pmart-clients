// SKU 를 누르면 펼쳐지는 상품 정보(사용자 2026-11-26 "SKU 누르면 아래에 상품 정보(상품명, 온도 같은 거) 간단하게").
// product-service `GET /skus/{sku}`(SkuDetail — 보관 온도·판매 단위·구성 낱개·무게·내용량·바코드·박스/팔레트 입수·소비기한 보장·판매 상태) +
// 이름은 shared/SkuName(GET /products?q=<SKU>). 없는 값은 "—"(0 으로 채우지 않는다), 조회 실패는 실패로.
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import { FieldList } from '@pmart/web-ui/standard';
import { useApi } from '../app/ApiContext';
import { messages } from './messages';
import { useSkuName } from './SkuName';

const t = messages.skuInfo;

export function SkuInfo({ sku }: { readonly sku: string }) {
  const api = useApi();
  const name = useSkuName(sku);
  const query = useQuery({
    queryKey: ['product', 'sku', sku],
    staleTime: 30 * 60_000,
    queryFn: () => request('GET', api.product.GET('/skus/{sku}', { params: { path: { sku } } })),
  });
  return (
    <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
      {(d) => {
        const storage = d.logistics?.storageType;
        const net = d.netContent ? `${d.netContent.amount.toLocaleString('ko-KR')}${d.netContent.unit === 'G' ? 'g' : 'mL'}` : messages.none;
        const life = [
          d.shelfLifeGuarantee?.minRemainingDays !== undefined ? t.minRemain(d.shelfLifeGuarantee.minRemainingDays) : null,
          d.shelfLifeGuarantee?.maxDaysSinceManufacture !== undefined ? t.maxSinceMfg(d.shelfLifeGuarantee.maxDaysSinceManufacture) : null,
        ].filter(Boolean);
        return (
          <div className="space-y-2 py-1" data-testid="sku-info">
            <p className="text-sm font-semibold">{name.data ?? (name.isError ? t.nameFailed : name.isPending ? '…' : t.nameUnknown)}</p>
            <FieldList
              rows={[
                [t.storage, storage ? <span className="font-semibold">{messages.master.loc.zones[storage] ?? storage}</span> : messages.none],
                [t.unit, `${t.unitType[d.unitType] ?? d.unitType} · ${t.units(d.unitsPerSku)}`],
                [t.net, net],
                [t.weight, d.weightG !== undefined ? `${d.weightG.toLocaleString('ko-KR')}g` : messages.none],
                [t.box, d.logistics?.unitsPerBox ? t.perBox(d.logistics.unitsPerBox) : messages.none],
                [t.pallet, d.logistics?.boxesPerPallet ? t.perPallet(d.logistics.boxesPerPallet) : messages.none],
                [t.life, life.length ? life.join(' · ') : messages.none],
                [t.barcodes, d.barcodes?.length ? <span className="font-mono text-xs">{d.barcodes.join(', ')}</span> : messages.none],
                [t.saleState, t.sale[d.saleState] ?? d.saleState],
              ]}
            />
          </div>
        );
      }}
    </QueryState>
  );
}
