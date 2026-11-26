// 주문 진행 단계(2026-11-18) — 서버 상태를 계약 상태표 순서대로 다섯 칸에, 갈래(취소·만료)는 따로
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';
import { OrderProgress, placeOf, stepTimes } from './OrderProgress';

const states = () => within(screen.getByTestId('order-progress')).getAllByRole('listitem').map((li) => li.getAttribute('data-step-state'));

describe('주문 진행 단계', () => {
  it('상태표 순서 — 결제 쪽 상태는 1칸, 확정 2, 준비 3, 인계·배송 4, 완료 5', () => {
    expect(placeOf('PAYMENT_PENDING')?.step).toBe(0);
    expect(placeOf('RESOURCE_PENDING')?.step).toBe(0);
    expect(placeOf('CONFIRMED')?.step).toBe(1);
    expect(placeOf('PREPARING')?.step).toBe(2);
    expect(placeOf('PARTIALLY_HANDED_OVER')?.step).toBe(3);
    expect(placeOf('IN_DELIVERY')?.step).toBe(3);
    expect(placeOf('PARTIALLY_DELIVERED')?.step).toBe(3);
    expect(placeOf('COMPLETED')).toEqual({ step: 4, done: true });
    expect(placeOf('CANCELLED')).toBeNull();
  });

  it('배송 중이면 앞 셋은 끝, 넷째가 지금, 다섯째는 아직', () => {
    render(<OrderProgress status="IN_DELIVERY" />);
    expect(states()).toEqual(['done', 'done', 'done', 'now', 'todo']);
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('배송 중');
  });

  it('일부 인계는 넷째 칸 아래 보조 문구, 결제 결과 불명은 결제 칸에 "결제 결과 확인 중"', () => {
    const { unmount } = render(<OrderProgress status="PARTIALLY_HANDED_OVER" />);
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('일부만 인계');
    unmount();
    render(<OrderProgress status="PAYMENT_UNKNOWN" />);
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('결제 결과 확인 중');
  });

  it('완료면 다섯 칸 모두 끝', () => {
    render(<OrderProgress status="COMPLETED" />);
    expect(states()).toEqual(['done', 'done', 'done', 'done', 'done']);
  });

  it('취소는 단계를 칠하지 않고 끝에 "취소됨"(어느 단계에서 끝났는지 지어내지 않는다)', () => {
    render(<OrderProgress status="CANCELLED" />);
    expect(states().slice(0, 5)).toEqual(['todo', 'todo', 'todo', 'todo', 'todo']);
    expect(screen.getByTestId('order-progress-ended')).toHaveTextContent('취소됨');
  });

  it('주문 상세 화면 맨 위에 보인다(목 ORD-MOCK-1001 = 배송 중)', async () => {
    renderAt('/orders/ORD-MOCK-1001', as.admin);
    const p = await screen.findByTestId('order-progress');
    expect(within(p).getByRole('listitem', { current: 'step' })).toHaveTextContent('배송 중');
  });

  it('단계 시각(2026-11-25): 확정 = confirmedAt, 배송 중 = 첫 픽업, 전달 완료 = 모든 배송이 끝났을 때만 마지막 완료 — 결제·준비는 계약에 없어 비움', () => {
    const t = (iso: string) => new Date(iso).toISOString();
    const a = [{ state: 'ASSIGNED' as const, occurredAt: t('2026-11-25T03:00:00Z') }, { state: 'PICKED_UP' as const, occurredAt: t('2026-11-25T03:20:00Z') }, { state: 'COMPLETED' as const, occurredAt: t('2026-11-25T04:00:00Z') }];
    const b = [{ state: 'PICKED_UP' as const, occurredAt: t('2026-11-25T03:10:00Z') }];
    const one = stepTimes('2026-11-25T02:50:00Z', [a]);
    expect(one[0]).toBeUndefined();
    expect(one[1]).toBeDefined();
    expect(one[2]).toBeUndefined();
    expect(one[3]).toBe(stepTimes(null, [[{ state: 'PICKED_UP', occurredAt: t('2026-11-25T03:20:00Z') }]])[3]);
    expect(one[4]).toBeDefined();
    const two = stepTimes(null, [a, b]);
    expect(two[3]).toBe(stepTimes(null, [b])[3]); // 두 배송 중 먼저 픽업한 시각
    expect(two[4]).toBeUndefined(); // 한 배송이 아직 — 완료 시각 없음
    expect(stepTimes(null, [])).toEqual([undefined, undefined, undefined, undefined, undefined]); // 배송을 못 읽으면 시각만 빠진다
  });

  it('상세 화면: 전달 완료 주문(목 ORD-MOCK-1007)은 확정·배송 중·전달 완료 칸 아래 시각, 결제·상품 준비는 없음', async () => {
    renderAt('/orders/ORD-MOCK-1007', as.admin);
    const p = await screen.findByTestId('order-progress');
    await within(p).findAllByTestId('step-time');
    await expect.poll(() => within(p).queryAllByTestId('step-time').length).toBe(3);
    const items = within(p).getAllByRole('listitem');
    expect(within(items[0]!).queryByTestId('step-time')).toBeNull();
    expect(within(items[2]!).queryByTestId('step-time')).toBeNull();
    expect(within(items[4]!).getByTestId('step-time')).toBeInTheDocument();
  });
});
