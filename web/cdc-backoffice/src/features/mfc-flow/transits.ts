// MFC 입고 반영 — 출발한 TRF 마다 MFC 가 수령을 확정해 재고에 반영했는지(사용자 2026-11-27 "mfc에서 적치까지 완료했는데 왜 dc백오피스에 계속 출발이라고 되어있니").
// cdc-inventory 0.22.0 `GET /cdcs/{cdcId}/transits`(MF-1) — 출발 최신 순, 한 줄 = 출발한 TRF 하나. 보낸 q = 받은 r + 승인 손실 l + 미정산 t.
// 상태는 서버 값(TransitState)만 쓴다: TRANSIT_OPEN = MFC 반영 전, RECEIPT_POSTED_AWAITING_ACK = 받았지만 수량이 안 맞음(t > 0), TRANSIT_RECONCILED = 다 맞음(입고 완료).
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import type { components } from '../../api/generated/cdc-inventory';
import { useApi } from '../../app/ApiContext';

export type CenterTransit = components['schemas']['CenterTransit'];
export type TransitState = components['schemas']['TransitState'];

/** 화면 단계 — 입고 전 / 받았지만 안 맞음 / 입고 완료 */
export type Receipt = 'WAITING' | 'MISMATCH' | 'DONE';
export function receiptOf(ct: CenterTransit): Receipt {
  const s = ct.transit.state;
  if (s === 'TRANSIT_RECONCILED') return 'DONE';
  if (s === 'RECEIPT_POSTED_AWAITING_ACK') return 'MISMATCH';
  return 'WAITING';
}

export const transitsKey = (cdcId: string) => ['cdc', cdcId, 'transits'] as const;

export interface Transits {
  readonly items: readonly CenterTransit[];
  /** trfId → 줄(TRF 는 한 번만 출발) */
  readonly byTrf: ReadonlyMap<string, CenterTransit>;
  readonly loading: boolean;
  readonly failed: boolean;
}

/** 최근 출발 200건(출발 최신 순) */
export function useTransits(cdcId: string, refetchInterval: number): Transits {
  const api = useApi();
  const q = useQuery({
    queryKey: [...transitsKey(cdcId), 'recent'],
    refetchInterval,
    queryFn: () => request('GET', api.inventory.GET('/cdcs/{cdcId}/transits', { params: { path: { cdcId }, query: { size: 200 } } })),
  });
  const items = q.data?.items ?? [];
  const byTrf = new Map<string, CenterTransit>();
  for (const x of items) if (x.transit.trfId) byTrf.set(x.transit.trfId, x);
  return { items, byTrf, loading: q.isPending, failed: q.isError };
}
