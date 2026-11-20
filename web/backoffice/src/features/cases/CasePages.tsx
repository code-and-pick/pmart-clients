// 지원센터 사건함(case 0.4.0, 백엔드 요청 backoffice/2026-11-16-request-case-inbox-and-pending-work §1).
// - 목록 `GET /cases`: 탭 = 안 집은 것(unassigned=true)·내 것(assigneeId=나)·기한 넘김(overdue=true)·닫힌 것(state=CLOSED). 탭은 URL 쿼리. 긴급·기한 이른 것 먼저(서버 순서 그대로).
//   refs(deliveryId·orderId·riderId)는 배송·주문·라이더 화면으로. 기한 넘김은 빨간 표시(표시만).
// - 상세 `GET /cases/{caseId}`: 이력·종결. 집기 `POST …/assignments` {assigneeId: 나}(관리자는 다른 사람도), 닫기 `POST …/closures` {resolution, summary}.
//   응답은 사건 상세(200) — 그 값으로 바로 바꾼다. 409(이미 다른 사람이 집음·닫힘)는 문구로.
// - 오배송 열기 `POST /cases` {kind: MISDELIVERY, subjectType: DELIVERY, subjectRef: deliveryId, summary, evidence?} → 201 → 상세. 409 CASE_ALREADY_OPEN.
// - 역할: 집기·닫기 버튼은 RIDER_OPS·OPERATOR_ADMIN 에게만(CS_AGENT 는 보기). 다른 사람이 집은 사건 닫기는 관리자만. 판정은 서버.
// - 요약·근거에 고객 주소·연락처 원문을 적지 않게 안내한다.
// - case 0.5.0 배차 실패 DISPATCH_FAILED — 배송 쪽(모든 역할, 집기·닫기 RIDER_OPS·관리자), refs deliveryId·orderId, 뒤 실패는 이력 RECURRED(재발).
// - case 0.5.0(백엔드 PR #21, R-3): 사가·결제 이상 RECONCILIATION·PAYMENT_UNKNOWN — 관리자만 보이고(종류 필터도 관리자만),
//   사건은 알림·기록, 조치는 처리 대기(/pending)·각 메뉴. refs 에 orderId(주문 화면 링크)·sagaId·paymentAttemptId·resourceId.
// - 목록은 bff 0.5.0 `GET /backoffice/views/case-inbox`(백엔드 요청 request-case-inbox-linked-state) — case 목록 값 + 연결 배송·주문의 지금 상태(linked).
//   linked 칸: confidence UNKNOWN → "확인 불가"(장애이거나 그 역할이 못 보는 원천), state null + DIRECT → "원천에 없음". 원천 값은 기존 상태 이름표로만 옮긴다.
//   unavailableSources 에 case-service 가 있으면 목록 자체를 못 읽은 것 → 오류(빈 목록 아님). size 최대 50 → page.nextCursor 로 다음 쪽(URL cursor).
//   집기·닫기·상세는 그대로 case-service 직접.
// - case 0.6.0 다시 열기 `POST /cases/{id}/reopenings` {reason} — 닫힌 사건, 닫기와 같은 사람(배송 쪽 = 지원센터·관리자, 관리자 팀 사건 = 관리자).
//   REOPENED 는 열린 사건. 409 CASE_ALREADY_OPEN = 같은 일로 열린 사건이 있음 → 통합 조회로 그 대상의 사건을 찾게 안내. refs previousCaseId → "이전 사건" 링크.
// - case 0.7.0 넘기기 `POST /cases/{id}/transfers` {toGroup, reason} — 배송 쪽 사건만 지원센터(DELIVERY_OPS) ↔ 관리자 팀(ORDER_OPS). 담당 비움·기한 그대로.
//   관리자 팀으로 간 배송 쪽 사건은 지원센터·상담원이 보기만 — 목록·상세에 "관리자 처리 중"(해결된 것처럼 보이지 않게, 업무 원문 §5.3).
//   버튼은 할 수 있어 보일 때만(판정은 서버 — 403·409·422 는 코드 문구).
// - bff 0.14.0 화면 번호(ADR-0070): 목록 관련 칸은 배송·주문 번호(linked[].displayNumber)·라이더(riders[]) — 링크는 시스템 ID.
//   상세는 case-service 직접(화면 번호 없음)이라 지금 모양 그대로.
import { QueueNav, useRememberQueue } from '../../shared/workQueue';
import { pushToast } from '../../shared/toast';
import { SeenMark } from '../../shared/SeenMark';
import { useSeenIds } from '../../shared/recentViews';
import { useNewIds, useNow } from '../../shared/motion';
import { useStaffText } from '../../shared/employeeLabels';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode, useRef } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { ProblemFailure, request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams, IdempotencyKey } from '../../api/command';
import type { operations as BffOps } from '../../api/generated/backoffice-bff';
import type { components } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { CodeLabel, NextAction, Notice, PageHeader, StatCard, StatStrip, StatusBadge, countCell, type Tone, AllDone, ListHeader, listCount, refreshOf } from '../../shared/admin';
import { SavedViews } from '../../shared/SavedViews';
import { useRecordRecent } from '../../shared/recentViews';
import { TabCount, useAlertCount } from '../../app/MenuAlerts';
import { PreviewDrawer, PreviewFacts, usePreview } from '../../shared/Preview';
import { messages as m } from '../../shared/messages';
import { label, text, when } from '../../shared/ops';
import { SourceStamps } from '../../shared/SourceStamps';
import { DisplayNumber, RiderLabel, riderSourceFailed, SystemNumbers } from '../../shared/displayNumber';
import { CaseNumber } from '../../shared/CaseNumber';
import { DispatchUnavailableCancel } from '../claims/DispatchUnavailableCancel';
import { DeliveryNo, OrderNo, RiderNo } from '../../shared/RefNumber';
import { useResolvedRef } from '../../shared/numberLookups';
import { RefStatus } from '../../shared/RefField';
import { DeliveryStartActions } from '../../shared/StartActions';
import { DeliveryPicker } from '../../shared/DeliveryPicker';
import { canSeeIntakes, CsIntakeLog } from '../csIntakes/CsIntakePages';
import { CaseNotes } from './CaseNotes';
import { ActionRequests } from './ActionRequests';
import { HelpChat } from './HelpChat';
import { useMarkCaseSeen } from './caseSeen';
import { hasNewRiderMessage } from './helpChatRead';
import { FollowUps, isOpenObligation } from './FollowUps';
import { ClaimOfCase } from '../claims/ReturnClaim';
import { CaseBoard } from './CaseBoard';
import { LayoutToggle } from '../../shared/Kanban';
import { TableSettings } from '../../shared/TableSettings';
import { useHelp } from '../../shared/HelpPanel';

type Case = components['schemas']['Case'];
type InboxView = BffOps['getCaseInboxView']['responses'][200]['content']['application/json'];
type InboxItem = NonNullable<InboxView['items']>[number];
type Linked = NonNullable<InboxItem['linked']>[number];

const CASE_SOURCE = 'case-service';

/** bff 가 case 목록을 못 읽었으면(unavailableSources 에 case-service) 빈 목록이 아니라 조회 실패 */
class CaseSourceUnavailable extends Error {}
type Summary = components['schemas']['CaseSummary'];
type Resolution = keyof typeof m.cases.resolutionName;
const RESOLUTIONS = Object.keys(m.cases.resolutionName) as Resolution[];
type Kind = components['schemas']['CaseKind'];
/** 배송 쪽(0.4.0 넷 + 0.5.0 배차 실패 — RIDER_OPS·CS_AGENT·관리자) */
const DELIVERY_KINDS: readonly Kind[] = ['RIDER_HELP', 'DELIVERY_INCIDENT', 'RIDER_LOCATION_STALE', 'MISDELIVERY', 'DISPATCH_FAILED'];
/** 고객센터 팀(CS) 사건 — case 0.22.0 반품 회수 실패(R-8): 상담원이 맡고 완료 처리하는 첫 종류, 지원센터에는 안 보임 */
// case 0.27.0 R-9 배차 지연(DISPATCH_DELAYED) — 상담원 팀(상담원이 맡고 닫음, 관리자 모두, 지원센터에는 안 보임 — 서버 판정)
const CS_KINDS: readonly Kind[] = ['RETURN_RECOVERY_FAILED', 'DISPATCH_DELAYED'];
const isCsCase = (c: { readonly kind?: string | null; readonly assigneeGroup?: string | null }) =>
  c.assigneeGroup === 'CS' || (c.kind !== undefined && c.kind !== null && (CS_KINDS as readonly string[]).includes(c.kind));
/** 사가·결제 이상(0.5.0 — 관리자만) */
const ORDER_KINDS: readonly Kind[] = ['RECONCILIATION', 'PAYMENT_UNKNOWN'];
const isOrderKind = (k: Kind | undefined) => k !== undefined && ORDER_KINDS.includes(k);
/** 관리자 팀으로 넘어간 배송 쪽 사건 — 지원센터·상담원은 보기만(0.7.0) */
const withAdminTeam = (c: { readonly kind?: string | null; readonly assigneeGroup?: string | null }) =>
  c.assigneeGroup === 'ORDER_OPS' && !isOrderKind((c.kind ?? undefined) as Kind | undefined);
type Tab = keyof typeof m.cases.tabs;
const TABS = Object.keys(m.cases.tabs) as Tab[];
const isTab = (v: string | null): v is Tab => TABS.some((t) => t === v);

function useCaseRoles() {
  const { session } = useSession();
  const roles = session?.roles ?? [];
  return {
    me: session?.subject ?? '',
    admin: roles.includes('OPERATOR_ADMIN'),
    team: roles.includes('RIDER_OPS'),
    agent: roles.includes('CS_AGENT'),
  };
}

const refLink = (refType: string | undefined, refId: string | undefined) => {
  if (!refId) return null;
  const to =
    refType === 'deliveryId' || refType === 'recoveryDeliveryId' || refType === 'reshipmentDeliveryId'
      ? `/deliveries/${encodeURIComponent(refId)}`
      : refType === 'orderId'
        ? `/orders/${encodeURIComponent(refId)}`
        : refType === 'riderId'
          ? `/riders/${encodeURIComponent(refId)}`
          : refType === 'previousCaseId'
            ? `/cases/${encodeURIComponent(refId)}`
            : refType === 'claimId'
              ? `/claims/${encodeURIComponent(refId)}`
              : refType === 'lastDeliveryId'
                ? `/deliveries/${encodeURIComponent(refId)}`
                : null;
  // 시스템 ID 인 관련 칸(…Id — 사가·클레임·사고 등)은 종류 이름만(ADR-0070 덧붙임 — 글자로 ID 를 보이지 않고 링크 대상으로만)
  const isSystemId = Boolean(refType?.endsWith('Id'));
  const value = refType === 'fault' ? label(m.cases.faultName, refId) : refType === 'resolution' ? label(m.cases.resolutionChoiceName, refId) : isSystemId ? '' : refId;
  const name = `${label(m.cases.refName, refType)}${value ? ` ${value}` : ''}`;
  // 배송·주문·라이더는 그 원천의 화면 번호로(ADR-0070 덧붙임 — 시스템 ID 는 링크 대상으로만)
  const numbered =
    refType === 'deliveryId' || refType === 'recoveryDeliveryId' || refType === 'reshipmentDeliveryId' || refType === 'lastDeliveryId' ? (
      <DeliveryNo id={refId} />
    ) : refType === 'orderId' ? (
      <OrderNo id={refId} />
    ) : refType === 'riderId' ? (
      <RiderNo id={refId} />
    ) : null;
  if (numbered && to)
    return (
      <Link key={`${refType}:${refId}`} className="link" to={to}>
        {`${label(m.cases.refName, refType)} `}
        {numbered}
      </Link>
    );
  // 이전 접수 건은 화면 번호로(ADR-0070 덧붙임)
  if (refType === 'previousCaseId' && to)
    return (
      <Link key={`${refType}:${refId}`} className="link" to={to}>
        {`${label(m.cases.refName, refType)} `}
        <CaseNumber caseId={refId} />
      </Link>
    );
  return to ? (
    <Link key={`${refType}:${refId}`} className="link" to={to}>
      {name}
    </Link>
  ) : (
    <span key={`${refType}:${refId}`}>{name}</span>
  );
};

function Refs({ c }: { readonly c: Pick<Summary, 'refs' | 'subjectRef'> }) {
  const refs = c.refs ?? [];
  if (refs.length === 0) return <span>{text(c.subjectRef)}</span>;
  return <span className="flex flex-wrap gap-x-2">{refs.map((r) => refLink(r.refType, r.refId))}</span>;
}

/** bff case-inbox 가 linked 로 잇는 배송 refs(그 밖 refs 는 번호가 오지 않아 그대로) */
const DELIVERY_REF_TYPES = ['deliveryId', 'recoveryDeliveryId', 'reshipmentDeliveryId'];

/**
 * 목록의 관련 칸(bff 0.14.0, ADR-0070) — 배송·주문은 linked[].displayNumber, 라이더는 riders[](가린 이름 + 번호). 링크는 시스템 ID 로.
 * 번호가 없으면 ID 끝 8자리 + "번호 없음". 연결 원천을 못 읽었으면(UNKNOWN) 또는 rider-service 실패면 "번호 확인 불가". 그 밖 refs 는 그대로.
 */
function ListRefs({ c, riderFailed }: { readonly c: InboxItem; readonly riderFailed: boolean }) {
  const refs = c.linkedRefs ?? [];
  if (refs.length === 0) return <span>{text(c.subjectRef)}</span>;
  const linkedOf = (kind: 'DELIVERY' | 'ORDER', id: string) => (c.linked ?? []).find((l) => l.kind === kind && l.id === id);
  return (
    <span className="flex flex-wrap gap-x-2">
      {refs.map((r) => {
        const refType = r.kind ?? '';
        const refId = r.id ?? '';
        if (!refId) return null;
        const key = `${refType}:${refId}`;
        const name = `${label(m.cases.refName, refType)} `;
        if (DELIVERY_REF_TYPES.includes(refType) || refType === 'orderId') {
          const delivery = refType !== 'orderId';
          const l = linkedOf(delivery ? 'DELIVERY' : 'ORDER', refId);
          return (
            <Link key={key} className="link" to={delivery ? `/deliveries/${encodeURIComponent(refId)}` : `/orders/${encodeURIComponent(refId)}`}>
              {name}
              <DisplayNumber number={l?.displayNumber} systemId={refId} failed={l?.source?.confidence === 'UNKNOWN'} />
            </Link>
          );
        }
        if (refType === 'riderId')
          return (
            <Link key={key} className="link" to={`/riders/${encodeURIComponent(refId)}`}>
              {name}
              <RiderLabel rider={(c.riders ?? []).find((x) => x?.riderId === refId) ?? undefined} riderId={refId} failed={riderFailed} />
            </Link>
          );
        return refLink(refType, refId);
      })}
    </span>
  );
}

/** 연결 배송·주문 한 칸 — 원천 값을 기존 상태 이름표로만 옮긴다(합치거나 해석하지 않음) */
/** 연결 배송의 쓰임 — 원래 배송(subjectRef)·회수(refs recoveryDeliveryId, case 0.8.1)·재발송(refs reshipmentDeliveryId, case 0.11.2) */
type DeliveryRole = 'recovery' | 'reshipment' | null;
const deliveryRoleOf = (refs: ReadonlyArray<{ readonly kind?: string; readonly id?: string }> | undefined, id: string | undefined): DeliveryRole =>
  (refs ?? []).some((x) => x.kind === 'recoveryDeliveryId' && x.id === id)
    ? 'recovery'
    : (refs ?? []).some((x) => x.kind === 'reshipmentDeliveryId' && x.id === id)
      ? 'reshipment'
      : null;

/** 도움요청 칸(bff 0.6.0) — 상태 + 새 메시지 점(라이더 마지막 메시지 뒤로 내가 이 건을 안 봄 — bff 0.10.0 myLastSeenAt) */
function LinkedHelp({ l, seenAt }: { readonly l: Linked; readonly seenAt: string | null | undefined }) {
  const unknown = l.source?.confidence === 'UNKNOWN';
  const fresh = !unknown && hasNewRiderMessage(l.lastRiderMessageAt, seenAt);
  return (
    <li data-testid="case-linked" data-kind={l.kind} data-id={l.id}>
      <span className="opacity-70">{m.cases.linkedHelp}</span>{' '}
      {unknown ? (
        <span className="text-warning">{m.cases.linkedUnknown}</span>
      ) : l.state ? (
        label(m.helpQueue.state, l.state)
      ) : (
        <span className="opacity-70">{m.cases.linkedMissing}</span>
      )}
      {fresh && (
        <span className="badge badge-error badge-xs ml-1" data-testid="case-new-message">
          {m.cases.newMessage}
        </span>
      )}
    </li>
  );
}

function LinkedState({ l, role, seenAt }: { readonly l: Linked; readonly role: DeliveryRole; readonly seenAt?: string | null | undefined }) {
  if (l.kind === 'HELP_REQUEST') return <LinkedHelp l={l} seenAt={seenAt} />;
  const name =
    l.kind === 'ORDER' ? m.cases.linkedOrder : role === 'recovery' ? m.cases.linkedRecovery : role === 'reshipment' ? m.cases.linkedReshipment : m.cases.linkedDelivery;
  const unknown = l.source?.confidence === 'UNKNOWN';
  const value = unknown ? (
    <span className="text-warning">{m.cases.linkedUnknown}</span>
  ) : l.state ? (
    label(l.kind === 'ORDER' ? m.orders.statusName : m.deliveries.executionState, l.state)
  ) : (
    <span className="opacity-70">{m.cases.linkedMissing}</span>
  );
  return (
    <li data-testid="case-linked" data-kind={l.kind} data-id={l.id}>
      <span className="opacity-70">{name}</span> {value}
    </li>
  );
}

/** 기한 임박 — 이 시간 안이면 주황 점이 숨쉰다(2026-11-19). 넘김 판단은 서버 overdue 만 */
const DUE_SOON_MS = 15 * 60_000;

function Sla({ c }: { readonly c: Pick<Summary, 'slaDueAt' | 'overdue'> & { readonly state?: string | null } }) {
  const now = useNow(30_000);
  if (!c.slaDueAt) return <span>{m.none}</span>;
  const left = Date.parse(c.slaDueAt) - now;
  // 서버가 넘겼다고 하지 않았고, 닫히지 않았고, 15분 안 — 화면은 남은 분만 센다(넘김 확정은 서버 overdue)
  const soon = !c.overdue && c.state !== 'CLOSED' && Number.isFinite(left) && left > 0 && left <= DUE_SOON_MS;
  return (
    <span className={`inline-flex items-center gap-1 ${c.overdue ? 'font-semibold text-error' : soon ? 'font-semibold text-warning' : ''}`} data-overdue={c.overdue ? 'true' : 'false'} data-due-soon={soon ? 'true' : undefined}>
      {c.overdue && <Icon d={ICON.alert} className="h-3.5 w-3.5 shrink-0" />}
      {soon && <span className="breathe h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden="true" data-testid="due-soon-dot" />}
      {when(c.slaDueAt)}
      {c.overdue && ` · ${m.cases.overdue}`}
      {soon && ` · ${m.cases.dueSoon(Math.max(1, Math.ceil(left / 60_000)))}`}
    </span>
  );
}

// ---------------------------------------------------------------- 보기 부품(2026-11-18 사용자 "밋밋하다" — 이슈 트래커처럼)

const ICON = {
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  inbox: 'M4 13h4l1.5 2.5h5L16 13h4M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5Z',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z',
  check: 'M5 12l5 5L20 7',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5m4-1v5l3 2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
} as const;

function Icon({ d, className = 'h-4 w-4' }: { readonly d: string; readonly className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`fill-none stroke-current ${className}`} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/** 종류 색 — 한국어 이름이 있는 종류만 색을 준다 */
const KIND_TONE: Readonly<Record<string, Tone>> = {
  RIDER_HELP: 'info',
  DELIVERY_INCIDENT: 'warning',
  RIDER_LOCATION_STALE: 'neutral',
  MISDELIVERY: 'error',
  DISPATCH_FAILED: 'warning',
  RECONCILIATION: 'accent',
  PAYMENT_UNKNOWN: 'accent',
  RETURN_RECOVERY_FAILED: 'info',
  DISPATCH_DELAYED: 'warning',
};

function KindBadge({ kind }: { readonly kind: string | null | undefined }) {
  if (!kind) return <span>{m.none}</span>;
  const named = m.cases.kindName[kind] !== undefined;
  return named ? (
    <StatusBadge tone={KIND_TONE[kind] ?? 'ghost'}>
      <CodeLabel code={kind} names={m.cases.kindName} />
    </StatusBadge>
  ) : (
    <CodeLabel code={kind} names={m.cases.kindName} />
  );
}

function PriorityBadge({ p }: { readonly p: string | null | undefined }) {
  if (!p) return <span>{m.none}</span>;
  const cls = p === 'P1' ? 'badge-error' : p === 'P2' ? 'badge-warning badge-soft' : 'badge-ghost';
  return <span className={`badge badge-sm font-mono font-semibold ${cls}`}>{p}</span>;
}

const stateTone = (c: { readonly state?: string | null; readonly overdue?: boolean | null }): Tone =>
  c.state === 'CLOSED' ? 'ghost' : c.overdue ? 'error' : c.state === 'REOPENED' ? 'warning' : 'info';

/** 운영자 — 머리글자 동그라미 + 이름 · 사번(ADR-0070 덧붙임). 비었으면 "아무도 안 맡음"(흐리게) */
function Person({ id }: { readonly id: string | null | undefined }) {
  const name = useStaffText(id);
  if (!id) return <span className="text-base-content/50">{m.cases.unassigned}</span>;
  const letter = name.replace(/^\[목\]\s*/, '').charAt(0) || '?';
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary" aria-hidden="true">
        {letter}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/** 이력 한 줄(한 문장) — 행위자는 직원이면 이름 · 사번(ADR-0070 덧붙임), 시스템(SYSTEM 등 직원 아님)은 그대로 */
function HistoryText({ h }: { readonly h: { readonly action?: string | null; readonly actorId?: string | null; readonly toState?: string | null; readonly note?: string | null } }) {
  const system = Boolean(h.actorId && /^[A-Z_]+$/.test(h.actorId));
  const name = useStaffText(system ? null : h.actorId);
  const actor = system ? (h.actorId ?? '') : name || text(h.actorId);
  return <p>{`${h.action ? label(m.cases.actionName, h.action) : text(h.action)} · ${actor}${h.toState ? ` → ${label(m.cases.stateName, h.toState)}` : ''}${h.note ? ` · ${h.note}` : ''}`}</p>;
}

/** 상세 본문 칸 — 제목 줄(아이콘) + 내용 */
function Panel({ title, icon, aside, children, testId }: { readonly title: ReactNode; readonly icon?: string; readonly aside?: ReactNode; readonly children: ReactNode; readonly testId?: string }) {
  return (
    <section className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm" data-testid={testId}>
      <div className="flex items-center justify-between gap-2 border-b border-base-300 px-5 py-3">
        <h2 className="flex items-center gap-2 font-semibold">
          {icon && <Icon d={icon} className="h-4 w-4 text-base-content/50" />}
          {title}
        </h2>
        {aside}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/** 기록 탭 — 고른 하나만 보인다(나머지는 숨김, 내용·조회는 그대로) */
function RecordTabs({ tabs }: { readonly tabs: ReadonlyArray<{ readonly id: string; readonly label: string; readonly body: ReactNode }> }) {
  const [on, setOn] = useState(tabs[0]?.id ?? '');
  return (
    <div className="space-y-3" data-testid="case-record-tabs">
      <div role="tablist" aria-label={m.cases.recordTabs.label} className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-base-300">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on === t.id}
            onClick={() => setOn(t.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${on === t.id ? 'border-primary font-semibold' : 'border-transparent text-base-content/55 hover:text-base-content'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" className={on === t.id ? 'space-y-4' : 'hidden'}>
          {t.body}
        </div>
      ))}
    </div>
  );
}

/** 오른쪽 속성 한 줄(이름 왼쪽 작게, 값 오른쪽) */
function Prop({ name, children, testId }: { readonly name: ReactNode; readonly children: ReactNode; readonly testId?: string }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-start gap-2 py-2">
      <dt className="pt-0.5 text-xs text-base-content/55">{name}</dt>
      <dd className="min-w-0 break-words text-sm" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

export function CaseListPage() {
  const api = useApi();
  const { me, admin, team, agent } = useCaseRoles();
  // 미리보기 칸(2026-11-18) — 줄을 누르면 목록을 떠나지 않고 오른쪽에 요약
  const pv = usePreview((id) => `/cases/${encodeURIComponent(id)}`);
  // 반품 회수 실패(CS 팀)는 상담원·관리자만 — 지원센터에는 안 보인다(서버도 목록에서 뺀다)
  const kinds = admin ? [...DELIVERY_KINDS, ...CS_KINDS, ...ORDER_KINDS] : agent ? [...DELIVERY_KINDS, ...CS_KINDS] : DELIVERY_KINDS;
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = isTab(tabParam) ? tabParam : 'unassigned';
  const kind = kinds.find((k) => k === params.get('kind'));
  const cursor = params.get('cursor') ?? '';
  const setQuery = (next: { tab?: Tab; kind?: Kind | ''; cursor?: string }) => {
    const k = next.kind === undefined ? kind : next.kind || undefined;
    setParams({ tab: next.tab ?? tab, ...(k ? { kind: k } : {}), ...(next.cursor ? { cursor: next.cursor } : {}) });
  };
  const query = useQuery({
    queryKey: ['cases', tab, me, kind ?? '', cursor],
    queryFn: async (): Promise<InboxView> => {
      const view = await request(
        'GET',
        api.bff.GET('/views/case-inbox', {
          params: {
            query: {
              size: 50,
              ...(kind ? { kind } : {}),
              ...(tab === 'unassigned' ? { unassigned: true } : {}),
              ...(tab === 'mine' ? { assignee: me } : {}),
              ...(tab === 'overdue' ? { overdue: true } : {}),
              ...(tab === 'closed' ? { state: 'CLOSED' } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      );
      if ((view.unavailableSources ?? []).includes(CASE_SOURCE)) throw new CaseSourceUnavailable(CASE_SOURCE);
      return view;
    },
  });
  // 새로 들어온 접수 건 — 5초 동안 강조(2026-11-19). 탭·종류·쪽이 바뀌면 다시 센다
  const fresh = useNewIds(query.data?.items?.flatMap((c) => (c.caseId ? [c.caseId] : [])), `${tab}|${kind ?? ''}|${cursor}`);
  const seen = useSeenIds('case');
  // 상세에서 이전·다음으로 넘기도록 지금 목록 순서를 기억(2026-11-19)
  useRememberQueue('case', query.data?.items?.flatMap((c) => (c.caseId ? [c.caseId] : [])), `/cases?${params.toString()}`);
  const roles = { admin, team, agent };
  // 일괄 맡기(2026-11-19 쿠팡 윙 "N개 선택됨 [일괄 처리]" 참고) — 맡을 수 있는 줄만 고른다
  const bulk = useBulkPick();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const pickable = (query.data?.items ?? []).flatMap((c) => (c.caseId && canPickCase(c, roles) ? [c.caseId] : []));
  const allPicked = pickable.length > 0 && pickable.every((id) => picked.has(id));
  const togglePick = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const board = params.get('layout') === 'board';
  const help = useHelp('cases', m.cases.title, <>{m.help.cases.map((t) => <p key={t}>{t}</p>)}</>);
  const setBoard = (on: boolean) => {
    const next = new URLSearchParams(params);
    if (on) next.set('layout', 'board');
    else next.delete('layout');
    setParams(next);
  };
  return (
    <section className="space-y-4">
      {/* 표 / 보드(2026-11-20 사용자 "보드로 보기") — 주소 layout=board 로 기억 */}
      <ListHeader title={m.cases.title} count={board ? undefined : listCount(query)} refresh={board ? undefined : refreshOf(query)} onInfo={help?.open} actions={<LayoutToggle board={board} onChange={setBoard} />} />
      {board ? (
        <CaseBoard kind={kind} />
      ) : (
      <>
      {/* 숫자 띠(2026-11-19 관제 형식) — 탭 개수와 같은 조회, 종류를 골랐으면 숫자가 달라 숨긴다 */}
      {!kind && <CaseStrip tab={tab} />}
      {/* 내 보기(2026-11-18 Saleor 참고) — 지금 주소 조건을 이름 붙여 저장 */}
      <SavedViews listKey="cases" />
      {/* 한 카드(2026-11-18 이슈 트래커 목록처럼): 밑줄 탭 → 종류 거르기 줄 → 표 → 아래 쪽 넘기기 */}
      <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm" data-testid="case-list-card">
        <div role="tablist" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-base-300 px-3">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === tab}
              className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${t === tab ? 'border-primary font-semibold text-base-content' : 'border-transparent text-base-content/55 hover:text-base-content'}`}
              onClick={() => setQuery({ tab: t })}
            >
              {t === 'overdue' && <Icon d={ICON.alert} className={`h-3.5 w-3.5 ${t === tab ? 'text-error' : ''}`} />}
              {m.cases.tabs[t]}
              {/* 탭 옆 개수(2026-11-18) — 메뉴 알림과 같은 조회, 종류를 골랐으면 그 개수와 달라 숨긴다 */}
              {!kind && t === 'unassigned' && <TabCount alert="casesUnassigned" tone="warning" />}
              {!kind && t === 'overdue' && <TabCount alert="casesOverdue" tone="error" />}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-base-300 bg-base-200/40 px-4 py-2.5">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-xs font-medium text-base-content/55">{m.cases.kind}</span>
            <select className="select select-sm w-48 bg-base-100" value={kind ?? ''} onChange={(e) => setQuery({ kind: kinds.find((k) => k === e.target.value) ?? '' })}>
              <option value="">{m.cases.anyKind}</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {label(m.cases.kindName, k)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {/* 할 일 탭이 서버 0건이면 "다 처리했어요"(2026-11-19 쿠팡 윙 배송관리 참고) — 처리 끝남 탭·실패·읽는 중에는 그리지 않는다 */}
        {query.isSuccess && (query.data.items ?? []).length === 0 && tab !== 'closed' && (
          <div className="p-4">
            <AllDone title={m.allDone.cases} body={m.allDone.casesBody} testId="cases-all-done" />
          </div>
        )}
        {!(query.isSuccess && (query.data.items ?? []).length === 0 && tab !== 'closed') && (
        <QueryState state={toUiState(query, (r) => (r.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={m.cases.empty}>
          {(r) => (
            <>
              {((r.sources ?? []).length > 0 || (r.unavailableSources ?? []).length > 0) && (
                <div className="border-b border-base-300 px-4 py-2">
                  <SourceStamps sources={r.sources} unavailableSources={r.unavailableSources} />
                </div>
              )}
              {pickable.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 border-b border-base-300 px-4 py-2.5 text-sm" data-testid="case-bulk-bar">
                  <span className="text-base-content/60">{m.cases.bulk.picked(picked.size)}</span>
                  <button
                    type="button"
                    className="btn btn-outline btn-primary btn-xs"
                    disabled={picked.size === 0 || bulk.busy}
                    onClick={() =>
                      void bulk.run([...picked]).then((done) => {
                        setPicked(new Set([...picked].filter((id) => !done.includes(id))));
                      })
                    }
                    data-testid="case-bulk-pick"
                  >
                    {bulk.busy ? m.cases.bulk.running(bulk.progress, picked.size) : m.cases.bulk.pick}
                  </button>
                  {bulk.result && <span role="status" className={bulk.result.failed > 0 ? 'text-warning' : 'text-success'} data-testid="case-bulk-result">{m.cases.bulk.result(bulk.result.done, bulk.result.failed)}</span>}
                </div>
              )}
              {/* 표 설정 톱니(2026-11-20 AWS) — 칸 켜고 끄기·줄 바꿈. 머리·줄 모양은 index.css 토큰(예전 작은 회색 머리·넉넉한 줄 뺌) */}
              <div className="flex justify-end border-b border-base-300 px-2 py-0.5">
                <TableSettings storeKey="cases" tableId="case-table" />
              </div>
              <div className="overflow-x-auto">
                <table id="case-table" className="table [&_tbody_tr:hover]:bg-base-200/60">
                  <thead>
                    <tr>
                      {pickable.length > 0 && (
                        <th className="w-8">
                          <input type="checkbox" className="checkbox checkbox-xs" aria-label={m.cases.bulk.pickAll} checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(pickable))} />
                        </th>
                      )}
                      <th className="w-12">{m.cases.priority}</th>
                      <th>{m.cases.summary}</th>
                      <th>{m.cases.kind}</th>
                      <th>{m.cases.refs}</th>
                      <th>{m.cases.linked}</th>
                      <th>{m.cases.sla}</th>
                      <th>{m.cases.assignee}</th>
                      <th>{m.cases.state}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(r.items ?? []).map((c, i) => (
                      <tr
                        key={c.caseId ?? `case-${i}`}
                        data-testid="case-row"
                        {...pv.row(c.caseId)}
                        className={`${pv.row(c.caseId).className ?? ''} ${c.overdue && pv.id !== c.caseId ? 'bg-error/5 shadow-[inset_3px_0_0_var(--color-error)]' : ''} ${c.caseId && fresh.has(c.caseId) ? 'row-new' : ''}`}
                        data-new={c.caseId && fresh.has(c.caseId) ? 'true' : undefined}
                      >
                        {pickable.length > 0 && (
                          <td onClick={(e) => e.stopPropagation()}>
                            {c.caseId && pickable.includes(c.caseId) && (
                              <input type="checkbox" className="checkbox checkbox-xs" aria-label={m.cases.bulk.pickOne(c.caseNumber ?? '')} checked={picked.has(c.caseId)} onChange={() => togglePick(c.caseId ?? '')} />
                            )}
                          </td>
                        )}
                        <td>
                          <PriorityBadge p={c.priority} />
                        </td>
                        <td className="max-w-md">
                          {/* 줄 어디를 눌러도 오른쪽 미리보기(2026-11-20 — 이름만 상세로 가서 누른 자리마다 달랐다). 상세는 미리보기 "상세 열기"·Enter */}
                          {/* 2026-11-20 AWS 한 줄 줄: 요약 · 화면 번호 · 맡기를 한 줄에(번호는 ADR-0070 화면 번호 — 시스템 ID 는 보이지 않는다) */}
                          <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                            <span className="truncate font-medium" data-testid="case-summary">
                              {c.summary ? c.summary : label(m.cases.kindName, c.kind)}
                            </span>
                            {c.caseNumber && (
                              <span className="shrink-0 font-mono text-xs text-base-content/50" data-testid="case-number">
                                {c.caseNumber}
                                <SeenMark seen={!!c.caseId && seen.has(c.caseId)} />
                              </span>
                            )}
                            {c.caseId && canPickCase(c, roles) && <QuickPick caseId={c.caseId} caseNumber={c.caseNumber ?? null} />}
                          </span>
                        </td>
                        <td>
                          <KindBadge kind={c.kind} />
                        </td>
                        <td className="text-xs">
                          {/* 화면 번호(bff 0.14.0, ADR-0070 — main #137) */}<ListRefs c={c} riderFailed={riderSourceFailed(r.unavailableSources)} />
                        </td>
                        {/* 연결 상태·담당·상태 칸이 좁아 한 글자씩 꺾이던 것(2026-11-20 화면 점검) — 최소 폭·줄바꿈 막기 */}
                        <td className="min-w-40">
                          {(c.linked ?? []).length === 0 ? (
                            <span className="opacity-70">{m.none}</span>
                          ) : (
                            <ul className="flex items-center gap-x-3 whitespace-nowrap text-xs">
                              {(c.linked ?? []).map((l) => (
                                <LinkedState
                                  key={`${l.kind ?? ''}:${l.id ?? ''}`}
                                  l={l}
                                  role={l.kind === 'DELIVERY' ? deliveryRoleOf(c.linkedRefs, l.id) : null}
                                  seenAt={c.myLastSeenAt}
                                />
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-sm">
                          <Sla c={{ slaDueAt: c.slaDueAt ?? null, overdue: c.overdue ?? false, state: c.state ?? null }} />
                        </td>
                        <td className="whitespace-nowrap text-sm">
                          {withAdminTeam(c) && (
                            <span className="badge badge-warning badge-sm mb-1" data-testid="case-admin-team">
                              {m.cases.adminHandling}
                            </span>
                          )}
                          <Person id={c.assigneeId} />
                        </td>
                        <td className="whitespace-nowrap">
                          <StatusBadge tone={stateTone(c)}>{c.state ? <CodeLabel code={c.state} names={m.cases.stateName} /> : m.none}</StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pv.id && (
                <PreviewDrawer
                  id={pv.id}
                  ids={(r.items ?? []).map((c) => c.caseId ?? '').filter(Boolean)}
                  onMove={pv.open}
                  onClose={pv.close}
                  title={label(m.cases.kindName, (r.items ?? []).find((c) => c.caseId === pv.id)?.kind)}
                  detailTo={`/cases/${encodeURIComponent(pv.id)}`}
                >
                  <CasePreview caseId={pv.id} />
                </PreviewDrawer>
              )}
              {/* 아래: 이 쪽 건수 · 쪽 넘기기 */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-base-300 px-4 py-3 text-sm">
                <span className="text-base-content/55">{m.cases.shown((r.items ?? []).length)}</span>
                {(cursor || r.page?.nextCursor) && (
                  <div className="flex gap-2">
                    {cursor && (
                      <button type="button" className="btn btn-sm border-base-300 bg-base-100" onClick={() => setQuery({})}>
                        {m.cases.firstPage}
                      </button>
                    )}
                    {r.page?.nextCursor && (
                      <button type="button" className="btn btn-sm border-base-300 bg-base-100" onClick={() => setQuery({ cursor: r.page?.nextCursor ?? '' })}>
                        {m.cases.nextPage}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </QueryState>
        )}
      </div>
      </>
      )}
    </section>
  );
}

/** 접수 건 미리보기 — 상세와 같은 조회 키(상세로 가도 다시 읽지 않는다). 맡기·완료 처리 같은 조치는 상세에서 */
function CasePreview({ caseId }: { readonly caseId: string }) {
  const api = useApi();
  const q = useQuery({ queryKey: ['cases', 'detail', caseId], queryFn: () => request('GET', api.cases.GET('/cases/{caseId}', { params: { path: { caseId } } })) });
  return (
    <QueryState state={toUiState(q)} onRetry={() => void q.refetch()}>
      {(c) => (
        <div className="space-y-4" data-testid="case-preview">
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge p={c.priority} />
            <KindBadge kind={c.kind} />
            <StatusBadge tone={stateTone(c)}>{c.state ? <CodeLabel code={c.state} names={m.cases.stateName} /> : m.none}</StatusBadge>
          </div>
          {c.summary && <p className="rounded-box bg-base-200/60 px-3 py-2 text-sm">{c.summary}</p>}
          <PreviewFacts
            rows={[
              [m.cases.sla, <Sla key="s" c={{ slaDueAt: c.slaDueAt ?? null, overdue: c.overdue ?? false, state: c.state ?? null }} />],
              [m.cases.previewGroup, label(m.cases.groupName, c.assigneeGroup)],
              [m.cases.assignee, <Person key="a" id={c.assigneeId} />],
              [m.cases.openedAt, when(c.openedAt)],
              (c.openObligationCount ?? 0) > 0 && [m.cases.previewObligations, <span key="o" className="font-semibold text-warning">{c.openObligationCount}</span>],
            ]}
          />
          <Refs c={c} />
        </div>
      )}
    </QueryState>
  );
}

/** 내가 맡을 수 있나(버튼을 보일지만 — 판정은 서버) */
const canPickCase = (c: { readonly kind?: string | null; readonly assigneeGroup?: string | null; readonly assigneeId?: string | null }, r: { readonly admin: boolean; readonly team: boolean; readonly agent: boolean }) =>
  ((isCsCase(c) ? r.agent : r.team && !withAdminTeam(c)) || r.admin) && !c.assigneeId;

/**
 * 일괄 맡기(2026-11-19 쿠팡 윙 "선택한 것 일괄 처리" 참고) — 계약에 일괄 명령이 없어 건마다 따로(빠른 맡기와 같게):
 * 그 건을 다시 읽어 지금 version 으로 POST /cases/{id}/assignments. 건마다 Idempotency-Key 를 기억해 다시 누르면 같은 키(실패한 것만 다시).
 * 결과는 서버 응답대로 — 받은 건 "맡음", 거절(이미 다른 사람이 맡음 등)은 그대로 둔다. 한 번에 하나씩(서버에 몰아 보내지 않는다).
 */
function useBulkPick() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { me } = useCaseRoles();
  const keys = useRef(new Map<string, IdempotencyKey>());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ done: number; failed: number } | null>(null);
  const run = async (ids: readonly string[]): Promise<string[]> => {
    setBusy(true);
    setResult(null);
    const done: string[] = [];
    let failed = 0;
    for (const [i, caseId] of ids.entries()) {
      setProgress(i + 1);
      const key = keys.current.get(caseId) ?? IdempotencyKey.generate();
      keys.current.set(caseId, key);
      try {
        const now = await request('GET', api.cases.GET('/cases/{caseId}', { params: { path: { caseId } } }));
        const r = await request('POST', api.cases.POST('/cases/{caseId}/assignments', { ...commandParams(key, { path: { caseId }, version: now.version }), body: { assigneeId: me } }));
        queryClient.setQueryData(['cases', 'detail', caseId], r);
        keys.current.delete(caseId);
        done.push(caseId);
      } catch {
        failed += 1;
      }
    }
    setResult({ done: done.length, failed });
    setBusy(false);
    void queryClient.invalidateQueries({ queryKey: ['cases'] });
    return done;
  };
  return { run, busy, progress, result };
}

/**
 * 목록 줄 빠른 맡기(2026-11-19 "계속 넣어") — 줄에 마우스를 올리거나 키보드로 오면 보인다.
 * 목록 줄에는 version 이 없어서 그 건을 다시 읽어 지금 version 으로 맡는다(그 사이 바뀌었으면 서버가 거절 — 화면은 서버 결과만).
 * 같은 키로 다시 보내면 다시 읽고 같은 Idempotency-Key 로 보낸다. 끝나면 목록·상세 조회를 다시 읽는다.
 */
function QuickPick({ caseId, caseNumber }: { readonly caseId: string; readonly caseNumber?: string | null }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { me } = useCaseRoles();
  const pick = useCommand(async (_: null, key) => {
    const now = await request('GET', api.cases.GET('/cases/{caseId}', { params: { path: { caseId } } }));
    const r = await request('POST', api.cases.POST('/cases/{caseId}/assignments', { ...commandParams(key, { path: { caseId }, version: now.version }), body: { assigneeId: me } }));
    queryClient.setQueryData(['cases', 'detail', caseId], r);
    // 목록을 다시 읽으면 이 줄은 "맡음"이 되어 단추·결과 글자가 사라진다 — 서버가 받아 준 뒤 구석 알림으로도
    pushToast({ tone: 'success', title: m.cases.picked, ...(caseNumber ? { body: caseNumber } : {}) });
    void queryClient.invalidateQueries({ queryKey: ['cases'] });
    return r;
  });
  const idle = pick.phase.kind === 'idle';
  return (
    <span className="mt-1 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {idle && (
        <button
          type="button"
          className="btn btn-primary btn-xs opacity-0 transition-opacity focus:opacity-100 [tr:hover_&]:opacity-100 [tr:focus-within_&]:opacity-100"
          title={m.cases.quickPickTitle}
          disabled={pick.busy}
          onClick={() => void pick.run(null)}
          data-testid="quick-pick"
        >
          {m.cases.quickPick}
        </button>
      )}
      <CommandFeedback command={pick}>{() => <span className="text-xs text-success">{m.cases.picked}</span>}</CommandFeedback>
    </span>
  );
}

/** 맡기 — part 'pick' = 내가 맡기 버튼(다음 할 일 카드 안), 'other' = 다른 사람에게 배정(관리자, 오른쪽 칸) */
function AssignForm({ c, onDone, part }: { readonly c: Case; readonly onDone: (c: Case) => void; readonly part: 'pick' | 'other' }) {
  const api = useApi();
  const { me, admin, team, agent } = useCaseRoles();
  const [other, setOther] = useState('');
  const assign = useCommand(async (v: { assigneeId: string }, key) => {
    const r = await request(
      'POST',
      api.cases.POST('/cases/{caseId}/assignments', { ...commandParams(key, { path: { caseId: c.caseId ?? '' }, version: c.version }), body: { assigneeId: v.assigneeId } }),
    );
    onDone(r);
    return r;
  });
  const run = (assigneeId: string) => {
    if (assign.phase.kind === 'rejected' || assign.phase.kind === 'done') assign.reset();
    void assign.run({ assigneeId });
  };
  if (part === 'pick') {
    if (!canPickCase(c, { admin, team, agent })) return null;
    return (
      <div className="space-y-1">
        <button type="button" className="btn btn-sm btn-primary" disabled={assign.busy} onClick={() => run(me)}>
          {m.cases.pick}
        </button>
        <CommandFeedback command={assign}>{() => <span className="text-xs text-success">{m.cases.picked}</span>}</CommandFeedback>
      </div>
    );
  }
  if (!admin) return null;
  return (
    <div className="space-y-2 border-t border-base-300 pt-3 text-sm">
      <form
        className="flex items-end gap-2"
        aria-label={m.cases.assignTo}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (other.trim()) run(other.trim());
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-base-content/60">
          {m.cases.assignTo}
          <input className="input input-sm w-full" placeholder={m.cases.assignee_} value={other} onChange={(e) => setOther(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-sm" disabled={!other.trim() || assign.busy}>
          {m.cases.assign}
        </button>
      </form>
      <CommandFeedback command={assign}>{() => <span className="text-xs text-success">{m.cases.picked}</span>}</CommandFeedback>
    </div>
  );
}

function CloseForm({ c, onDone, openFollowUps }: { readonly c: Case; readonly onDone: (c: Case) => void; readonly openFollowUps: number }) {
  const api = useApi();
  const [resolution, setResolution] = useState<Resolution>('RESOLVED');
  const [summary, setSummary] = useState('');
  const close = useCommand(async (v: { resolution: Resolution; summary: string }, key) => {
    const r = await request(
      'POST',
      api.cases.POST('/cases/{caseId}/closures', { ...commandParams(key, { path: { caseId: c.caseId ?? '' }, version: c.version }), body: { resolution: v.resolution, summary: v.summary } }),
    );
    onDone(r);
    return r;
  });
  return (
    <form
      id="case-close"
      className="scroll-mt-4 space-y-3 rounded-box border border-base-300 bg-base-100 p-4 text-sm shadow-sm"
      aria-label={m.cases.close}
      onSubmit={(e) => {
        e.preventDefault();
        if (!summary.trim()) return;
        if (close.phase.kind === 'rejected') close.reset();
        void close.run({ resolution, summary: summary.trim() });
      }}
    >
      <h2 className="flex items-center gap-2 font-semibold">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success/15 text-success">
          <Icon d={ICON.check} className="h-3.5 w-3.5" />
        </span>
        {m.cases.close}
      </h2>
      {/* case 0.30.0: 라이더 도움요청·전달 실패는 닫기 = 전달 실패 확정 + 반납 배송(서버가 한다 — 화면은 미리 알린다) */}
      {(c.kind === 'RIDER_HELP' || c.kind === 'DELIVERY_INCIDENT') && (
        <Notice tone="warning">
          <span data-testid="close-confirms-failure">{m.cases.closeConfirmsFailure}</span>
        </Notice>
      )}
      <label className="flex flex-col gap-1 text-xs text-base-content/60">
        {m.cases.resolution}
        <select className="select select-sm w-full" value={resolution} onChange={(e) => setResolution(RESOLUTIONS.find((r) => r === e.target.value) ?? 'RESOLVED')}>
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {m.cases.resolutionName[r]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-base-content/60">
        {m.cases.closeSummary}
        <textarea className="textarea textarea-sm w-full" maxLength={1000} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>
      <p className="text-xs text-base-content/60">{m.cases.piiHint}</p>
      {openFollowUps > 0 && (
        <p role="note" className="text-xs text-warning" data-testid="close-blocked">
          {m.followUps.closeBlocked(openFollowUps)}
        </p>
      )}
      <button type="submit" className="btn btn-sm btn-success w-full" disabled={!summary.trim() || close.busy || openFollowUps > 0}>
        {m.cases.close}
      </button>
      <CommandFeedback command={close}>{() => <span className="text-xs text-success">{m.cases.closed}</span>}</CommandFeedback>
    </form>
  );
}

/** 사유 하나 받는 명령 폼(다시 열기·넘기기 공통) — 사유 1~500자 필수, 개인정보 금지 안내 */
function ReasonForm({
  title,
  submitLabel,
  doneText,
  testId,
  warn,
  send,
  failureHint,
}: {
  readonly title: string;
  readonly submitLabel: string;
  readonly doneText: string;
  readonly testId: string;
  readonly warn?: string;
  readonly send: (reason: string, key: Parameters<Parameters<typeof useCommand>[0]>[1]) => Promise<Case>;
  readonly failureHint?: (code: string | undefined) => ReactNode;
}) {
  const [reason, setReason] = useState('');
  const cmd = useCommand(async (v: { reason: string }, key) => send(v.reason, key));
  const ok = reason.trim().length >= 1 && reason.trim().length <= 500;
  const code = cmd.phase.kind === 'rejected' && cmd.phase.failure instanceof ProblemFailure ? cmd.phase.failure.problem.code : undefined;
  return (
    <form
      className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4 text-sm shadow-sm"
      aria-label={title}
      data-testid={testId}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        if (cmd.phase.kind === 'rejected') cmd.reset();
        void cmd.run({ reason: reason.trim() });
      }}
    >
      <h2 className="font-semibold">{title}</h2>
      {warn && <p className="text-xs text-base-content/60">{warn}</p>}
      <label className="flex flex-col gap-1 text-xs text-base-content/60">
        {m.cases.reason}
        <textarea className="textarea textarea-sm w-full" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <p className="text-xs text-base-content/60">{m.cases.piiHint}</p>
      <button type="submit" className="btn btn-sm btn-outline w-full" disabled={!ok || cmd.busy}>
        {submitLabel}
      </button>
      <CommandFeedback command={cmd}>{() => <span className="text-xs text-success">{doneText}</span>}</CommandFeedback>
      {cmd.phase.kind === 'rejected' && failureHint?.(code)}
    </form>
  );
}

/** 이 사건의 대상(배송·주문) 번호 — 통합 조회로 같은 대상의 사건을 찾게 */
const subjectOf = (c: Case) => (c.refs ?? []).find((r) => r.refType === 'deliveryId' || r.refType === 'orderId')?.refId ?? c.subjectRef ?? '';

function ReopenForm({ c, onDone }: { readonly c: Case; readonly onDone: (c: Case) => void }) {
  const api = useApi();
  const target = subjectOf(c);
  return (
    <ReasonForm
      title={m.cases.reopen}
      submitLabel={m.cases.reopen}
      doneText={m.cases.reopened}
      testId="case-reopen"
      warn={m.cases.reopenNote}
      send={async (reason, key) => {
        const r = await request('POST', api.cases.POST('/cases/{caseId}/reopenings', { ...commandParams(key, { path: { caseId: c.caseId ?? '' }, version: c.version }), body: { reason } }));
        onDone(r);
        return r;
      }}
      failureHint={(code) =>
        code === 'CASE_ALREADY_OPEN' && target ? (
          <Link className="link text-xs" to={`/lookup?q=${encodeURIComponent(target)}`} data-testid="case-open-elsewhere">
            {m.cases.findOpenCase(target)}
          </Link>
        ) : null
      }
    />
  );
}

function TransferForm({ c, toGroup, onDone }: { readonly c: Case; readonly toGroup: 'DELIVERY_OPS' | 'ORDER_OPS'; readonly onDone: (c: Case) => void }) {
  const api = useApi();
  const toAdmin = toGroup === 'ORDER_OPS';
  return (
    <ReasonForm
      title={toAdmin ? m.cases.transferToAdmin : m.cases.transferToSupport}
      submitLabel={toAdmin ? m.cases.transferToAdmin : m.cases.transferToSupport}
      doneText={m.cases.transferred}
      testId="case-transfer"
      warn={toAdmin ? m.cases.transferToAdminNote : m.cases.transferToSupportNote}
      send={async (reason, key) => {
        const r = await request('POST', api.cases.POST('/cases/{caseId}/transfers', { ...commandParams(key, { path: { caseId: c.caseId ?? '' }, version: c.version }), body: { toGroup, reason } }));
        onDone(r);
        return r;
      }}
    />
  );
}

/**
 * 라이더 도움요청·전달 실패 사건: refs 의 requestId·deliveryId(case 0.4.1 부터), 없으면(그 전 사건) incidentId(= `<deliveryId>:<requestId>`)를 나눠 execution `GET /deliveries/{id}/help-requests/{requestId}`
 * (라이더가 쓴 내용·사진 참조). 사건 처리는 사건 집기·닫기로(백엔드 알림 2026-11-16 rider-delivery-staff-apis §3).
 */
function HelpRequestOfCase({ c }: { readonly c: Case }) {
  const api = useApi();
  const ref = (t: string) => (c.refs ?? []).find((r) => r.refType === t)?.refId ?? '';
  const incident = ref('incidentId');
  const sep = incident.lastIndexOf(':');
  // 따로 실린 requestId(case 0.4.1)를 먼저 — 그 전 사건은 incidentId 에서 `<deliveryId>:` 를 뗀다(백엔드 회신 reply-rider-delivery-staff-apis §1)
  const deliveryId = ref('deliveryId') || (sep > 0 ? incident.slice(0, sep) : '');
  const requestId = ref('requestId') || (sep > 0 ? incident.slice(sep + 1) : '');
  const query = useQuery({
    queryKey: ['help-request', deliveryId, requestId],
    enabled: deliveryId !== '' && requestId !== '',
    queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}/help-requests/{requestId}', { params: { path: { deliveryId, requestId } } })),
  });
  if (!deliveryId || !requestId) return null;
  return (
    <Panel title={m.cases.helpRequest} icon={ICON.chat}>
      <div className="space-y-4">
        <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
          {(h) => (
            <div className="space-y-3" data-testid="case-help-request">
              {/* 라이더가 쓴 내용을 인용 상자로 — 그 아래 분류·단계·사진·상태 */}
              <div className="space-y-1">
                <p className="text-xs text-base-content/50">{m.cases.helpDetail}</p>
                <blockquote className="whitespace-pre-wrap rounded-box border-l-4 border-info bg-info/5 px-4 py-3 text-sm">{text(h.detail)}</blockquote>
              </div>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3 [&_dt]:text-xs [&_dt]:text-base-content/50 [&_dd]:font-medium">
                <div>
                  <dt>{m.helpQueue.category}</dt>
                  <dd>{label(m.helpQueue.categoryName, h.category)}</dd>
                </div>
                <div>
                  <dt>{m.helpQueue.stage}</dt>
                  <dd>{label(m.deliveries.executionState, h.stage)}</dd>
                </div>
                <div>
                  <dt>{m.cases.state}</dt>
                  <dd>{label(m.helpQueue.state, h.state)}</dd>
                </div>
                <div>
                  <dt>{m.helpQueue.createdAt}</dt>
                  <dd>{when(h.createdAt)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt>{m.helpQueue.photos}</dt>
                  {/* 사진 참조(PHOTO-…)는 시스템 값이라 장수만(2026-11-20) */}
                  <dd>{(h.evidenceRefs ?? []).length > 0 ? m.helpChat.photoCount((h.evidenceRefs ?? []).length) : m.none}</dd>
                </div>
              </dl>
            </div>
          )}
        </QueryState>
        <HelpChat caseId={c.caseId ?? ''} deliveryId={deliveryId} requestId={requestId} adminTeam={c.assigneeGroup === 'ORDER_OPS'} />
      </div>
    </Panel>
  );
}

export function CaseDetailPage() {
  const { caseId = '' } = useParams();
  const api = useApi();
  const queryClient = useQueryClient();
  const { me, admin, team, agent } = useCaseRoles();
  const { session } = useSession();
  const key = ['cases', 'detail', caseId];
  const query = useQuery({ queryKey: key, queryFn: () => request('GET', api.cases.GET('/cases/{caseId}', { params: { path: { caseId } } })) });
  const markSeen = useMarkCaseSeen();
  // 접수 건을 열면 "봤음"(case 0.20.0) — 사건함 새 메시지 점이 이 직원에게 꺼진다
  useEffect(() => {
    if (caseId) markSeen(caseId);
  }, [caseId, markSeen]);
  const onDone = (c: Case) => {
    queryClient.setQueryData(key, c);
    void queryClient.invalidateQueries({ queryKey: ['cases'], exact: false, predicate: (q) => q.queryKey[1] !== 'detail' });
    // execution 0.8.0: 맡으면 도움요청이 처리 중, 다시 열기·넘기기(담당 비움)는 접수로 — 도움요청 상태를 다시 읽는다
    void queryClient.invalidateQueries({ queryKey: ['help-request'] });
  };
  // 최근 본 항목(2026-11-18) — 서버 응답을 받은 뒤에만 남긴다
  // 최근 본 항목 이름은 화면 번호·요약(2026-11-19 — 시스템 ID 를 이름으로 남기던 것 고침, ADR-0070 덧붙임)
  useRecordRecent('case', caseId, query.data ? (query.data.caseNumber ?? label(m.cases.kindName, query.data.kind)) : null);
  return (
    <section className="space-y-4">
      {/* 제목은 종류 이름 먼저, 번호는 작게(2026-11-18 "제목이 번호뿐") — 읽기 전에는 "접수 건" */}
      <PageHeader
        title={
          <>
            {query.data?.kind ? <CodeLabel code={query.data.kind} names={m.cases.kindName} /> : m.cases.title}
            <span className="ml-2 font-mono text-xs font-normal text-base-content/45" data-testid="case-number">{query.data ? (query.data.caseNumber ?? m.displayNumber.missing) : ''}</span>
          </>
        }
        back={{ to: '/cases', label: m.cases.back }}
      />
      {/* 보던 목록 순서대로 이전·다음(2026-11-19) */}
      <QueueNav kind="case" id={caseId} />
      {/* 시스템 번호(ADR-0070 덧붙임) — 장애 문의·로그 대조용, 상세에서만 */}
      <SystemNumbers ids={[{ label: m.cases.title, id: caseId }]} />
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(c) => {
          const closed = c.state === 'CLOSED';
          const adminTeam = withAdminTeam(c);
          // 지원센터는 자기 팀(배송 쪽, 관리자 팀으로 가지 않은) 사건만 — 관리자 팀 사건·사가 사건은 관리자만(서버 판정)
          // 반품 회수 실패(CS 팀)는 상담원이 맡고 완료 처리(case 0.22.0)
          const csCase = isCsCase(c);
          const teamCan = csCase ? agent : team && !adminTeam && !isOrderKind(c.kind);
          const canClose = !closed && (admin || (teamCan && (!c.assigneeId || c.assigneeId === me)));
          const canReopen = closed && (admin || teamCan);
          // 넘기기(지원센터 ↔ 관리자 팀)에는 CS 팀이 없다 — CS 사건은 넘기기 없음
          const deliverySide = !isOrderKind(c.kind) && !csCase;
          const canToAdmin = !closed && deliverySide && !adminTeam && (admin || (teamCan && (!c.assigneeId || c.assigneeId === me)));
          const canToSupport = !closed && deliverySide && adminTeam && admin;
          const history = c.history ?? [];
          const openFollowUps = (c.obligations ?? []).filter(isOpenObligation).length;
          return (
            <>
              <CaseNext c={c} me={me} viewer={!admin && !teamCan} canPick={!closed && canPickCase(c, { admin, team, agent })} canClose={canClose} openFollowUps={openFollowUps} onDone={onDone} />
              {/* 이슈 트래커처럼 두 칸(2026-11-18): 왼쪽 = 내용·후속 처리·행위 요청·메모·연락·이력, 오른쪽 = 속성·명령 */}
              <div className="grid items-start gap-4 lg:grid-cols-3">
                <div className="min-w-0 space-y-4 lg:col-span-2">
                  {/* 개요 — 종류·우선순위 배지, 요약을 크게 */}
                  <div className="rounded-box border border-base-300 bg-base-100 px-5 py-4 shadow-sm empty:hidden">
                    <div className="flex flex-wrap items-center gap-2">
                      <PriorityBadge p={c.priority} />
                      {c.overdue && !closed && (
                        <span className="badge badge-error badge-sm gap-1">
                          <Icon d={ICON.alert} className="h-3 w-3" />
                          {m.cases.overdue}
                        </span>
                      )}
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-lg font-semibold leading-snug">{text(c.summary)}</p>
                    <p className="mt-1 text-xs text-base-content/55">{`${m.cases.openedAt} ${when(c.openedAt)}`}</p>
                  </div>
  
                  {(c.refs ?? []).some((r) => r.refType === 'recoveryDeliveryId' || r.refType === 'reshipmentDeliveryId') && (
                    <p role="note" className="alert alert-info alert-soft text-sm" data-testid="case-recovery-note">
                      {m.cases.recoveryNote}
                    </p>
                  )}
                  {isOrderKind(c.kind) && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-box border border-accent/30 bg-accent/5 px-4 py-3 text-sm" data-testid="case-order-note">
                      <p className="text-base-content/75">{m.cases.orderNote}</p>
                      <Link className="btn btn-sm btn-accent btn-outline" to="/pending">
                        {m.cases.orderAction}
                      </Link>
                    </div>
                  )}
  
                  {(c.kind === 'RIDER_HELP' || c.kind === 'DELIVERY_INCIDENT') && <HelpRequestOfCase c={c} />}
                  {/* 배차 지연 → 배차 불가로 취소(claim 0.7.0 CL-5) — 주문 전체 취소·전액 환불, 확인 상자 */}
                  {c.kind === 'DISPATCH_DELAYED' && <DispatchUnavailableCancel caseId={c.caseId ?? caseId} orderId={(c.refs ?? []).find((r) => r.refType === 'orderId')?.refId} closed={closed} />}
                  {c.kind === 'RETURN_RECOVERY_FAILED' && <ClaimOfCase claimId={c.subjectType === 'CLAIM' && c.subjectRef ? c.subjectRef : ((c.refs ?? []).find((r) => r.refType === 'claimId')?.refId ?? '')} />}
  
                  <div id="case-follow-ups" className="scroll-mt-4 rounded-box border border-base-300 bg-base-100 px-5 py-4 shadow-sm empty:hidden">
                    <FollowUps c={c} canAdd={!closed && (admin || teamCan)} />
                  </div>
  
                  {c.closure && (
                    <Panel title={closed ? m.cases.closure : m.cases.lastClosure} icon={ICON.check}>
                      <div className={`space-y-1 rounded-box border-l-4 px-4 py-3 text-sm ${closed ? 'border-success bg-success/5' : 'border-base-300 bg-base-200/50'}`} data-testid="case-closure">
                        <StatusBadge tone={closed ? 'success' : 'ghost'}>{label(m.cases.resolutionName, c.closure.resolution)}</StatusBadge>
                        <p className="whitespace-pre-wrap">{text(c.closure.summary)}</p>
                        <p className="text-xs text-base-content/55">{`${text(c.closure.closedBy)} · ${when(c.closure.closedAt)}`}</p>
                      </div>
                    </Panel>
                  )}
  
                  {/* 기록 탭(2026-11-18 작업 따라 해 보기 — "접수 건 화면이 너무 길다"): 메모·행위 요청·연락 기록·이력을 한 번에 하나만 */}
                  <RecordTabs
                    tabs={[
                      { id: 'notes', label: m.cases.recordTabs.notes, body: (
                        <>
                  <CaseNotes caseId={c.caseId ?? caseId} />
  
                        </>
                      ) },
                      { id: 'actions', label: m.cases.recordTabs.actions, body: (
                        <>
                  {/* 행위 요청 기록(case 0.17.0) — 맡을 수 있는 사람만 남김, 처리 끝난 건은 새 요청 없음 */}
                  <ActionRequests c={c} canAct={!closed && (admin || teamCan)} />
  
                        </>
                      ) },
                      // 고객 연락 기록은 볼 수 있는 역할만(그 밖은 서버 403 — 빈 탭을 만들지 않는다)
                      ...(canSeeIntakes(session?.roles ?? []) ? [
                      { id: 'log', label: m.cases.recordTabs.log, body: (
                        <>
                  {/* 고객 연락 기록(case 0.12.0) — 상담원·관리자만(그 밖 역할은 서버 403이라 그리지 않는다) */}
                  <div className="space-y-3 rounded-box border border-base-300 bg-base-100 px-5 py-4 shadow-sm empty:hidden">
                    <CsIntakeLog caseId={c.caseId ?? caseId} title={m.csIntake.caseLog} />
                    {canSeeIntakes(session?.roles ?? []) && (
                      <Link className="btn btn-sm" to={`/cs-intakes/new?${new URLSearchParams({ linkCaseId: c.caseId ?? caseId }).toString()}`}>
                        {m.csIntake.caseRecord}
                      </Link>
                    )}
                  </div>
  
                        </>
                      ) }]
                        : []),
                      { id: 'history', label: m.cases.recordTabs.history, body: (
                        <>
                  {/* 이력 — 세로 시간 줄 */}
                  <Panel title={m.cases.history} icon={ICON.history}>
                    {history.length === 0 ? (
                      <p className="text-sm text-base-content/55">{m.cases.noHistory}</p>
                    ) : (
                      <ol className="relative ml-2 space-y-4 border-l border-base-300 pl-5 text-sm" data-testid="case-history">
                        {history.map((h, i) => (
                          <li key={`${h.at ?? ''}-${i}`} className="relative">
                            <span className={`absolute -left-[1.6rem] top-1 h-3 w-3 rounded-full ring-4 ring-base-100 ${HISTORY_DOT[h.action ?? ''] ?? 'bg-base-300'}`} aria-hidden="true" />
                            <HistoryText h={h} />
                            <p className="text-xs text-base-content/50">{when(h.at)}</p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </Panel>
                        </>
                      ) },
                    ]}
                  />
                </div>
  
                {/* 오른쪽 — 속성(상태·우선순위·기한·담당·관련) + 할 수 있는 명령만 */}
                <aside className="min-w-0 space-y-4 lg:sticky lg:top-4">
                  <div className="rounded-box border border-base-300 bg-base-100 px-5 py-3 shadow-sm">
                    <dl className="divide-y divide-base-300/70" data-testid="case-facts">
                      <Prop name={m.cases.state}>
                        <StatusBadge tone={stateTone(c)} testId="case-state">
                          {c.state ? <CodeLabel code={c.state} names={m.cases.stateName} /> : m.none}
                        </StatusBadge>
                      </Prop>
                      <Prop name={m.cases.priority}>
                        <PriorityBadge p={c.priority} />
                      </Prop>
                      <Prop name={m.cases.kind}>{c.kind ? <CodeLabel code={c.kind} names={m.cases.kindName} /> : m.none}</Prop>
                      <Prop name={m.cases.sla}>
                        <span className={c.overdue ? 'rounded-md bg-error/10 px-1.5 py-0.5' : ''}>
                          <Sla c={c} />
                        </span>
                      </Prop>
                      <Prop name={m.cases.assigneeGroup} testId="case-group">
                        {c.assigneeGroup ? <CodeLabel code={c.assigneeGroup} names={m.cases.groupName} /> : m.none}
                        {adminTeam && (
                          <span className="badge badge-warning badge-sm ml-1" data-testid="case-admin-team">
                            {m.cases.adminHandling}
                          </span>
                        )}
                      </Prop>
                      <Prop name={m.cases.assignee} testId="case-assignee">
                        <Person id={c.assigneeId} />
                      </Prop>
                      <Prop name={m.cases.openedAt}>{when(c.openedAt)}</Prop>
                      <Prop name={m.cases.refs}>
                        <span className="text-sm [&_.flex]:flex-col [&_.flex]:gap-y-1">
                          <Refs c={c} />
                        </span>
                        {/* 원래 배송으로 바로 시작(2026-11-19 — 번호를 옮겨 적지 않는다). 이미 오배송 접수 건이면 오배송 단추는 뺀다 */}
                        {(() => {
                          const dl = (c.refs ?? []).find((r) => r.refType === 'deliveryId')?.refId;
                          return dl ? (
                            <span className="mt-2 block">
                              <DeliveryStartActions deliveryId={dl} size="xs" noMisdelivery={c.kind === 'MISDELIVERY'} />
                            </span>
                          ) : null;
                        })()}
                      </Prop>
                    </dl>
                    {!closed && (
                      <div className="pb-2">
                        <AssignForm c={c} onDone={onDone} part="other" />
                      </div>
                    )}
                  </div>
                  {canClose && <CloseForm c={c} onDone={onDone} openFollowUps={openFollowUps} />}
                  {canToAdmin && <TransferForm c={c} toGroup="ORDER_OPS" onDone={onDone} />}
                  {canToSupport && <TransferForm c={c} toGroup="DELIVERY_OPS" onDone={onDone} />}
                  {canReopen && <ReopenForm c={c} onDone={onDone} />}
                </aside>
              </div>
            </>
          );
        }}
      </QueryState>
    </section>
  );
}

/**
 * 다음 할 일 하나(2026-11-18 "지금 뭘 해야 하는지 안 보인다") — 이미 읽은 서버 상태로만 고른다(새 판정·새 호출 없음).
 * 처리 끝남 → 성공 한 줄 · 보기만 하는 역할 → 안내 · 아무도 안 맡음(맡을 수 있음) → 내가 맡기 ·
 * 내가 맡음 → 후속 처리 남음이면 후속 처리로, 아니면 완료 처리로(기한 넘김이면 빨강) · 다른 사람이 맡음 → 안내만
 */
function CaseNext({ c, me, viewer, canPick, canClose, openFollowUps, onDone }: { readonly c: Case; readonly me: string; readonly viewer: boolean; readonly canPick: boolean; readonly canClose: boolean; readonly openFollowUps: number; readonly onDone: (c: Case) => void }) {
  // 담당자 이름 · 사번(ADR-0070 덧붙임) — 훅이라 먼저
  const assigneeName = useStaffText(c.assigneeId);
  const n = m.cases.next;
  const overdue = c.overdue === true;
  if (c.state === 'CLOSED') {
    const how = c.closure?.resolution ? label(m.cases.resolutionName, c.closure.resolution) : label(m.cases.stateName, c.state);
    return <NextAction tone="success" title={n.closed(how)} />;
  }
  if (viewer) {
    const adminTeam = withAdminTeam(c);
    return <NextAction tone="info" title={adminTeam ? n.adminTeam : n.viewOnly} body={adminTeam ? m.cases.adminHandlingNote : m.cases.viewOnly} />;
  }
  if (canPick) {
    return (
      <NextAction tone={overdue ? 'error' : 'warning'} title={overdue ? n.unassignedOverdue : n.unassigned}>
        <AssignForm c={c} onDone={onDone} part="pick" />
      </NextAction>
    );
  }
  if (c.assigneeId && c.assigneeId !== me) return <NextAction tone={overdue ? 'warning' : 'info'} title={overdue ? n.otherAssigneeOverdue(assigneeName) : n.otherAssignee(assigneeName)} />;
  if (openFollowUps > 0) {
    return (
      <NextAction tone={overdue ? 'error' : 'warning'} title={n.followUps(openFollowUps)} body={n.followUpsBody}>
        <a href="#case-follow-ups" className="btn btn-sm btn-primary">
          {n.goFollowUps}
        </a>
      </NextAction>
    );
  }
  if (!canClose) return null;
  return (
    <NextAction tone={overdue ? 'error' : 'info'} title={overdue ? n.overdue : n.close} body={isOrderKind(c.kind) ? n.orderBody : undefined}>
      <a href="#case-close" className="btn btn-sm btn-primary">
        {n.goClose}
      </a>
    </NextAction>
  );
}

/** 이력 점 색 — 동작 이름이 있는 것만 */
const HISTORY_DOT: Readonly<Record<string, string>> = {
  OPENED: 'bg-info',
  ASSIGNED: 'bg-primary',
  CLOSED: 'bg-success',
  REOPENED: 'bg-warning',
  TRANSFERRED: 'bg-accent',
  RECURRED: 'bg-error',
  HANDED_OVER: 'bg-primary',
};

/**
 * 귀책(ADR-0065, case 0.11.0). 고객 잘못(CUSTOMER)은 2026-11-16 백엔드 #49~#53 배포로 쓸 수 있다(요청서 다시 씀):
 * - 라이더·시스템 잘못 → 재발송(기본)·전 품목 환불. 고객 잘못 → 다시 배송(기본)·환불(상품값 − 9,000원 — 정책 안내만, 화면은 계산하지 않음).
 * - 고객 잘못 + 다시 배송은 두 단계: ① 배송에서 주문 번호를 읽고 order `POST /orders/lookups/{orderId}/redelivery-destinations`
 *   {deliveryId, roadAddress, detailAddress?, postalCode?, reason} → destinationId ② case `POST /cases` misdelivery {fault, resolution, redeliveryDestinationId}.
 *   ①에서 받은 번호는 화면에 들고 있어 ②만 실패하면 주소를 다시 기록하지 않는다. 같은 요청 재전송은 같은 키(서버가 같은 번호를 준다).
 * - 실제 주소는 입력만 — 다시 보여 주지 않고 로그에 남기지 않는다. 기록 사유에 주소·전화번호 금지 안내.
 */
type Fault = 'RIDER' | 'SYSTEM' | 'CUSTOMER';
type Choice = 'RESHIP' | 'REFUND' | 'REDELIVER';
const FAULTS: readonly Fault[] = ['RIDER', 'SYSTEM', 'CUSTOMER'];
const CHOICES_OF: Readonly<Record<Fault, readonly Choice[]>> = { RIDER: ['RESHIP', 'REFUND'], SYSTEM: ['RESHIP', 'REFUND'], CUSTOMER: ['REDELIVER', 'REFUND'] };
const choiceNote = (f: Fault | '', c: Choice) =>
  f === 'CUSTOMER' ? (c === 'REDELIVER' ? m.cases.redeliverNote : m.cases.customerRefundNote) : c === 'REFUND' ? m.cases.refundNote : m.cases.reshipNote;

interface Address {
  readonly road: string;
  readonly detail: string;
  readonly postal: string;
  readonly reason: string;
}
const EMPTY_ADDRESS: Address = { road: '', detail: '', postal: '', reason: '' };

export function NewMisdeliveryPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [deliveryId, setDeliveryId] = useState(params.get('deliveryId') ?? '');
  const [summary, setSummary] = useState('');
  const [evidence, setEvidence] = useState('');
  const [fault, setFault] = useState<Fault | ''>('');
  const [choice, setChoice] = useState<Choice>('RESHIP');
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS);
  /** ①에서 받은 실제 주소 번호(배송 번호가 같을 때만 다시 쓴다) */
  const [destination, setDestination] = useState<{ readonly deliveryId: string; readonly id: string } | null>(null);
  const needsAddress = fault === 'CUSTOMER' && choice === 'REDELIVER';
  const pickFault = (f: Fault) => {
    setFault(f);
    setChoice(CHOICES_OF[f][0] ?? 'RESHIP');
  };
  const open = useCommand(async (v: { deliveryId: string; summary: string; evidence: string; fault: Fault; choice: Choice; address: Address }, key) => {
    let redeliveryDestinationId: string | undefined;
    if (v.fault === 'CUSTOMER' && v.choice === 'REDELIVER') {
      if (destination && destination.deliveryId === v.deliveryId) {
        redeliveryDestinationId = destination.id;
      } else {
        const d = await request('GET', api.execution.GET('/deliveries/{deliveryId}', { params: { path: { deliveryId: v.deliveryId } } }));
        const orderId = d.orderId ?? '';
        const rec = await request(
          'POST',
          api.orders.POST('/orders/lookups/{orderId}/redelivery-destinations', {
            ...commandParams(key, { path: { orderId } }),
            body: {
              deliveryId: v.deliveryId,
              roadAddress: v.address.road,
              reason: v.address.reason,
              ...(v.address.detail ? { detailAddress: v.address.detail } : {}),
              ...(v.address.postal ? { postalCode: v.address.postal } : {}),
            },
          }),
        );
        redeliveryDestinationId = rec.destinationId;
        setDestination({ deliveryId: v.deliveryId, id: rec.destinationId });
        setAddress(EMPTY_ADDRESS); // 기록했으면 화면에서 지운다(다시 보여 주지 않음)
      }
    }
    const c = await request(
      'POST',
      api.cases.POST('/cases', {
        ...commandParams(key),
        body: {
          kind: 'MISDELIVERY',
          subjectType: 'DELIVERY',
          subjectRef: v.deliveryId,
          summary: v.summary,
          ...(v.evidence ? { evidence: [{ system: 'backoffice-web', ref: v.evidence, kind: 'PHOTO' as const }] } : {}),
          misdelivery: { fault: v.fault, resolution: v.choice, ...(redeliveryDestinationId ? { redeliveryDestinationId } : {}) },
        },
      }),
    );
    void navigate(`/cases/${encodeURIComponent(c.caseId ?? '')}`);
    return c;
  });
  // 배송 번호(74939255-1)로도 — 찾은 배송 ID 로 보낸다(2026-11-19)
  const delivery = useResolvedRef('delivery', deliveryId);
  const recorded = needsAddress && destination !== null && destination.deliveryId === delivery.id;
  const addressOk =
    !needsAddress ||
    recorded ||
    (address.road.trim().length >= 1 && address.road.trim().length <= 200 && address.reason.trim().length >= 2 && address.reason.trim().length <= 200);
  const ok = delivery.id !== null && summary.trim() !== '' && fault !== '' && addressOk;
  const setAddr = (k: keyof Address, val: string) => setAddress((a) => ({ ...a, [k]: val }));
  return (
    <section className="space-y-4">
      <PageHeader title={m.cases.newTitle} back={{ to: '/cases', label: m.cases.back }} />
      {/* 단계 상자(2026-11-18): ① 배송·요약 ② 누구 잘못 ③ 고객이 고른 처리(+실제 주소) ④ 근거 — 오른쪽은 고른 처리 안내 */}
      <form
        className="grid items-start gap-4 lg:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          if (open.phase.kind === 'rejected') open.reset();
          void open.run({
            deliveryId: delivery.id ?? '',
            summary: summary.trim(),
            evidence: evidence.trim(),
            fault,
            choice,
            address: { road: address.road.trim(), detail: address.detail.trim(), postal: address.postal.trim(), reason: address.reason.trim() },
          });
        }}
      >
        <div className="min-w-0 space-y-4 text-sm lg:col-span-2">
          <Step n={1} title={m.cases.newStepWhat} done={delivery.id !== null && summary.trim() !== ''}>
            <label className="flex flex-col gap-1">
              {m.cases.deliveryId}
              <input className="input input-sm w-64 font-mono" placeholder={m.refField.deliveryHint} value={deliveryId} onChange={(e) => setDeliveryId(e.target.value)} />
              <RefStatus r={delivery} kind="delivery" />
            </label>
            {/* 번호를 몰라도 — 최근 본 배송·고객 연락처·라이더 전화로 찾아 고르기(2026-11-19) */}
            <DeliveryPicker onPick={setDeliveryId} />
            <label className="flex flex-col gap-1">
              {m.cases.summary}
              <textarea className="textarea textarea-sm w-full" rows={3} maxLength={1000} value={summary} onChange={(e) => setSummary(e.target.value)} />
            </label>
          </Step>
          <Step n={2} title={m.cases.faultQuestion} done={fault !== ''}>
            <fieldset className="space-y-2" data-testid="misdelivery-fault">
              <legend className="sr-only">{m.cases.faultQuestion}</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {FAULTS.map((f) => (
                  <label
                    key={f}
                    className={`flex cursor-pointer items-center gap-2 rounded-box border px-3 py-3 transition-colors ${fault === f ? 'border-primary bg-primary/5 font-medium' : 'border-base-300 hover:border-base-content/30'}`}
                  >
                    <input type="radio" className="radio radio-sm radio-primary" name="misdelivery-fault" value={f} checked={fault === f} onChange={() => pickFault(f)} />
                    {m.cases.faultName[f]}
                  </label>
                ))}
              </div>
              {fault === 'RIDER' && (
                <p role="note" className="text-xs text-warning" data-testid="rider-fee-note">
                  {m.cases.riderFeeNote}
                </p>
              )}
            </fieldset>
          </Step>
          <Step n={3} title={m.cases.choiceQuestion} done={fault !== '' && addressOk}>
            <label className="flex flex-col gap-1">
              {m.cases.choiceQuestion}
              <select className="select select-sm w-56" value={choice} disabled={fault === ''} onChange={(e) => setChoice((CHOICES_OF[fault || 'RIDER'].find((c) => c === e.target.value) ?? 'RESHIP'))}>
                {CHOICES_OF[fault || 'RIDER'].map((c) => (
                  <option key={c} value={c}>
                    {fault === 'CUSTOMER' && c === 'REFUND' ? m.cases.customerRefundName : m.cases.resolutionChoiceName[c]}
                  </option>
                ))}
              </select>
            </label>
            {needsAddress && (
              <fieldset className="space-y-2 rounded-box border border-base-300 bg-base-200/30 p-3" data-testid="redelivery-address">
                <legend className="px-1 font-semibold">{m.cases.addressTitle}</legend>
                {recorded ? (
                  <p className="text-xs text-success" data-testid="address-recorded">
                    {m.cases.addressRecorded(destination?.id ?? '')}
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-base-content/60">{m.cases.addressIntro}</p>
                    <label className="flex flex-col gap-1">
                      {m.cases.roadAddress}
                      <input className="input input-sm w-full" maxLength={200} autoComplete="off" value={address.road} onChange={(e) => setAddr('road', e.target.value)} />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <label className="flex flex-col gap-1">
                        {m.cases.detailAddress}
                        <input className="input input-sm w-64" maxLength={100} autoComplete="off" value={address.detail} onChange={(e) => setAddr('detail', e.target.value)} />
                      </label>
                      <label className="flex flex-col gap-1">
                        {m.cases.postalCode}
                        <input className="input input-sm w-28" maxLength={10} autoComplete="off" value={address.postal} onChange={(e) => setAddr('postal', e.target.value)} />
                      </label>
                    </div>
                    <label className="flex flex-col gap-1">
                      {m.cases.addressReason}
                      <input className="input input-sm w-full" maxLength={200} value={address.reason} onChange={(e) => setAddr('reason', e.target.value)} />
                    </label>
                    <p className="text-xs text-warning">{m.cases.addressReasonHint}</p>
                  </>
                )}
              </fieldset>
            )}
          </Step>
          <Step n={4} title={m.cases.newStepEvidence} done={evidence.trim() !== ''}>
            <label className="flex flex-col gap-1">
              {m.cases.evidence}
              <input className="input input-sm w-64" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
            </label>
          </Step>
        </div>

        {/* 오른쪽 — 고른 처리의 안내 + 접수 버튼 */}
        <aside className="min-w-0 space-y-3 rounded-box border border-base-300 bg-base-100 p-4 text-sm shadow-sm lg:sticky lg:top-4">
          <h2 className="font-semibold">{m.cases.newSideTitle}</h2>
          {fault !== '' && (
            <p className={`rounded-box px-3 py-2 text-xs ${fault === 'CUSTOMER' ? 'bg-warning/10 text-warning' : 'bg-base-200/60 text-base-content/75'}`} data-testid="choice-note">
              {choiceNote(fault, choice)}
            </p>
          )}
          <p className="text-xs text-base-content/60">{m.cases.piiHint}</p>
          <button type="submit" className="btn btn-primary btn-sm w-full" disabled={!ok || open.busy}>
            {m.cases.open}
          </button>
          <CommandFeedback command={open} />
        </aside>
      </form>
    </section>
  );
}

/** 접수 단계 상자 — 번호 동그라미(채우면 체크) + 제목 + 입력 */
function Step({ n, title, done, children }: { readonly n: number; readonly title: string; readonly done: boolean; readonly children: ReactNode }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 shadow-sm">
      <div className="flex items-center gap-3 border-b border-base-300 px-5 py-3">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? 'bg-success text-success-content' : 'bg-base-200 text-base-content/60'}`}
          aria-hidden="true"
        >
          {done ? <Icon d={ICON.check} className="h-3.5 w-3.5" /> : n}
        </span>
        <h2 className="font-semibold">{title}</h2>
      </div>
      <div className="space-y-3 px-5 py-4">{children}</div>
    </div>
  );
}

/** 접수 건 숫자 띠 — 안 맡음·기한 지남(메뉴 알림·탭 개수와 같은 서버 조회). 누르면 그 탭 */
function CaseStrip({ tab }: { readonly tab: Tab }) {
  const unassigned = useAlertCount('casesUnassigned');
  const overdue = useAlertCount('casesOverdue');
  const has = (q: typeof unassigned) => (q.data?.n ?? 0) > 0;
  return (
    <StatStrip label={m.listStrip.cases} testId="case-strip">
      <StatCard label={m.cases.tabs.unassigned} value={countCell(unassigned)} tone={has(unassigned) ? 'warning' : undefined} to="/cases?tab=unassigned" active={tab === 'unassigned'} testId="case-strip-unassigned" />
      <StatCard label={m.cases.tabs.overdue} value={countCell(overdue)} tone={has(overdue) ? 'error' : undefined} to="/cases?tab=overdue" active={tab === 'overdue'} testId="case-strip-overdue" />
    </StatStrip>
  );
}
