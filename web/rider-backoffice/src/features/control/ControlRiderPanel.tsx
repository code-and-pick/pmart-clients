// 관제 오른쪽 상세 칸(2026-11-18, 사용자 "시뮬레이션 서버로 따로 넘어가니까 실시간 현황이랑 주문 내역(픽업지·전달지)을 같이 보기 힘들다").
// 지도·표에서 라이더를 고르면 그 라이더의 진행 중 배송마다: 단계·도착 예정(tracking eta)·픽업지(execution mfcName·mfcPhone + 센터 주소)·
// 주문번호·품목·배송 요청사항(execution orderSummary).
// 전달지(고객 주소·좌표)는 직원용 API 가 없다 — drop-info 는 배정 라이더 본인만. 백엔드 요청 중(handoff 2026-11-18-backend-staff-drop-info)
// 이라 "백엔드 대기"로만 보인다. 추측해 부르지 않는다.
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/delivery-tracking';
import { useApi } from '../../app/ApiContext';
import { FieldList, StatusBadge } from '../../shared/admin';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { label, none, when, won } from '../../shared/opsUi';
import { SimBadge } from '../../shared/sim';
import { EtaPanel } from '../deliveries/DeliveryExtras';
import { CONTROL_REFRESH_MS } from './refresh';

type Rider = components['schemas']['ControlRider'];
type ActiveDelivery = Rider['activeDeliveries'][number];

const n = messages.names;
const c = ops.control;

export const panelMessages = {
  title: '라이더 상세',
  pick: '지도나 아래 표에서 라이더를 고르면 진행 중 배송의 픽업지·주문 내역·도착 예정이 여기에 보여요.',
  gone: '고른 라이더가 지금 목록에 없어요(운행 종료 등).',
  close: '닫기',
  noDelivery: '진행 중 배송이 없어요.',
  delivery: '배송',
  order: '주문번호',
  purpose: '목적',
  pickup: '픽업지',
  drop: '전달지',
  dropPending: '백엔드 대기 — 직원용 전달지 API 가 아직 없어요(라이더 본인만 볼 수 있음).',
  items: '품목',
  itemLine: (name: string, opt: string | null | undefined, qty: number | undefined) => `${name}${opt ? ` (${opt})` : ''} × ${qty ?? '?'}`,
  itemAmount: '상품 합계',
  note: '요청사항',
  open: '배송 상세',
  pickupShort: '픽업',
  orderFailed: '주문 정보 못 불러옴',
  live: '10초마다 새로 불러와요',
  location: '위치',
  updated: '마지막 수신',
} as const;
const p = panelMessages;

export function ControlRiderPanel({
  rider,
  selectedId,
  centerAddress,
  onClose,
}: {
  readonly rider: Rider | undefined;
  readonly selectedId: string;
  readonly centerAddress: string | null;
  readonly onClose: () => void;
}) {
  if (!selectedId) {
    return (
      <aside className="rounded-box border border-dashed border-base-300 bg-base-100 p-5 text-sm text-base-content/60" data-testid="control-panel-empty">
        {p.pick}
      </aside>
    );
  }
  return (
    <aside className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4" aria-label={p.title} data-testid="control-panel">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-1">
            <Link className="font-mono font-semibold hover:underline" to={`/riders/${encodeURIComponent(selectedId)}`}>
              {selectedId}
            </Link>
            {rider?.nameMasked && <span className="text-xs text-base-content/60">{rider.nameMasked}</span>}
            <SimBadge riderId={selectedId} />
          </p>
          {rider && (
            <p className="text-xs text-base-content/60">
              {[label(n.vehicle, rider.vehicleType), rider.newDispatchEnabled ? `신규배차 ${c.on}` : `신규배차 ${c.off}`, p.live].join(' · ')}
            </p>
          )}
        </div>
        <button type="button" className="btn btn-ghost btn-xs" onClick={onClose}>
          {p.close}
        </button>
      </div>
      {!rider ? (
        <p className="text-sm text-base-content/60">{p.gone}</p>
      ) : (
        <>
          <FieldList
            rows={[
              [
                p.location,
                !rider.location ? (
                  <StatusBadge tone="error">{c.noLocation}</StatusBadge>
                ) : rider.stale ? (
                  <StatusBadge tone="error">{c.stale}</StatusBadge>
                ) : (
                  <span className="font-mono text-xs">{`${Number(rider.location.lat).toFixed(5)}, ${Number(rider.location.lng).toFixed(5)}`}</span>
                ),
              ],
              [p.updated, rider.staleSinceSeconds == null ? none : c.seconds(rider.staleSinceSeconds)],
            ]}
          />
          {rider.activeDeliveries.length === 0 ? (
            <p className="text-sm text-base-content/60">{p.noDelivery}</p>
          ) : (
            <ul className="space-y-3">
              {rider.activeDeliveries.map((d) => (
                <li key={d.deliveryId}>
                  <DeliveryCard active={d} centerAddress={centerAddress} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </aside>
  );
}

/** 배송 수행 조회 — 관제에서는 위치 목록과 같은 간격으로 다시 불러온다(상세 칸·표가 같은 캐시를 나눠 씀). */
function useLiveDelivery(deliveryId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['delivery', deliveryId],
    refetchInterval: CONTROL_REFRESH_MS,
    queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}', { params: { path: { deliveryId } } })),
  });
}

/**
 * 표의 "진행 중 배송" 칸 한 줄 — 배송·단계·도착 예정(관제 값) + 주문번호·픽업 지점(배송 조회).
 * 배송 조회를 못 읽으면 관제 값만 보이고 "주문 정보 못 불러옴" 표시(빈 값으로 숨기지 않는다).
 */
export function ActiveDeliverySummary({ active }: { readonly active: ActiveDelivery }) {
  const detail = useLiveDelivery(active.deliveryId);
  const x = detail.data;
  return (
    <span className="flex flex-wrap items-center gap-1" data-testid="row-delivery">
      <Link className="font-mono text-xs font-semibold hover:underline" to={`/deliveries/${encodeURIComponent(active.deliveryId)}`} onClick={(e) => e.stopPropagation()}>
        {active.deliveryId}
      </Link>
      <StatusBadge tone="info">{label(n.stage, active.stage)}</StatusBadge>
      {x && (
        <span className="text-xs text-base-content/70">
          {[x.orderNumber ?? x.orderSummary?.orderNumber ? `#${x.orderNumber ?? x.orderSummary?.orderNumber}` : null, x.mfcName ? `${p.pickupShort} ${x.mfcName}` : null].filter(Boolean).join(' · ')}
        </span>
      )}
      {detail.isError && !x && <span className="text-xs text-error">{p.orderFailed}</span>}
      {active.etaDrop && <span className="text-xs text-base-content/60">{c.eta(when(active.etaDrop))}</span>}
    </span>
  );
}

function DeliveryCard({ active, centerAddress }: { readonly active: ActiveDelivery; readonly centerAddress: string | null }) {
  const deliveryId = active.deliveryId;
  const detail = useLiveDelivery(deliveryId);
  return (
    <div className="space-y-3 rounded-box border border-base-300 p-3" data-testid="panel-delivery">
      <div className="flex flex-wrap items-center gap-1">
        <Link className="font-mono text-sm font-semibold hover:underline" to={`/deliveries/${encodeURIComponent(deliveryId)}`}>
          {deliveryId}
        </Link>
        <StatusBadge tone="info">{label(n.stage, active.stage)}</StatusBadge>
      </div>
      <QueryState state={toUiState(detail)} onRetry={() => void detail.refetch()}>
        {(x) => {
          const s = x.orderSummary;
          const items = s?.items ?? [];
          return (
            <div className="space-y-3">
              <FieldList
                testId="panel-order"
                rows={[
                  [p.order, <span className="font-mono">{x.orderNumber ?? s?.orderNumber ?? none}</span>],
                  x.purpose && x.purpose !== 'DELIVERY' ? [p.purpose, label(n.purpose, x.purpose)] : null,
                  [
                    p.pickup,
                    <span className="flex flex-col">
                      <span className="font-medium">{x.mfcName ?? x.mfcId ?? none}</span>
                      {centerAddress && <span className="text-xs text-base-content/60">{centerAddress}</span>}
                      {x.mfcPhone && <span className="font-mono text-xs text-base-content/60">{x.mfcPhone}</span>}
                    </span>,
                  ],
                  [p.drop, <span className="text-xs text-base-content/60" data-testid="panel-drop-pending">{p.dropPending}</span>],
                  [
                    p.items,
                    items.length === 0 ? (
                      none
                    ) : (
                      <ul className="space-y-0.5 text-sm">
                        {items.map((it, i) => (
                          <li key={it.orderLineId ?? i}>{p.itemLine(it.name ?? none, it.optionLabel, it.qty)}</li>
                        ))}
                      </ul>
                    ),
                  ],
                  s?.itemAmount !== undefined ? [p.itemAmount, won(s.itemAmount)] : null,
                  s?.deliveryNote ? [p.note, s.deliveryNote] : null,
                ]}
              />
            </div>
          );
        }}
      </QueryState>
      <EtaPanel deliveryId={deliveryId} refreshMs={CONTROL_REFRESH_MS} />
      <div className="flex justify-end">
        <Link className="btn btn-xs border-base-300 bg-base-100" to={`/deliveries/${encodeURIComponent(deliveryId)}`}>
          {p.open}
        </Link>
      </div>
    </div>
  );
}
