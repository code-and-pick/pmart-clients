// 고객센터 문의(상담원 CS_AGENT) — case-service 0.2.0 inquiries, 백엔드 요청 2026-11-09 customer-inquiry-page §2.
// 목록(GET /inquiries?status=) · 상세(GET /inquiries/{id}) · 답변(POST /inquiries/{id}/replies, X-Expected-Version = 문의 version).
// 권한은 서버 판정 — 조회는 CS_AGENT·OPERATOR_ADMIN, 답변은 CS_AGENT 만(case 0.4.2, 2026-11-16 사용자 (가)).
// 라이더 문의(case 0.13.0, requesterType=RIDER): 지원센터 메뉴 `/rider-inquiries` — 조회 RIDER_OPS·OPERATOR_ADMIN, 답변 RIDER_OPS 만.
// 두 메뉴가 같은 화면을 쓰고 목록은 `requesterType` 으로 서버에 거른다(관리자는 둘 다 보지만 메뉴별로 나뉘어 보인다).
// 답변 칸은 상담원에게만 그린다(편의 — 서버도 403). 답변은 접수 응대일 뿐 주문·환불을 바꾸지 않는다.
// 문의·답변 본문은 고객이 쓴 신뢰할 수 없는 텍스트 — 일반 텍스트로만 그린다. 로그에 남기지 않는다.
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
import { messages as m } from '../../shared/messages';

type Inquiry = components['schemas']['Inquiry'];
type InquirySummary = components['schemas']['InquirySummary'];
type InquiryStatus = components['schemas']['InquiryStatus'];
type RequesterType = components['schemas']['InquiryRequesterType'];

const basePath = (kind: RequesterType) => (kind === 'RIDER' ? '/rider-inquiries' : '/inquiries');

const STATUSES: readonly InquiryStatus[] = ['RECEIVED', 'ANSWERED', 'CLOSED'];
const MAX_REPLY = 4000; // 계약 replyInquiry body maxLength

const isStatus = (v: string | null): v is InquiryStatus => v !== null && (STATUSES as readonly string[]).includes(v);
/** 계약 밖 값은 지어내지 않고 원문 그대로 보인다. */
const label = (map: Readonly<Record<string, string>>, v: string | null | undefined) => (v ? (map[v] ?? v) : m.none);

/** 문의 목록(최근 접수 순). 상태 필터는 URL 쿼리(`?status=`)에 둔다 — 서버에 그대로 묻는다(화면에서 거르지 않는다). */
export function InquiryListPage({ kind = 'CUSTOMER' }: { readonly kind?: RequesterType }) {
  const api = useApi();
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
  const items: InquirySummary[] = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{rider ? m.inquiries.riderTitle : m.inquiries.title}</h1>
      <p className="text-sm opacity-70">{rider ? m.inquiries.riderIntro : m.inquiries.intro}</p>
      <div role="group" aria-label={m.inquiries.statusFilter} className="join">
        {([undefined, ...STATUSES] as const).map((s) => (
          <button
            key={s ?? 'ALL'}
            type="button"
            aria-pressed={status === s}
            className={`btn join-item btn-sm ${status === s ? 'btn-active' : ''}`}
            onClick={() => setSearch(s ? { status: s } : {})}
          >
            {s ? m.inquiries.status[s] : m.inquiries.all}
          </button>
        ))}
      </div>

      {query.isPending ? (
        <QueryState state={{ kind: 'loading' }}>{() => null}</QueryState>
      ) : query.isError && items.length === 0 ? (
        // 조회 실패(403 포함)는 "문의 없음"이 아니라 오류로 보인다.
        <QueryState state={uiStateFromError(query.error)} onRetry={() => void query.refetch()}>
          {() => null}
        </QueryState>
      ) : items.length === 0 ? (
        <p className="text-sm opacity-70">{m.inquiries.empty}</p>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>{m.inquiries.id}</th>
                <th>{m.inquiries.category}</th>
                <th>{m.inquiries.subject}</th>
                <th>{m.inquiries.statusLabel}</th>
                <th>{m.inquiries.createdAt}</th>
                <th>{m.inquiries.answeredAt}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.inquiryId} data-testid="inquiry-row">
                  <td>
                    <Link className="link" to={`${basePath(kind)}/${encodeURIComponent(i.inquiryId)}`}>
                      {i.inquiryId}
                    </Link>
                  </td>
                  <td>{label(m.inquiries.categoryName, i.category)}</td>
                  <td className="max-w-xs truncate">
                    {i.title ?? m.none}
                    {i.origin === 'ASSISTANT_HANDOFF' && <span className="badge badge-ghost badge-sm ml-1">{m.inquiries.fromAssistant}</span>}
                    {i.origin === 'STAFF_INTAKE' && (
                      <span className="badge badge-ghost badge-sm ml-1" data-testid="inquiry-channel">{`${m.inquiries.fromStaff} · ${label(m.csIntake.channelName, i.channel)}`}</span>
                    )}
                    {i.callerRelation === 'PROXY' && <span className="badge badge-warning badge-sm ml-1">{m.inquiries.proxy}</span>}
                    {i.deliveryIssue && (
                      <span className="badge badge-error badge-outline badge-sm ml-1" data-testid="inquiry-delivery-issue">{`${m.inquiries.deliveryIssue} · ${label(m.inquiries.deliveryIssueName, i.deliveryIssue)}`}</span>
                    )}
                  </td>
                  <td>{label(m.inquiries.status, i.status)}</td>
                  <td>{formatSeoul(i.createdAt)}</td>
                  <td>{i.answeredAt ? formatSeoul(i.answeredAt) : m.none}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {query.isFetchNextPageError && <p className="text-sm text-error">{m.inquiries.moreFailed}</p>}
          {query.hasNextPage && (
            <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              {m.inquiries.more}
            </button>
          )}
        </>
      )}
    </section>
  );
}

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
  if (inquiry.status === 'CLOSED') return <p className="text-sm opacity-70">{m.inquiries.closedNote}</p>;

  return (
    <form
      className="space-y-2 rounded-box bg-base-100 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed && !locked) void reply.run({ text: trimmed, version: inquiry.version });
      }}
    >
      <label className="block">
        <span className="text-sm font-bold">{m.inquiries.replyLabel}</span>
        <textarea
          className="textarea mt-1 w-full"
          rows={4}
          maxLength={MAX_REPLY}
          value={body}
          disabled={locked}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <p className="text-xs opacity-60">
        {inquiry.requesterType === 'RIDER' ? m.inquiries.riderReplyNote : inquiry.origin === 'STAFF_INTAKE' ? m.inquiries.replyNoteStaff : m.inquiries.replyNote}
      </p>
      <div className="flex items-center gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={!trimmed || locked}>
          {m.inquiries.replySend}
        </button>
        <span className="ml-auto text-xs opacity-60">{`${body.length} / ${MAX_REPLY}`}</span>
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
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
        {m.inquiries.close}
      </button>
    );
  return (
    <form
      className="space-y-2 rounded-box bg-base-100 p-4"
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
      <div className="flex gap-2">
        <button type="submit" className="btn btn-warning btn-sm" disabled={!ok || close.busy}>
          {m.inquiries.closeSubmit}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={close.busy} onClick={() => setOpen(false)}>
          {m.inquiries.closeCancel}
        </button>
      </div>
      <CommandFeedback command={close}>{() => <p role="status" className="text-sm text-success">{m.inquiries.closed}</p>}</CommandFeedback>
    </form>
  );
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

  return (
    <section className="max-w-3xl space-y-4">
      <h1 className="text-xl font-bold">{`${m.inquiries.detailTitle} ${inquiryId}`}</h1>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(q) => (
          <>
            <dl className="grid grid-cols-[8rem_1fr] gap-1 rounded-box bg-base-100 p-4 text-sm">
              <dt>{m.inquiries.statusLabel}</dt>
              <dd data-testid="inquiry-status">{label(m.inquiries.status, q.status)}</dd>
              <dt>{m.inquiries.category}</dt>
              <dd>{label(m.inquiries.categoryName, q.category)}</dd>
              <dt>{m.inquiries.requester}</dt>
              <dd data-testid="inquiry-requester">{label(m.inquiries.requesterName, q.requesterType ?? 'CUSTOMER')}</dd>
              {q.requesterType === 'RIDER' ? (
                <>
                  <dt>{m.inquiries.rider}</dt>
                  <dd>
                    {q.riderId ? (
                      <Link className="link" to={`/riders/${encodeURIComponent(q.riderId)}`}>
                        {q.riderId}
                      </Link>
                    ) : (
                      m.none
                    )}
                  </dd>
                </>
              ) : (
                <>
                  <dt>{m.inquiries.customer}</dt>
                  <dd>{q.customerId ?? m.none}</dd>
                  <dt>{m.inquiries.order}</dt>
                  <dd>{q.orderId ?? m.none}</dd>
                  {/* 배송 신고(case 0.16.0) — 고객 배송 분류 + 주문 문의에만 */}
                  {q.deliveryIssue && (
                    <>
                      <dt>{m.inquiries.deliveryIssue}</dt>
                      <dd data-testid="inquiry-delivery-issue">
                        {label(m.inquiries.deliveryIssueName, q.deliveryIssue)}
                        {q.deliveryId && (
                          <>
                            {` · ${m.inquiries.delivery} `}
                            <Link className="link" to={`/deliveries/${encodeURIComponent(q.deliveryId)}`}>
                              {q.deliveryId}
                            </Link>
                          </>
                        )}
                      </dd>
                    </>
                  )}
                </>
              )}
              <dt>{m.inquiries.origin}</dt>
              <dd>
                {q.origin === 'ASSISTANT_HANDOFF'
                  ? m.inquiries.fromAssistant
                  : q.origin === 'INQUIRY_PAGE'
                    ? m.inquiries.fromPage
                    : q.origin === 'STAFF_INTAKE'
                      ? m.inquiries.fromStaff
                      : (q.origin ?? m.none)}
              </dd>
              {q.channel && (
                <>
                  <dt>{m.inquiries.channel}</dt>
                  <dd>{`${label(m.csIntake.channelName, q.channel)}${q.callerRelation ? ` · ${label(m.csIntake.relationName, q.callerRelation)}` : ''}`}</dd>
                </>
              )}
              <dt>{m.inquiries.createdAt}</dt>
              <dd>{formatSeoul(q.createdAt)}</dd>
              {/* 닫힘(case 0.19.0) — 닫은 쪽·시각, 직원이 닫았으면 사유(직원에게만 온다) */}
              {q.status === 'CLOSED' && (
                <>
                  <dt>{m.inquiries.closedLabel}</dt>
                  <dd data-testid="inquiry-closed">
                    {`${label(m.inquiries.closedByName, q.closedByType)}${q.closedAt ? ` · ${formatSeoul(q.closedAt)}` : ''}`}
                    {q.closeReason && <span className="block whitespace-pre-wrap opacity-80">{q.closeReason}</span>}
                  </dd>
                </>
              )}
              {/* 만족도(case 0.15.0) — 서버가 관리자에게만 준다. 상담원 화면에는 없다 */}
              {q.satisfaction && (
                <>
                  <dt>{m.inquiries.satisfaction}</dt>
                  <dd data-testid="inquiry-satisfaction">
                    {m.inquiries.satisfactionLine(q.satisfaction.score, formatSeoul(q.satisfaction.ratedAt))}
                    {q.satisfaction.comment && <span className="block whitespace-pre-wrap opacity-80">{q.satisfaction.comment}</span>}
                  </dd>
                </>
              )}
              <dt>{m.inquiries.caseId}</dt>
              <dd>{q.caseId}</dd>
            </dl>

            {q.callerRelation === 'PROXY' && (
              <p role="alert" className="alert alert-warning text-sm" data-testid="inquiry-proxy-warning">
                {m.inquiries.proxyWarning}
              </p>
            )}
            {q.origin === 'STAFF_INTAKE' && <p className="text-sm opacity-70">{m.inquiries.staffNote}</p>}

            <article className="rounded-box bg-base-100 p-4">
              {q.title && <h2 className="mb-2 font-bold">{q.title}</h2>}
              <p className="whitespace-pre-wrap break-words" data-testid="inquiry-body">
                {q.body}
              </p>
            </article>
            {/* 문의 사진(case 0.14.0) — 고객·라이더가 붙인 것. 상담원 접수 문의에는 없다 */}
            <InquiryPhotos photos={q.photos} />

            {/* case 0.21.0: 라이더 문의는 대화 — replies 에 라이더가 이어 쓴 줄(authorType RIDER)이 섞인다. 보낸 쪽으로 나눠 그린다(라이더 메시지를 답변처럼 보이지 않게) */}
            <h2 className="font-bold">{q.requesterType === 'RIDER' ? m.inquiries.conversation : m.inquiries.replies}</h2>
            {q.replies.length === 0 ? (
              <p className="text-sm opacity-70">{m.inquiries.noReplies}</p>
            ) : (
              <ul className="space-y-2">
                {q.replies.map((r, i) => {
                  const fromRider = r.authorType === 'RIDER';
                  return (
                    <li
                      key={r.replyId ?? `reply-${i}`}
                      className={`rounded-box p-3 text-sm ${fromRider ? 'mr-12 border border-base-300 bg-base-100' : 'ml-12 bg-base-200'}`}
                      data-testid="inquiry-reply"
                      data-author={r.authorType ?? 'AGENT'}
                    >
                      <p className="mb-1 text-xs font-semibold opacity-70">{fromRider ? m.inquiries.fromRider : m.inquiries.fromStaffReply}</p>
                      <p className="whitespace-pre-wrap break-words">{r.body ?? ''}</p>
                      <p className="mt-1 text-xs opacity-60">{r.createdAt ? formatSeoul(r.createdAt) : m.none}</p>
                    </li>
                  );
                })}
              </ul>
            )}
            {q.status === 'RECEIVED' && q.replies.at(-1)?.authorType === 'RIDER' && (
              <p role="status" className="text-sm text-warning" data-testid="inquiry-rider-followup">
                {m.inquiries.riderFollowUp}
              </p>
            )}

            {canReplyTo(q) && q.status !== 'CLOSED' && <CloseForm key={`close-${q.inquiryId}`} inquiry={q} />}
            {canReplyTo(q) ? (
              <ReplyForm key={q.inquiryId} inquiry={q} />
            ) : (
              <p className="text-sm opacity-70" data-testid="inquiry-read-only">
                {q.requesterType === 'RIDER' ? m.inquiries.riderReadOnly : m.inquiries.readOnly}
              </p>
            )}
            {q.requesterType !== 'RIDER' && (
              <>
                {/* 라이더 때문에 생긴 문의면 컴플레인을 기록한다(문의 ID 로 사건 연결 — case 0.3.0). 배송 번호는 상담원이 넣는다(문의에 없음). */}
                <Link
                  className="btn btn-sm"
                  to={`/rider-complaints/new?${new URLSearchParams({ inquiryId: q.inquiryId, ...(q.orderId ? { orderId: q.orderId } : {}) }).toString()}`}
                >
                  {m.inquiries.recordComplaint}
                </Link>
                {canSeeIntakes(session?.roles ?? []) && (
                  <Link
                    className="btn btn-sm ml-2"
                    to={`/cs-intakes/new?${new URLSearchParams({ linkCaseId: q.caseId, ...(q.customerId ? { customerRef: q.customerId } : {}), ...(q.orderId ? { subjectRef: q.orderId } : {}) }).toString()}`}
                  >
                    {m.inquiries.recordContact}
                  </Link>
                )}
                <CsIntakeLog caseId={q.caseId} title={m.inquiries.contactLog} />
              </>
            )}
          </>
        )}
      </QueryState>
      <Link className="link text-sm" to={basePath(kind)}>
        {kind === 'RIDER' ? m.inquiries.riderBack : m.inquiries.back}
      </Link>
    </section>
  );
}
