// 고객센터 문의(상담원 CS_AGENT) — case-service 0.2.0 inquiries, 백엔드 요청 2026-11-09 customer-inquiry-page §2.
// 목록(GET /inquiries?status=) · 상세(GET /inquiries/{id}) · 답변(POST /inquiries/{id}/replies, X-Expected-Version = 문의 version).
// 권한은 서버 판정 — 조회는 CS_AGENT·OPERATOR_ADMIN, 답변은 CS_AGENT 만(case 0.4.2, 2026-11-16 사용자 (가)).
// 라이더 문의(case 0.13.0, requesterType=RIDER): 지원센터 메뉴 `/rider-inquiries` — 조회 RIDER_OPS·OPERATOR_ADMIN, 답변 RIDER_OPS 만.
// 두 메뉴가 같은 화면을 쓰고 목록은 `requesterType` 으로 서버에 거른다(관리자는 둘 다 보지만 메뉴별로 나뉘어 보인다).
// 답변 칸은 상담원에게만 그린다(편의 — 서버도 403). 답변은 접수 응대일 뿐 주문·환불을 바꾸지 않는다.
// 문의·답변 본문은 고객이 쓴 신뢰할 수 없는 텍스트 — 일반 텍스트로만 그린다. 로그에 남기지 않는다.
// 화면(2026-11-18 사용자 "밋밋하다 — 헬프데스크(Zendesk·Intercom)처럼"): 목록은 한 카드 안 상태 탭 → 표(제목 굵게·번호 작게·종류 색 꼬리표·"N분 전") → 아래 건수·더 보기.
// 상세는 왼쪽 대화(고객/라이더 말풍선 ↔ 답변 말풍선, 아래 답변 쓰기 카드), 오른쪽 정보 카드(문의 정보·고객/라이더·이어서 할 일·연락 기록). 동작은 그대로.
import { useNow } from '../../shared/motion';
import { QueueNav, useRememberQueue, useQueueBack } from '../../shared/workQueue';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState, uiStateFromError, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { CommandFeedback } from '../../shared/Feedback';
import { canSeeIntakes, CsIntakeLog } from '../csIntakes/CsIntakePages';
import { InquiryPhotos } from './InquiryPhotos';
import { ago, Avatar, Card, EmptyBox, Icon, ICON, MetaList } from './HelpdeskParts';
import { CodeLabel, DetailHeader, NextAction, StatusBadge, type Tone, StatCard, StatStrip, AllDone, ListHeader, listCount, refreshOf } from '../../shared/admin';
import { DisplayNumber, RiderLabel, SystemNumbers } from '../../shared/displayNumber';
import { useDeliveryNumber, useOrderNumbers, useRiderLabels } from '../../shared/numberLookups';
import { SavedViews } from '../../shared/SavedViews';
import { LeaveGuard } from '../../shared/LeaveGuard';
import { useRecordRecent } from '../../shared/recentViews';
import { TabCount } from '../../app/MenuAlerts';
import { PreviewDrawer, usePreview } from '../../shared/Preview';
import { CaseNumber } from '../../shared/CaseNumber';
import { StaffName } from '../lookup/parts';
import { messages as m } from '../../shared/messages';
import { MisdeliveryPanel } from './Misdelivery';

type Inquiry = components['schemas']['Inquiry'];
type InquirySummary = components['schemas']['InquirySummary'];
type InquiryStatus = components['schemas']['InquiryStatus'];
type RequesterType = components['schemas']['InquiryRequesterType'];

const basePath = (kind: RequesterType) => (kind === 'RIDER' ? '/rider-inquiries' : '/inquiries');

const STATUSES: readonly InquiryStatus[] = ['RECEIVED', 'ANSWERED', 'CLOSED'];
const MAX_REPLY = 4000; // 계약 replyInquiry body maxLength

const isStatus = (v: string | null): v is InquiryStatus => v !== null && (STATUSES as readonly string[]).includes(v);
/**
 * 미답변 기다린 시간(2026-11-19 쿠팡 윙 고객문의 "미답변 현황 24시간 이내·24~72시간·72시간~" 참고).
 * 서버 접수 시각(createdAt)에서 지금까지 — 표시용 묶음일 뿐 기한 판정이 아니다(기한·자격은 서버).
 */
type Wait = 'lt24' | 'h24to72' | 'gt72';
const WAITS: readonly Wait[] = ['lt24', 'h24to72', 'gt72'];
const isWait = (v: string | null): v is Wait => v !== null && (WAITS as readonly string[]).includes(v);
const HOUR = 3_600_000;
const waitOf = (createdAt: string, now: number): Wait | undefined => {
  const h = (now - Date.parse(createdAt)) / HOUR;
  if (!Number.isFinite(h)) return undefined;
  return h < 24 ? 'lt24' : h < 72 ? 'h24to72' : 'gt72';
};
/** 미답변 줄의 "N시간째 기다림" — 24시간 넘으면 주황, 72시간 넘으면 빨강 */
function WaitChip({ createdAt, now }: { readonly createdAt: string; readonly now: number }) {
  const h = Math.floor((now - Date.parse(createdAt)) / HOUR);
  if (!Number.isFinite(h) || h < 0) return null;
  const w = waitOf(createdAt, now);
  const tone = w === 'gt72' ? 'badge-error' : w === 'h24to72' ? 'badge-warning' : 'badge-ghost';
  return (
    <span className={`badge badge-soft badge-xs mt-1 ${tone}`} data-testid="inquiry-wait">
      {h < 24 ? m.inquiries.listView.waitHours(h) : m.inquiries.listView.waitDays(Math.floor(h / 24))}
    </span>
  );
}
/** 계약 밖 값은 지어내지 않고 원문 그대로 보인다. */
const label = (map: Readonly<Record<string, string>>, v: string | null | undefined) => (v ? (map[v] ?? v) : m.none);
/** 화면에 그리는 코드 값 — 한국어 이름(원래 코드는 마우스를 올리면), 값이 없으면 "—" */
const codeOf = (map: Readonly<Record<string, string>>, v: string | null | undefined) => (v ? <CodeLabel code={v} names={map} /> : m.none);
/** 상태 꼬리표 색(표시만) */
const statusTone = (s: string | undefined): Tone => (s === 'RECEIVED' ? 'warning' : s === 'ANSWERED' ? 'info' : 'ghost');

/** 문의 종류 꼬리표 색(표시만 — 모르는 값은 회색) */
const CATEGORY_STYLE: Readonly<Record<string, string>> = {
  ORDER: 'bg-info/10 text-info',
  DELIVERY: 'bg-accent/15 text-accent',
  PAYMENT: 'bg-warning/15 text-warning',
  REFUND: 'bg-error/10 text-error',
  PRODUCT: 'bg-secondary/10 text-secondary',
  ACCOUNT: 'bg-primary/10 text-primary',
  SETTLEMENT: 'bg-warning/15 text-warning',
  APP_ERROR: 'bg-error/10 text-error',
};

function CategoryTag({ value }: { readonly value: string | null | undefined }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${(value && CATEGORY_STYLE[value]) || 'bg-base-200 text-base-content/70'}`}>
      {codeOf(m.inquiries.categoryName, value)}
    </span>
  );
}

/** 시각 두 줄 — 위 "N분 전", 아래 정확한 시각 */
function Time({ iso }: { readonly iso: string | null | undefined }) {
  if (!iso) return <span className="text-base-content/40">{m.none}</span>;
  return (
    <>
      <p className="text-sm">{ago(iso)}</p>
      <p className="text-xs text-base-content/45">{formatSeoul(iso)}</p>
    </>
  );
}

/** 문의 목록(최근 접수 순). 상태 필터는 URL 쿼리(`?status=`)에 둔다 — 서버에 그대로 묻는다(화면에서 거르지 않는다). */
export function InquiryListPage({ kind = 'CUSTOMER' }: { readonly kind?: RequesterType }) {
  const api = useApi();
  // 미리보기 칸(2026-11-18) — 줄을 누르면 목록을 떠나지 않고 오른쪽에 문의·마지막 답변
  const pv = usePreview((id) => `${basePath(kind)}/${encodeURIComponent(id)}`);
  const rider = kind === 'RIDER';
  const [search, setSearch] = useSearchParams();
  const raw = search.get('status');
  const status = isStatus(raw) ? raw : undefined;

  const query = useInfiniteQuery({
    queryKey: ['inquiries', 'list', kind, status ?? 'ALL'],
    queryFn: ({ pageParam }) =>
      request(
        'GET',
        api.cases.GET('/inquiries', {
          params: { query: { requesterType: kind, ...(status ? { status } : {}), ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });
  const loaded: InquirySummary[] = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  // 기다린 시간 카드(미답변) — 접수 상태 첫 쪽으로 센다(넘치면 +). 누르면 wait= 로 그 묶음만(접수 탭에서)
  const now = useNow(60_000);
  const waitParam = search.get('wait');
  const wait = status === 'RECEIVED' && isWait(waitParam) ? waitParam : undefined;
  const items = wait ? loaded.filter((i) => waitOf(i.createdAt, now) === wait) : loaded;
  const open = useQuery({
    queryKey: ['inquiries', 'list', kind, 'RECEIVED', 'waits'],
    queryFn: () => request('GET', api.cases.GET('/inquiries', { params: { query: { requesterType: kind, status: 'RECEIVED' } } })),
  });
  const openItems = open.data?.items ?? [];
  const openMore = Boolean(open.data?.page?.nextCursor);
  const waitCount = (w: Wait) => (open.isPending ? '…' : open.isError ? '?' : `${openItems.filter((i) => waitOf(i.createdAt, now) === w).length}${openMore ? '+' : ''}`);
  const lv = m.inquiries.listView;
  // 상세에서 이전·다음으로 넘기도록 지금 목록 순서를 기억(2026-11-19)
  useRememberQueue(rider ? 'riderInquiry' : 'inquiry', query.data ? items.map((i) => i.inquiryId) : undefined, `${basePath(kind)}?${search.toString()}`);
  const tabs: ReadonlyArray<{ readonly value: InquiryStatus | ''; readonly label: string }> = [
    { value: '', label: m.inquiries.all },
    ...STATUSES.map((st) => ({ value: st, label: m.inquiries.status[st] ?? st })),
  ];

  return (
    <section className="space-y-4">
      <ListHeader title={rider ? m.inquiries.riderTitle : m.inquiries.title} count={listCount(query)} refresh={refreshOf(query)} />
      {/* 2026-11-19 쿠팡 윙 고객문의 참고: 안내 상자 → 미답변 현황(기다린 시간) 카드 → 상태 탭·목록 */}
      <section aria-label={lv.waitsLabel} className="space-y-1.5">
        <h2 className="text-sm font-bold">{lv.waitsLabel}</h2>
        <StatStrip label={lv.waitsLabel} testId="inquiry-waits">
          {WAITS.map((w) => {
            const v = waitCount(w);
            const has = /^[1-9]/.test(v);
            return (
              <StatCard
                key={w}
                layout="row"
                label={lv.wait[w]}
                value={v}
                tone={has ? (w === 'gt72' ? 'error' : w === 'h24to72' ? 'warning' : 'info') : undefined}
                to={`${basePath(kind)}?status=RECEIVED&wait=${w}`}
                active={wait === w}
                testId={`inquiry-wait-${w}`}
              />
            );
          })}
        </StatStrip>
      </section>
      {/* 내 보기(2026-11-18 Saleor 참고) — 지금 주소 조건을 이름 붙여 저장 */}
      <SavedViews listKey={rider ? 'rider-inquiries' : 'inquiries'} />
      <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm" data-testid="inquiry-list-card">
        {/* 상태 탭(밑줄) — 누르면 바로 서버에 묻는다(URL ?status=) */}
        <div role="radiogroup" aria-label={m.inquiries.statusFilter} className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-base-300 px-3">
          {tabs.map((t) => {
            const on = (status ?? '') === t.value;
            return (
              <button
                key={t.value || 'all'}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setSearch(t.value ? { status: t.value } : {})}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${on ? 'border-primary font-semibold text-base-content' : 'border-transparent text-base-content/55 hover:text-base-content'}`}
              >
                {t.label}
                {/* 접수 탭 옆 개수(2026-11-18) — 메뉴 알림과 같은 조회 */}
                {t.value === 'RECEIVED' && <span className="ml-1.5"><TabCount alert={rider ? 'riderInquiries' : 'inquiries'} /></span>}
              </button>
            );
          })}
        </div>

        {query.isPending ? (
          <div className="p-4">
            <QueryState state={{ kind: 'loading' }}>{() => null}</QueryState>
          </div>
        ) : query.isError && items.length === 0 ? (
          // 조회 실패(403 포함)는 "문의 없음"이 아니라 오류로 보인다.
          <div className="p-4">
            <QueryState state={uiStateFromError(query.error)} onRetry={() => void query.refetch()}>
              {() => null}
            </QueryState>
          </div>
        ) : items.length === 0 && status === 'RECEIVED' && !wait && query.isSuccess ? (
          // 미답변이 서버 0건이면 "다 답했어요"(2026-11-19)
          <div className="p-4">
            <AllDone title={m.allDone.inquiries} body={m.allDone.inquiriesBody} testId="inquiries-all-done" />
          </div>
        ) : items.length === 0 ? (
          <EmptyBox icon={ICON.inbox} hint={m.inquiries.emptyHint}>
            {m.inquiries.empty}
          </EmptyBox>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table [&_tbody_tr:hover]:bg-base-200/60 [&_tbody_tr]:border-base-300/70 [&_thead_th]:text-xs [&_thead_th]:font-medium [&_thead_th]:text-base-content/50">
                <thead>
                  <tr>
                    <th>{m.inquiries.subject}</th>
                    <th>{m.inquiries.category}</th>
                    <th>{m.inquiries.statusLabel}</th>
                    <th className="text-right">{m.inquiries.createdAt}</th>
                    <th className="text-right">{m.inquiries.answeredAt}</th>
                    {/* 마지막으로 답한 직원(case 0.36.0, 2026-11-23) — 답 없으면 "-" */}
                    <th>{m.inquiries.lastAnsweredBy}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.inquiryId} data-testid="inquiry-row" {...pv.row(i.inquiryId)}>
                      <td className="max-w-xl">
                        {/* 제목 없는 문의는 "-" 한 글자 대신 흐린 "제목 없는 문의"(2026-11-20 화면 점검) */}
                        {i.title?.trim() ? (
                          <p className="truncate font-medium" title={i.title}>
                            {i.title}
                          </p>
                        ) : (
                          <p className="truncate font-medium text-base-content/45" data-testid="inquiry-untitled">
                            {m.inquiries.untitled}
                          </p>
                        )}
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs text-base-content/50" data-testid="inquiry-number">
                            {i.inquiryNumber ?? m.displayNumber.missing}
                          </span>
                          {i.origin === 'ASSISTANT_HANDOFF' && <span className="badge badge-ghost badge-xs">{m.inquiries.fromAssistant}</span>}
                          {i.origin === 'STAFF_INTAKE' && (
                            <span className="badge badge-ghost badge-xs" data-testid="inquiry-channel">{m.inquiries.fromStaff} · {codeOf(m.csIntake.channelName, i.channel)}</span>
                          )}
                          {i.callerRelation === 'PROXY' && <span className="badge badge-warning badge-soft badge-xs">{m.inquiries.proxy}</span>}
                          {i.deliveryIssue && (
                            <span className="badge badge-error badge-soft badge-xs" data-testid="inquiry-delivery-issue">{m.inquiries.deliveryIssue} · {codeOf(m.inquiries.deliveryIssueName, i.deliveryIssue)}</span>
                          )}
                          {/* 오배송 선택(case 0.39.0) — 선택 대기면 기한까지 */}
                          {i.misdeliveryState && (
                            <span className={`badge badge-soft badge-xs ${i.misdeliveryState === 'AWAITING_CHOICE' ? 'badge-warning' : 'badge-success'}`} data-testid="inquiry-misdelivery">
                              {i.misdeliveryState === 'AWAITING_CHOICE' ? m.inquiries.misdelivery.badgeWaiting : m.inquiries.misdelivery.badgeChosen}
                              {i.misdeliveryState === 'AWAITING_CHOICE' && i.misdeliveryDeadlineAt ? ` · ${formatSeoul(i.misdeliveryDeadlineAt)}까지` : ''}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <CategoryTag value={i.category} />
                      </td>
                      <td>
                        <StatusBadge tone={statusTone(i.status)}>{codeOf(m.inquiries.status, i.status)}</StatusBadge>
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <Time iso={i.createdAt} />
                        {/* 아직 답하지 않은 문의는 기다린 시간(2026-11-19) */}
                        {i.status === 'RECEIVED' && (
                          <span className="block">
                            <WaitChip createdAt={i.createdAt} now={now} />
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <Time iso={i.answeredAt} />
                      </td>
                      <td className="whitespace-nowrap" data-testid="inquiry-answered-by">
                        <StaffName id={i.lastAnsweredBy} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pv.id && (
              <PreviewDrawer
                id={pv.id}
                ids={items.map((i) => i.inquiryId)}
                onMove={pv.open}
                onClose={pv.close}
                title={items.find((i) => i.inquiryId === pv.id)?.title ?? m.inquiries.untitled}
                detailTo={`${basePath(kind)}/${encodeURIComponent(pv.id)}`}
              >
                <InquiryPreview inquiryId={pv.id} />
              </PreviewDrawer>
            )}
            {/* 아래: 받은 건수 · 더 보기. 다음 쪽을 못 읽으면 받은 줄은 두고 경고만 */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-base-300 px-4 py-3 text-sm">
              <span className="text-base-content/55" data-testid="result-count">
                {m.inquiries.shown(items.length, query.hasNextPage)}
              </span>
              {query.isFetchNextPageError && <span className="text-error">{m.inquiries.moreFailed}</span>}
              {query.hasNextPage && (
                <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                  {m.inquiries.more}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** 문의 미리보기 — 상세와 같은 조회 키. 답변 쓰기·닫기는 상세에서 */
function InquiryPreview({ inquiryId }: { readonly inquiryId: string }) {
  const api = useApi();
  const q = useQuery({
    queryKey: ['inquiries', 'detail', inquiryId],
    queryFn: () => request('GET', api.cases.GET('/inquiries/{inquiryId}', { params: { path: { inquiryId } } })),
  });
  return (
    <QueryState state={toUiState(q)} onRetry={() => void q.refetch()}>
      {(d) => {
        const last = d.replies.at(-1);
        return (
          <div className="space-y-4" data-testid="inquiry-preview">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={statusTone(d.status)}>{codeOf(m.inquiries.status, d.status)}</StatusBadge>
              <CategoryTag value={d.category} />
            </div>
            <p className="text-xs text-base-content/55">{`${m.inquiries.requesterName[d.requesterType ?? 'CUSTOMER'] ?? ''} · ${formatSeoul(d.createdAt)}`}</p>
            <p className="line-clamp-6 whitespace-pre-wrap rounded-box bg-base-200/60 px-3 py-2 text-sm">{d.body}</p>
            <div className="text-sm">
              <p className="mb-1 text-xs font-semibold text-base-content/60">{m.inquiries.previewReplies(d.replies.length)}</p>
              {last ? (
                <div className="rounded-box border border-base-300 px-3 py-2">
                  <p className="text-xs text-base-content/50">{`${last.authorType === 'RIDER' ? m.inquiries.fromRider : m.inquiries.fromStaffReply} · ${last.createdAt ? formatSeoul(last.createdAt) : ''}`}</p>
                  <p className="line-clamp-4 whitespace-pre-wrap">{last.body}</p>
                </div>
              ) : (
                <p className="text-base-content/50">{m.inquiries.previewNoReply}</p>
              )}
            </div>
          </div>
        );
      }}
    </QueryState>
  );
}

/** 대화 아래 답변 쓰기 카드 */
function ReplyForm({ inquiry }: { readonly inquiry: Inquiry }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');

  const reply = useCommand(async ({ text, version }: { text: string; version: number }, key) => {
    try {
      const updated = await request(
        'POST',
        api.cases.POST('/inquiries/{inquiryId}/replies', {
          ...commandParams(key, { path: { inquiryId: inquiry.inquiryId }, version }),
          body: { body: text },
        }),
      );
      queryClient.setQueryData(['inquiries', 'detail', inquiry.inquiryId], updated);
      setBody('');
      return updated;
    } finally {
      // 거절(버전 충돌·닫힘)이어도 문의가 바뀌었을 수 있다 — 새로 읽는다.
      void queryClient.invalidateQueries({ queryKey: ['inquiries'] });
    }
  });

  const trimmed = body.trim();
  const locked = reply.busy; // 진행 중·결과 불명이면 본문을 바꾸지 않는다(같은 키 재확인만)
  if (inquiry.status === 'CLOSED')
    return (
      <p className="flex items-center gap-2 rounded-box bg-base-200 px-4 py-3 text-sm text-base-content/70">
        <Icon d={ICON.check} />
        {m.inquiries.closedNote}
      </p>
    );

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed && !locked) void reply.run({ text: trimmed, version: inquiry.version });
      }}
    >
      {/* 떠날 때 경고(2026-11-18): 답변을 쓰다 만 채로 나갈 때 — 보내면 칸이 비워져 풀린다 */}
      <LeaveGuard when={trimmed !== ''} />
      <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 focus-within:border-primary">
        <label className="block">
          <span className="flex items-center gap-2 border-b border-base-200 px-3 py-2 text-xs font-semibold text-base-content/60">
            <Icon d={ICON.chat} className="h-3.5 w-3.5" />
            {m.inquiries.replyLabel}
          </span>
          <textarea
            className="block min-h-28 w-full resize-y bg-transparent px-3 py-2 text-sm outline-none disabled:opacity-60"
            rows={4}
            maxLength={MAX_REPLY}
            value={body}
            disabled={locked}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3 border-t border-base-200 bg-base-200/40 px-3 py-2">
          <p className="min-w-0 flex-1 text-xs text-base-content/60">
            {inquiry.requesterType === 'RIDER' ? m.inquiries.riderReplyNote : inquiry.origin === 'STAFF_INTAKE' ? m.inquiries.replyNoteStaff : m.inquiries.replyNote}
          </p>
          <span className="text-xs tabular-nums text-base-content/50">{`${body.length} / ${MAX_REPLY}`}</span>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!trimmed || locked}>
            {m.inquiries.replySend}
          </button>
        </div>
      </div>
      <CommandFeedback command={reply} unknown={{ body: m.inquiries.replyUnknown }}>
        {() => (
          <p role="status" className="text-sm text-success">
            {m.inquiries.replySent}
          </p>
        )}
      </CommandFeedback>
    </form>
  );
}

/**
 * 문의 닫기(case 0.19.0 — 백엔드 요청 all/2026-11-17-request-inquiry-close, 사용자 "다시 열기는 빼고").
 * 답변 역할 직원만(고객 문의 CS_AGENT, 라이더 문의 RIDER_OPS — 관리자는 보기만 403). 사유 필수 2~500자, 직원에게만 보인다.
 * 다시 열기·자동 닫기 없음, 상담 종료는 거래 종결이 아니다(주문·클레임 그대로). 닫으면 답변·사진 보완이 막힌다(409 INQUIRY_CLOSED).
 */
function CloseForm({ inquiry }: { readonly inquiry: Inquiry }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const close = useCommand(async (r: string, key) => {
    try {
      const updated = await request(
        'POST',
        api.cases.POST('/inquiries/{inquiryId}/closures', { ...commandParams(key, { path: { inquiryId: inquiry.inquiryId } }), body: { reason: r } }),
      );
      queryClient.setQueryData(['inquiries', 'detail', inquiry.inquiryId], updated);
      return updated;
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['inquiries'] });
    }
  });
  const ok = reason.trim().length >= 2 && reason.trim().length <= 500;
  if (!open)
    return (
      <button type="button" className="btn btn-outline btn-sm w-full" onClick={() => setOpen(true)}>
        {m.inquiries.close}
      </button>
    );
  return (
    <form
      className="space-y-2 rounded-box border border-warning/40 bg-warning/5 p-3"
      aria-label={m.inquiries.close}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok || close.busy) return;
        if (close.phase.kind === 'rejected') close.reset();
        void close.run(reason.trim());
      }}
    >
      <p role="note" className="text-xs text-warning">
        {m.inquiries.closeWarn}
      </p>
      <label className="flex flex-col gap-1 text-sm">
        {m.inquiries.closeReason}
        <textarea className="textarea textarea-sm w-full" maxLength={500} value={reason} disabled={close.busy} onChange={(e) => setReason(e.target.value)} />
      </label>
      <p className="text-xs opacity-70">{m.inquiries.closeReasonHint}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-sm" disabled={close.busy} onClick={() => setOpen(false)}>
          {m.inquiries.closeCancel}
        </button>
        <button type="submit" className="btn btn-warning btn-sm" disabled={!ok || close.busy}>
          {m.inquiries.closeSubmit}
        </button>
      </div>
      <CommandFeedback command={close}>{() => <p role="status" className="text-sm text-success">{m.inquiries.closed}</p>}</CommandFeedback>
    </form>
  );
}

/** 대화 말풍선 하나 — 문의한 쪽(고객·라이더)은 왼쪽, 답변(직원)은 오른쪽 */
function Bubble({ mine, who, at, children, testId, author }: {
  readonly mine: boolean;
  readonly who: string;
  readonly at: string | null | undefined;
  readonly children: ReactNode;
  readonly testId?: string;
  readonly author?: string;
}) {
  return (
    <li className={`flex gap-3 ${mine ? 'flex-row-reverse' : ''}`} data-testid={testId} data-author={author}>
      <Avatar letter={who.charAt(0)} tone={mine ? 'primary' : 'neutral'} />
      <div className={`min-w-0 max-w-[85%] space-y-1 ${mine ? 'items-end text-right' : ''}`}>
        <p className="text-xs text-base-content/55">
          <span className="font-semibold text-base-content/80">{who}</span>
          <span className="mx-1.5 text-base-content/30">·</span>
          {at ? formatSeoul(at) : m.none}
        </p>
        <div className={`rounded-2xl px-4 py-3 text-left text-sm ${mine ? 'rounded-tr-sm bg-primary/10' : 'rounded-tl-sm border border-base-300 bg-base-200/60'}`}>{children}</div>
      </div>
    </li>
  );
}

/**
 * 맨 위 "다음 할 일" 하나 — 화면이 이미 읽은 문의 상태·마지막 대화·역할로만 고른다(새 규칙·새 조회 없음, 판정은 서버).
 * 종료 → 없음 / 답변 역할 아님 → 보기만 / 접수(라이더가 이어 씀) → 다시 답변 / 접수 → 답변 쓰기 / 답변 완료 → 확인 기다림.
 */
function InquiryNextAction({ q, canReply }: { readonly q: Inquiry; readonly canReply: boolean }) {
  const n = m.inquiries.next;
  const rider = q.requesterType === 'RIDER';
  if (q.status === 'CLOSED') return null;
  if (!canReply) return <NextAction tone="info" title={n.readOnly} body={rider ? m.inquiries.riderReadOnly : m.inquiries.readOnly} testId="inquiry-read-only" />;
  const toReply = (
    <a href="#inquiry-reply-box" className="btn btn-primary btn-sm">
      {n.toReply}
    </a>
  );
  if (q.status === 'RECEIVED' && q.replies.at(-1)?.authorType === 'RIDER')
    return (
      <NextAction tone="warning" title={n.riderAgain} body={m.inquiries.riderFollowUp} testId="inquiry-rider-followup">
        {toReply}
      </NextAction>
    );
  if (q.status === 'RECEIVED')
    return (
      <NextAction tone="warning" title={n.reply} body={n.replyBody[q.origin === 'STAFF_INTAKE' ? 'STAFF' : rider ? 'RIDER' : 'CUSTOMER']}>
        {toReply}
      </NextAction>
    );
  // 답한 뒤에는 다음 답변 대기 문의로 바로(2026-11-18 작업 따라 해 보기 — 목록으로 돌아가 다시 찾아야 했다)
  if (q.status === 'ANSWERED')
    return (
      <NextAction tone="info" title={n.waiting[rider ? 'RIDER' : 'CUSTOMER']} body={n.waitingBody}>
        <Link className="btn btn-primary btn-sm" to={`${rider ? '/rider-inquiries' : '/inquiries'}?status=RECEIVED`}>
          {n.nextOne}
        </Link>
      </NextAction>
    );
  return null;
}

/** 문의 상세 + 답변. */
export function InquiryDetailPage({ kind = 'CUSTOMER' }: { readonly kind?: RequesterType }) {
  const { inquiryId = '' } = useParams();
  const api = useApi();
  const { session } = useSession();
  const roles = session?.roles ?? [];
  // 답변 역할은 문의 종류별(case 0.13.0) — 라이더 문의 RIDER_OPS, 고객 문의 CS_AGENT. 판정은 서버(403).
  const canReplyTo = (q: Inquiry) => roles.includes(q.requesterType === 'RIDER' ? 'RIDER_OPS' : 'CS_AGENT');
  const query = useQuery({
    queryKey: ['inquiries', 'detail', inquiryId],
    queryFn: () => request('GET', api.cases.GET('/inquiries/{inquiryId}', { params: { path: { inquiryId } } })),
  });
  // 화면 번호(ADR-0070, 2026-11-18): 문의 응답엔 번호가 없어 라이더·주문·배송 조회로 붙인다(같은 값은 캐시)
  const riders = useRiderLabels([query.data?.riderId]);
  const orders = useOrderNumbers([query.data?.orderId]);
  const delivery = useDeliveryNumber(query.data?.deliveryId);
  // 고객 문의 대화(case 0.39.0 /messages — 고객 이어 쓰기·시스템 안내 포함). 라이더 문의·상담원 접수는 예전처럼 답변 목록
  const useThread = !!query.data && query.data.requesterType !== 'RIDER' && query.data.origin !== 'STAFF_INTAKE';
  const thread = useQuery({
    queryKey: ['inquiries', 'messages', inquiryId, query.data?.version],
    enabled: useThread,
    retry: false,
    queryFn: () => request('GET', api.cases.GET('/inquiries/{inquiryId}/messages', { params: { path: { inquiryId } } })),
  });

  // 최근 본 항목(2026-11-18) — 서버 응답을 받은 뒤에만 남긴다
  // 최근 본 항목 이름(2026-11-19 — 시스템 ID 를 이름으로 남기던 것 고침, ADR-0070 덧붙임) — 문의는 분류
  const back = useQueueBack(kind === 'RIDER' ? 'riderInquiry' : 'inquiry', inquiryId, { to: basePath(kind), label: kind === 'RIDER' ? m.inquiries.riderBack : m.inquiries.back });
  useRecordRecent(kind === 'RIDER' ? 'riderInquiry' : 'inquiry', inquiryId, query.data ? `${m.inquiries.categoryName[query.data.category] ?? query.data.category} 문의` : null); // 제목은 고객이 쓴 글이라(개인정보가 있을 수 있어) 분류만
  return (
    <section className="space-y-4">
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(q) => {
          const riderAsk = q.requesterType === 'RIDER';
          const asker = label(m.inquiries.requesterName, q.requesterType ?? 'CUSTOMER');
          return (
            <>
              <DetailHeader
                back={back}
                // 시스템 번호·이전/다음은 뒤로 가기 줄 오른쪽에(2026-11-23 사용자 "복잡하게 해놨네" — 따로 두 줄 차지하던 것)
                nav={<><SystemNumbers ids={[{ label: m.inquiries.customer, id: query.data?.customerId }]} /> <QueueNav kind={kind === 'RIDER' ? 'riderInquiry' : 'inquiry'} id={inquiryId} /></>}
                // 제목은 문의 제목(번호는 아래 줄에 작게) — 2026-11-18 "직관적이지 않다"
                title={q.title ?? m.inquiries.untitled}
                badges={
                  <>
                    <StatusBadge tone={statusTone(q.status)}>{codeOf(m.inquiries.status, q.status)}</StatusBadge>
                    <CategoryTag value={q.category} />
                  </>
                }
                summary={
                  <>
                    <span className="font-mono text-xs text-base-content/55" title={m.inquiries.id} data-testid="inquiry-number">
                      {q.inquiryNumber ?? m.displayNumber.missing}
                    </span>
                    {` · ${asker} · ${formatSeoul(q.createdAt)}`}
                  </>
                }
              />

              <InquiryNextAction q={q} canReply={canReplyTo(q)} />

              {/* 오배송 처리(case 0.39.0 R-16) — 서버가 오배송 접수 건을 연 고객 문의만 */}
              <MisdeliveryPanel q={q} canChoose={roles.includes('CS_AGENT') || roles.includes('OPERATOR_ADMIN')} />

              <div className="grid items-start gap-4 lg:grid-cols-3 [&>*]:min-w-0">
                {/* 왼쪽: 대화 + 답변 쓰기 */}
                <div className="space-y-4 lg:col-span-2">
                  {q.callerRelation === 'PROXY' && (
                    <p role="alert" className="alert alert-warning alert-soft text-sm" data-testid="inquiry-proxy-warning">
                      {m.inquiries.proxyWarning}
                    </p>
                  )}
                  {q.origin === 'STAFF_INTAKE' && (
                    <p className="flex items-start gap-2 rounded-box bg-info/10 px-4 py-3 text-sm text-base-content/80">
                      <Icon d={ICON.phone} className="mt-0.5 h-4 w-4 text-info" />
                      <span>{m.inquiries.staffNote}</span>
                    </p>
                  )}

                  {/* case 0.21.0: 라이더 문의는 대화 — replies 에 라이더가 이어 쓴 줄(authorType RIDER)이 섞인다. 보낸 쪽으로 나눠 그린다(라이더 메시지를 답변처럼 보이지 않게) */}
                  <Card title={riderAsk ? m.inquiries.conversation : m.inquiries.replies} icon={ICON.chat} bodyClass="space-y-5 px-4 py-5 sm:px-5">
                    <ul className="space-y-5">
                      {/* 처음 문의(제목·본문·사진) */}
                      <Bubble mine={false} who={asker} at={q.createdAt}>
                        <p className="mb-1 font-semibold">{q.title ?? m.inquiries.sectionBody}</p>
                        <p className="whitespace-pre-wrap break-words" data-testid="inquiry-body">
                          {q.body}
                        </p>
                        {/* 문의 사진(case 0.14.0) — 고객·라이더가 붙인 것. 상담원 접수 문의에는 없다 */}
                        <InquiryPhotos photos={q.photos} />
                      </Bubble>
                      {/* 고객 문의 대화(case 0.39.0): 고객이 이어 쓴 말·시스템 안내(오배송 선택)는 /messages 에만 있다 — 읽히면 그것으로, 못 읽으면 예전처럼 답변 목록 */}
                      {thread.data ? (
                        thread.data.items.map((msg) =>
                          msg.senderType === 'SYSTEM' ? (
                            <li key={msg.messageId} className="flex justify-center" data-testid="inquiry-system-message">
                              <div className="max-w-[90%] rounded-box border border-dashed border-base-300 bg-base-200/40 px-3 py-2 text-xs text-base-content/70">
                                <p className="mb-0.5 font-semibold">{m.inquiries.misdelivery.systemKind[msg.systemKind ?? ''] ?? m.inquiries.misdelivery.systemName} · {formatSeoul(msg.createdAt)}</p>
                                <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                              </div>
                            </li>
                          ) : (
                            <Bubble
                              key={msg.messageId}
                              mine={msg.senderType === 'SUPPORT'}
                              who={msg.senderType === 'SUPPORT' ? m.inquiries.fromStaffReply : msg.senderType === 'RIDER' ? m.inquiries.fromRider : m.inquiries.misdelivery.fromCustomer}
                              at={msg.createdAt}
                              testId={msg.senderType === 'SUPPORT' ? 'inquiry-reply' : 'inquiry-message'}
                              author={msg.senderType === 'SUPPORT' ? 'AGENT' : msg.senderType}
                            >
                              <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                            </Bubble>
                          ),
                        )
                      ) : q.replies.map((r, i) => {
                        const fromRider = r.authorType === 'RIDER';
                        return (
                          <Bubble
                            key={r.replyId ?? `reply-${i}`}
                            mine={!fromRider}
                            who={fromRider ? m.inquiries.fromRider : m.inquiries.fromStaffReply}
                            at={r.createdAt}
                            testId="inquiry-reply"
                            author={r.authorType ?? 'AGENT'}
                          >
                            <p className="whitespace-pre-wrap break-words">{r.body ?? ''}</p>
                          </Bubble>
                        );
                      })}
                    </ul>
                    {(thread.data ? thread.data.items.length === 0 : q.replies.length === 0) && (
                      <p className="flex items-center gap-3 text-xs text-base-content/50">
                        <span className="h-px flex-1 bg-base-300" />
                        {m.inquiries.noReplies}
                        <span className="h-px flex-1 bg-base-300" />
                      </p>
                    )}
                    {/* 답변 쓰기 — 답변 역할만(보기만·라이더 이어 쓰기 안내는 맨 위 "다음 할 일") */}
                    {canReplyTo(q) && (
                      <div className="scroll-mt-4 border-t border-base-200 pt-4" id="inquiry-reply-box">
                        <ReplyForm key={q.inquiryId} inquiry={q} />
                      </div>
                    )}
                  </Card>
                </div>

                {/* 오른쪽: 정보 카드 */}
                <aside className="space-y-4">
                  <Card title={m.inquiries.sectionInfo} icon={ICON.note}>
                    <MetaList
                      rows={[
                        [m.inquiries.statusLabel, codeOf(m.inquiries.status, q.status), 'inquiry-status'],
                        [m.inquiries.category, codeOf(m.inquiries.categoryName, q.category)],
                        [m.inquiries.requester, asker, 'inquiry-requester'],
                        [m.inquiries.origin, codeOf(m.inquiries.originName, q.origin)],
                        q.channel
                          ? [
                              m.inquiries.channel,
                              <>
                                {codeOf(m.csIntake.channelName, q.channel)}
                                {q.callerRelation && <> · {codeOf(m.csIntake.relationName, q.callerRelation)}</>}
                              </>,
                            ]
                          : null,
                        [m.inquiries.createdAt, formatSeoul(q.createdAt)],
                        // 닫힘(case 0.19.0) — 닫은 쪽·시각, 직원이 닫았으면 사유(직원에게만 온다)
                        q.status === 'CLOSED'
                          ? [
                              m.inquiries.closedLabel,
                              <>
                                {codeOf(m.inquiries.closedByName, q.closedByType)}
                                {q.closedAt && ` · ${formatSeoul(q.closedAt)}`}
                                {q.closeReason && <span className="block whitespace-pre-wrap text-base-content/70">{q.closeReason}</span>}
                              </>,
                              'inquiry-closed',
                            ]
                          : null,
                        // 만족도(case 0.15.0) — 서버가 관리자에게만 준다. 상담원 화면에는 없다
                        q.satisfaction
                          ? [
                              m.inquiries.satisfaction,
                              <>
                                {m.inquiries.satisfactionLine(q.satisfaction.score, formatSeoul(q.satisfaction.ratedAt))}
                                {q.satisfaction.comment && <span className="block whitespace-pre-wrap text-base-content/70">{q.satisfaction.comment}</span>}
                              </>,
                              'inquiry-satisfaction',
                            ]
                          : null,
                        [m.inquiries.caseId, <Link key="c" className="link text-sm" to={`/cases/${encodeURIComponent(q.caseId)}`}><CaseNumber caseId={q.caseId} /></Link>],
                      ]}
                    />
                  </Card>

                  {riderAsk ? (
                    <Card title={m.inquiries.sectionRider} icon={ICON.user}>
                      <MetaList
                        rows={[
                          [
                            m.inquiries.rider,
                            q.riderId ? (
                              <Link className="link link-primary text-xs" to={`/riders/${encodeURIComponent(q.riderId)}`} data-testid="inquiry-rider">
                                <RiderLabel rider={riders.get(q.riderId)} riderId={q.riderId} failed={riders.failed} />
                              </Link>
                            ) : (
                              m.none
                            ),
                          ],
                        ]}
                      />
                    </Card>
                  ) : (
                    <Card title={m.inquiries.sectionCustomer} icon={ICON.bag}>
                      <MetaList
                        rows={[
                          [
                            m.inquiries.order,
                            q.orderId ? (
                              <Link className="text-xs hover:text-primary hover:underline" to={`/orders/${encodeURIComponent(q.orderId)}`} data-testid="inquiry-order">
                                <DisplayNumber number={orders.get(q.orderId)} systemId={q.orderId} failed={orders.failed(q.orderId)} />
                              </Link>
                            ) : (
                              m.none
                            ),
                          ],
                          // 배송 신고(case 0.16.0) — 고객 배송 분류 + 주문 문의에만
                          q.deliveryIssue
                            ? [
                                m.inquiries.deliveryIssue,
                                <>
                                  {codeOf(m.inquiries.deliveryIssueName, q.deliveryIssue)}
                                  {q.deliveryId && (
                                    <>
                                      {` · ${m.inquiries.delivery} `}
                                      <Link className="link link-primary" to={`/deliveries/${encodeURIComponent(q.deliveryId)}`} data-testid="inquiry-delivery">
                                        <DisplayNumber number={delivery.number} systemId={q.deliveryId} failed={delivery.failed} />
                                      </Link>
                                    </>
                                  )}
                                </>,
                                'inquiry-delivery-issue',
                              ]
                            : null,
                        ]}
                      />
                    </Card>
                  )}

                  {/* 운영 조치 — 닫기(답변 역할만), 라이더 컴플레인 기록·고객 연락 남기기(고객 문의만) */}
                  {((canReplyTo(q) && q.status !== 'CLOSED') || !riderAsk) && (
                    <Card title={m.inquiries.sectionActions} icon={ICON.task} bodyClass="space-y-2 px-4 py-3.5">
                      {canReplyTo(q) && q.status !== 'CLOSED' && <CloseForm key={`close-${q.inquiryId}`} inquiry={q} />}
                      {!riderAsk && (
                        <>
                          {/* 라이더 때문에 생긴 문의면 컴플레인을 기록한다(문의 ID 로 사건 연결 — case 0.3.0). 배송 번호는 상담원이 넣는다(문의에 없음). */}
                          <Link
                            className="btn btn-sm w-full justify-start border-base-300 bg-base-100 font-normal"
                            to={`/rider-complaints/new?${new URLSearchParams({ inquiryId: q.inquiryId, ...(q.orderId ? { orderId: q.orderId } : {}) }).toString()}`}
                          >
                            {m.inquiries.recordComplaint}
                          </Link>
                          {canSeeIntakes(session?.roles ?? []) && (
                            <Link
                              className="btn btn-sm w-full justify-start border-base-300 bg-base-100 font-normal"
                              to={`/cs-intakes/new?${new URLSearchParams({ linkCaseId: q.caseId, ...(q.customerId ? { customerRef: q.customerId } : {}), ...(q.orderId ? { subjectRef: q.orderId } : {}) }).toString()}`}
                            >
                              {m.inquiries.recordContact}
                            </Link>
                          )}
                        </>
                      )}
                    </Card>
                  )}

                  {!riderAsk && <CsIntakeLog caseId={q.caseId} title={m.inquiries.contactLog} />}
                </aside>
              </div>
            </>
          );
        }}
      </QueryState>
    </section>
  );
}
