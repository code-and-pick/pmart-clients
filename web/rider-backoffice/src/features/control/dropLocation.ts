// 직원용 전달지 — execution 0.24.0 `GET /deliveries/{deliveryId}/drop-location`(RIDER_OPS·OPERATOR_ADMIN, 백엔드 회신
// pmart-backend docs/handoff/clients/rider-backoffice/2026-11-18-reply-staff-drop-location.md).
// - 서버가 열람 기록(audit)을 남긴 뒤에만 주소를 준다 → 고른 라이더의 배송을 열 때 **한 번만**. 관제 10초 새로 고침·창 포커스·다시 마운트로
//   다시 부르지 않는다(staleTime Infinity). 화면을 떠나면 캐시도 바로 버린다(gcTime 0 — 주소를 메모리에 오래 두지 않음).
// - 주소는 로컬 저장·로그·분석 이벤트에 남기지 않는다. 409·404·403 은 다시 부르지 않고(retry 없음) 이유를 그대로 보인다.
import { useQueries, useQuery } from '@tanstack/react-query';

import { ProblemFailure, request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';

type Api = ReturnType<typeof useApi>;

const options = (api: Api, deliveryId: string) => ({
  queryKey: ['drop-location', deliveryId] as const,
  queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}/drop-location', { params: { path: { deliveryId } } })),
  staleTime: Infinity,
  gcTime: 0,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
});

export function useDropLocation(deliveryId: string) {
  const api = useApi();
  return useQuery(options(api, deliveryId));
}

/** 지도 경로용 — 상세 칸과 같은 캐시라 요청은 배송마다 한 번. */
export function useDropLocations(deliveryIds: readonly string[]) {
  const api = useApi();
  return useQueries({ queries: deliveryIds.map((id) => options(api, id)) });
}

export const dropMessages = {
  kind: { DELIVERY_DROP: '전달지', RETURN_PICKUP: '반품 회수지(고객 집)', REDELIVERY_DROP: '다시 배송할 곳(실제 집)' } as Readonly<Record<string, string>>,
  closed: '지금 단계에서는 전달지를 볼 수 없어요(배정 ~ 전달 전만).',
  noCustomerDrop: '고객 전달지가 없는 배송이에요(도착지 = MFC).',
  notFound: '주문 당시 배송지 기록이 없는 옛 주문이에요.',
  forbidden: '전달지는 라이더 운영·관리자만 볼 수 있어요.',
  unavailable: '열람 기록을 남기지 못해 주소를 받지 못했어요 — 잠시 뒤 다시 불러 주세요.',
  noPoint: '좌표가 없어 지도에는 표시하지 않아요.',
  logged: '열람 기록이 남아요',
  retry: '다시 불러오기',
} as const;

export type DropLocation = Awaited<ReturnType<ReturnType<typeof options>['queryFn']>>;

/** 실패를 화면 문구로. 모르는 실패는 null(공통 오류 표시로). */
export function dropFailureText(error: unknown): { readonly text: string; readonly retry: boolean } | null {
  if (!(error instanceof ProblemFailure)) return null;
  const { status, code } = error.problem;
  if (code === 'DROP_LOCATION_CLOSED') return { text: dropMessages.closed, retry: false };
  if (code === 'NO_CUSTOMER_DROP') return { text: dropMessages.noCustomerDrop, retry: false };
  if (code === 'DROP_INFO_NOT_FOUND') return { text: dropMessages.notFound, retry: false };
  if (status === 403) return { text: dropMessages.forbidden, retry: false };
  if (status === 503) return { text: dropMessages.unavailable, retry: true };
  return null;
}
