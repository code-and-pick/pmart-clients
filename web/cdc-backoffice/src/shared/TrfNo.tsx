// TRF 화면 번호(T+6) — 응답에 번호가 없는 곳(피킹 부족 등)에서 TRF 상세로 찾아 보인다(사용자 2026-11-27 "못 알아보게"·"긴 식별값은 간단한 번호로").
// 못 찾으면 짧은 표기(shortRef). 같은 TRF 는 5분 동안 다시 읽지 않는다.
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { useApi } from '../app/ApiContext';
import { shortRef } from './shortRef';

export function TrfNo({ cdcId, trfId }: { readonly cdcId: string; readonly trfId: string }) {
  const api = useApi();
  const q = useQuery({
    queryKey: ['cdc', cdcId, 'transfer', trfId],
    enabled: !!trfId,
    staleTime: 5 * 60_000,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/transfers/{trfId}', { params: { path: { cdcId, trfId } } })),
  });
  return <span title={trfId}>{q.data?.trfNumber ?? shortRef(trfId)}</span>;
}
