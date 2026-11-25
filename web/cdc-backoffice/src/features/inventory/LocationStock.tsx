// 칸별 재고 — cdc-inventory 0.9.0 `GET /cdcs/{cdcId}/location-stocks?locationPrefix=&limit=`(M-6). 한 줄 = 칸 × SKU × LOT × 품질 상태.
// 로케이션 상세(그 칸 코드로)와 재고관리 [칸별 재고] 탭(층·통로 앞부분으로)이 같이 쓴다. 줄이 잘리면(truncated) 숨기지 않고 알린다.
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { formatSeoulDate, QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';

const t = messages.locStock;

export function LocationStockTable({ cdcId, prefix, single = false }: { readonly cdcId: string; readonly prefix: string; readonly single?: boolean }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'location-stocks', prefix],
    queryFn: () => request('GET', api.inventory.GET('/cdcs/{cdcId}/location-stocks', { params: { path: { cdcId }, query: { locationPrefix: prefix, limit: 500 } } })),
  });
  return (
    <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={single ? t.empty : t.emptyPrefix}>
      {(data) => (
        <div className="space-y-2">
          {data.truncated && (
            <p role="note" className="alert alert-warning text-sm">
              {t.truncated}
            </p>
          )}
          <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
            <table className="table table-sm" data-testid="location-stock-table">
              <thead>
                <tr>
                  {!single && <th>{t.location}</th>}
                  <th>{messages.inventory.sku}</th>
                  <th>{messages.inventory.lot}</th>
                  <th>{messages.inventory.expires}</th>
                  <th>{messages.inventory.quality}</th>
                  <th className="text-right">{messages.inventory.onHand}</th>
                  <th className="text-right">{messages.inventory.reserved}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={`${r.locationCode}-${r.sku}-${r.lot}-${r.qualityState}`} data-testid="location-stock-row">
                    {!single && <td className="font-mono text-xs">{r.locationCode}</td>}
                    <td className="font-mono text-xs">{r.sku}</td>
                    <td className="font-mono text-xs">{r.lot}</td>
                    <td>{r.expiresAt ? formatSeoulDate(r.expiresAt) : messages.none}</td>
                    <td>{messages.inventory.qualityState[r.qualityState] ?? r.qualityState}</td>
                    <td className="text-right tabular-nums">{messages.qty(r.onHand)}</td>
                    <td className="text-right tabular-nums">{messages.qty(r.reserved)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </QueryState>
  );
}
