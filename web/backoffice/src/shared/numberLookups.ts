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

/** 화면 라이더 번호(R4785 — ADR-0085, 서버가 R4785·r4785·4785 를 같게 봄) → 라이더 ID. 없으면 null */
export async function riderIdOfNumber(api: ReturnType<typeof useApi>, riderNumber: string): Promise<string | null> {
  const r = await request('GET', api.riders.GET('/riders', { params: { query: { riderNumber, size: 1 } } }));
  return r.items?.[0]?.riderId ?? null;
}

/** 고객번호 — bff customer-search 계약 pattern ^[1-9][0-9]{5}$ 와 같게(0 으로 시작하면 고객번호가 아니다 — 2026-11-24 PR용 프론트 #442 리뷰) */
export const isCustomerNumber = (v: string) => /^[1-9]\d{5}$/.test(v.trim());

export const isOrderNumber = (v: string) => /^\d{8}$/.test(v.replace(/[\s-]/g, ''));
/** 라이더 번호(ADR-0085 2026-11-22): R + 4자리(드물게 5자리). R 없이 숫자만 넣어도 된다 */
export const isRiderNumber = (v: string) => /^[Rr]?\d{4,5}$/.test(v.trim());

/**
 * 화면 배송 번호(ADR-0085 2026-11-22): D + 주문번호 8자리, 같은 주문 두 번째 배송부터 -순번(D74939255, D74939255-2).
 * D·순번 없이 넣어도 되고(순번 없음 = 1), 예전 모양(74939255-1)도 같게 읽는다. 서버 orderNumber 는 숫자 8자리만 받는다.
 */
export function parseDeliveryNumber(v: string | null | undefined): { readonly orderNumber: string; readonly seq: number; readonly marked: boolean } | null {
  const x = /^([Dd])?(\d{8})(?:-(\d{1,3}))?$/.exec((v ?? '').replace(/\s/g, ''));
  return x ? { orderNumber: x[2]!, seq: x[3] ? Number(x[3]) : 1, marked: Boolean(x[1] || x[3]) } : null;
}
export const isDeliveryNumber = (v: string) => parseDeliveryNumber(v) !== null;

/**
 * 화면 배송 번호 → 배송 ID(2026-11-19 사용자 "난수 ID 를 일일이 확인 안 하고 불러올 방법"). 새 API 없이:
 * execution `GET /deliveries?orderNumber=` 로 그 주문의 배송들을 받아 deliveryNumber 가 같은 것. 없으면 null.
 */
export async function deliveryIdOfNumber(api: ReturnType<typeof useApi>, deliveryNumber: string): Promise<string | null> {
  const want = parseDeliveryNumber(deliveryNumber);
  if (!want) return null;
  const r = await request('GET', api.execution.GET('/deliveries', { params: { query: { orderNumber: want.orderNumber, size: 50 } } }));
  return (
    (r.items ?? []).find((d) => {
      const got = parseDeliveryNumber(d.deliveryNumber);
      return got?.orderNumber === want.orderNumber && got.seq === want.seq;
    })?.deliveryId ?? null
  );
}

export type RefKind = 'delivery' | 'rider' | 'order' | 'case';
const isNumberOf: Readonly<Record<RefKind, (v: string) => boolean>> = { delivery: isDeliveryNumber, rider: isRiderNumber, order: isOrderNumber, case: (v) => isCaseNumber(v) };

/** 입력 칸 값 → 시스템 ID. 화면 번호 모양이면 서버에서 찾고, 아니면 넣은 값을 ID 로 그대로(기존처럼) */
export function useResolvedRef(kind: RefKind, input: string) {
  const api = useApi();
  const value = input.trim();
  const byNumber = value !== '' && isNumberOf[kind](value);
  const q = useQuery({
    queryKey: ['ref', kind, value],
    enabled: byNumber,
    staleTime: 60_000,
    queryFn: () =>
      kind === 'delivery' ? deliveryIdOfNumber(api, value) : kind === 'rider' ? riderIdOfNumber(api, value) : kind === 'case' ? caseIdOfNumber(api, value) : orderIdOfNumber(api, value.replace(/[\s-]/g, '')),
  });
  if (value === '') return { id: null, state: 'empty' as const, value };
  if (!byNumber) return { id: value, state: 'id' as const, value };
  if (q.isPending) return { id: null, state: 'loading' as const, value };
  if (q.isError) return { id: null, state: 'failed' as const, value };
  return q.data ? { id: q.data, state: 'found' as const, value } : { id: null, state: 'notFound' as const, value };
}

/** 접수 건 ID → 화면 번호(C-MMDD-일련, case 0.25.0 caseNumber). 상세와 같은 queryKey 라 상세로 가도 다시 읽지 않는다 */
export function useCaseNumber(caseId: string | null | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['cases', 'detail', caseId],
    enabled: Boolean(caseId),
    queryFn: () => request('GET', api.cases.GET('/cases/{caseId}', { params: { path: { caseId: caseId ?? '' } } })),
    select: (c) => c.caseNumber ?? null,
  });
}

/** 접수 건 화면 번호(C-1119-0042) */
export const isCaseNumber = (v: string) => /^C-\d{4}-\d{4,5}$/i.test(v.trim());
/** 접수 건 화면 번호 → 접수 건 ID. case 0.25.0 `GET /cases?caseNumber=` */
export async function caseIdOfNumber(api: ReturnType<typeof useApi>, caseNumber: string): Promise<string | null> {
  const r = await request('GET', api.cases.GET('/cases', { params: { query: { caseNumber: caseNumber.trim().toUpperCase(), size: 1 } } }));
  return r.items?.[0]?.caseId ?? null;
}
