// 대시보드 "보드" 탭(2026-11-20 사용자 "칸반 보드로 대시보드는?" → "보드로 보기 탭"). 보기 전용.
// 칸은 "내 할 일" 숫자와 같은 서버 조회(메뉴 알림과 같은 조건)로만 나눈다 — 클라이언트가 새 판정을 만들지 않는다.
//   기한 넘김     = GET /cases?overdue=true            (서버 판정 overdue)
//   아무도 안 맡음 = GET /cases?unassigned=true         — 기한 넘긴 건은 "기한 넘김" 칸에만(서버 값 overdue 로 뺌)
//   내가 맡음     = GET /cases?assigneeId=나            — 처리 끝남(CLOSED)·기한 넘김은 뺌
//   답변 대기 문의 = GET /inquiries?status=RECEIVED     (고객·라이더 문의, 볼 수 있는 것만)
//   내가 심사할 승인 = GET /approvals?reviewState=REVIEW_PENDING&decidableByMe=true
// 50건 한 쪽만 — 다음 쪽이 있으면 "N+", 칸 아래 "목록에서 모두 보기".
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { useCenterScope } from '../shared/centerScope';
import { useApi } from './ApiContext';
import { useSession } from './SessionContext';
import { approvalWhat } from '../features/approvals/ApprovalListPage';
import { hideIds } from '../shared/hideIds';
import { KanbanBoard, type BoardCard, type BoardColumn } from '../shared/Kanban';
import { messages } from '../shared/messages';
import { caseSummaryText } from '../shared/blockReason';
import { label } from '../shared/ops';

const m = messages.dashboard.board;
const SIZE = 50;

export function ago(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(min)) return undefined;
  if (min < 1) return messages.approvals.ago.now;
  if (min < 60) return messages.approvals.ago.min(min);
  if (min < 60 * 24) return messages.approvals.ago.hour(Math.floor(min / 60));
  return messages.approvals.ago.day(Math.floor(min / (60 * 24)));
}

type CaseItem = { readonly caseId?: string; readonly caseNumber?: string | null; readonly summary?: string | null; readonly kind?: string | null; readonly openedAt?: string | null; readonly overdue?: boolean | null; readonly state?: string | null };

export const caseCard = (c: CaseItem): BoardCard => ({
  key: c.caseId ?? '',
  to: `/cases/${encodeURIComponent(c.caseId ?? '')}`,
  tag: label(messages.cases.kindName, c.kind ?? null),
  title: c.summary ? caseSummaryText(c.summary) : label(messages.cases.kindName, c.kind ?? null),
  sub: c.caseNumber ?? undefined,
  meta: ago(c.openedAt),
});

export function DashboardBoard({ cases, inquiries, riderInquiries, approvals }: { readonly cases: boolean; readonly inquiries: boolean; readonly riderInquiries: boolean; readonly approvals: boolean }) {
  const api = useApi();
  const me = useSession().session?.subject ?? null;
  const center = useCenterScope(); // 머리줄 센터 고르기(2026-11-23) — 접수 건 칸만(cases centerId). 문의·승인 칸은 센터 인자가 없다
  const caseQ = (key: string, query: Record<string, string | boolean | number>, enabled: boolean) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks -- 칸 수가 역할로 정해져 화면 안에서 바뀌지 않는다(같은 순서로 부른다)
    useQuery({ queryKey: ['board', 'cases', key, query, center], enabled, queryFn: () => request('GET', api.cases.GET('/cases', { params: { query: { ...query, ...(center ? { centerId: center } : {}), size: SIZE } } })) });
  const overdue = caseQ('overdue', { overdue: true }, cases);
  const unassigned = caseQ('unassigned', { unassigned: true }, cases);
  const mine = caseQ('mine', { assigneeId: me ?? '' }, cases && me !== null);
  const inq = useQuery({
    queryKey: ['board', 'inquiries', inquiries, riderInquiries],
    enabled: inquiries || riderInquiries,
    queryFn: async () => {
      const types = [...(inquiries ? ['CUSTOMER' as const] : []), ...(riderInquiries ? ['RIDER' as const] : [])];
      const rs = await Promise.all(types.map((requesterType) => request('GET', api.cases.GET('/inquiries', { params: { query: { requesterType, status: 'RECEIVED', size: SIZE } } }))));
      return { items: rs.flatMap((r) => r.items ?? []), more: rs.some((r) => Boolean(r.page?.nextCursor)) };
    },
  });
  const apv = useQuery({
    queryKey: ['board', 'approvals'],
    enabled: approvals,
    queryFn: () => request('GET', api.approval.GET('/approvals', { params: { query: { reviewState: 'REVIEW_PENDING', decidableByMe: true, size: SIZE } } })),
  });

  const fromCases = (q: typeof overdue, keep: (c: CaseItem) => boolean) => ({
    cards: q.data ? (q.data.items ?? []).filter(keep).map(caseCard) : undefined,
    more: Boolean(q.data?.page?.nextCursor),
    isError: q.isError,
    onRetry: () => void q.refetch(),
  });

  const columns: BoardColumn[] = [];
  if (cases) {
    columns.push({ id: 'overdue', title: m.overdue, tone: 'error', listTo: '/cases?tab=overdue', ...fromCases(overdue, () => true) });
    columns.push({ id: 'unassigned', title: m.unassigned, tone: 'warning', listTo: '/cases?tab=unassigned', ...fromCases(unassigned, (c) => !c.overdue) });
    columns.push({ id: 'mine', title: m.mine, listTo: '/cases?tab=mine', ...fromCases(mine, (c) => c.state !== 'CLOSED' && !c.overdue) });
  }
  if (inquiries || riderInquiries)
    columns.push({
      id: 'inquiries',
      title: m.inquiries,
      listTo: inquiries ? '/inquiries?status=RECEIVED' : '/rider-inquiries?status=RECEIVED',
      cards: inq.data?.items
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
        .map((x) => ({ key: x.inquiryId, to: `/inquiries/${encodeURIComponent(x.inquiryId)}`, tag: label(messages.inquiries.categoryName, x.category), title: x.title || label(messages.inquiries.categoryName, x.category), meta: ago(x.createdAt) })),
      more: inq.data?.more ?? false,
      isError: inq.isError,
      onRetry: () => void inq.refetch(),
    });
  if (approvals)
    columns.push({
      id: 'approvals',
      title: m.approvals,
      listTo: '/approvals',
      cards: apv.data ? (apv.data.items ?? []).map((a) => ({ key: a.approvalId ?? '', to: `/approvals/${encodeURIComponent(a.approvalId ?? '')}`, tag: approvalWhat(a), title: hideIds(a.summary) || messages.approvals.untitled, meta: ago(a.submittedAt) })) : undefined,
      more: Boolean(apv.data?.page?.nextCursor),
      isError: apv.isError,
      onRetry: () => void apv.refetch(),
    });

  return (
    <div className="space-y-2">
      <p className="text-xs text-base-content/60">{messages.board.note}</p>
      <KanbanBoard columns={columns} label={m.label} testId="dash-board" />
    </div>
  );
}
