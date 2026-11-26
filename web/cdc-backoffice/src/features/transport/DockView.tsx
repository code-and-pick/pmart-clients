// 출하·운송 [도크] — cdc-location 0.8.0 `GET /cdcs/{cdcId}/dock-reservations?date=`(DK-1, 회신 2026-11-26-reply-dock-assignment).
// 도크는 계획완료 때 서버가 자동으로 잡는다(창 = 상차 시작 ~ 계획 출차, 출차·취소 때 해제). 화면은 보기만 — 사람이 바꾸는 경로(DK-3)는 아직 없다.
// docks = 그 센터 ACTIVE 도크 칸 전부(예약이 없어도) → 층별 도크 × 시간 막대. docks 가 비면(LAN 위치 전환 전) 숨기지 않고 "도크 칸 없음"으로 알린다.
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/cdc-location';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { tempLabel } from './TransportPage';

const t = messages.transport;
type Res = components['schemas']['DockReservation'];
const HOUR = 3_600_000;
const hm = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });

/** 막대 축: 예약 창을 다 덮는 정시 범위(앞뒤 1시간, 최소 6시간). 예약이 없으면 그날 18:00~다음 날 02:00 */
function axis(date: string, items: readonly Res[]) {
  const ts = items.flatMap((r) => [r.window?.start, r.window?.end]).filter((v): v is string => !!v).map((v) => new Date(v).getTime());
  const base = new Date(`${date}T00:00:00+09:00`).getTime();
  let from = ts.length ? Math.floor(Math.min(...ts) / HOUR) * HOUR - HOUR : base + 18 * HOUR;
  let to = ts.length ? Math.ceil(Math.max(...ts) / HOUR) * HOUR + HOUR : base + 26 * HOUR;
  if (to - from < 6 * HOUR) {
    const mid = (from + to) / 2;
    from = Math.floor((mid - 3 * HOUR) / HOUR) * HOUR;
    to = from + 6 * HOUR;
  }
  const hours: number[] = [];
  for (let h = from; h <= to; h += HOUR) hours.push(h);
  return { from, to, hours };
}

export function DockView({ cdcId, date }: { readonly cdcId: string; readonly date: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'dock-reservations', date],
    refetchInterval: 30_000,
    queryFn: () => request('GET', api.location.GET('/cdcs/{cdcId}/dock-reservations', { params: { path: { cdcId }, query: { date } } })),
  });
  return (
    <div className="space-y-3">
      <p className="max-w-4xl text-sm text-base-content/60">{t.dockLead}</p>
      <QueryState state={toUiState(query, () => false)} onRetry={() => void query.refetch()}>
        {(data) => {
          const docks = data.docks ?? [];
          const items = data.items;
          if (docks.length === 0)
            return (
              <p className="rounded-box border border-dashed border-base-300 p-6 text-center text-sm text-base-content/60" data-testid="dock-none">
                {t.dockNone}
              </p>
            );
          const ax = axis(date, items);
          const span = ax.to - ax.from;
          const pct = (iso: string | undefined, fallback: number) => ((Math.min(Math.max(iso ? new Date(iso).getTime() : fallback, ax.from), ax.to) - ax.from) / span) * 100;
          const floors = [...new Set(docks.map((d) => d.floor ?? ''))].sort();
          const reserved = items.filter((r) => r.state === 'RESERVED').length;
          return (
            <div className="space-y-4">
              <p className="text-sm" data-testid="dock-summary">
                {t.dockSummary(docks.length, reserved)}
              </p>
              <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100 p-3">
                <div className="min-w-[720px] space-y-3" data-testid="dock-grid">
                  <div className="relative ml-44 h-5 text-[11px] text-base-content/55">
                    {ax.hours.map((h, i) => (
                      <span key={h} className={`absolute ${i === ax.hours.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: `${((h - ax.from) / span) * 100}%` }}>
                        {hm.format(h)}
                      </span>
                    ))}
                  </div>
                  {floors.map((f) => (
                    <div key={f} className="space-y-1">
                      <h3 className="text-xs font-semibold text-base-content/70">{t.dockFloor(f)}</h3>
                      {docks
                        .filter((d) => (d.floor ?? '') === f)
                        .map((d) => {
                          const mine = items.filter((r) => r.dockCode === d.dockCode);
                          return (
                            <div key={d.dockCode} className="flex items-center gap-2" data-testid="dock-lane">
                              <span className="w-42 shrink-0 truncate font-mono text-xs" title={d.dockCode}>
                                {d.dockCode} <span className="text-base-content/55">{tempLabel(d.temperatureZone)}</span>
                              </span>
                              <div className="relative h-8 flex-1 rounded bg-base-200">
                                {ax.hours.map((h) => (
                                  <span key={h} aria-hidden className="absolute inset-y-0 border-l border-base-300/70" style={{ left: `${((h - ax.from) / span) * 100}%` }} />
                                ))}
                                {mine.map((r) => {
                                  const left = pct(r.window?.start, ax.from);
                                  const width = Math.max(pct(r.window?.end, ax.to) - left, 1.5);
                                  const on = r.state === 'RESERVED';
                                  return (
                                    <span
                                      key={r.dockReservationId}
                                      data-testid="dock-bar"
                                      data-state={r.state}
                                      title={`${r.tripId ?? ''} · ${r.routeId ?? ''} · ${r.plateNo ?? r.vehicleId ?? ''} · ${hm.format(new Date(r.window?.start ?? 0))}~${hm.format(new Date(r.window?.end ?? 0))}`}
                                      className={`absolute inset-y-1 overflow-hidden truncate rounded px-1 text-[11px] leading-6 ${on ? 'bg-primary text-primary-content' : 'border border-dashed border-base-content/30 text-base-content/55'}`}
                                      style={{ left: `${left}%`, width: `${width}%` }}
                                    >
                                      {r.routeId ?? r.tripId}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  ))}
                  <p className="flex gap-4 text-xs text-base-content/60">
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-3 w-5 rounded bg-primary" /> {t.dockState.RESERVED}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-3 w-5 rounded border border-dashed border-base-content/30" /> {t.dockState.RELEASED}
                    </span>
                  </p>
                </div>
              </div>
              {items.length > 0 && (
                <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
                  <table className="table table-sm" data-testid="dock-table">
                    <thead>
                      <tr>
                        <th>{t.dock}</th>
                        <th>{t.trip}</th>
                        <th>{t.route}</th>
                        <th>{t.vehicle}</th>
                        <th>{t.dockWindow}</th>
                        <th>{t.state}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((r) => (
                        <tr key={r.dockReservationId} data-testid="dock-row">
                          <td className="whitespace-nowrap font-mono text-xs">{r.dockCode}</td>
                          <td className="whitespace-nowrap font-mono text-xs">{r.tripId}</td>
                          <td className="whitespace-nowrap">
                            {r.routeId ?? messages.none} · {tempLabel(r.temperatureZone)}
                          </td>
                          <td className="whitespace-nowrap">{r.plateNo ?? r.vehicleId ?? messages.none}</td>
                          <td className="whitespace-nowrap">
                            {r.window?.start ? formatSeoul(r.window.start) : messages.none} ~ {r.window?.end ? hm.format(new Date(r.window.end)) : messages.none}
                          </td>
                          <td>
                            <span className={`badge badge-sm whitespace-nowrap ${r.state === 'RESERVED' ? 'badge-primary' : 'badge-ghost'}`}>{t.dockState[r.state ?? ''] ?? r.state}</span>
                            {r.releaseReason && <span className="ml-1 text-xs text-base-content/55">{t.dockRelease[r.releaseReason] ?? r.releaseReason}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
