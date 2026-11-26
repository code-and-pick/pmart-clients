// 배차 지연(우리 센터) — delivery-dispatch 0.12.0 `GET /dispatch-delays?mfcId=`(백엔드 요청 clients/mfc-backoffice/2026-11-19-request-dispatch-delays,
// 원문 Delivery §3.6 "배차 지연 시간이 기준을 넘으면 MFC 관리자·고객센터에 안내"). 지연 안내(DispatchDelayed)가 난 픽업 전 배송, 약속이 이른 것부터.
// - 배송 번호(ADR-0070)는 delivery-execution `GET /deliveries?deliveryIds=&mfcId=`(0.31.0 묶음, 50개씩)로 붙인다. 못 읽으면 "번호 확인 불가"(번호 없음과 구분).
// - "약속 대비" = 지금 − promisedAt(표시만 — 판정은 서버가 이미 지연 안내로 했다). 약속 시각이 없으면 "약속 없음".
// - "배차 불가로 취소"(claim 0.11.0 DC-1 — lines 생략, 서버가 주문 행을 채움)는 DispatchCancel.tsx.
// - 30초마다 다시 읽는다(목록은 서버가 픽업되면 뺀다).
// - (2026-11-26 화면 검토 "두 건 상황이 다른데 조치가 같다") 지연 종류를 나눈다 — 라이더 없음(CREATED·DISPATCHING) = 배차 탐색 지연,
//   배정됨(ASSIGNED) = 픽업 지연. 줄마다 다음 할 일과 취소하면 생기는 일(백엔드 cancel-vs-handover §7 — 픽업 전 배송 거둠·포장분 취소 복귀),
//   탐색 지연은 약속 + 30분 자동 취소(claim 0.9.1)까지 남은 시간. 같은 배송의 열린 배차 실패 접수(case DISPATCH_FAILED — 지원센터 처리)가 있으면 그 접수로.
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import type { Api } from '../../api/client';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { DisplayNumber, RiderLabel, SystemNumbers } from '../../shared/displayNumber';
import { AllDone } from '../../shared/listParts';
import { messages } from '../../shared/messages';
import { useNow } from '../../shared/motion';
import { DispatchCancelButton } from './DispatchCancel';

const m = messages.dispatchDelays;
const REFRESH_MS = 30_000;
const BATCH = 50;
/** 약속 + 30분에 라이더가 없으면 dispatch 가 자동 취소한다(claim 0.9.1, 설정 pmart.dispatch.auto-cancel-after — 화면은 기본값만 안내) */
const AUTO_CANCEL_MIN = 30;

export type DelayKind = 'SEARCH' | 'PICKUP';
export const delayKindOf = (d: { readonly state: string; readonly riderId?: string | null }): DelayKind => (d.state === 'ASSIGNED' || d.riderId ? 'PICKUP' : 'SEARCH');

/** 배송 ID → 열린 배차 실패 접수(지원센터) — 센터의 열린 것 50건 안에서 대상·참조로 맞춘다 */
function useOpenDispatchFailures(mfcId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['dispatch-failures', mfcId, false],
    refetchInterval: REFRESH_MS,
    queryFn: () => request('GET', api.cases.GET('/cases', { params: { query: { kind: 'DISPATCH_FAILED', centerId: mfcId, size: 50 } } })),
    select: (r) => {
      const map = new Map<string, { readonly caseId: string; readonly caseNumber: string | null; readonly overdue: boolean }>();
      for (const c of r.items ?? []) {
        if (!c.caseId) continue;
        const ids = [c.subjectRef, ...(c.refs ?? []).filter((x) => x.refType === 'deliveryId').map((x) => x.refId)];
        for (const id of ids) if (id && !map.has(id)) map.set(id, { caseId: c.caseId, caseNumber: c.caseNumber ?? null, overdue: !!c.overdue });
      }
      return map;
    },
  });
}

export function useDispatchDelays(mfcId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: ['dispatch-delays', mfcId ?? ''],
    enabled: !!mfcId,
    refetchInterval: REFRESH_MS,
    queryFn: async () => (await request('GET', api.dispatch.GET('/dispatch-delays', { params: { query: { mfcId: mfcId ?? '' } } }))).items,
  });
}

/** 배송 ID → 배송 번호(50개씩 묶음 조회) */
async function readNumbers(api: Api, mfcId: string, ids: readonly string[]) {
  const map = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const r = await request('GET', api.execution.GET('/deliveries', { params: { query: { mfcId, deliveryIds: chunk.join(','), size: chunk.length } } }));
    for (const d of r.items ?? []) if (d.deliveryId) map.set(d.deliveryId, d.deliveryNumber ?? null);
  }
  return map;
}

export function DispatchDelaysMenu({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const query = useDispatchDelays(mfcId);
  const ids = (query.data ?? []).map((d) => d.deliveryId);
  const numbers = useQuery({
    queryKey: ['dispatch-delay-numbers', mfcId, ids.join(',')],
    enabled: ids.length > 0,
    queryFn: () => readNumbers(api, mfcId, ids),
  });
  const now = useNow(30_000);
  const failures = useOpenDispatchFailures(mfcId);
  return (
    <section className="space-y-4">
      <h1>{messages.menus.dispatchDelays}</h1>
      {numbers.isError && (
        <p role="alert" className="alert alert-warning text-sm">
          {m.numbersFailed}
        </p>
      )}
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(items) =>
          items.length === 0 ? (
            <AllDone body={m.none} />
          ) : (
            <div className="overflow-x-auto rounded-box bg-base-100">
            <table className="table table-sm" data-testid="dispatch-delays">
              <thead>
                <tr>
                  <th>{m.col.delivery}</th>
                  <th>{m.col.kind}</th>
                  <th>{m.col.state}</th>
                  <th>{m.col.rider}</th>
                  <th>{m.col.promised}</th>
                  <th>{m.col.late}</th>
                  <th>{m.col.alerted}</th>
                  <th>{m.col.action}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => {
                  const over = d.promisedAt ? Math.floor((now - Date.parse(d.promisedAt)) / 60_000) : null;
                  const kind = delayKindOf(d);
                  const failure = failures.data?.get(d.deliveryId);
                  return (
                    <tr key={d.deliveryId} data-testid="dispatch-delay-row">
                      <td>
                        {numbers.isPending ? '…' : <DisplayNumber number={numbers.data?.get(d.deliveryId) ?? null} systemId={d.deliveryId} {...(numbers.isError ? { failed: true } : {})} />}
                        <SystemNumbers
                          ids={[
                            { label: messages.displayNumber.system.deliveryId, id: d.deliveryId },
                            { label: messages.displayNumber.system.orderId, id: d.orderId },
                          ]}
                        />
                      </td>
                      <td data-testid="delay-kind">
                        <span className={`badge badge-sm ${kind === 'SEARCH' ? 'badge-error' : 'badge-warning'}`}>{m.kind[kind]}</span>
                      </td>
                      <td>{m.state[d.state] ?? d.state}</td>
                      <td>{d.riderId ? <RiderLabel riderId={d.riderId} /> : <span className="font-semibold text-warning">{m.noRider}</span>}</td>
                      <td>{d.promisedAt ? formatSeoul(d.promisedAt) : m.noPromise}</td>
                      <td data-testid="delay-minutes">
                        {over === null ? (
                          messages.none
                        ) : over >= 0 ? (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-error">
                            <span className="breathe h-2 w-2 rounded-full bg-error" aria-hidden="true" />
                            {m.over(over)}
                          </span>
                        ) : (
                          <span className="text-warning">{m.left(-over)}</span>
                        )}
                      </td>
                      <td>{formatSeoul(d.delayAlertedAt)}</td>
                      <td className="min-w-64 space-y-1.5" data-testid="delay-next">
                        <p className="text-xs">{m.next[kind]}</p>
                        {kind === 'SEARCH' && over !== null && (
                          <p className="text-xs text-base-content/60">{over >= AUTO_CANCEL_MIN ? m.autoCancelDue : m.autoCancelIn(AUTO_CANCEL_MIN - over)}</p>
                        )}
                        {failure ? (
                          <p className="text-xs">
                            <Link className={`link ${failure.overdue ? 'text-error' : ''}`} to={centerPath(mfcId, `dispatch-failures/${encodeURIComponent(failure.caseId)}`)} data-testid="delay-failure-link">
                              {m.failureCase(failure.caseNumber)}
                            </Link>
                          </p>
                        ) : failures.isError ? (
                          <p className="text-xs text-base-content/50">{m.failureUnknown}</p>
                        ) : null}
                        <DispatchCancelButton orderId={d.orderId} label={numbers.data?.get(d.deliveryId) ?? d.deliveryId} kind={kind} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )
        }
      </QueryState>
    </section>
  );
}
