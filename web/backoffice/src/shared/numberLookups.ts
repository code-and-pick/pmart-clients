// 화면 번호(ADR-0070)를 응답에 번호가 없는 화면에 붙이는 조회(2026-11-18 — 백엔드 딜리버리 세션 요청, 사용자 지시).
// 새 API 없이 계약에 있는 조회만:
// - 라이더: rider 0.12.0 `GET /riders?riderIds=a,b,c`(50개까지) → riderNumber·nameMasked. 번호로 찾기 `GET /riders?riderNumber=`.
// - 주문: order `GET /orders/lookups?orderId=`(한 건) → orderNumber. 번호로 찾기 `GET /orders/lookups?orderNumber=`.
// 못 읽으면 failed — 화면은 "번호 확인 불가"(없음과 구분). 결과는 queryKey 로 캐시를 나눠 쓴다.
import { useQueries, useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { useApi } from '../app/ApiContext';
import type { RiderDisplay } from './displayNumber';

const RIDER_BATCH = 50;

/** 라이더 ID 여러 개 → 표시(번호·가린 이름). 50개씩 나눠 부른다 */
export function useRiderLabels(riderIds: ReadonlyArray<string | null | undefined>) {
  const api = useApi();
  const ids = [...new Set(riderIds.filter((x): x is string => Boolean(x)))].sort();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += RIDER_BATCH) chunks.push(ids.slice(i, i + RIDER_BATCH));
  const qs = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: ['riders', 'labels', chunk.join(',')],
      queryFn: () => request('GET', api.riders.GET('/riders', { params: { query: { riderIds: chunk.join(','), size: RIDER_BATCH } } })),
    })),
  });
  const map = new Map<string, RiderDisplay>();
  for (const q of qs) for (const r of q.data?.items ?? []) if (r.riderId) map.set(r.riderId, { riderId: r.riderId, riderNumber: r.riderNumber ?? null, nameMasked: r.nameMasked ?? null });
  return { get: (id: string | null | undefined) => (id ? map.get(id) : undefined), failed: qs.some((q) => q.isError) };
}

/** 주문 ID 여러 개 → 화면 주문번호(한 건씩 — 같은 ID 는 캐시) */
export function useOrderNumbers(orderIds: ReadonlyArray<string | null | undefined>) {
  const api = useApi();
  const ids = [...new Set(orderIds.filter((x): x is string => Boolean(x)))];
  const qs = useQueries({
    queries: ids.map((orderId) => ({
      queryKey: ['orders', 'number', orderId],
      queryFn: async () => (await request('GET', api.orders.GET('/orders/lookups', { params: { query: { orderId, page: 0, size: 1 } } }))).items[0]?.orderNumber ?? null,
    })),
  });
  return {
    get: (id: string | null | undefined) => (id ? qs[ids.indexOf(id)]?.data : undefined),
    failed: (id: string | null | undefined) => (id ? Boolean(qs[ids.indexOf(id)]?.isError) : false),
  };
}

/** 한 건의 배송 → 화면 배송 번호(execution 배송 상세) */
export function useDeliveryNumber(deliveryId: string | null | undefined) {
  const api = useApi();
  const q = useQuery({
    queryKey: ['deliveries', 'number', deliveryId ?? ''],
    enabled: Boolean(deliveryId),
    queryFn: async () => (await request('GET', api.execution.GET('/deliveries/{deliveryId}', { params: { path: { deliveryId: deliveryId ?? '' } } }))).deliveryNumber ?? null,
  });
  return { number: q.data, failed: q.isError };
}

/** 배송 ID 여러 개 → 화면 배송 번호(한 건씩 execution 배송 상세 — 같은 ID 는 useDeliveryNumber 와 같은 캐시) */
export function useDeliveryNumbers(deliveryIds: ReadonlyArray<string | null | undefined>) {
  const api = useApi();
  const ids = [...new Set(deliveryIds.filter((x): x is string => Boolean(x)))];
  const qs = useQueries({
    queries: ids.map((deliveryId) => ({
      queryKey: ['deliveries', 'number', deliveryId],
      queryFn: async () => (await request('GET', api.execution.GET('/deliveries/{deliveryId}', { params: { path: { deliveryId } } }))).deliveryNumber ?? null,
    })),
  });
  return {
    get: (id: string | null | undefined) => (id ? qs[ids.indexOf(id)]?.data : undefined),
    failed: (id: string | null | undefined) => (id ? Boolean(qs[ids.indexOf(id)]?.isError) : false),
  };
}

/** 화면 주문번호(8자리) → 주문 ID. 없으면 null(찾기 결과 없음) */
export async function orderIdOfNumber(api: ReturnType<typeof useApi>, orderNumber: string): Promise<string | null> {
  const r = await request('GET', api.orders.GET('/orders/lookups', { params: { query: { orderNumber, page: 0, size: 1 } } }));
  return r.items[0]?.orderId ?? null;
}

/** 화면 라이더 번호(6자리) → 라이더 ID. 없으면 null */
export async function riderIdOfNumber(api: ReturnType<typeof useApi>, riderNumber: string): Promise<string | null> {
  const r = await request('GET', api.riders.GET('/riders', { params: { query: { riderNumber, size: 1 } } }));
  return r.items?.[0]?.riderId ?? null;
}

export const isOrderNumber = (v: string) => /^\d{8}$/.test(v.replace(/[\s-]/g, ''));
export const isRiderNumber = (v: string) => /^[1-9]\d{5}$/.test(v.trim());
