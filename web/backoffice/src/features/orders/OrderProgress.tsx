// 주문 진행 단계(2026-11-18 사용자 "참고 사이트 조합" — Refine Finefoods 주문 상세의 단계 표시를 참고).
// 서버 주문 상태(order-service OrderStatus)를 계약 상태표(contracts/states/order-states.md) 순서대로 다섯 단계에 놓는다.
// 결제 → 주문 확정 → 상품 준비 → 배송 중 → 전달 완료. 화면이 상태를 판정하지 않고, 받은 상태가 어느 칸인지만 보인다.
// - 일부 인계·일부 전달은 그 단계 아래 보조 문구, 결제 결과 불명은 결제 칸을 노랑으로.
// - 취소(CANCELLED)·만료(EXPIRED)는 갈래 — 단계를 회색으로 두고 끝에 빨간 표시(어느 단계에서 끝났는지는 상태만으로 알 수 없어 칠하지 않는다).
// - 모르는 상태는 단계를 칠하지 않고 코드 그대로.
import { messages } from '../../shared/messages';
import { ProgressSteps, type StepPlace } from '../../shared/ProgressSteps';

const m = messages.orders.progress;

type Place = StepPlace;

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
  const ended = status === 'CANCELLED' ? m.cancelled : status === 'EXPIRED' ? m.expired : undefined;
  return (
    <ProgressSteps
      steps={m.steps}
      place={placeOf(status)}
      ended={ended}
      unknownText={status ? m.unknown(status) : undefined}
      label={m.title}
      testId="order-progress"
      endedTestId="order-progress-ended"
    />
  );
}
