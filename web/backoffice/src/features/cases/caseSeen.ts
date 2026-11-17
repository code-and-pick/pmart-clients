// 접수 건을 지금 봤음 — `POST /cases/{caseId}/views`(case 0.20.0 — 백엔드 요청 backoffice/2026-11-17-request-last-seen-and-badges §1).
// 본문·멱등 키 없음(서버는 늘 지금 시각, 더 늦은 것만 남김). 그 건을 볼 수 없으면 404.
// 실패해도 화면을 막지 않는다(사건함 점이 남을 뿐). 성공하면 사건함 목록을 다시 읽어 내 myLastSeenAt 을 받는다.
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { NO_IDEMPOTENCY_HEADER, request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';

export function useMarkCaseSeen(): (caseId: string) => void {
  const api = useApi();
  const queryClient = useQueryClient();
  return useCallback(
    (caseId: string) => {
      // 계약이 멱등 키를 받지 않는 변경 요청 — 공통 fetch 의 '키 없음' 표시를 붙인다(보내기 전에 지워진다)
      request('POST', api.cases.POST('/cases/{caseId}/views', { params: { path: { caseId } }, headers: { [NO_IDEMPOTENCY_HEADER]: '1' } }))
        .then(() => queryClient.invalidateQueries({ queryKey: ['cases'], exact: false, predicate: (q) => q.queryKey[1] !== 'detail' }))
        .catch(() => undefined);
    },
    [api, queryClient],
  );
}
