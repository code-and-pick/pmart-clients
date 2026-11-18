// 주문 진행 단계(2026-11-18 사용자 "참고 사이트 조합" — Refine Finefoods 주문 상세의 단계 표시를 참고).
// 서버 주문 상태(order-service OrderStatus)를 계약 상태표(contracts/states/order-states.md) 순서대로 다섯 단계에 놓는다.
// 결제 → 주문 확정 → 상품 준비 → 배송 중 → 전달 완료. 화면이 상태를 판정하지 않고, 받은 상태가 어느 칸인지만 보인다.
// - 일부 인계·일부 전달은 그 단계 아래 보조 문구, 결제 결과 불명은 결제 칸을 노랑으로.
// - 취소(CANCELLED)·만료(EXPIRED)는 갈래 — 단계를 회색으로 두고 끝에 빨간 표시(어느 단계에서 끝났는지는 상태만으로 알 수 없어 칠하지 않는다).
// - 모르는 상태는 단계를 칠하지 않고 코드 그대로.
import { messages } from '../../shared/messages';

const m = messages.orders.progress;

type Step = 0 | 1 | 2 | 3 | 4;
interface Place {
  readonly step: Step;
  readonly done: boolean;
  readonly note?: string;
  readonly warn?: boolean;
}

/** 상태 → 단계 자리(계약 상태표 순서). 없으면 null(갈래·모름) */
export function placeOf(status: string | null | undefined): Place | null {
  switch (status) {
    case 'DRAFT':
    case 'RESOURCE_PENDING':
      return { step: 0, done: false, note: m.note.resource };
    case 'PAYMENT_PENDING':
      return { step: 0, done: false, note: m.note.paying };
    case 'PAYMENT_UNKNOWN':
      return { step: 0, done: false, note: m.note.paymentUnknown, warn: true };
    case 'CONFIRMED':
      return { step: 1, done: false };
    case 'PREPARING':
      return { step: 2, done: false };
    case 'PARTIALLY_HANDED_OVER':
      return { step: 3, done: false, note: m.note.partialHandover };
    case 'IN_DELIVERY':
      return { step: 3, done: false };
    case 'PARTIALLY_DELIVERED':
      return { step: 3, done: false, note: m.note.partialDelivered };
    case 'COMPLETED':
      return { step: 4, done: true };
    default:
      return null;
  }
}

export function OrderProgress({ status }: { readonly status: string | null | undefined }) {
  const place = placeOf(status);
  const ended = status === 'CANCELLED' || status === 'EXPIRED';
  return (
    <section aria-label={m.title} className="rounded-box border border-base-300 bg-base-100 px-5 py-4 shadow-sm" data-testid="order-progress">
      <ol className="flex items-start">
        {m.steps.map((name, i) => {
          const state = !place ? 'todo' : i < place.step || (i === place.step && place.done) ? 'done' : i === place.step ? 'now' : 'todo';
          const circle =
            state === 'done'
              ? 'bg-success text-success-content'
              : state === 'now'
                ? place?.warn
                  ? 'bg-warning text-warning-content ring-4 ring-warning/20'
                  : 'bg-primary text-primary-content ring-4 ring-primary/20'
                : 'bg-base-200 text-base-content/40';
          const line = place && i < place.step ? 'bg-success' : 'bg-base-300';
          return (
            <li key={name} className="relative flex flex-1 flex-col items-center text-center" aria-current={state === 'now' ? 'step' : undefined} data-step-state={state}>
              {i > 0 && <span className={`absolute left-0 right-1/2 top-4 -z-0 h-0.5 -translate-y-1/2 ${line}`} aria-hidden="true" />}
              {i < m.steps.length - 1 && <span className={`absolute left-1/2 right-0 top-4 -z-0 h-0.5 -translate-y-1/2 ${place && i < place.step ? 'bg-success' : 'bg-base-300'}`} aria-hidden="true" />}
              <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${circle}`} aria-hidden="true">
                {state === 'done' ? '✓' : i + 1}
              </span>
              <span className={`mt-2 text-xs ${state === 'now' ? 'font-bold' : state === 'done' ? 'text-base-content/80' : 'text-base-content/45'}`}>{name}</span>
              {state === 'now' && place?.note && <span className={`mt-0.5 text-[11px] ${place.warn ? 'text-warning' : 'text-base-content/55'}`}>{place.note}</span>}
            </li>
          );
        })}
        {ended && (
          <li className="flex flex-col items-center pl-3 text-center" data-testid="order-progress-ended">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-error text-sm font-bold text-error-content" aria-hidden="true">
              ✕
            </span>
            <span className="mt-2 text-xs font-bold text-error">{status === 'CANCELLED' ? m.cancelled : m.expired}</span>
          </li>
        )}
      </ol>
      {!place && !ended && status && <p className="mt-2 text-center text-xs text-base-content/50">{m.unknown(status)}</p>}
    </section>
  );
}
