// 지원센터(2026-11-17, PC 5 — ADR-0068 로 옮겨 오는 화면): 도움요청 대화(execution), 라이더 문의 대화(case 0.21.0).
// 대화는 몇 초마다 새로 불러온다(도움요청 4초, 문의 5초 — 라이더 앱과 비슷하게). 메시지 내용은 화면에만, 로그 안 함.
// 2026-11-18: 배민 주문접수 모양 — 목록(쪽 머리 → 검색 조건/상태 탭 → 결과 줄 → 표, 줄 누르면 상세),
// 상세(머리: 번호·상태·요약 → 구역 이동 탭 → 왼쪽 요청 내용·사진·처리 / 오른쪽 대화).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import { useApi } from '../../app/ApiContext';
import { humanizeCodes } from '../../shared/codeText';
import { useCenterQuery } from '../../app/CenterScope';
import { useSession } from '../../app/SessionContext';
import { photoMessages } from '../../shared/AuthedPhotos';
import { AllDone, ChipGroup, DataTable, DetailHeader, GuideBox, FieldList, PageHeader, ResultBar, SearchPanel, Section, SectionTabs, StatCard, StatStrip, StatusBadge } from '../../shared/admin';
import { listCountText, statText, useListRows } from '../../shared/listKit';
import { useNewIds } from '../../shared/motion';
import { ui } from '../../shared/uiMessages';
import { DeliveryNo, DeliveryRef, RiderName, RiderRef, StaffName, SystemIds, useDeliveryNumbers, useRiderSummaries } from '../../shared/displayNumbers';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { label, none, when } from '../../shared/opsUi';
import { useNow, waited } from '../../shared/useNow';
import { DeliveryActions } from '../deliveries/DeliveryActions';
import { AppealsMenu } from './AppealPages';
import { CaseDetailPage, caseDetailPath, CaseListPage } from '../cases/CasePages';
import { EvidencePhotos, helpExtrasMessages, InquiryPhotos, MaskMessage, ResolvePanel } from './HelpExtras';
import { ChatBox, ChatBubble, helpTone, inquiryTone, isLiveChat, StateTabs } from './supportUi';

const h = ops.help;
const q = ops.inquiries;
const n = messages.names;

/** 이 화면에서만 쓰는 문구(공통 문구 파일은 다른 PC 와 같이 고치므로 여기에 둔다) */
const sm = {
  helpCol: { stage: '배송 단계', photos: '사진', case: '접수 건' },
  helpSearch: { state: '상태', category: '종류', allCategories: '모든 종류', rider: '라이더', riderHint: '라이더 번호 R4785' },
  autoRefresh: (s: number) => `${s}초마다 새로 불러와요`,
  photoCount: (k: number) => (k > 0 ? `${k}장` : none),
  hasCase: '사건 있음',
  help: {
    request: '요청 내용',
    photos: '사진',
    chat: '대화',
    actions: '배송 조치',
    actionsHint: '지금 배송 상태에서 할 수 있는 조치만 보여요',
    resolve: '처리',
    riderSaid: '라이더가 쓴 내용',
    lastRider: '라이더 마지막 말',
    lastSupport: '지원센터 마지막 말',
    resolvedAt: '종료시점',
    resolvedBy: '닫은 직원',
    viaConsults: '상담 관리에서 완료',
    resolutionNote: '처리 메모',
    goDelivery: '배송 상세',
  },
  inquiry: {
    content: '문의 내용',
    photos: '사진',
    chat: '대화',
    liveChat: '채팅 상담',
    close: '상담 완료',
    rider: '라이더',
    answeredAt: '답변시점',
    closedAt: '종료시점',
    closedBy: '닫은 쪽',
    closeReason: '닫은 사유',
    closedByName: { CUSTOMER: '고객', RIDER: '라이더', STAFF: '지원센터' } as Readonly<Record<string, string>>,
    alreadyClosed: '닫힌 문의예요. 더 답할 수 없어요.',
  },
} as const;

/** 도움요청 종류 — 계약(execution HelpCategory) 값 이름. 공통 이름표에 없는 값은 여기서 채운다 */
const helpCategoryName: Readonly<Record<string, string>> = n.helpCategory;
type HelpState = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
const HELP_PAGE_SIZE = 50;
/** 상담함이 한 상태에서 읽는 최대 쪽 수(50 × 20 = 1,000건) */
const HELP_MAX_PAGES = 20;
/** 상담함 끝남 탭이 보여 주는 기간(일) */
const DONE_DAYS = 7;
const consultBack = '상담함';

// ---------------- 도움요청

export function HelpRequestsMenu() {
  return (
    <Routes>
      {/* 목록은 상담함으로 합쳤다(2026-11-19) — 옛 주소는 상담함으로 */}
      <Route index element={<Navigate to="/consults" replace />} />
      <Route path=":deliveryId/:requestId" element={<HelpChatPage />} />
    </Routes>
  );
}

const helpPath = (deliveryId: string | undefined, requestId: string | undefined) => `/help-requests/${encodeURIComponent(deliveryId ?? '')}/${encodeURIComponent(requestId ?? '')}`;


function HelpChatPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { deliveryId = '', requestId = '' } = useParams();
  const path = { deliveryId, requestId };
  const detail = useQuery({
    queryKey: ['help', deliveryId, requestId],
    queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}/help-requests/{requestId}', { params: { path } })),
  });
  const chat = useQuery({
    queryKey: ['help-messages', deliveryId, requestId],
    refetchInterval: 4_000,
    queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}/help-requests/{requestId}/messages', { params: { path } })),
  });
  const [text, setText] = useState('');
  const send = useCommand(async (body: { body: string }, key) => {
    try {
      return await request('POST', api.execution.POST('/deliveries/{deliveryId}/help-requests/{requestId}/messages', { ...commandParams(key, { path }), body }));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['help-messages', deliveryId, requestId] });
    }
  });
  const closed = chat.data?.helpState === 'RESOLVED';
  // 새로 들어온 메시지(2026-11-19 통합 백오피스처럼) — 처음 읽은 대화는 새것이 아니다. 움직임 줄이기면 CSS 가 끈다
  const freshHelp = useNewIds(chat.data?.items?.map((x) => x.messageId ?? ''), 'help');
  const { session } = useSession();
  const isAdmin = (session?.roles ?? []).includes('OPERATOR_ADMIN');
  const d = detail.data;
  const photoRefs = d?.evidenceRefs ?? [];
  // 화면 번호(ADR-0070): 배송 번호 — 시스템 ID 는 아래 접힌 "시스템 번호"
  const no = useDeliveryNumbers([deliveryId]).get(deliveryId);
  const deliveryLabel = no?.deliveryNumber ?? (no?.orderNumber ? `주문 ${no.orderNumber}` : `…${deliveryId.slice(-8)}`);
  const tabs = [
    { id: 'sec-request', label: sm.help.request },
    { id: 'sec-photos', label: sm.help.photos },
    { id: 'sec-chat', label: sm.help.chat },
    { id: 'sec-actions', label: sm.help.actions },
  ];
  return (
    <section className="max-w-[1600px] space-y-4">
      <DetailHeader
        seen={!!d}
        back={{ to: '/consults', label: consultBack }}
        title={d ? `${label(helpCategoryName, d.category)} 도움요청` : h.chatTitle('')}
        badges={
          d && (
            <>
              <StatusBadge tone={helpTone(d.state)}>{label(n.helpState, d.state)}</StatusBadge>
              <StatusBadge tone="accent">{label(helpCategoryName, d.category)}</StatusBadge>
              {d.caseId && <StatusBadge>{sm.hasCase}</StatusBadge>}
            </>
          )
        }
        summary={d && [`배송 ${deliveryLabel}`, d.stage ? `${sm.helpCol.stage} ${label(n.executionState, d.stage)}` : null, `${h.col.createdAt} ${when(d.createdAt)}`].filter(Boolean).join(' · ')}
        actions={
          <>
            {d && <ResolvePanel help={d} deliveryId={deliveryId} requestId={requestId} />}
            <Link className="btn btn-sm border-base-300 bg-base-100" to={`/deliveries/${encodeURIComponent(deliveryId)}`}>
            {sm.help.goDelivery}
          </Link>
          </>
        }
      />
      <SectionTabs items={tabs} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-4">
          <Section id="sec-request" title={sm.help.request}>
            <QueryState state={toUiState(detail)} onRetry={() => void detail.refetch()}>
              {(x) => (
                <div className="space-y-4">
                  {x.detail && (
                    <div className="rounded-box bg-base-200/60 px-4 py-3">
                      <p className="mb-1 text-xs text-base-content/55">{sm.help.riderSaid}</p>
                      <p className="whitespace-pre-wrap text-sm">{x.detail}</p>
                    </div>
                  )}
                  <FieldList
                    testId="help-detail"
                    rows={[
                      [h.col.category, label(helpCategoryName, x.category)],
                      [h.col.state, label(n.helpState, x.state)],
                      [sm.helpCol.stage, label(n.executionState, x.stage)],
                      [h.col.delivery, <DeliveryNo deliveryId={x.deliveryId ?? deliveryId} deliveryNumber={no?.deliveryNumber} orderNumber={no?.orderNumber} />],
                      [h.col.createdAt, when(x.createdAt)],
                      [sm.help.lastRider, when(x.lastRiderMessageAt)],
                      [sm.help.lastSupport, when(x.lastSupportMessageAt)],
                      !!x.resolvedAt && [sm.help.resolvedAt, when(x.resolvedAt)],
                      !!x.resolvedBy && [sm.help.resolvedBy, <HelpClosedBy resolvedBy={x.resolvedBy} me={session?.subject} />],
                      !!x.resolutionNote && [sm.help.resolutionNote, <span className="whitespace-pre-wrap">{helpNoteText(x.resolutionNote)}</span>],
                    ]}
                  />
                  <SystemIds
                    ids={[
                      ['도움요청', requestId],
                      ['배송', deliveryId],
                      ['접수 건', x.caseId],
                    ]}
                  />
                </div>
              )}
            </QueryState>
          </Section>
          {d && (
            <>
              <Section id="sec-photos" title={photoMessages.title(helpExtrasMessages.photos.label, photoRefs.length)}>
                <EvidencePhotos deliveryId={deliveryId} refs={photoRefs} heading={false} />
              </Section>
            </>
          )}
        </div>
        <div className="space-y-4">
        <Section id="sec-chat" title={sm.help.chat} aside={<span className="text-xs text-base-content/50">{sm.autoRefresh(4)}</span>}>
          <div className="space-y-3">
            <QueryState state={toUiState(chat)} onRetry={() => void chat.refetch()}>
              {(c) => (
                <ChatBox testId="help-messages" empty={(c.items ?? []).length === 0}>
                  {(c.items ?? []).map((msg) => (
                    <ChatBubble
                      key={msg.messageId}
                      fresh={freshHelp.has(msg.messageId ?? '')}
                      mine={msg.senderType === 'SUPPORT'}
                      who={msg.senderType === 'SUPPORT' ? h.support : h.rider}
                      at={when(msg.createdAt)}
                      footer={isAdmin && !msg.masked && msg.messageId ? <MaskMessage deliveryId={deliveryId} requestId={requestId} messageId={msg.messageId} /> : undefined}
                    >
                      {msg.masked ? <span className="italic opacity-70">{h.masked}</span> : (msg.body ?? none)}
                    </ChatBubble>
                  ))}
                </ChatBox>
              )}
            </QueryState>
            {closed ? (
              <p className="rounded-box bg-base-200/60 px-4 py-3 text-center text-sm text-base-content/60">{h.closed}</p>
            ) : (
              <form
                className="flex gap-2 border-t border-base-300 pt-3"
                aria-label={h.write}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!text.trim()) return;
                  void send.run({ body: text.trim() }).then(() => setText(''));
                }}
              >
                <input className="input input-sm flex-1" aria-label={h.write} placeholder="라이더에게 보낼 말" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
                <button type="submit" className="btn btn-sm btn-primary w-20" disabled={!text.trim() || send.busy}>
                  {h.send}
                </button>
              </form>
            )}
            <CommandFeedback command={send}>{() => <span className="text-xs text-success">{h.sent}</span>}</CommandFeedback>
          </div>
        </Section>
        {/* 상담하면서 바로 배송 조치(상태 정정·전달 실패 확정·반려·배차 취소) — 배송 찾기로 가지 않아도 된다(사용자 2026-11-19) */}
        <Section id="sec-actions" action title={`${sm.help.actions}하기`} info={sm.help.actionsHint}>
          <HelpDeliveryActions deliveryId={deliveryId} />
        </Section>
        </div>
      </div>
    </section>
  );
}

// ---------------- 라이더 문의

type InquiryStatus = 'RECEIVED' | 'ANSWERED' | 'CLOSED';
const INQUIRY_PAGE_SIZE = 50;

export function InquiriesMenu() {
  return (
    <Routes>
      <Route index element={<Navigate to="/consults" replace />} />
      <Route path=":inquiryId" element={<InquiryDetailPage />} />
    </Routes>
  );
}


function InquiryDetailPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { inquiryId = '' } = useParams();
  const path = { inquiryId };
  const inquiry = useQuery({
    queryKey: ['inquiry', inquiryId],
    queryFn: () => request('GET', api.cases.GET('/inquiries/{inquiryId}', { params: { path } })),
  });
  const chat = useQuery({
    queryKey: ['inquiry-messages', inquiryId],
    refetchInterval: 5_000,
    queryFn: () => request('GET', api.cases.GET('/inquiries/{inquiryId}/messages', { params: { path } })),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['inquiry', inquiryId] });
    void queryClient.invalidateQueries({ queryKey: ['inquiry-messages', inquiryId] });
  };
  const [text, setText] = useState('');
  const reply = useCommand(async (body: { body: string }, key) => {
    try {
      return await request(
        'POST',
        api.cases.POST('/inquiries/{inquiryId}/replies', {
          ...commandParams(key, { path, ...(inquiry.data?.version !== undefined ? { version: inquiry.data.version } : {}) }),
          body,
        }),
      );
    } finally {
      refresh();
    }
  });
  const [closeReason, setCloseReason] = useState('');
  const close = useCommand(async (body: { reason: string }, key) => {
    try {
      return await request('POST', api.cases.POST('/inquiries/{inquiryId}/closures', { ...commandParams(key, { path }), body }));
    } finally {
      refresh();
    }
  });
  const status = chat.data?.status ?? inquiry.data?.status;
  const freshInquiry = useNewIds(chat.data?.items?.map((x) => x.messageId ?? ''), 'inquiry');
  const closed = status === 'CLOSED';
  const d = inquiry.data;
  const riderSummary = useRiderSummaries([d?.riderId]).get(d?.riderId ?? '');
  const photoIds = (d?.photos ?? []).map((p) => p.photoId);
  const liveChat = isLiveChat(d?.title);
  const tabs = [
    ...(liveChat ? [{ id: 'sec-chat', label: sm.inquiry.liveChat }] : []),
    { id: 'sec-content', label: sm.inquiry.content },
    { id: 'sec-photos', label: sm.inquiry.photos },
    ...(liveChat ? [] : [{ id: 'sec-chat', label: sm.inquiry.chat }]),
    ...(closed ? [] : [{ id: 'sec-close', label: sm.inquiry.close }]),
  ];
  return (
    <section className="max-w-[1600px] space-y-4">
      <DetailHeader
        seen={!!d}
        back={{ to: '/consults', label: consultBack }}
        title={d?.title ?? q.detailTitle('')}
        badges={
          d && (
            <>
              <StatusBadge tone={inquiryTone(status)}>{label(q.statusName, status)}</StatusBadge>
              <StatusBadge tone="accent">{label(n.inquiryCategory, d.category)}</StatusBadge>
            </>
          )
        }
        summary={d && [d.title, d.riderId && riderSummary?.riderNumber ? `${sm.inquiry.rider} ${riderSummary.nameMasked ?? ''} ${riderSummary.riderNumber}` : null, `${q.col.createdAt} ${when(d.createdAt)}`].filter(Boolean).join(' · ')}
      />
      <SectionTabs items={tabs} />
      {/* 채팅 상담(라이더 앱)이면 대화가 주인공 — 대화 칸을 먼저(왼쪽)·넓게·높게, 문의 내용은 오른쪽 좁게(2026-11-23) */}
      <div className={`grid items-start gap-4 ${liveChat ? 'lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]' : 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]'}`}>
        <div className={`space-y-4 ${liveChat ? 'lg:order-2' : ''}`}>
          <Section id="sec-content" title={sm.inquiry.content}>
            <QueryState state={toUiState(inquiry)} onRetry={() => void inquiry.refetch()}>
              {(x) => (
                <div className="space-y-4">
                  <div className="rounded-box bg-base-200/60 px-4 py-3">
                    <p className="mb-1 text-xs text-base-content/55">{q.first}</p>
                    {x.title && <p className="mb-1 font-semibold">{x.title}</p>}
                    <p className="whitespace-pre-wrap text-sm">{x.body}</p>
                  </div>
                  <FieldList
                    testId="inquiry-detail"
                    rows={[
                      [q.col.category, label(n.inquiryCategory, x.category)],
                      [q.col.status, label(q.statusName, x.status)],
                      [sm.inquiry.rider, <RiderRef riderId={x.riderId} summary={riderSummary} />],
                      [q.col.createdAt, when(x.createdAt)],
                      [sm.inquiry.answeredAt, when(x.answeredAt)],
                      !!x.closedAt && [sm.inquiry.closedAt, when(x.closedAt)],
                      !!x.closedByType && [sm.inquiry.closedBy, label(sm.inquiry.closedByName, x.closedByType)],
                      !!x.closeReason && [sm.inquiry.closeReason, <span className="whitespace-pre-wrap">{x.closeReason}</span>],
                    ]}
                  />
                  <SystemIds ids={[['문의', inquiryId], ['라이더', x.riderId]]} />
                </div>
              )}
            </QueryState>
          </Section>
          {d && (
            <Section id="sec-photos" title={photoMessages.title(helpExtrasMessages.photos.inquiryLabel, photoIds.length)}>
              <InquiryPhotos photoIds={photoIds} heading={false} />
            </Section>
          )}
        </div>
        <div className={`space-y-4 ${liveChat ? 'lg:order-1' : ''}`}>
          <Section id="sec-chat" title={liveChat ? sm.inquiry.liveChat : sm.inquiry.chat} aside={<span className="text-xs text-base-content/50">{sm.autoRefresh(5)}</span>}>
            <div className="space-y-3">
              <QueryState state={toUiState(chat)} onRetry={() => void chat.refetch()}>
                {(c) => (
                  <ChatBox testId="inquiry-messages" empty={(c.items ?? []).length === 0} tall={liveChat}>
                    {(c.items ?? []).map((msg) => (
                      <ChatBubble key={msg.messageId} fresh={freshInquiry.has(msg.messageId ?? '')} mine={msg.senderType === 'SUPPORT'} who={msg.senderType === 'SUPPORT' ? h.support : h.rider} at={when(msg.createdAt)}>
                        {msg.body}
                      </ChatBubble>
                    ))}
                  </ChatBox>
                )}
              </QueryState>
              {closed ? (
                <p className="rounded-box bg-base-200/60 px-4 py-3 text-center text-sm text-base-content/60">{sm.inquiry.alreadyClosed}</p>
              ) : (
                <form
                  className="flex gap-2 border-t border-base-300 pt-3"
                  aria-label={q.reply}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!text.trim()) return;
                    void reply.run({ body: text.trim() }).then(() => setText(''));
                  }}
                >
                  <input className="input input-sm flex-1" aria-label={q.reply} placeholder="라이더에게 보낼 답변" maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
                  <button type="submit" className="btn btn-sm btn-primary w-20" disabled={!text.trim() || reply.busy}>
                    {q.send}
                  </button>
                </form>
              )}
              <CommandFeedback command={reply}>{() => <span className="text-xs text-success">{q.sent}</span>}</CommandFeedback>
            </div>
          </Section>
          {!closed && (
            <Section id="sec-close" action title={`${q.close}하기`}>
              <form
                className="flex flex-wrap items-end gap-2 text-sm"
                aria-label={q.close}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (closeReason.trim().length >= 2) void close.run({ reason: closeReason.trim() });
                }}
              >
                <label className="flex min-w-60 flex-1 flex-col gap-1">
                  <span className="text-base-content/70">{q.closeReason}</span>
                  <input className="input input-sm w-full" maxLength={500} value={closeReason} onChange={(e) => setCloseReason(e.target.value)} />
                </label>
                <button type="submit" className="btn btn-sm border-base-300 bg-base-100" disabled={closeReason.trim().length < 2 || close.busy}>
                  {q.close}
                </button>
              </form>
              <CommandFeedback command={close}>{() => <span className="text-xs text-success">{q.closed}</span>}</CommandFeedback>
            </Section>
          )}
        </div>
      </div>
    </section>
  );
}


/** 받은 뒤 지난 시간 — 10분 넘으면 주의, 30분 넘으면 경고 */
function WaitBadge({ from, now, muted = false }: { readonly from: string | null | undefined; readonly now: number | null; /** 우리가 기다리게 하는 건이 아니면(답변함 등) 색 없이 회색 — 2026-11-21 사용자 */ readonly muted?: boolean }) {
  const w = waited(from, now);
  if (!w) return <span className="text-base-content/40">—</span>;
  return <StatusBadge tone={muted ? 'ghost' : w.tone}>{w.text}</StatusBadge>;
}

// ---------------- 상담함(도움요청 + 라이더 문의 한 목록 — 사용자 2026-11-19 "라이더문의랑 도움요청이 둘 다 있는 이유가 뭐냐")

const consultText = {
  title: '상담 관리',
  intro: '라이더가 보낸 배송 도움요청(급함)과 일반 문의를 한곳에서 봐요. 배송 도움요청이 먼저, 그 안에서는 오래 기다린 것부터. 누르면 대화를 열고, 끝나면 "상담 완료".',
  // 안내 상자 글머리(2026-11-19) — 위 intro 를 문장으로 나눈 것(새 규칙 아님)
  guide: ['라이더가 보낸 배송 도움요청(급함)과 일반 문의를 한곳에서 봐요.', '배송 도움요청이 먼저, 그 안에서는 오래 기다린 것부터.', '누르면 대화를 열고, 끝나면 "상담 완료".'],
  tabs: { open: '상담 중', cases: '배송 사건', appeals: '소명·이의', done: '완료' },
  searchLabel: '찾기',
  searchHint: '배송번호·주문번호·라이더 이름·번호·내용',
  search: '찾기',
  clear: '지우기',
  allKinds: '전체',
  truncated: '도움요청이 너무 많아 가장 최근 것 일부를 불러오지 못했어요. 찾기·구분으로 좁히거나 완료 탭은 기간이 지나면 줄어요.',
  noMatch: (q: string) => `"${q}"에 맞는 상담이 없어요.`,
  kind: { help: '배송 도움요청', inquiry: '일반 문의', failure: '전달 실패 결정 대기' },
  /** 라이더 앱 채팅 상담으로 연 문의 꼬리표(2026-11-23) */
  chat: '채팅',
  failureTitle: '전달 불가 신고 — 확정·반려 기다림',
  resumeRequested: '라이더 재개 요청',
  col: { kind: '구분', title: '내용', state: '상태', delivery: '배송번호', order: '주문번호', rider: '라이더', createdAt: '접수시점', wait: '기다린 시간' },
  empty: { open: '상담할 건이 없어요.', done: '최근 7일 동안 완료된 상담이 없어요.' },
  partial: (what: string) => `${what} 목록을 불러오지 못했어요 — 아래는 일부예요.`,
  retry: '다시 불러오기',
  stripLabel: '상담 대기 수',
  stripHelpHint: '받음·처리 중',
  stripInquiryHint: '접수·답함 — 불러온 것 기준',
} as const;

// 결정 대기(멈춘 배송) → 배송 도움요청 → 일반 문의
const kindOrder = { failure: 0, help: 1, inquiry: 2 } as const;

type ConsultRow = {
  readonly kind: 'help' | 'inquiry' | 'failure';
  /** 라이더 앱 채팅 상담으로 연 문의 */
  readonly chat?: boolean;
  readonly key: string;
  readonly to: string;
  readonly title: string;
  readonly state: ReactNode;
  readonly deliveryId: string | null;
  readonly riderId: string | null;
  readonly createdAt: string | undefined;
  readonly open: boolean;
  /** 우리 답을 기다리는 중(답변함 문의는 라이더 차례라 false) — 기다린 시간 색은 이때만 */
  readonly waiting?: boolean;
};

export function ConsultsMenu() {
  return (
    <Routes>
      <Route index element={<ConsultsHome />} />
      {/* 배송 사건 상세(2026-11-21 처리함으로 합침 — 옛 /cases/:id 가 여기로) */}
      <Route path="cases/:caseId" element={<CaseDetailPage />} />
    </Routes>
  );
}

type ConsultTab = 'open' | 'cases' | 'appeals' | 'done';

/**
 * 상담함 한 곳 — 상담 중 | 끝남 | 소명·이의(2026-11-20 사용자 "상담함이랑 소명이의는 왜 나눠져 있냐").
 * 라이더앱도 지원센터 한 화면(문의 | 소명·이의 탭)으로 합쳤다. 소명·이의 화면은 그대로 이 탭 안에 그린다.
 */
function ConsultsHome() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: ConsultTab = raw === 'done' || raw === 'appeals' || raw === 'cases' ? raw : 'open';
  return (
    <section className="space-y-4">
      <PageHeader title={consultText.title} />
      <StateTabs
        label={consultText.title}
        value={tab}
        options={[
          { value: 'open' as const, label: consultText.tabs.open },
          { value: 'cases' as const, label: consultText.tabs.cases },
          { value: 'appeals' as const, label: consultText.tabs.appeals },
          { value: 'done' as const, label: consultText.tabs.done },
        ]}
        onChange={(t) => setParams(t === 'open' ? {} : { tab: t })}
      />
      {tab === 'appeals' ? <AppealsMenu embedded /> : tab === 'cases' ? <CaseListPage embedded /> : <ConsultsPage tab={tab} />}
    </section>
  );
}

/** 검색어가 줄에 맞는지 — 배송번호·주문번호·라이더(이름·번호)·내용. 띄어쓰기·대소문자는 무시 */
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toLowerCase();

function ConsultsPage({ tab }: { readonly tab: 'open' | 'done' }) {
  const api = useApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [queryInput, setQueryInput] = useState(query);
  const rawKind = params.get('kind');
  const kindFilter: ConsultRow['kind'] | 'all' = rawKind === 'help' || rawKind === 'inquiry' || rawKind === 'failure' ? rawKind : 'all';
  const patch = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p);
  };
  const helpStates: readonly HelpState[] = tab === 'open' ? ['OPEN', 'IN_PROGRESS'] : ['RESOLVED'];
  const inquiryStatuses: readonly InquiryStatus[] = tab === 'open' ? ['RECEIVED', 'ANSWERED'] : ['CLOSED'];
  const cq = useCenterQuery(); // 머리줄 센터 고르기(RS-7)
  const help = useQuery({
    queryKey: ['help-queue', 'consults', tab, cq.mfcId ?? ''],
    refetchInterval: 15_000,
    // 서버는 오래된 것부터 한 쪽 50건(계약) — 첫 쪽만 읽으면 끝난 건이 50건을 넘을 때 최근 것이 빠졌다(2026-11-20 사용자 "상담함에 안 뜬다").
    // 다음 쪽까지 읽는다. 끝남 탭은 최근 7일만(끝난 건은 계속 쌓인다).
    queryFn: async () => {
      const from = tab === 'done' ? new Date(Date.now() - DONE_DAYS * 86_400_000).toISOString() : undefined;
      const pages = await Promise.all(
        helpStates.map(async (state) => {
          const items = [];
          let cursor: string | undefined;
          for (let i = 0; i < HELP_MAX_PAGES; i++) {
            const r = await request('GET', api.execution.GET('/delivery-help-requests', { params: { query: { size: HELP_PAGE_SIZE, state, ...cq, ...(from ? { from } : {}), ...(cursor ? { cursor } : {}) } } }));
            items.push(...(r.items ?? []));
            cursor = r.page?.nextCursor ?? undefined;
            if (!cursor) break;
          }
          // 상한까지 읽고도 다음 쪽이 남았다 — 오래된 것부터라 가장 최근 것이 빠졌다. 숨기지 않고 알린다(PC 1 PR 리뷰 2026-11-20).
          return { items, more: !!cursor };
        }),
      );
      return { items: pages.flatMap((p) => p.items), more: pages.some((p) => p.more) };
    },
  });
  // 숫자 띠(2026-11-19 통합 백오피스처럼) — 서버가 센 수: 도움요청·전달 실패 결정 대기는 delivery-stats, 일반 문의는 목록 한 쪽(넘치면 "N건 이상")
  const stats = useQuery({
    queryKey: ['delivery-stats', cq.mfcId ?? ''],
    refetchInterval: 15_000,
    queryFn: () => request('GET', api.execution.GET('/delivery-stats', { params: { query: { ...cq } } })),
  });
  const openInquiries = useQuery({
    queryKey: ['rider-inquiries', 'consults-count'],
    refetchInterval: 15_000,
    queryFn: async () => {
      const pages = await Promise.all((['RECEIVED', 'ANSWERED'] as const).map((status) => request('GET', api.cases.GET('/inquiries', { params: { query: { requesterType: 'RIDER', status, size: INQUIRY_PAGE_SIZE } } }))));
      return { n: pages.reduce((a, p) => a + (p.items ?? []).length, 0), more: pages.some((p) => !!p.page?.nextCursor) };
    },
  });
  const inquiries = useQuery({
    queryKey: ['rider-inquiries', 'consults', tab],
    refetchInterval: 15_000,
    queryFn: async () =>
      (
        await Promise.all(
          inquiryStatuses.map((status) => request('GET', api.cases.GET('/inquiries', { params: { query: { requesterType: 'RIDER', status, size: INQUIRY_PAGE_SIZE } } }))),
        )
      ).flatMap((r) => r.items ?? []),
  });
  // 전달 실패 결정(확정·반려)을 기다리는 배송 — 상담이 끝났어도 결정 전이면 여기 남긴다. 라이더가 "전달할 수 있어요"
  // (재개 요청)를 보내면 표시한다(사용자 2026-11-19 "지원센터에서 처리해버리면 반려해 달라고 해도 연락이 안 가지고").
  const failures = useQuery({
    queryKey: ['deliveries', 'consults-failure-reported', cq.mfcId ?? ''],
    enabled: tab === 'open',
    refetchInterval: 15_000,
    queryFn: () => request('GET', api.execution.GET('/deliveries', { params: { query: { state: 'FAILURE_REPORTED', size: 50, ...cq } } })),
  });
  const openHelpDeliveries = new Set((help.data?.items ?? []).filter((it) => it.state !== 'RESOLVED').map((it) => it.deliveryId));
  const pendingFailures = tab === 'open' ? (failures.data?.items ?? []) : [];
  const resumeBy = new Map(pendingFailures.filter((d) => d.resumeRequestedAt).map((d) => [d.deliveryId, d.resumeRequestedAt] as const));
  const riders = useRiderSummaries([...(help.data?.items ?? []).map((it) => it.riderId), ...pendingFailures.map((d) => d.riderId ?? undefined)]);
  const deliveryNos = useDeliveryNumbers([...(help.data?.items ?? []).map((it) => it.deliveryId), ...(inquiries.data ?? []).map((it) => it.deliveryId ?? undefined)]);
  const now = useNow();
  const resumeBadge = <StatusBadge tone="error">{consultText.resumeRequested}</StatusBadge>;
  const allRows: ConsultRow[] = [
    // 도움요청이 열려 있지 않은(상담이 끝난) 결정 대기 배송 — 상세의 배송 조치에서 확정·반려
    ...pendingFailures
      .filter((d) => d.deliveryId && !openHelpDeliveries.has(d.deliveryId))
      .map(
        (d): ConsultRow => ({
          kind: 'failure',
          key: `f:${d.deliveryId}`,
          to: `/deliveries/${encodeURIComponent(d.deliveryId ?? '')}`,
          title: consultText.failureTitle,
          state: d.resumeRequestedAt ? resumeBadge : <StatusBadge>{label(n.executionState, d.state)}</StatusBadge>,
          deliveryId: d.deliveryId ?? null,
          riderId: d.riderId ?? null,
          createdAt: d.resumeRequestedAt ?? d.createdAt,
          open: true,
        }),
      ),
    ...(help.data?.items ?? []).map(
      (it): ConsultRow => ({
        kind: 'help',
        key: `h:${it.deliveryId}:${it.requestId}`,
        to: helpPath(it.deliveryId, it.requestId),
        title: label(helpCategoryName, it.category),
        state: (
          <span className="flex flex-wrap items-center gap-1">
            <StatusBadge>{label(n.helpState, it.state)}</StatusBadge>
            {it.state !== 'RESOLVED' && it.deliveryId && resumeBy.has(it.deliveryId) && resumeBadge}
            {/* 같은 일의 배송 사건(RIDER_HELP) — 처리함에서 한 줄로: 도움요청 줄에 "사건 있음 ›"(사건 상세로) */}
            {it.caseId && (
              <Link className="text-xs text-primary hover:underline" to={caseDetailPath(it.caseId)} onClick={(e) => e.stopPropagation()} data-testid="help-case-link">
                {sm.hasCase} ›
              </Link>
            )}
          </span>
        ),
        deliveryId: it.deliveryId ?? null,
        riderId: it.riderId ?? null,
        createdAt: it.createdAt,
        open: it.state !== 'RESOLVED',
      }),
    ),
    ...(inquiries.data ?? []).map(
      (it): ConsultRow => ({
        kind: 'inquiry',
        key: `i:${it.inquiryId}`,
        to: `/inquiries/${encodeURIComponent(it.inquiryId)}`,
        title: it.title ?? label(n.inquiryCategory, it.category),
        chat: isLiveChat(it.title),
        state: <StatusBadge>{label(q.statusName, it.status)}</StatusBadge>,
        deliveryId: it.deliveryId ?? null,
        riderId: null,
        createdAt: it.createdAt,
        open: it.status !== 'CLOSED',
        waiting: it.status === 'RECEIVED',
      }),
    ),
  ].sort((a, b) => (a.kind === b.kind ? (a.createdAt ?? '').localeCompare(b.createdAt ?? '') * (tab === 'open' ? 1 : -1) : kindOrder[a.kind] - kindOrder[b.kind]));
  // 찾기·구분 거르기 — 불러온 목록 안에서(서버 목록에 번호 검색이 없어 화면에서 거른다)
  const needle = norm(query);
  const rows = allRows.filter((r) => {
    if (kindFilter !== 'all' && r.kind !== kindFilter) return false;
    if (!needle) return true;
    const no = r.deliveryId ? deliveryNos.get(r.deliveryId) : undefined;
    const rider = r.riderId ? riders.get(r.riderId) : undefined;
    return [r.title, no?.deliveryNumber, no?.orderNumber, rider?.nameMasked, rider?.riderNumber].some((x) => norm(x).includes(needle));
  });
  const filtered = !!needle || kindFilter !== 'all';
  // 둘 다 실패면 오류, 하나만 실패면 일부라고 알린다(빈 목록·0 으로 바꾸지 않는다)
  const bothFailed = help.isError && inquiries.isError;
  const loading = help.isPending || inquiries.isPending;
  const partial = !bothFailed && (help.isError || inquiries.isError);
  const listRows = useListRows(loading || bothFailed ? undefined : rows.map((r) => r.to), tab);
  const retryAll = () => {
    void help.refetch();
    void inquiries.refetch();
  };
  return (
    <div className="space-y-4">
      <GuideBox title={ui.guideTitle} items={consultText.guide} storeKey="consults" testId="consults-guide" />
      <StatStrip label={consultText.stripLabel} testId="consult-strip">
        <StatCard layout="row" label={consultText.kind.help} value={statText(stats.data?.openHelpRequests, stats.isError)} hint={consultText.stripHelpHint} tone={(stats.data?.openHelpRequests ?? 0) > 0 ? 'warning' : undefined} onClick={() => patch({ kind: kindFilter === 'help' ? '' : 'help' })} active={kindFilter === 'help'} testId="strip-help" />
        <StatCard layout="row" label={consultText.kind.failure} value={statText(stats.data?.inProgress?.['FAILURE_REPORTED'], stats.isError)} tone={(stats.data?.inProgress?.['FAILURE_REPORTED'] ?? 0) > 0 ? 'error' : undefined} {...(tab === 'open' ? { onClick: () => patch({ kind: kindFilter === 'failure' ? '' : 'failure' }), active: kindFilter === 'failure' } : {})} testId="strip-failure" />
        <StatCard layout="row" label={consultText.kind.inquiry} value={listCountText(openInquiries.data, openInquiries.isError)} hint={consultText.stripInquiryHint} onClick={() => patch({ kind: kindFilter === 'inquiry' ? '' : 'inquiry' })} active={kindFilter === 'inquiry'} testId="strip-inquiry" />
      </StatStrip>
      {/* 시뮬레이터 모양(2026-11-21): 왼쪽 찾기 칸 + 깔때기(종류) + 건 조건 칩 ✕ */}
      <SearchPanel
        testId="consults-search"
        onSubmit={(ev) => {
          ev.preventDefault();
          patch({ q: queryInput.trim() });
        }}
        onReset={() => {
          setQueryInput('');
          patch({ q: '', kind: '' });
        }}
        submitLabel={consultText.search}
        resetLabel={consultText.clear}
        summary={[
          [consultText.searchLabel, needle ? query : '', () => {
            setQueryInput('');
            patch({ q: '' });
          }],
        ]}
        active={kindFilter !== 'all'}
        // 구분은 고르기 하나뿐이라 팝업에 숨기지 않고 늘 보이는 붙은 단추 줄(찾기 단추와 세로 선으로 떨어뜨림 — 2026-11-21 사용자)
        filters={
          <>
            <span className="pm-fbar-filters-l" aria-hidden="true">
              {consultText.col.kind}
            </span>
            <ChipGroup
              label={consultText.col.kind}
              value={kindFilter}
              options={(['all', 'help', 'inquiry', ...(tab === 'open' ? (['failure'] as const) : [])] as const).map((k) => ({ value: k, label: k === 'all' ? consultText.allKinds : consultText.kind[k] }))}
              onChange={(k) => patch({ kind: k === 'all' ? '' : k })}
            />
          </>
        }
        search={
          <input
            className="input input-sm w-72 max-w-full"
            type="search"
            maxLength={64}
            placeholder={consultText.searchHint}
            aria-label={consultText.searchHint}
            value={queryInput}
            onChange={(ev) => setQueryInput(ev.target.value)}
          />
        }
      />

      {partial && (
        <p role="alert" className="alert alert-warning text-sm" data-testid="consults-partial">
          {consultText.partial(help.isError ? consultText.kind.help : consultText.kind.inquiry)}
          <button type="button" className="btn btn-xs" onClick={retryAll}>
            {consultText.retry}
          </button>
        </p>
      )}
      {bothFailed ? (
        <p role="alert" className="alert alert-error text-sm">
          {consultText.partial(`${consultText.kind.help}·${consultText.kind.inquiry}`)}
          <button type="button" className="btn btn-xs" onClick={retryAll}>
            {consultText.retry}
          </button>
        </p>
      ) : loading ? (
        <span className="loading loading-spinner" aria-label="불러오는 중" />
      ) : allRows.length === 0 && !filtered && tab === 'open' && help.isSuccess && inquiries.isSuccess && failures.isSuccess ? (
        // 상담할 건이 서버 0건(세 원천 모두 읽음)일 때만 "수고하셨어요"(2026-11-19 통합 백오피스 AllDone) — 하나라도 못 읽으면 위 경고
        <AllDone title={ui.allDone} body={consultText.empty.open} testId="consults-all-done" />
      ) : rows.length === 0 ? (
        <p className="rounded-box bg-base-100 px-4 py-10 text-center text-sm text-base-content/60" data-testid="consults-empty">
          {needle ? consultText.noMatch(query) : consultText.empty[tab]}
        </p>
      ) : (
        <div className="space-y-3">
          {help.data?.more && (
            <p role="alert" className="alert alert-warning text-sm" data-testid="consults-truncated">
              {consultText.truncated}
            </p>
          )}
          <ResultBar count={rows.length} more={!!help.data?.more} extra={<span className="text-xs text-base-content/50">{sm.autoRefresh(15)}</span>} />
          <DataTable>
            <thead>
              <tr>
                <th>{consultText.col.kind}</th>
                <th>{consultText.col.title}</th>
                <th>{consultText.col.state}</th>
                <th>{consultText.col.delivery}</th>
                <th>{consultText.col.order}</th>
                <th>{consultText.col.rider}</th>
                <th>{consultText.col.createdAt}</th>
                <th>{consultText.col.wait}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-testid="consult-row" data-kind={r.kind} className={`cursor-pointer ${listRows.rowClass(r.to)}`} onClick={() => void navigate(r.to)}>
                  <td className="whitespace-nowrap">
                    <StatusBadge>{consultText.kind[r.kind]}</StatusBadge>
                    {r.chat && (
                      <span className="ml-1 inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-content" data-testid="consult-chat">
                        {consultText.chat}
                      </span>
                    )}
                  </td>
                  <td className="font-semibold">
                    <Link className="hover:underline" to={r.to} onClick={(e) => e.stopPropagation()}>
                      {r.title}
                    </Link>
                    {listRows.seenMark(r.to)}
                  </td>
                  <td>{r.state}</td>
                  <td>{r.deliveryId ? <DeliveryRef deliveryId={r.deliveryId} numbers={deliveryNos.get(r.deliveryId)} /> : none}</td>
                  <td className="whitespace-nowrap font-mono" data-testid="consult-order">{(r.deliveryId && deliveryNos.get(r.deliveryId)?.orderNumber) || none}</td>
                  <td>{r.riderId ? <RiderName riderId={r.riderId} nameMasked={riders.get(r.riderId)?.nameMasked} riderNumber={riders.get(r.riderId)?.riderNumber} /> : none}</td>
                  <td className="whitespace-nowrap">{when(r.createdAt)}</td>
                  <td className="whitespace-nowrap">{r.open ? <WaitBadge from={r.createdAt} now={now} muted={r.waiting === false} /> : none}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      )}
    </div>
  );
}

/**
 * 상담 화면의 배송 조치 — 배송 상세의 "운영 조치"와 같은 양식(상태 정정·전달 실패 확정·반려·배차 취소).
 * 같은 조회 키를 써서 배송 상세와 캐시를 나눈다. 조치는 서버가 권한·상태를 판정한다.
 */
function HelpDeliveryActions({ deliveryId }: { readonly deliveryId: string }) {
  const api = useApi();
  const execution = useQuery({
    queryKey: ['delivery', deliveryId],
    refetchInterval: 10_000,
    queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}', { params: { path: { deliveryId } } })),
  });
  const dispatch = useQuery({
    queryKey: ['delivery-dispatch', deliveryId],
    refetchInterval: 10_000,
    queryFn: () => request('GET', api.dispatch.GET('/deliveries/{deliveryId}/dispatch', { params: { path: { deliveryId } } })),
  });
  return (
    <QueryState state={toUiState(execution)} onRetry={() => void execution.refetch()}>
      {(d) => <DeliveryActions delivery={d} dispatch={dispatch.data} />}
    </QueryState>
  );
}

/**
 * 도움요청을 닫은 직원(2026-11-23 사용자 "영어로 뜨고 식별값도 너무 길어 … 직원 식별값 짧게 보이는 규칙 있잖아").
 * 상담 관리(사건)에서 닫으면 execution 은 `resolvedBy` 에 "case:<사건 ID>" 를 남긴다 — 그 사건의 닫은 직원(closure.closedBy)을 읽어
 * 다른 화면처럼 "이름 · 사번"(StaffName)으로 보인다. 사건을 못 읽으면 "상담 관리에서 완료"만(긴 ID 를 보이지 않는다).
 */
function HelpClosedBy({ resolvedBy, me }: { readonly resolvedBy: string; readonly me?: string | undefined }) {
  const api = useApi();
  const caseId = resolvedBy.startsWith('case:') ? resolvedBy.slice('case:'.length) : null;
  const kase = useQuery({
    queryKey: ['case', caseId],
    enabled: !!caseId,
    staleTime: 60_000,
    queryFn: () => request('GET', api.cases.GET('/cases/{caseId}', { params: { path: { caseId: caseId! } } })),
  });
  if (!caseId) return <StaffName operatorId={resolvedBy} me={me} />;
  const closer = kase.data?.closure?.closedBy;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      {closer && <StaffName operatorId={closer} me={me} />}
      <span className={closer ? 'text-xs font-normal text-base-content/55' : ''}>{sm.help.viaConsults}</span>
    </span>
  );
}

/** 서버 처리 메모의 옛 말("사건함에서 닫음")·상태 코드("RESOLVED")를 화면 말로(뜻은 그대로). */
function helpNoteText(note: string): string {
  return humanizeCodes(note.replace(/사건함에서 닫음\s*\(RESOLVED\)/g, '상담 관리에서 완료').replace(/사건함에서 닫음/g, '상담 관리에서 완료'));
}
