// 배송 상세 보탬(PC 5, 2026-11-17 — #88 위): 배차 시도 표(dispatch `GET /deliveries/{id}/dispatch` 의 attempts·offers)와
// 도착 예정(tracking `GET /deliveries/{id}/eta`). 값은 서버 그대로 — 남은 분·km 는 서버 초·미터를 단위만 바꿔 보인다.
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { components as DispatchC } from '../../api/generated/delivery-dispatch';
import type { components as ExecC } from '../../api/generated/delivery-execution';
import type { components as TrackingC } from '../../api/generated/delivery-tracking';
import { useApi } from '../../app/ApiContext';
import { AuthedPhotos } from '../../shared/AuthedPhotos';
import { messages } from '../../shared/messages';
import { DeliveryRef, RiderName, useRiderSummaries, RiderLink } from '../../shared/displayNumbers';
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
  reason: '이유',
  story: {
    title: '이 배송에 있었던 일',
    cases: '사건',
    siblings: '같은 주문의 다른 배송',
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

export function DispatchAttempts({ attempts }: { readonly attempts: readonly Attempt[] }) {
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
        .filter((c) => c.subjectRef === id || (c.refs ?? []).some((r) => r.refType === 'deliveryId' && r.refId === id))
        .filter((c) => !!c.caseId && (seen.has(c.caseId) ? false : (seen.add(c.caseId), true)));
    },
  });
  const siblings = useQuery({
    queryKey: ['delivery-story-siblings', orderNo ?? ''],
    enabled: !!orderNo,
    queryFn: () => request('GET', api.execution.GET('/deliveries', { params: { query: { orderNumber: orderNo!, size: 10 } } })),
  });
  const others = (siblings.data?.items ?? []).filter((d) => d.deliveryId !== id);
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
  for (const c of cases.data ?? []) {
    rows.push({
      k: s.cases,
      v: (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5" data-testid="story-case">
          <span className="badge badge-sm badge-outline">{label(messages.names.caseKind, c.kind)}</span>
          <span className="font-medium">{label(messages.names.caseState, c.state)}</span>
          {c.summary && <span className="text-base-content/70">{c.summary}</span>}
          <Link to={`/consults/cases/${encodeURIComponent(c.caseId ?? '')}`} className="link link-hover text-xs text-base-content/60">
            {c.caseNumber ?? '사건 보기'} ›
          </Link>
        </span>
      ),
    });
  }
  if (siblings.isError) rows.push({ k: s.siblings, v: <span className="text-error">{s.siblingsFailed}</span> });
  if (others.length > 0) {
    rows.push({
      k: s.siblings,
      v: (
        <span className="flex flex-wrap items-center gap-x-4 gap-y-0.5" data-testid="story-siblings">
          {others.map((d) => (
            <span key={d.deliveryId} className="inline-flex items-center gap-1.5">
              <DeliveryRef deliveryId={d.deliveryId} numbers={{ deliveryNumber: d.deliveryNumber ?? null, orderNumber: d.orderNumber ?? null }} />
              <span className="text-xs text-base-content/60">{label(messages.names.executionState, d.state)}</span>
            </span>
          ))}
        </span>
      ),
    });
  }
  if (e && isUnpaid(e)) rows.push({ k: s.fee, v: <span>{m.unpaid}{e.note ? ` — ${e.note}` : ''}</span> });
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
                {e.note && <Row k={m.reason}>{e.note}</Row>}
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