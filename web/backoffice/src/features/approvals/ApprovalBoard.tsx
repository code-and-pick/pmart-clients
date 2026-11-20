// 승인함 "보드로 보기"(2026-11-20) — 심사 상태(서버 reviewState)별 칸. 보기 전용, 카드를 누르면 상세에서 심사한다.
// "내가 올린 것"(requesterId = 나)·"모두"에서만 — "내가 심사할 것"은 늘 심사 기다림이라 칸이 하나뿐. 무엇을 승인(type) 거르기는 그대로 건다.
import { useQueries } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { REVIEW_STATES, type ApprovalType } from '../../api/models';
import { useApi } from '../../app/ApiContext';
import { ago } from '../../app/DashboardBoard';
import { hideIds } from '../../shared/hideIds';
import { KanbanBoard, type BoardColumn } from '../../shared/Kanban';
import { messages as m } from '../../shared/messages';
import { approvalNow, approvalWhat } from './ApprovalListPage';

export function ApprovalBoard({ requesterId, type }: { readonly requesterId?: string | undefined; readonly type?: ApprovalType | undefined }) {
  const api = useApi();
  const qs = useQueries({
    queries: REVIEW_STATES.map((reviewState) => ({
      queryKey: ['board', 'approval-state', reviewState, requesterId ?? '', type ?? ''],
      queryFn: () =>
        request('GET', api.approval.GET('/approvals', { params: { query: { reviewState, ...(requesterId ? { requesterId } : {}), ...(type ? { type } : {}), size: 50 } } })),
    })),
  });
  const columns: BoardColumn[] = REVIEW_STATES.map((st, i) => {
    const q = qs[i]!;
    return {
      id: st,
      title: m.approvals.inbox.state[st] ?? st,
      ...(st === 'REJECTED' ? { tone: 'error' as const } : st === 'REVIEW_PENDING' || st === 'EVIDENCE_REQUIRED' ? { tone: 'warning' as const } : {}),
      cards: q.data
        ? (q.data.items ?? []).map((a) => ({
            key: a.approvalId ?? '',
            to: `/approvals/${encodeURIComponent(a.approvalId ?? '')}`,
            tag: approvalWhat(a),
            title: hideIds(a.summary) || m.approvals.untitled,
            // 승인된 뒤 반영이 어디까지인지(서버 executionState)를 같은 말로
            status: st === 'APPROVED' || st === 'PARTIALLY_APPROVED' ? approvalNow(a) : undefined,
            meta: ago(a.submittedAt),
          }))
        : undefined,
      more: Boolean(q.data?.page?.nextCursor),
      isError: q.isError,
      onRetry: () => void q.refetch(),
    };
  });
  return (
    <div className="space-y-2">
      <p className="text-xs text-base-content/60">{m.board.note}</p>
      <KanbanBoard columns={columns} label={m.approvals.inbox.boardLabel} testId="approval-board" />
    </div>
  );
}
