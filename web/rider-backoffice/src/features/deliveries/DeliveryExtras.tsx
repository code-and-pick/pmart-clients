// 배송 상세 보탬(PC 5, 2026-11-17 — #88 위): 배차 시도 표(dispatch `GET /deliveries/{id}/dispatch` 의 attempts·offers)와
// 도착 예정(tracking `GET /deliveries/{id}/eta`). 값은 서버 그대로 — 남은 분·km 는 서버 초·미터를 단위만 바꿔 보인다.
import { useQueries, useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { components as DispatchC } from '../../api/generated/delivery-dispatch';
import type { components as ExecC } from '../../api/generated/delivery-execution';
import type { components as TrackingC } from '../../api/generated/delivery-tracking';
import { useApi } from '../../app/ApiContext';
import { AuthedPhotos } from '../../shared/AuthedPhotos';
import { messages } from '../../shared/messages';
import { caseSummaryText } from '../../shared/caseText';
import { DeliveryNo, DeliveryRef, RiderName, shortDeliveryKind, useRiderSummaries, RiderLink } from '../../shared/displayNumbers';
import { label, none, when, won } from '../../shared/opsUi';
import { StatusBadge } from '../../shared/admin';
import type { Tone } from '@pmart/web-ui/console';
import { useEvidenceLoader } from '../../shared/evidenceLoader';

type Attempt = NonNullable<DispatchC['schemas']['Delivery']['attempts']>[number];
type EtaLeg = TrackingC['schemas']['EtaLeg'];
type Execution = ExecC['schemas']['DeliveryExecution'];
type CompletionMethod = NonNullable<NonNullable<Execution['evidence']>['method']>;

export const extrasMessages = {
  attempts: '배차 시도',
  noAttempts: '배차 시도 기록이 없어요.',
  attemptCol: { started: '시작', trigger: '계기', state: '시도 상태', radius: '반경', retry: '재시도', failure: '실패 사유', offers: '제안(라이더 · 응답 · 보낸 시각)' },
  attemptTrigger: { AUTO: '자동', STORE_STAFF: '점원 요청', REASSIGN: '재배차', RETRY: '재시도' } as Readonly<Record<string, string>>,
  attemptState: { SEARCHING: '찾는 중', OFFERING: '제안 중', ASSIGNED: '배정됨', FAILED: '실패', CANCELLED: '취소' } as Readonly<Record<string, string>>,
  attemptFailure: { NO_RIDER: '라이더 없음', REPEATED_REJECTION: '반복 거절', EXPIRED: '시간 초과', SYSTEM_FAILURE: '시스템 오류' } as Readonly<Record<string, string>>,
  offerState: { SENT: '보냄', ACCEPTED: '수락', REJECTED: '거절', EXPIRED: '만료', LATE: '늦은 응답', SEND_FAILED: '보내기 실패', SUPERSEDED: '대체됨' } as Readonly<Record<string, string>>,
  noOffers: '제안 없음',
  attemptsMore: (n: number) => `이전 시도 ${n}개 더 보기`,
  attemptsLess: '최근 시도만 보기',
  // 배차 지연(Delivery 업무 §3.6 "배차지연시간이 일정기준(ex.20분)을 넘으면 MFC관리자·고객센터에 안내")
  dispatchDelayTitle: '배차 지연 — 라이더를 못 찾고 있어요',
  dispatchDelayBody: (since: string, tries: number) => `${since}째 배정되지 않았어요 · 배차 시도 ${tries}번. 운영 조치에서 배차를 직접 확인해 주세요.`,
  dispatchDelayTag: (since: string) => `배차 지연 ${since}`,
  km: (v: number) => `${v}km`,
  retries: (n: number) => `${n}번`,
  eta: '도착 예정(delivery-tracking)',
  stage: '진행 단계',
  stageName: { UNASSIGNED: '배정 전', TO_STORE: '가게로 가는 중', AT_STORE: '가게 도착', TO_CUSTOMER: '고객에게 가는 중', AT_CUSTOMER: '고객 도착', DONE: '완료' } as Readonly<Record<string, string>>,
  outcome: '결과',
  outcomeName: { COMPLETED: '전달 완료', FAILED: '전달 실패', CANCELLED: '취소' } as Readonly<Record<string, string>>,
  pickupEta: '가게 도착 예정',
  dropEta: '고객 도착 예정',
  etaStatus: { AVAILABLE: '계산됨', LOCATING: '위치 확인 중', ETA_PENDING: '도착 예정 확인 중', FINAL: '확정' } as Readonly<Record<string, string>>,
  etaLeg: (at: string, minutes: number | null, meters: number | null) =>
    [at, minutes === null ? null : `${minutes}분 남음`, meters === null ? null : `${(meters / 1000).toFixed(1)}km`].filter(Boolean).join(' · '),
  delayed: (minutes: number) => `약속보다 ${minutes}분 늦음`,
  delayAlertedAt: '배차 지연 알림',
  delayAlert: '지연 알림 울림',
  riderLocation: '라이더 마지막 위치',
  riderLocationAt: (at: string, staleSeconds: number | null) => (staleSeconds === null ? at : `${at} (받은 지 ${staleSeconds}초)`),
  asOf: '기준 시각',
  freshness: { CURRENT: '최신', STALE: '지연', UNAVAILABLE: '확인 불가' } as Readonly<Record<string, string>>,
  proof: '전달 완료 증빙',
  noProof: '증빙이 없어요(아직 전달 전이거나 사진 없는 완료).',
  method: '완료 방법',
  // 완료 방법 — execution 0.22.1 계약 enum(요청서 #7 회신). 값이 늘면 타입 검사에서 걸린다. 사진은 FACE·CONTACTLESS 만(CUSTOMER_CONFIRMED·AUTO_COMPLETED 는 사진 없음)
  methodName: { FACE: '대면 전달', CONTACTLESS: '비대면(사진)', CUSTOMER_CONFIRMED: '고객이 "받았어요"', AUTO_COMPLETED: '자동 완료(픽업 5시간)' } satisfies Record<CompletionMethod, string> as Readonly<Record<string, string>>,
  placement: '놓은 곳',
  placementName: { HANDED_TO_CUSTOMER: '고객에게 직접', FRONT_DOOR: '문 앞', SECURITY_OFFICE: '경비실', DELIVERY_BOX: '택배함', OTHER: '기타' } as Readonly<Record<string, string>>,
  takenAt: '찍은 시각',
  proofPhoto: '완료 사진',
  substituteCase: '대체 증빙 접수 건',
  earning: '이 배송 수행료',
  fee: { base: '기본', surcharge: '할증', compensation: '보상(추가 배달료 포함)', deduction: '차감', total: '합계' },
  settlement: '정산 상태',
  payoutDate: '지급 예정일',
  notCalculable: '산정 불가 — 수행료 조정에서 귀책을 정해요',
  // 2026-11-24 라이더 백엔드 회신: settlementState ADJUSTED + calculable false = 최종 미지급(귀책 확정 등). 이유는 서버 note
  unpaid: '미지급',
  notCalculableShort: '산정 불가',
  reason: '이유',
  story: {
    title: '이 배송에 있었던 일',
    cases: '사건',
    siblings: '이 주문의 배송',
    thisOne: '이 배송',
    plain: '배송',
    caseLink: '사건 보기',
    fee: '수행료',
    failure: '전달 실패 신고',
    casesFailed: '사건을 불러오지 못했어요',
    siblingsFailed: '다른 배송을 불러오지 못했어요',
  },
  earningNone: '수행료 기록이 없어요.',
  returnFlow: '반납 방식',
  returnPickup: (v: boolean) => (v ? '받음 → 반납(다른 라이더가 원래 라이더에게서 받아 반납)' : '바로 반납(같은 라이더)'),
} as const;

const m = extrasMessages;
const DL = 'grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2.5 text-sm';

function Row({ k, children }: { readonly k: string; readonly children: ReactNode }) {
  return (
    <>
      <dt className="opacity-70">{k}</dt>
      <dd>{children}</dd>
    </>
  );
}

const attemptTone = (st: string | null | undefined): Tone => (st === 'ASSIGNED' ? 'success' : st === 'FAILED' ? 'error' : st === 'CANCELLED' ? 'neutral' : 'info');
const offerTone = (st: string | null | undefined): Tone =>
  st === 'ACCEPTED' ? 'success' : st === 'REJECTED' || st === 'SEND_FAILED' ? 'error' : st === 'SENT' ? 'info' : 'neutral';

/** 배차 지연 기준(분) — Delivery 업무 §3.6 예시값 20분 */
export const DISPATCH_DELAY_MIN = 20;
/** 경과 글자: "4일 2시간"·"3시간 5분"·"25분" */
export function elapsedText(fromIso: string, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const mm = min % 60;
  if (d > 0) return h > 0 ? `${d}일 ${h}시간` : `${d}일`;
  if (h > 0) return mm > 0 ? `${h}시간 ${mm}분` : `${h}시간`;
  return `${mm}분`;
}
/** 아직 라이더가 없는 배송이 배차 시작(첫 시도, 없으면 배송 생성)부터 기준을 넘었으면 그 시작 시각 */
export function dispatchDelaySince(startIso: string | null | undefined, hasRider: boolean, now = Date.now()): string | null {
  if (hasRider || !startIso) return null;
  const t = Date.parse(startIso);
  return Number.isFinite(t) && now - t >= DISPATCH_DELAY_MIN * 60_000 ? startIso : null;
}

/**
 * 배송 상세 맨 위 빨간 경고(2026-11-24 사용자 "4일째 배차 찾고 있는데 왜 아무데도 위급하다고 빨리 처리하라는 알림이나 글이 안 적혀 있어?").
 * 배차 상태가 아직 찾는 중·실패(라이더 없음)이고 배차 시작부터 20분이 넘으면.
 */
/**
 * 서버 시각(2026-11-24 PR #485 검토 — "PC 시계가 틀리면 어긋남"): execution `GET /delivery-stats` 의 asOf(서버 응답 시각)와 받은 때의 차이로
 * 지금 서버 시각을 센다(1분마다 다시). 못 읽으면 PC 시계.
 */
export function useServerNow(): () => number {
  const api = useApi();
  const q = useQuery({
    queryKey: ['server-clock'],
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: () => request('GET', api.execution.GET('/delivery-stats', { params: { query: {} } })),
  });
  const asOf = q.data?.asOf ? Date.parse(q.data.asOf) : NaN;
  const offset = Number.isFinite(asOf) && q.dataUpdatedAt ? asOf - q.dataUpdatedAt : 0;
  return () => Date.now() + offset;
}

export function DispatchDelayAlert({ dispatchState, attempts, createdAt, delayAlertedAt, hasRider }: { readonly dispatchState: string | null | undefined; readonly attempts: readonly Attempt[]; readonly createdAt: string | null | undefined; readonly delayAlertedAt?: string | null | undefined; readonly hasRider: boolean }) {
  const now = useServerNow()();
  if (!['CREATED', 'DISPATCHING', 'DISPATCH_FAILED'].includes(dispatchState ?? '') || hasRider) return null;
  // 기준은 목록과 같게 배송 생성 시각(없으면 첫 시도). 서버가 배차 지연 알림을 냈으면(delayAlertedAt) 그것을 먼저 믿는다
  const start = createdAt ?? attempts.map((a) => a.startedAt).filter((x): x is string => !!x).sort()[0] ?? null;
  const since = delayAlertedAt && start ? start : dispatchDelaySince(start, hasRider, now);
  if (!since) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-box border border-error bg-error/10 px-4 py-3" data-testid="dispatch-delay">
      <span className="mt-1 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-error" aria-hidden />
      <div>
        <p className="font-bold text-error">{m.dispatchDelayTitle}</p>
        <p className="text-sm">{m.dispatchDelayBody(elapsedText(since, now), attempts.length)}</p>
      </div>
    </div>
  );
}

/** 처음에 보이는 배차 시도 수(2026-11-24 사용자 "배차 시도가 일정 개수 넘어가면 더보기로 열게 해주고 최신 게 위에") */
const ATTEMPTS_SHOWN = 3;

export function DispatchAttempts({ attempts: raw }: { readonly attempts: readonly Attempt[] }) {
  const [all, setAll] = useState(false);
  // 최신 시도가 위(서버는 오래된 순) — 같은 시각이면 받은 순서를 뒤집은 순
  const sorted = [...raw].map((t, i) => ({ t, i })).sort((a, b) => (b.t.startedAt ?? '').localeCompare(a.t.startedAt ?? '') || b.i - a.i).map((x) => x.t);
  const attempts = all ? sorted : sorted.slice(0, ATTEMPTS_SHOWN);
  const hidden = sorted.length - attempts.length;
  // 제안받은 라이더: 가린 이름 · 라이더 번호(ADR-0070, 한 번에 조회)
  const riders = useRiderSummaries(attempts.flatMap((t) => (t.offers ?? []).map((o) => o.riderId)));
  return (
    <div className="space-y-1">
      {attempts.length === 0 ? (
        <p className="text-sm opacity-70">{m.noAttempts}</p>
      ) : (
        // 2026-11-24 사용자 "이것도 스크롤 안 하게 하는 방법 없어?" → 같은 날 "배차에 UI 이게 최선이니?" — 시도마다 카드:
        // 머리 줄(상태 꼬리표·시각·계기 | 반경·재시도), 실패 사유, 제안은 라이더마다 한 줄(라이더 | 응답 꼬리표·보낸 시각). 옆 스크롤 없음.
        <ol className="space-y-2" data-testid="dispatch-attempts">
          {attempts.map((t, i) => (
            <li key={t.attemptId ?? `a-${i}`} className="overflow-hidden rounded-box border border-base-300 bg-base-100" data-testid="dispatch-attempt">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-base-200/50 px-3 py-2">
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={attemptTone(t.state)}>{label(m.attemptState, t.state)}</StatusBadge>
                  <span className="text-sm font-semibold">{when(t.startedAt)}</span>
                  <span className="text-xs text-base-content/60" title={m.attemptCol.trigger}>
                    {label(m.attemptTrigger, t.trigger)}
                  </span>
                </span>
                <span className="text-xs text-base-content/60">
                  {m.attemptCol.radius} {t.currentRadiusKm === undefined ? none : m.km(t.currentRadiusKm)} · {m.attemptCol.retry} {t.retryCount === undefined ? none : m.retries(t.retryCount)}
                </span>
              </div>
              {t.failureReason && (
                <p className="border-t border-base-200 px-3 py-1.5 text-xs">
                  <span className="text-base-content/60">{m.attemptCol.failure} </span>
                  <span className="font-medium text-error">{label(m.attemptFailure, t.failureReason)}</span>
                </p>
              )}
              {(t.offers ?? []).length === 0 ? (
                <p className="border-t border-base-200 px-3 py-2 text-xs text-base-content/60">{m.noOffers}</p>
              ) : (
                <ul className="divide-y divide-base-200 border-t border-base-200" aria-label={m.attemptCol.offers}>
                  {(t.offers ?? []).map((o, j) => (
                    <li key={o.offerId ?? `o-${j}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm">
                      {o.riderId ? <RiderLink riderId={o.riderId} nameMasked={riders.get(o.riderId)?.nameMasked} riderNumber={riders.get(o.riderId)?.riderNumber} /> : <RiderName riderId={o.riderId} />}
                      <span className="flex items-center gap-2">
                        <StatusBadge tone={offerTone(o.state)}>{label(m.offerState, o.state)}</StatusBadge>
                        <span className="text-xs text-base-content/60">{when(o.sentAt)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      {(hidden > 0 || all) && sorted.length > ATTEMPTS_SHOWN && (
        <button type="button" className="btn btn-ghost btn-xs w-full" onClick={() => setAll((v) => !v)} data-testid="dispatch-attempts-more">
          {all ? m.attemptsLess : m.attemptsMore(hidden)}
        </button>
      )}
    </div>
  );
}

const minutes = (s: number | undefined) => (s === undefined ? null : Math.max(0, Math.round(s / 60)));

function Leg({ leg }: { readonly leg: EtaLeg | undefined }) {
  if (!leg) return <>{none}</>;
  if (leg.status !== 'AVAILABLE') return <>{label(m.etaStatus, leg.status)}</>;
  const late = leg.delayedBySeconds !== undefined && leg.delayedBySeconds > 0 ? minutes(leg.delayedBySeconds) : null;
  return (
    <>
      {m.etaLeg(when(leg.etaAt), minutes(leg.remainingSeconds), leg.remainingDistanceM ?? null)}
      {late !== null && <span className="badge badge-warning badge-sm ml-1">{m.delayed(late)}</span>}
    </>
  );
}

/** `refreshMs` 를 주면 그 간격으로 다시 불러온다(관제 상세 칸 — 실시간). 배송 상세는 한 번. */
export function EtaPanel({ deliveryId, refreshMs }: { readonly deliveryId: string; readonly refreshMs?: number }) {
  const api = useApi();
  const eta = useQuery({
    ...(refreshMs ? { refetchInterval: refreshMs } : {}),
    queryKey: ['delivery', deliveryId, 'eta'],
    queryFn: () => request('GET', api.tracking.GET('/deliveries/{deliveryId}/eta', { params: { path: { deliveryId } } })),
  });
  return (
    <div className="space-y-2">
      <QueryState state={toUiState(eta)} onRetry={() => void eta.refetch()}>
        {(e) => (
          <dl className={DL} data-testid="eta-detail">
            <Row k={m.stage}>{label(m.stageName, e.stage)}</Row>
            {e.outcome && <Row k={m.outcome}>{label(m.outcomeName, e.outcome)}</Row>}
            <Row k={m.pickupEta}>
              <Leg leg={e.pickupEta} />
            </Row>
            <Row k={m.dropEta}>
              <Leg leg={e.dropEta} />
            </Row>
            {e.delayAlertTriggered && <Row k={m.delayAlertedAt}>{m.delayAlert}</Row>}
            <Row k={m.riderLocation}>{e.riderLocation?.recordedAt ? m.riderLocationAt(when(e.riderLocation.recordedAt), e.riderLocation.staleSeconds ?? null) : none}</Row>
            <Row k={m.asOf}>{e.asOf ? `${when(e.asOf.asOf)} · ${label(m.freshness, e.asOf.freshness ?? 'UNAVAILABLE')}` : none}</Row>
          </dl>
        )}
      </QueryState>
    </div>
  );
}

/** 전달 완료 증빙(execution `evidence`) — 방법·놓은 곳·시각·사진. 반납 배송이면 반납 방식(`returnPickupRequired`). */
export function DeliveryProof({ delivery }: { readonly delivery: Execution }) {
  const deliveryId = delivery.deliveryId ?? '';
  const load = useEvidenceLoader(deliveryId);
  const ev = delivery.evidence;
  const isReturn = delivery.returnPickupRequired !== undefined && delivery.returnPickupRequired !== null;
  return (
    <div className="space-y-2" data-testid="delivery-proof">
      {isReturn && (
        <dl className={DL} data-testid="return-flow">
          <Row k={m.returnFlow}>{m.returnPickup(delivery.returnPickupRequired === true)}</Row>
        </dl>
      )}
      {!ev ? (
        <p className="text-sm opacity-70">{m.noProof}</p>
      ) : (
        <>
          <dl className={DL}>
            <Row k={m.method}>{label(m.methodName, ev.method)}</Row>
            {ev.placement && <Row k={m.placement}>{label(m.placementName, ev.placement)}</Row>}
            <Row k={m.takenAt}>{when(ev.takenAt)}</Row>
            {ev.substituteEvidenceCaseId && (
              <Row k={m.substituteCase}>
                <Link className="link link-primary" to={`/consults/cases/${encodeURIComponent(ev.substituteEvidenceCaseId)}`}>
                  접수 건 보기
                </Link>
              </Row>
            )}
          </dl>
          {(ev.photoRefs ?? []).length > 0 && <AuthedPhotos refs={ev.photoRefs ?? []} load={load} label={m.proofPhoto} heading={false} />}
        </>
      )}
    </div>
  );
}

const isUnpaid = (e: NonNullable<Execution['earning']>) => e.calculable === false && e.settlementState === 'ADJUSTED';
const stripCaseId = (note: string | null | undefined) => (note ?? '').replace(/\s*\(?사건\s+CASE-[0-9A-Za-z-]+…?\)?/g, '').trim();

/** 배송 줄 옆 수행료 네모칸 — 미지급(조정으로 끝남) 또는 산정 불가만. 이유(서버 note, 사건 ID 뺌)는 올려 보면 */
function FeeTag({ earning }: { readonly earning: Execution['earning'] | undefined }) {
  if (!earning || earning.calculable !== false) return null;
  const unpaid = isUnpaid(earning);
  const why = stripCaseId(earning.note);
  return (
    <span
      className={`rounded border px-1 text-[11px] font-semibold leading-4 ${unpaid ? 'border-error/50 text-error' : 'border-warning/60 text-warning'}`}
      title={why || undefined}
      data-testid="story-fee-tag"
    >
      {unpaid ? m.unpaid : m.notCalculableShort}
    </span>
  );
}

/**
 * "이 배송에 있었던 일"(2026-11-24 사용자 "이 배송에 문제가 뭐였는지 백오피스에서 바로 보기가 힘들어") — 상세 맨 위 한 상자:
 * 전달 실패 신고(판정), 이 배송이 걸린 사건(case `GET /cases?subjectRef=` 배송 ID·주문 ID — 배송을 참조로 가진 것만), 같은 주문의 다른 배송(회수·재발송 …),
 * 수행료가 미지급이면 서버 이유. 보일 것이 없으면 상자도 없다. 못 읽은 부분은 그렇다고 적는다(없다고 하지 않음).
 */
export function DeliveryStory({ delivery }: { readonly delivery: Execution }) {
  const api = useApi();
  const s = m.story;
  const id = delivery.deliveryId ?? '';
  const orderNo = delivery.orderNumber ?? delivery.orderSummary?.orderNumber ?? null;
  const subjects = [id, delivery.orderId].filter((x): x is string => !!x);
  const cases = useQuery({
    queryKey: ['delivery-story-cases', id, delivery.orderId ?? ''],
    enabled: !!id,
    queryFn: async () => {
      const pages = await Promise.all(subjects.map((ref) => request('GET', api.cases.GET('/cases', { params: { query: { subjectRef: ref, size: 20 } } }))));
      const seen = new Set<string>();
      return pages
        .flatMap((p) => p.items ?? [])
        // 이 배송을 가리키는 사건 + 주문 전체 사건(오배송 등은 주문을 주제로 연다 — 2026-11-24 D28767701-3)
        .filter((c) => c.subjectRef === id || c.subjectRef === delivery.orderId || (c.refs ?? []).some((r) => r.refType === 'deliveryId' && r.refId === id))
        .filter((c) => !!c.caseId && (seen.has(c.caseId) ? false : (seen.add(c.caseId), true)));
    },
  });
  // 수행료 이유(서버 note)에 적힌 사건 ID — 목록에 없으면 한 건 읽어 같은 줄로 보인다. 글자에서는 긴 ID 를 뺀다
  const noteCaseId = /CASE-[0-9A-Za-z-]+/.exec(delivery.earning?.note ?? '')?.[0] ?? null;
  const noteCase = useQuery({
    queryKey: ['delivery-story-note-case', noteCaseId ?? ''],
    enabled: !!noteCaseId && !!cases.data && !cases.data.some((c) => c.caseId === noteCaseId),
    queryFn: () => request('GET', api.cases.GET('/cases/{caseId}', { params: { path: { caseId: noteCaseId! } } })),
  });
  const caseRows = [...(cases.data ?? []), ...(noteCase.data && !(cases.data ?? []).some((c) => c.caseId === noteCase.data.caseId) ? [noteCase.data] : [])];
  const siblings = useQuery({
    queryKey: ['delivery-story-siblings', orderNo ?? ''],
    enabled: !!orderNo,
    queryFn: () => request('GET', api.execution.GET('/deliveries', { params: { query: { orderNumber: orderNo!, size: 10 } } })),
  });
  // 이 주문의 배송 전부(이 배송 포함) — 순번 순. 다른 배송의 "전달 실패 확정" 이 이 배송 일로 보이지 않게 이 배송을 표시한다
  const seqOf = (no: string | null | undefined) => Number(/-(\d+)$/.exec(no ?? '')?.[1] ?? '1');
  const orderDeliveries = [...(siblings.data?.items ?? [])].sort((a, b) => seqOf(a.deliveryNumber) - seqOf(b.deliveryNumber));
  const hasOthers = orderDeliveries.some((d) => d.deliveryId !== id);
  // 배송마다 수행료(2026-11-24 사용자 "그냥 이 주문의 배송 … 그 옆에 네모칸 안에 미지급 이렇게 적어") — 다른 배송은 상세를 한 번씩 읽는다(주문당 몇 건)
  const otherIds = orderDeliveries.map((d) => d.deliveryId ?? '').filter((x) => !!x && x !== id);
  const details = useQueries({
    queries: otherIds.map((did) => ({
      queryKey: ['delivery-story-detail', did],
      staleTime: 60_000,
      queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}', { params: { path: { deliveryId: did } } })),
    })),
  });
  const earningOf = (did: string | null | undefined) => (did === id ? delivery.earning : details[otherIds.indexOf(did ?? '')]?.data?.earning);
  const e = delivery.earning;
  const f = delivery.failure;
  const rows: { readonly k: string; readonly v: ReactNode }[] = [];
  if (f) {
    rows.push({
      k: s.failure,
      v: (
        <span>
          {label(messages.names.failureReason, f.reason)}
          {f.decision ? ` · ${label(messages.names.decision, f.decision)}` : ''}
        </span>
      ),
    });
  }
  if (cases.isError) rows.push({ k: s.cases, v: <span className="text-error">{s.casesFailed}</span> });
  for (const c of caseRows) {
    rows.push({
      k: s.cases,
      v: (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5" data-testid="story-case">
          <span className="badge badge-sm badge-outline">{label(messages.names.caseKind, c.kind)}</span>
          <span className="font-medium">{label(messages.names.caseState, c.state)}</span>
          {/* 꼬리표에 종류가 있으니 요약 앞 "종류 — " 는 떼고, 영문 코드는 한글로 */}
          {c.summary && <span className="text-base-content/70">{caseSummaryText(c.summary, label(messages.names.caseKind, c.kind), true)}</span>}
          <Link to={`/consults/cases/${encodeURIComponent(c.caseId ?? '')}`} className="link link-hover text-xs text-base-content/60">
            {c.caseNumber ?? s.caseLink} ›
          </Link>
        </span>
      ),
    });
  }
  if (siblings.isError) rows.push({ k: s.siblings, v: <span className="text-error">{s.siblingsFailed}</span> });
  if (hasOthers) {
    rows.push({
      k: s.siblings,
      v: (
        <ol className="space-y-0.5" data-testid="story-siblings">
          {orderDeliveries.map((d) => {
            const mine = d.deliveryId === id;
            const kind = shortDeliveryKind(d.purpose, d.type) ?? s.plain;
            return (
              <li key={d.deliveryId} className={`flex flex-wrap items-center gap-2 ${mine ? 'font-semibold' : ''}`} data-testid={mine ? 'story-this' : undefined}>
                {mine ? (
                  <DeliveryNo kindTag={false} deliveryId={d.deliveryId ?? ''} deliveryNumber={d.deliveryNumber} orderNumber={d.orderNumber} />
                ) : (
                  <DeliveryRef kindTag={false} deliveryId={d.deliveryId} numbers={{ deliveryNumber: d.deliveryNumber ?? null, orderNumber: d.orderNumber ?? null }} />
                )}
                <span className="rounded border border-base-300 px-1 text-[11px] font-medium leading-4 text-base-content/70">{kind}</span>
                <span className={`text-xs ${mine ? 'text-base-content' : 'text-base-content/60'}`}>{label(messages.names.executionState, d.state)}</span>
                <FeeTag earning={earningOf(d.deliveryId)} />
                {mine && <span className="badge badge-primary badge-sm">{s.thisOne}</span>}
              </li>
            );
          })}
        </ol>
      ),
    });
  }
  // 수행료 이유에서 긴 사건 ID("(사건 CASE-…)")는 빼고 보인다 — 사건은 위 "사건" 줄에서 접수 번호·링크로
  const noteText = (e?.note ?? '').replace(/\s*\(?사건\s+CASE-[0-9A-Za-z-]+…?\)?/g, '').trim();
  // 같은 주문 배송 줄이 있으면 미지급은 그 줄 옆 네모칸(이유는 올려 보면). 배송이 하나뿐일 때만 따로 한 줄
  if (e && isUnpaid(e) && !hasOthers) rows.push({ k: s.fee, v: <span data-testid="story-fee">{m.unpaid}{noteText ? ` — ${noteText}` : ''}</span> });
  if (rows.length === 0) return null;
  return (
    <section className="rounded-box border border-warning/40 bg-warning/5 px-4 py-3" aria-label={s.title} data-testid="delivery-story">
      <h2 className="mb-1.5 text-sm font-bold">{s.title}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map((r, i) => (
          <div key={i} className="contents">
            <dt className="text-base-content/60">{r.k}</dt>
            <dd className="min-w-0">{r.v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** 이 배송의 수행료(execution `earning`) — 서버 금액 그대로 */
export function DeliveryEarning({ delivery }: { readonly delivery: Execution }) {
  const e = delivery.earning;
  return (
    <div className="space-y-2" data-testid="delivery-earning">
      {!e ? (
        <p className="text-sm opacity-70">{m.earningNone}</p>
      ) : (
        <>
          <dl className={DL}>
            {e.calculable === false ? (
              <>
                <Row k={m.fee.total}>
                  {/* 미지급으로 끝난 건(ADJUSTED)은 "조정에서 정해요" 가 아니라 미지급 + 서버 이유 */}
                  <span className={`badge badge-sm ${isUnpaid(e) ? 'badge-error badge-soft' : 'badge-warning'}`}>{isUnpaid(e) ? m.unpaid : m.notCalculable}</span>
                </Row>
                {e.note && <Row k={m.reason}>{e.note.replace(/\s*\(?사건\s+CASE-[0-9A-Za-z-]+…?\)?/g, '').trim()}</Row>}
              </>
            ) : (
              <>
                <Row k={m.fee.base}>{won(e.baseFee)}</Row>
                {e.surcharge !== undefined && <Row k={m.fee.surcharge}>{won(e.surcharge)}</Row>}
                {e.compensation !== undefined && <Row k={m.fee.compensation}>{won(e.compensation)}</Row>}
                {e.deduction !== undefined && <Row k={m.fee.deduction}>{won(e.deduction)}</Row>}
                <Row k={m.fee.total}>
                  <strong>{won(e.total)}</strong>
                </Row>
              </>
            )}
            <Row k={m.settlement}>{label(messages.names.settlementState, e.settlementState)}</Row>
            {/* 미지급이면 지급 예정일을 숨긴다(서버가 예전 날짜를 지우지 않는다 — 라이더 백엔드 2026-11-24) */}
            {e.payoutDate && !isUnpaid(e) && <Row k={m.payoutDate}>{e.payoutDate}</Row>}
          </dl>
          {/* 2026-11-24 사용자 "이렇게 긴 회색글들 필요한 말만 하고 줄여" — "서버 값 그대로" 안내 줄을 뺐다(값은 그대로 서버 값) */}
        </>
      )}
    </div>
  );
}