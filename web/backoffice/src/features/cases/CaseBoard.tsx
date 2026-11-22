// 접수 건 "보드로 보기"(2026-11-20) — 처리 단계(서버 상태 state)별 칸. 보기 전용, 카드를 누르면 상세에서 처리한다.
// 칸마다 GET /cases?state=…(&kind=…) 한 쪽(50건). 기한 넘김 표시는 서버 값 overdue.
import { useQueries } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { useCenterScope } from '../../shared/centerScope';
import { useApi } from '../../app/ApiContext';
import { caseCard } from '../../app/DashboardBoard';
import { KanbanBoard, type BoardColumn } from '../../shared/Kanban';
import { messages as m } from '../../shared/messages';
import type { components } from '../../api/generated/case';

type Kind = components['schemas']['CaseKind'];

// 일이 흘러가는 순서(case-service 상태표) — 처리 끝남은 맨 끝
const FLOW = ['OPEN', 'ASSIGNED', 'ACTION_PENDING', 'MONITORING', 'RESOLUTION_REVIEW', 'REOPENED', 'CLOSED'] as const;

export function CaseBoard({ kind }: { readonly kind?: Kind | undefined }) {
  const api = useApi();
  const centerId = useCenterScope(); // 머리줄 센터 고르기(2026-11-23)
  const qs = useQueries({
    queries: FLOW.map((state) => ({
      queryKey: ['board', 'case-state', state, kind ?? '', centerId],
      queryFn: () => request('GET', api.cases.GET('/cases', { params: { query: { state, ...(kind ? { kind } : {}), ...(centerId ? { centerId } : {}), size: 50 } } })),
    })),
  });
  const columns: BoardColumn[] = FLOW.map((state, i) => {
    const q = qs[i]!;
    return {
      id: state,
      title: m.cases.stateName[state] ?? state,
      cards: q.data ? (q.data.items ?? []).map((c) => ({ ...caseCard(c), ...(c.overdue ? { status: { text: m.cases.tabs.overdue, tone: 'error' as const } } : {}) })) : undefined,
      more: Boolean(q.data?.page?.nextCursor),
      isError: q.isError,
      onRetry: () => void q.refetch(),
    };
  });
  return (
    <div className="space-y-2">
      <p className="text-xs text-base-content/60">{m.board.note}</p>
      <KanbanBoard columns={columns} label={m.cases.boardLabel} testId="case-board" />
    </div>
  );
}
