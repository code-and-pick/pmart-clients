// 평면도 — 층의 통로마다 재고가 있는지(사용자 2026-11-26 "랙 클릭했는데 재고가 안 떠" — LAN 재고는 4만여 칸 중 1천여 줄이라 대부분 통로가 빈다).
// 층의 구역마다 cdc-inventory `GET /cdcs/{cdcId}/location-stocks?locationPrefix={센터}-{구역}-{층}-&limit=2000` 한 번씩 읽어 통로(코드 넷째 구간)별로 더한다.
// 2000 줄에서 잘리면(truncated) "일부만"으로 표시한다 — 없는 것으로 보이지 않게.
import { useQueries } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';

export interface AisleStock {
  readonly qty: number;
  readonly lines: number;
}

export interface FloorStock {
  /** `${구역}${통로 번호}` → 합 */
  readonly byAisle: ReadonlyMap<string, AisleStock>;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly truncated: boolean;
}

export const aisleKey = (zone: string, no: number) => `${zone}${no}`;

export function useFloorStock(cdcId: string, centerId: string, floor: string, zones: readonly string[]): FloorStock {
  const api = useApi();
  const qs = useQueries({
    queries: zones.map((zone) => ({
      queryKey: ['cdc', cdcId, 'location-stocks', `${centerId}-${zone}-${floor}-`, 'floor'],
      staleTime: 60_000,
      queryFn: () =>
        request('GET', api.inventory.GET('/cdcs/{cdcId}/location-stocks', { params: { path: { cdcId }, query: { locationPrefix: `${centerId}-${zone}-${floor}-`, limit: 2000 } } })),
    })),
  });
  const byAisle = new Map<string, AisleStock>();
  for (const q of qs) {
    for (const r of q.data?.items ?? []) {
      const parts = r.locationCode.split('-');
      const no = Number(parts[3]);
      if (!parts[1] || !Number.isFinite(no)) continue;
      const k = aisleKey(parts[1], no);
      const cur = byAisle.get(k) ?? { qty: 0, lines: 0 };
      byAisle.set(k, { qty: cur.qty + r.onHand, lines: cur.lines + 1 });
    }
  }
  return {
    byAisle,
    loading: qs.some((q) => q.isPending),
    failed: qs.some((q) => q.isError),
    truncated: qs.some((q) => q.data?.truncated),
  };
}
