// 주문 진행 단계(2026-11-18 사용자 "참고 사이트 조합" — Refine Finefoods 주문 상세의 단계 표시를 참고).
// 서버 주문 상태(order-service OrderStatus)를 계약 상태표(contracts/states/order-states.md) 순서대로 다섯 단계에 놓는다.
// 결제 → 주문 확정 → 상품 준비 → 배송 중 → 전달 완료. 화면이 상태를 판정하지 않고, 받은 상태가 어느 칸인지만 보인다.
// - 일부 인계·일부 전달은 그 단계 아래 보조 문구, 결제 결과 불명은 결제 칸을 노랑으로.
// - 취소(CANCELLED)·만료(EXPIRED)는 갈래 — 단계를 회색으로 두고 끝에 빨간 표시(어느 단계에서 끝났는지는 상태만으로 알 수 없어 칠하지 않는다).
// - 모르는 상태는 단계를 칠하지 않고 코드 그대로.
// - 단계 시각(2026-11-25 사용자 "각 작업이 언제 끝났는지"): 주문 계약에는 확정 시각(confirmedAt)만 있어, 있는 계약으로 셋만 붙인다.
//   주문 확정 = confirmedAt, 배송 중 = 배송(FORWARD) 이력의 첫 픽업, 전달 완료 = 모든 배송이 완료일 때 마지막 완료 시각.
//   결제·상품 준비 시각은 계약에 없어 비운다. 배송을 못 읽으면 시각만 빠진다(단계 칠하기는 주문 상태 그대로).
import { useQueries, useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import type { components as ExecutionC } from '../../api/generated/delivery-execution';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { when } from '../../shared/ops';
import { ProgressSteps, type StepPlace } from '../../shared/ProgressSteps';

type History = ExecutionC['schemas']['StatusHistoryEntry'];

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

/** 다섯 칸 시각(없으면 undefined). histories = 이 주문의 정방향 배송마다 상태 이력 */
export function stepTimes(confirmedAt: string | null | undefined, histories: readonly (readonly History[])[]): (string | undefined)[] {
  const firstOf = (h: readonly History[], state: History['state']) =>
    h
      .filter((x) => x.state === state)
      .map((x) => x.occurredAt)
      .filter((t): t is string => !!t)
      .sort()[0];
  const pickups = histories.map((h) => firstOf(h, 'PICKED_UP')).filter((t): t is string => !!t).sort();
  const completes = histories.map((h) => firstOf(h, 'COMPLETED')).filter((t): t is string => !!t).sort();
  const allDone = histories.length > 0 && completes.length === histories.length;
  return [undefined, confirmedAt ? when(confirmedAt) : undefined, undefined, pickups[0] ? when(pickups[0]) : undefined, allDone ? when(completes.at(-1)) : undefined];
}

/** 이 주문의 배송 이력으로 단계 시각 — 배송 칸(DeliveriesOf)·배송 상세와 같은 조회 키라 두 번 읽지 않는다 */
export function useOrderStepTimes(orderId: string, confirmedAt: string | null | undefined): (string | undefined)[] {
  const api = useApi();
  const list = useQuery({
    queryKey: ['deliveries', 'of', '', orderId],
    queryFn: () => request('GET', api.execution.GET('/deliveries', { params: { query: { size: 50, orderId } } })),
    enabled: orderId !== '',
  });
  const forward = (list.data?.items ?? []).flatMap((d) => (d.type === 'FORWARD' && d.deliveryId ? [d.deliveryId] : [])).slice(0, 5);
  const details = useQueries({
    queries: forward.map((deliveryId) => ({
      queryKey: ['deliveries', deliveryId, 'execution'],
      queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}', { params: { path: { deliveryId } } })),
    })),
  });
  const ready = list.isSuccess && details.every((q) => q.isSuccess);
  return stepTimes(confirmedAt, ready ? details.map((q) => q.data?.history ?? []) : []);
}

export function OrderProgress({ status, times }: { readonly status: string | null | undefined; readonly times?: readonly (string | undefined)[] | undefined }) {
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
      times={times}
    />
  );
}
