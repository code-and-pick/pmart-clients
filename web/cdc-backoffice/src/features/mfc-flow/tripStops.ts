// MFC 쪽 — TRF 가 실린 운행의 정차(도착·인계)를 TRF 로 찾는다(사용자 2026-11-27 "재고 이관할 때 mfc랑 재고 연동되는 거 실시간으로").
// transport-execution `GET /cdcs/{cdcId}/trips` 를 오늘·어제 출고일과 출고일 없이(전체 200) 읽어 운행 ID 로 합친다.
// 인계(handover)는 MFC 직원이 박스를 받고 서버가 대조한 결과다. MFC 재고에 반영(수령 확정)됐는지는 DC 가 볼 조회가 아직 없다(백엔드 요청 MF-1).
import { useQueries } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import type { components } from '../../api/generated/transport-execution';
import { useApi } from '../../app/ApiContext';
import { todaySeoul, tripsKey } from '../transport/TransportPage';

export type Trip = components['schemas']['Trip'];
export type TripStop = Trip['stops'][number];

export interface StopOfTrf {
  readonly trip: Trip;
  readonly stop: TripStop;
}

export interface TripStops {
  readonly trips: readonly Trip[];
  /** trfId → 그 TRF 를 내리는 정차 */
  readonly byTrf: ReadonlyMap<string, StopOfTrf>;
  readonly loading: boolean;
  readonly failed: boolean;
}

/** 서울 날짜 하루 전(YYYY-MM-DD) */
export function dayBefore(date: string): string {
  const d = new Date(`${date}T12:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() - 1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
}

export function useTripStops(cdcId: string, refetchInterval: number): TripStops {
  const api = useApi();
  const today = todaySeoul();
  const qs = useQueries({
    // 출고일이 출발한 날과 다를 수 있다(DC 시뮬 2026-11-27 — 12-01 출고일 운행이 11-27 에 출발) → 오늘·어제 + 출고일 없이 전체(최대 200)
    queries: [today, dayBefore(today), ''].map((date) => ({
      queryKey: [...tripsKey(cdcId), date || 'any'],
      refetchInterval,
      queryFn: () => request('GET', api.transportExecution.GET('/cdcs/{cdcId}/trips', { params: { path: { cdcId }, query: { ...(date ? { shipDate: date } : {}), size: 200 } } })),
    })),
  });
  const trips = [...new Map(qs.flatMap((q) => q.data?.items ?? []).map((tr) => [tr.tripId, tr])).values()];
  const byTrf = new Map<string, StopOfTrf>();
  for (const trip of trips) {
    if (trip.state === 'CANCELLED') continue;
    for (const stop of trip.stops) for (const id of stop.trfIds ?? []) byTrf.set(id, { trip, stop });
  }
  return { trips, byTrf, loading: qs.some((q) => q.isPending), failed: qs.some((q) => q.isError) };
}

/** 정차 → MFC 쪽 단계 */
export type MfcSide = 'ON_WAY' | 'ARRIVED' | 'HANDED_OVER';
export function mfcSideOf(stop: TripStop): MfcSide {
  if (stop.handover || stop.state === 'HANDED_OVER' || (stop.state === 'DEPARTED' && stop.handedOverAt)) return 'HANDED_OVER';
  if (stop.state === 'ARRIVED' || stop.arrivedAt) return 'ARRIVED';
  return 'ON_WAY';
}
