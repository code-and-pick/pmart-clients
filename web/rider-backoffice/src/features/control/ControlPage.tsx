// 라이더 관제(2026-11-17, PC 5 — ADR-0068): tracking `GET /rider-locations?mfcId=` — 운행 중 라이더의 지금 위치·끊김·진행 중 배송.
// RIDER_OPS·OPERATOR_ADMIN 만(서버 403), 10초마다 다시 불러오기, 이동 이력 없음. 지도는 VITE_KAKAO_JS_KEY 가 있을 때만(없으면 안내 + 표).
// 거르기(전체·배송 중·위치 끊김)는 주소 쿼리 filter.
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/delivery-tracking';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { CenterPicker, label, none, when } from '../../shared/opsUi';
import { KakaoRiderMap, type MapRider } from './KakaoRiderMap';

const c = ops.control;
const n = messages.names;
export const CONTROL_REFRESH_MS = 10_000;

type Filter = 'all' | 'delivering' | 'stale';
type Rider = components['schemas']['ControlRider'];

// 거르기·지도 색은 서버 값으로만: stale(서버 3분 기준) 또는 위치 없음 = 끊김, 진행 중 배송 있음 = 배송 중.
const isStale = (r: Rider) => r.stale || !r.location;
const isDelivering = (r: Rider) => r.activeDeliveries.length > 0;

export function ControlPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const mfcId = params.get('mfcId') ?? '';
  const rawFilter = params.get('filter');
  const filter: Filter = rawFilter === 'delivering' || rawFilter === 'stale' ? rawFilter : 'all';
  const setFilter = (f: Filter) => {
    const p = new URLSearchParams(params);
    if (f === 'all') p.delete('filter');
    else p.set('filter', f);
    setParams(p);
  };
  const board = useQuery({
    queryKey: ['rider-locations', mfcId],
    enabled: mfcId !== '',
    refetchInterval: CONTROL_REFRESH_MS,
    queryFn: () => request('GET', api.tracking.GET('/rider-locations', { params: { query: { mfcId } } })),
  });
  // 센터 좌표(지도 가운데) — CenterPicker 와 같은 목록 캐시
  const centers = useQuery({
    queryKey: ['centers', 'MFC'],
    queryFn: () => request('GET', api.center.GET('/centers', { params: { query: { type: 'MFC' } } })),
  });
  const coords = (centers.data?.items ?? []).find((x) => x.centerId === mfcId)?.coordinates;
  const centerPoint = coords?.lat != null && coords.lng != null ? { lat: coords.lat, lng: coords.lng } : null;
  const onSelect = useCallback((riderId: string) => {
    document.getElementById(`control-${riderId}`)?.scrollIntoView({ block: 'center' });
  }, []);
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{c.title}</h1>
      <p className="text-sm opacity-70">{c.intro}</p>
      <div className="flex flex-wrap items-end gap-3">
        <CenterPicker value={mfcId} onChange={(v) => setParams(v ? { mfcId: v } : {})} />
        <div role="tablist" className="tabs tabs-box w-fit">
          {(['all', 'delivering', 'stale'] as const).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={f === filter} className={`tab ${f === filter ? 'tab-active' : ''}`} onClick={() => setFilter(f)}>
              {c.filter[f]}
            </button>
          ))}
        </div>
      </div>
      {mfcId === '' ? (
        <p className="text-sm opacity-70">{c.pickCenter}</p>
      ) : (
        <QueryState state={toUiState(board, (b) => (b.items ?? []).length === 0)} onRetry={() => void board.refetch()} emptyText={c.empty}>
          {(b) => {
            const all = b.items ?? [];
            const stale = all.filter((r) => r.stale).length;
            const items = all.filter((r) => (filter === 'delivering' ? isDelivering(r) : filter === 'stale' ? isStale(r) : true));
            const mapRiders: MapRider[] = items.flatMap((r) =>
              r.location?.lat != null && r.location.lng != null
                ? [{ riderId: r.riderId, lat: r.location.lat, lng: r.location.lng, tone: isStale(r) ? 'stale' : isDelivering(r) ? 'delivering' : 'ok', label: r.nameMasked ?? r.riderId }]
                : [],
            );
            return (
              <div className="space-y-2">
                <p className="text-sm">
                  {`${all.length}명`}
                  {stale > 0 && <span className="badge badge-error ml-2">{c.staleCount(stale)}</span>}
                  <span className="ml-2 text-xs opacity-60">{ops.dashboard.asOf(when(b.asOf))}</span>
                </p>
                <KakaoRiderMap center={centerPoint} riders={mapRiders} onSelect={onSelect} />
                {items.length === 0 && (
                  <p data-state="empty" className="p-4 opacity-70">
                    {c.emptyFiltered}
                  </p>
                )}
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
                        <tr key={r.riderId} id={`control-${r.riderId}`} data-testid="control-row" className={r.stale ? 'bg-error/10' : undefined}>
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
