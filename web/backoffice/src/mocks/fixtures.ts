// 계약(backoffice-bff.yaml) 모양 픽스처. 계약에 없는 필드는 넣지 않는다.
import type { paths as CenterPaths } from '../api/generated/center-master';
import type { ApprovalInboxView } from '../api/views';

type CenterList = CenterPaths['/centers']['get']['responses']['200']['content']['application/json'];

/** 센터 목록(center-master-service `GET /centers`). 운영자 계정의 센터 선택에 쓴다. */
export const centerList: CenterList = {
  items: [
    { centerId: 'CDC01', type: 'CDC', name: '수도권 CDC', state: 'ACTIVE', address: '경기 이천시' },
    { centerId: 'MFC-BSN-01', type: 'MFC', name: '부산진구 MFC', state: 'ACTIVE', address: '부산 부산진구' },
    { centerId: 'MFC-SEL-01', type: 'MFC', name: '송파 MFC', state: 'PLANNED', address: '서울 송파구' },
  ],
  page: { nextCursor: null, size: 50 },
};

export const approvalInbox: ApprovalInboxView = {
  sources: [
    {
      system: 'approval-service',
      asOf: { asOf: '2026-10-24T06:00:00Z', freshness: 'CURRENT' },
      confidence: 'DIRECT',
    },
    {
      system: 'order-service',
      asOf: { asOf: '2026-10-24T05:58:00Z', freshness: 'STALE' },
      confidence: 'COPY',
    },
  ],
  unavailableSources: [],
  composedAt: '2026-10-24T06:00:01Z',
  items: [
    {
      dossierId: 'dos-mock-1',
      approvalId: 'dos-mock-1', // BR-40 회신: dossierId = approval-service 승인 ID(같은 값을 approvalId 로도 준다)
      approvalType: 'PRICE',
      summary: '기본가 변경 1건',
      requestState: 'SUBMITTED',
      reviewState: 'REVIEW_PENDING',
      executionState: 'NOT_REQUESTED',
      targetRef: 'price-version:E-00000001:12',
      expectedVersion: 12,
      requestedBy: 'op-mock-1',
      submittedAt: '2026-10-24T05:30:00Z',
    },
  ],
  page: { nextCursor: null, size: 50 },
};
