// 세션 centers 중 DC(center-master type=CDC)만 — 한 계정이 MFC 센터도 맡을 수 있다(예 CDC01·MFC-BJG-01, 2026-11-26).
// center-master `GET /centers?type=CDC` 로 DC 목록을 받아 세션 centers 와 겹치는 것만 쓴다. 판정(권한)은 서버.
// 목록을 못 받으면(403·장애) 거르지 않고 세션 centers 그대로 — 고를 수 없게 만들지 않는다(그 센터 화면이 서버 403 으로 막힌다).
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { useApi } from './ApiContext';
import { useSession } from './SessionContext';

export interface DcCenters {
  /** 이 앱에서 고를 수 있는 센터(세션 순서 그대로) */
  readonly centers: readonly string[];
  /** DC 목록을 아직 받는 중 */
  readonly loading: boolean;
  /** DC 목록을 못 받아 거르지 못했다 */
  readonly unfiltered: boolean;
}

export function useDcCenters(): DcCenters {
  const api = useApi();
  const { session } = useSession();
  const all = session?.centers ?? [];
  const query = useQuery({
    queryKey: ['center-master', 'centers', 'CDC'],
    enabled: all.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const ids = new Set<string>();
      let cursor: string | undefined;
      // DC 는 몇 곳뿐이라 보통 한 쪽 — 그래도 끝까지 읽는다(최대 5쪽)
      for (let i = 0; i < 5; i++) {
        const page = await request('GET', api.center.GET('/centers', { params: { query: { type: 'CDC', size: 200, ...(cursor ? { cursor } : {}) } } }));
        for (const c of page.items ?? []) if (c.centerId) ids.add(c.centerId);
        cursor = page.page?.nextCursor ?? undefined;
        if (!cursor) break;
      }
      return ids;
    },
  });
  if (query.data) return { centers: all.filter((c) => query.data.has(c)), loading: false, unfiltered: false };
  if (query.isError) return { centers: all, loading: false, unfiltered: true };
  return { centers: all, loading: all.length > 0, unfiltered: false };
}
