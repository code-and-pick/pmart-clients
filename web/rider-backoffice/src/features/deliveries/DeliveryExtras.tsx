// 배송 상세 보탬(PC 5, 2026-11-17 — #88 위): 배차 시도 표(dispatch `GET /deliveries/{id}/dispatch` 의 attempts·offers)와
// 도착 예정(tracking `GET /deliveries/{id}/eta`). 값은 서버 그대로 — 남은 분·km 는 서버 초·미터를 단위만 바꿔 보인다.
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { components as DispatchC } from '../../api/generated/delivery-dispatch';
import type { components as TrackingC } from '../../api/generated/delivery-tracking';
import { useApi } from '../../app/ApiContext';
import { label, none, when } from '../../shared/opsUi';

type Attempt = NonNullable<DispatchC['schemas']['Delivery']['attempts']>[number];
type EtaLeg = TrackingC['schemas']['EtaLeg'];

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
} as const;

const m = extrasMessages;
const DL = 'grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 rounded-box bg-base-100 p-4 text-sm';

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
      <h3 className="font-semibold">{m.attempts}</h3>
      {attempts.length === 0 ? (
        <p className="text-sm opacity-70">{m.noAttempts}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-xs rounded-box bg-base-100" data-testid="dispatch-attempts">
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
                  <td>{when(t.startedAt)}</td>
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
                          <li key={o.offerId ?? `o-${j}`} className="font-mono">{`${o.riderId ?? none} · ${label(m.offerState, o.state)} · ${when(o.sentAt)}`}</li>
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

export function EtaPanel({ deliveryId }: { readonly deliveryId: string }) {
  const api = useApi();
  const eta = useQuery({
    queryKey: ['delivery', deliveryId, 'eta'],
    queryFn: () => request('GET', api.tracking.GET('/deliveries/{deliveryId}/eta', { params: { path: { deliveryId } } })),
  });
  return (
    <div className="space-y-2">
      <h2 className="font-bold">{m.eta}</h2>
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
