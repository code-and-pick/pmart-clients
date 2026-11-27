// TRF 한 건이 DC 에서 MFC 까지 어디쯤인지 한 줄(사용자 2026-11-27 "재고 이관할 때 mfc랑 재고 연동되는 거 실시간으로 잘 보이게").
// DC 쪽 = TRF 상태(cdc-outbound), MFC 쪽 = 그 TRF 가 실린 운행 정차(transport-execution — 도착·인계 대조)와
// MFC 입고 반영(cdc-inventory 0.22.0 transits — 사용자 2026-11-27 "mfc에서 적치까지 완료했는데 왜 계속 출발이라고"). 15초마다 다시 읽는다.
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { formatSeoul } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { receiptOf, transitsKey } from './transits';
import { mfcSideOf, useTripStops } from './tripStops';

const t = messages.journey;
const STEPS = ['RECEIVED', 'ALLOCATED', 'PICKING', 'READY', 'DEPARTED', 'ARRIVED', 'HANDED_OVER', 'STOCKED'] as const;
type Step = (typeof STEPS)[number];

/** TRF 상태 → DC 쪽 걸음(취소·변경 보류는 null — 줄 대신 상태 배지로) */
function dcStep(state: string): Step | null {
  if (state.startsWith('CANCEL') || state.startsWith('CHANGE')) return null;
  if (state === 'RECEIVED' || state === 'ALLOCATING' || state === 'ALLOCATION_FAILED') return 'RECEIVED';
  if (state === 'ALLOCATED' || state === 'PARTIALLY_ALLOCATED') return 'ALLOCATED';
  if (state === 'IN_WAVE' || state === 'PICKING') return 'PICKING';
  if (state === 'DEPARTED') return 'DEPARTED';
  return 'READY';
}

export function TrfJourney({ cdcId, trfId, state }: { readonly cdcId: string; readonly trfId: string; readonly state: string }) {
  const api = useApi();
  const stops = useTripStops(cdcId, 15_000);
  const dc = dcStep(state);
  const tq = useQuery({
    queryKey: [...transitsKey(cdcId), 'trf', trfId],
    enabled: dc === 'DEPARTED',
    refetchInterval: 15_000,
    queryFn: () => request('GET', api.inventory.GET('/cdcs/{cdcId}/transits', { params: { path: { cdcId }, query: { trfId, size: 1 } } })),
  });
  if (!dc) return null;
  const ct = tq.data?.items[0];
  const receipt = ct ? receiptOf(ct) : null;
  const at = stops.byTrf.get(trfId);
  const side = dc === 'DEPARTED' && at ? mfcSideOf(at.stop) : null;
  // MFC 가 입고를 확정했으면(받은 수량이 있으면) 운행 기록과 상관없이 마지막 걸음 — 운행 없이 출발한 경우도 있다
  const cur: Step =
    dc !== 'DEPARTED'
      ? dc
      : receipt === 'DONE' || receipt === 'MISMATCH'
        ? 'STOCKED'
        : side === 'HANDED_OVER'
          ? 'HANDED_OVER'
          : side === 'ARRIVED'
            ? 'ARRIVED'
            : 'DEPARTED';
  const rAt = ct?.transit.lastReceiptAt ?? ct?.transit.reconciledAt;
  const idx = STEPS.indexOf(cur);
  const stop = at?.stop;
  const h = stop?.handover;
  const note =
    cur === 'STOCKED' && ct
      ? receipt === 'DONE'
        ? t.stocked(rAt ? formatSeoul(rAt) : messages.none, ct.totals.departedQty ?? 0, ct.totals.receivedQty ?? 0)
        : t.stockedMismatch(rAt ? formatSeoul(rAt) : messages.none, ct.totals.departedQty ?? 0, ct.totals.receivedQty ?? 0, ct.totals.unreconciledQty ?? 0)
      : cur === 'HANDED_OVER'
      ? t.handed(stop?.handedOverAt ? formatSeoul(stop.handedOverAt) : messages.none, h?.receivedBoxes ?? null, h?.shippedBoxes ?? null, h?.result === 'MISMATCHED')
      : cur === 'ARRIVED'
        ? t.arrived(stop?.arrivedAt ? formatSeoul(stop.arrivedAt) : messages.none)
        : cur === 'DEPARTED'
          ? stop
            ? t.onWay((stop.estimatedArrivalAt ?? stop.plannedArrivalAt) ? formatSeoul((stop.estimatedArrivalAt ?? stop.plannedArrivalAt)!) : messages.none, Boolean(stop.delayed))
            : stops.loading
              ? '…'
              : stops.failed
                ? t.tripFailed
                : t.noTrip
          : stop
            ? t.planned(at.trip.plateNo ?? at.trip.vehicleId ?? messages.none, stop.plannedArrivalAt ? formatSeoul(stop.plannedArrivalAt) : messages.none)
            : null;
  return (
    <div className="space-y-2 rounded-box border border-base-300 bg-base-100 p-4" data-testid="trf-journey">
      <h2 className="text-base font-semibold">{t.title}</h2>
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            <span
              className={`rounded-full px-2.5 py-1 ${
                i < idx || (i === idx && receipt === 'DONE')
                  ? 'bg-success/15 text-success'
                  : i === idx
                    ? receipt === 'MISMATCH'
                      ? 'bg-warning font-semibold text-warning-content'
                      : 'bg-primary font-semibold text-primary-content'
                    : 'bg-base-200 text-base-content/50'
              }`}
              aria-current={i === idx ? 'step' : undefined}
            >
              {i < idx || (i === idx && receipt === 'DONE') ? '✓ ' : ''}
              {t.steps[s]}
            </span>
            {i < STEPS.length - 1 && <span className="text-base-content/30">›</span>}
            {i === 4 && <span className="mx-1 text-base-content/30">|</span>}
          </li>
        ))}
      </ol>
      <p className="text-xs text-base-content/55">{t.sides}</p>
      {note && (
        <p className="text-sm" data-testid="trf-journey-note">
          {note}
        </p>
      )}
    </div>
  );
}
