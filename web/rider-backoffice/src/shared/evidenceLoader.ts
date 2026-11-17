// 배송 사진(execution `GET /deliveries/{deliveryId}/evidence-photos/{photoRef}`) 받기 — 도움요청·전달 완료 증빙·추가 배달료가 같이 쓴다.
import { useCallback } from 'react';

import { request } from '@pmart/web-core';
import { useApi } from '../app/ApiContext';
import type { PhotoLoader } from './AuthedPhotos';

export function useEvidenceLoader(deliveryId: string): PhotoLoader {
  const api = useApi();
  return useCallback(
    (photoRef: string) =>
      request('GET', api.execution.GET('/deliveries/{deliveryId}/evidence-photos/{photoRef}', { params: { path: { deliveryId, photoRef } }, parseAs: 'blob' })),
    [api, deliveryId],
  );
}