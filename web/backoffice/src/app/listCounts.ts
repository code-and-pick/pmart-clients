// 목록 숫자 띠와 대시보드가 같이 쓰는 셈(2026-11-19 관제 형식 2단계) — 같은 조회 키·같은 기준이라 두 화면의 숫자가 어긋나지 않는다.
import { useQueries } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { APPROVAL_TYPES } from '../api/models';
import { useApi } from './ApiContext';

const APPROVAL_SIZE = 50;

/** 심사 대기 유형별(유형마다 같은 승인 목록 조회, 50 넘으면 more) — 대시보드 "심사 대기 유형별"과 같은 queryKey */
export function useApprovalTypeCounts() {
  const api = useApi();
  const qs = useQueries({
    queries: APPROVAL_TYPES.map((type) => ({
      queryKey: ['dashboard', 'approvals-by-type', type],
      refetchInterval: 60_000,
      queryFn: async () => {
        const r = await request('GET', api.approval.GET('/approvals', { params: { query: { type, reviewState: 'REVIEW_PENDING', size: APPROVAL_SIZE } } }));
        const n = (r.items ?? []).length;
        return { n, more: Boolean(r.page?.nextCursor) };
      },
    })),
  });
  return APPROVAL_TYPES.map((type, i) => ({ type, q: qs[i]! }));
}

/** 처리 대기 종류(운영 위험) — 결제 결과 불명은 STUCK_SAGA 에서 따로 */
interface PendingLike {
  readonly kind?: string | null;
  readonly reasonCode?: string | null;
}
export const PENDING_KINDS = [
  { id: 'payment', tone: 'error', match: (i: PendingLike) => i.kind === 'STUCK_SAGA' && i.reasonCode === 'PAYMENT_UNKNOWN' },
  { id: 'stuck', tone: 'warning', match: (i: PendingLike) => i.kind === 'STUCK_SAGA' && i.reasonCode !== 'PAYMENT_UNKNOWN' },
  { id: 'issue', tone: 'warning', match: (i: PendingLike) => i.kind === 'FULFILLMENT_ISSUE' },
  { id: 'handover', tone: 'warning', match: (i: PendingLike) => i.kind === 'MFC_HANDOVER_REJECTED' },
  { id: 'stop', tone: 'warning', match: (i: PendingLike) => i.kind === 'MFC_STOP_FAILED' },
] as const;
