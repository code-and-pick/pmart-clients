// 화면 번호(ADR-0070, bff 0.14.0 — 백엔드 알림 backoffice/2026-11-18-notice-bff-display-numbers).
// - 목록·표에는 화면 번호만: 주문 orderNumber(8자리), 배송 deliveryNumber("주문번호-순번"), 라이더 가린 이름 + 라이더 번호 6자리.
// - 시스템 ID(orderId·deliveryId·riderId)는 링크 대상과 상세의 접힌 "시스템 번호" 칸에만 둔다.
// - 화면 번호가 null(옛 기록·번호 전 주문)이면 시스템 ID 끝 8자리를 회색으로 + "번호 없음".
// - 원천을 못 읽어 번호가 null 이면(라이더 = unavailableSources 에 rider-service, 연결 주문 = 원천 UNKNOWN) "번호 없음"이 아니라 "번호 확인 불가"
//   — 없는 것과 못 읽은 것을 섞지 않는다. 번호를 화면에서 만들지 않는다.
import type { components } from '../api/generated/backoffice-bff';
import { messages } from './messages';

const m = messages.displayNumber;

export type RiderDisplay = components['schemas']['RiderDisplay'];

/** 라이더 번호를 읽는 원천 — 실패·403 이면 bff 가 unavailableSources 에 넣는다 */
export const RIDER_SOURCE = 'rider-service';

/** 이 화면 응답에서 라이더 번호를 못 읽었는지 */
export const riderSourceFailed = (unavailableSources: readonly string[] | null | undefined) => (unavailableSources ?? []).includes(RIDER_SOURCE);

/** 시스템 ID 끝 8자리(번호가 없을 때 알아보는 용도로만) */
export const idTail = (id: string) => id.slice(-8);

function Fallback({ systemId, failed }: { readonly systemId: string; readonly failed: boolean }) {
  return (
    <span data-testid="display-number" data-fallback={failed ? 'failed' : 'missing'}>
      <span className="font-mono text-base-content/50">{idTail(systemId)}</span>{' '}
      <span className={`text-xs ${failed ? 'text-warning' : 'text-base-content/50'}`}>{failed ? m.failed : m.missing}</span>
    </span>
  );
}

/** 주문·배송 화면 번호 한 칸. 링크는 부르는 쪽이 시스템 ID 로 건다. */
export function DisplayNumber({ number, systemId, failed = false }: { readonly number?: string | null | undefined; readonly systemId?: string | null | undefined; readonly failed?: boolean }) {
  if (number)
    return (
      <span className="font-mono" data-testid="display-number">
        {number}
      </span>
    );
  if (!systemId) return <span>{messages.none}</span>;
  return <Fallback systemId={systemId} failed={failed} />;
}

/** 라이더 한 칸 — "김*수 · 482913". 번호가 없으면 riderId 끝 8자리 + 번호 없음/확인 불가. 라이더가 없으면 부르는 쪽이 정한다. */
export function RiderLabel({ rider, riderId, failed = false }: { readonly rider?: RiderDisplay | undefined; readonly riderId?: string | null | undefined; readonly failed?: boolean }) {
  const id = rider?.riderId ?? riderId ?? null;
  if (rider?.riderNumber)
    return (
      <span data-testid="rider-label">
        {rider.nameMasked ? `${rider.nameMasked} · ` : ''}
        <span className="font-mono">{rider.riderNumber}</span>
      </span>
    );
  if (!id) return <span>{messages.none}</span>;
  return (
    <span data-testid="rider-label">
      <Fallback systemId={id} failed={failed} />
    </span>
  );
}

/** 상세의 접힌 "시스템 번호" 칸 — 값이 있는 것만 */
export function SystemNumbers({ ids }: { readonly ids: ReadonlyArray<{ readonly label: string; readonly id: string | null | undefined }> }) {
  const shown = ids.filter((x): x is { readonly label: string; readonly id: string } => typeof x.id === 'string' && x.id !== '');
  if (shown.length === 0) return null;
  return (
    <details className="text-xs" data-testid="system-numbers">
      <summary className="cursor-pointer text-base-content/60">{m.systemNumbers}</summary>
      <dl className="mt-1 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-0.5">
        {shown.map((x) => (
          <div key={`${x.label}:${x.id}`} className="contents">
            <dt className="text-base-content/60">{x.label}</dt>
            <dd className="break-all font-mono">{x.id}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
