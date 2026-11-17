// 라이더 관제(2026-11-17, PC 5 — ADR-0068): tracking `GET /rider-locations?mfcId=` — 운행 중 라이더의 지금 위치·끊김·진행 중 배송.
// RIDER_OPS·OPERATOR_ADMIN 만(서버 403), 10초마다 다시 불러오기, 이동 이력 없음. 지도는 카카오 지도 키(도메인 등록)가 준비되면 붙인다 — 지금은 목록.
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { CenterPicker, label, none, when } from '../../shared/opsUi';

const c = ops.control;
const n = messages.names;
export const CONTROL_REFRESH_MS = 10_000;

export function ControlPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const mfcId = params.get('mfcId') ?? '';
  const board = useQuery({
    queryKey: ['rider-locations', mfcId],
    enabled: mfcId !== '',
    refetchInterval: CONTROL_REFRESH_MS,
    queryFn: () => request('GET', api.tracking.GET('/rider-locations', { params: { query: { mfcId } } })),
  });
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{c.title}</h1>
      <p className="text-sm opacity-70">{c.intro}</p>
      <CenterPicker value={mfcId} onChange={(v) => setParams(v ? { mfcId: v } : {})} />
      {mfcId === '' ? (
        <p className="text-sm opacity-70">{c.pickCenter}</p>
      ) : (
        <QueryState state={toUiState(board, (b) => (b.items ?? []).length === 0)} onRetry={() => void board.refetch()} emptyText={c.empty}>
          {(b) => {
            const items = b.items ?? [];
            const stale = items.filter((r) => r.stale).length;
            return (
              <div className="space-y-2">
                <p className="text-sm">
                  {`${items.length}명`}
                  {stale > 0 && <span className="badge badge-error ml-2">{c.staleCount(stale)}</span>}
                  <span className="ml-2 text-xs opacity-60">{ops.dashboard.asOf(when(b.asOf))}</span>
                </p>
                <div className="overflow-x-auto">
                  <table className="table table-sm rounded-box bg-base-100">
                    <thead>
                      <tr>
                        <th>{c.col.rider}</th>
                        <th>{c.col.vehicle}</th>
                        <th>{c.col.dispatch}</th>
                        <th>{c.col.location}</th>
                        <th>{c.col.updated}</th>
                        <th>{c.col.deliveries}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((r) => (
                        <tr key={r.riderId} data-testid="control-row" className={r.stale ? 'bg-error/10' : undefined}>
                          <td>
                            <Link className="link font-mono" to={`/riders/${encodeURIComponent(r.riderId)}`}>
                              {r.riderId}
                            </Link>
                            {r.nameMasked && <span className="ml-1 text-xs opacity-70">{r.nameMasked}</span>}
                            {r.restriction && r.restriction !== 'NORMAL' && <span className="badge badge-warning badge-sm ml-1">{label(n.restriction, r.restriction)}</span>}
                          </td>
                          <td>{label(n.vehicle, r.vehicleType)}</td>
                          <td>{r.newDispatchEnabled ? c.on : c.off}</td>
                          <td className="font-mono text-xs">
                            {r.location ? `${Number(r.location.lat).toFixed(5)}, ${Number(r.location.lng).toFixed(5)}` : c.noLocation}
                          </td>
                          <td>
                            {r.staleSinceSeconds === null || r.staleSinceSeconds === undefined ? none : c.seconds(r.staleSinceSeconds)}
                            {r.stale && <span className="badge badge-error badge-sm ml-1">{c.stale}</span>}
                          </td>
                          <td>
                            {r.activeDeliveries.length === 0
                              ? none
                              : r.activeDeliveries.map((a) => (
                                  <div key={a.deliveryId}>
                                    <Link className="link font-mono text-xs" to={`/deliveries/${encodeURIComponent(a.deliveryId)}`}>
                                      {a.deliveryId}
                                    </Link>
                                    <span className="ml-1 text-xs">{label(n.stage, a.stage)}</span>
                                    {a.etaDrop && <span className="ml-1 text-xs opacity-70">{c.eta(when(a.etaDrop))}</span>}
                                  </div>
                                ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          }}
        </QueryState>
      )}
    </section>
  );
}
