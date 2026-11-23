// 관제 "최근 배송" — 그 센터의 최근 배송을 끝난 것까지 단계·시각과 함께(execution 직원용 `GET /deliveries?mfcId=` 최신순, 10초).
// 실서버 확인(2026-11-18): 배송이 배정 → 완료 2분 30초로 끝나 "지금 진행 중"만 보이는 관제에서는 스쳐 지나갔고, 사용자는 시뮬레이터로
// 확인하고 있었다. 줄을 누르면 그 라이더·배송이 오른쪽 "라이더 한눈에"에 열린다.
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { DataTable, Section, StatusBadge, type Tone } from '../../shared/admin';
import { DeliveryNo, RiderName, useRiderSummaries, RiderLink } from '../../shared/displayNumbers';
import { isLiveDelivery } from '../../shared/liveRefresh';
import { messages } from '../../shared/messages';
import { label, none } from '../../shared/opsUi';
import { CONTROL_REFRESH_MS } from './refresh';

const n = messages.names;

export const recentMessages = {
  title: '최근 배송',
  aside: '이 센터의 최근 20건 · 완료된 배송도 · 10초마다',
  empty: '이 센터의 배송이 아직 없어요.',
  col: { delivery: '배송', state: '상태', rider: '라이더', assigned: '배정', pickedUp: '픽업', done: '완료' },
  live: '진행 중',
} as const;
const m = recentMessages;

const clockFmt = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Seoul' });
const clock = (iso: string | null | undefined) => (iso ? clockFmt.format(new Date(iso)) : none);

const stateTone = (s: string | undefined): Tone =>
  s === 'COMPLETED' ? 'success' : s === 'FAILED' || s === 'CANCELLED' ? 'error' : s === 'FAILURE_REPORTED' || s === 'SUSPENDED' ? 'warning' : s === 'UNASSIGNED' ? 'ghost' : 'info';

export function RecentDeliveries({ mfcId, selectedDeliveryId, onPick }: { readonly mfcId: string; readonly selectedDeliveryId: string; readonly onPick: (hit: { readonly riderId: string; readonly deliveryId: string }) => void }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['deliveries', 'recent', mfcId],
    enabled: mfcId !== '',
    refetchInterval: CONTROL_REFRESH_MS,
    placeholderData: keepPreviousData,
    queryFn: () => request('GET', api.execution.GET('/deliveries', { params: { query: { mfcId, size: 20 } } })),
  });
  const riders = useRiderSummaries((query.data?.items ?? []).map((d) => d.riderId));
  return (
    <Section title={m.title} aside={<span className="text-xs text-base-content/50">{m.aside}</span>} testId="recent-deliveries">
      <QueryState state={toUiState(query, (x) => (x.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={m.empty}>
        {(x) => (
          <DataTable>
            <thead>
              <tr>
                <th>{m.col.delivery}</th>
                <th>{m.col.state}</th>
                <th>{m.col.rider}</th>
                <th>{m.col.assigned}</th>
                <th>{m.col.pickedUp}</th>
                <th>{m.col.done}</th>
              </tr>
            </thead>
            <tbody>
              {(x.items ?? []).map((d) => {
                const id = d.deliveryId ?? '';
                const r = d.riderId ? riders.get(d.riderId) : undefined;
                const live = isLiveDelivery(d.state);
                return (
                  <tr
                    key={id}
                    data-testid="recent-row"
                    aria-selected={id === selectedDeliveryId}
                    className={`${d.riderId ? 'cursor-pointer' : ''} ${id === selectedDeliveryId ? 'bg-primary/10' : live ? 'bg-info/5' : ''}`}
                    onClick={() => d.riderId && onPick({ riderId: d.riderId, deliveryId: id })}
                  >
                    <td>
                      <DeliveryNo deliveryId={id} deliveryNumber={d.deliveryNumber} orderNumber={d.orderNumber} />
                    </td>
                    <td>
                      <StatusBadge tone={stateTone(d.state)}>{label(n.executionState, d.state)}</StatusBadge>
                    </td>
                    <td>
                      {d.riderId ? <RiderLink riderId={d.riderId} nameMasked={r?.nameMasked} riderNumber={r?.riderNumber} /> : <RiderName riderId={d.riderId} />}
                    </td>
                    <td className="whitespace-nowrap tabular-nums">{clock(d.assignedAt)}</td>
                    <td className="whitespace-nowrap tabular-nums">{clock(d.pickedUpAt)}</td>
                    <td className="whitespace-nowrap tabular-nums">{live ? <span className="text-info">{m.live}</span> : clock(d.completedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </QueryState>
    </Section>
  );
}
