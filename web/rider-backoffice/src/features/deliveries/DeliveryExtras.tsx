// 배송 상세 보탬(PC 5, 2026-11-17 — #88 위): 배차 시도 표(dispatch `GET /deliveries/{id}/dispatch` 의 attempts·offers)와
// 도착 예정(tracking `GET /deliveries/{id}/eta`). 값은 서버 그대로 — 남은 분·km 는 서버 초·미터를 단위만 바꿔 보인다.
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { components as DispatchC } from '../../api/generated/delivery-dispatch';
import type { components as ExecC } from '../../api/generated/delivery-execution';
import type { components as TrackingC } from '../../api/generated/delivery-tracking';
import { useApi } from '../../app/ApiContext';
import { AuthedPhotos } from '../../shared/AuthedPhotos';
import { messages } from '../../shared/messages';
import { label, none, when, won } from '../../shared/opsUi';
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
  stageName: { UNASSIGNED: '배정 전', TO_STORE: '가게로 가는 중', AT_STORE: '가게 도착', TO_CUSTOMER: '고객에게 가는 중', AT_CUSTOMER: '고객 도착', DONE: '끝남' } as Readonly<Record<string, string>>,
  outcome: '결과',
  outcomeName: { COMPLETED: '전달 완료', FAILED: '전달 실패', CANCELLED: '취소' } as Readonly<Record<string, string>>,
  pickupEta: '가게 도착 예정',
  dropEta: '고객 도착 예정',
  etaStatus: { AVAILABLE: '계산됨', LOCATING: '위치 확인 중', ETA_PENDING: '도착 예정 확인 중', FINAL: '끝남' } as Readonly<Record<string, string>>,
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
  earningNote: '금액·지급 상태는 서버 값 그대로예요(화면에서 계산하지 않아요).',
  fee: { base: '기본', surcharge: '할증', compensation: '보상(추가 배달료 포함)', deduction: '차감', total: '합계' },
  settlement: '정산 상태',
  payoutDate: '지급 예정일',
  notCalculable: '산정 불가 — 수행료 조정에서 귀책을 정해요',
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

export function DispatchAttempts({ attempts }: { readonly attempts: readonly Attempt[] }) {
  return (
    <div className="space-y-1">
      {attempts.length === 0 ? (
        <p className="text-sm opacity-70">{m.noAttempts}</p>
      ) : (
        <div className="overflow-x-auto rounded-box border border-base-300">
          <table className="table table-xs [&_thead_th]:bg-base-200/70" data-testid="dispatch-attempts">
            <thead>
              <tr>
                <th>{m.attemptCol.started}</th>
                <th>{m.attemptCol.trigger}</th>
                <th>{m.attemptCol.state}</th>
                <th>{m.attemptCol.radius}</th>
                <th>{m.attemptCol.retry}</th>
                <th>{m.attemptCol.failure}</th>
                <th>{m.attemptCol.offers}</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((t, i) => (
                <tr key={t.attemptId ?? `a-${i}`} data-testid="dispatch-attempt">
                  <td className="whitespace-nowrap">{when(t.startedAt)}</td>
                  <td>{label(m.attemptTrigger, t.trigger)}</td>
                  <td>{label(m.attemptState, t.state)}</td>
                  <td>{t.currentRadiusKm === undefined ? none : m.km(t.currentRadiusKm)}</td>
                  <td>{t.retryCount === undefined ? none : m.retries(t.retryCount)}</td>
                  <td>{label(m.attemptFailure, t.failureReason)}</td>
                  <td>
                    {(t.offers ?? []).length === 0 ? (
                      <span className="opacity-70">{m.noOffers}</span>
                    ) : (
                      <ul>
                        {(t.offers ?? []).map((o, j) => (
                          <li key={o.offerId ?? `o-${j}`} className="whitespace-nowrap font-mono">{`${o.riderId ?? none} · ${label(m.offerState, o.state)} · ${when(o.sentAt)}`}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
            {ev.substituteEvidenceCaseId && <Row k={m.substituteCase}>{ev.substituteEvidenceCaseId}</Row>}
          </dl>
          {(ev.photoRefs ?? []).length > 0 && <AuthedPhotos refs={ev.photoRefs ?? []} load={load} label={m.proofPhoto} heading={false} />}
        </>
      )}
    </div>
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
              <Row k={m.fee.total}>
                <span className="badge badge-warning badge-sm">{m.notCalculable}</span>
              </Row>
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
            {e.payoutDate && <Row k={m.payoutDate}>{e.payoutDate}</Row>}
          </dl>
          <p className="text-xs opacity-70">{m.earningNote}</p>
        </>
      )}
    </div>
  );
}