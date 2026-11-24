// 관제 지연 표시(2026-11-23 — tracking 0.14.0 activeDeliveries.delayed·promisedAt). 목(MSW) 기준: RD-7 의 DLV-1 이 약속 + 20분을 넘김.
// 2026-11-24 지연 배송 카드·거르기·목록(사용자 "지연 배송을 바로 볼 수 있는 기능").
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';
import { lateRows } from './ControlPage';

describe('관제 — 지연', () => {
  it('약속 + 20분을 넘긴 배송은 라이더 줄과 패널에 "지연"', async () => {
    renderAt('/control?mfcId=MFC-BSJ-01', as.riderOps);
    const badge = await screen.findByTestId('row-delayed');
    expect(badge).toHaveTextContent('지연');
    expect(badge.getAttribute('title')).toMatch(/\+ 20분/);
    const row = screen.getAllByTestId('control-row').find((r) => within(r).queryByTestId('row-delayed'))!;
    await userEvent.click(row);
    expect(await screen.findByTestId('panel-delayed')).toHaveTextContent('지연');
  });

  it('지연 배송 카드 → 지연 거르기: 지연 목록(약속에서 지난 분)과 지연 라이더만, 줄을 누르면 그 배송', async () => {
    renderAt('/control?mfcId=MFC-BSJ-01', as.riderOps);
    const tile = await screen.findByTestId('control-stat-late');
    expect(tile).toHaveTextContent('1건');
    await userEvent.click(tile);
    const list = await screen.findByTestId('control-late');
    const rows = within(list).getAllByTestId('control-late-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent(/약속보다 (29|30|31)분 지남/);
    // 라이더 목록도 지연 라이더만
    for (const r of screen.getAllByTestId('control-row')) expect(within(r).queryByTestId('row-delayed')).not.toBeNull();
    await userEvent.click(rows[0]!);
    expect(await screen.findByTestId('panel-delayed')).toHaveTextContent('지연');
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('지연 목록 줄은 키보드(Enter)로도 고른다', async () => {
    renderAt('/control?mfcId=MFC-BSJ-01&filter=late', as.riderOps);
    const row = (await screen.findAllByTestId('control-late-row'))[0]!;
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByTestId('panel-delayed')).toHaveTextContent('지연');
    expect(row).toHaveAttribute('aria-selected', 'true');
  });

  it('lateRows — 많이 늦은 순, 약속 시각을 모르면 맨 뒤', () => {
    const asOf = '2026-11-24T10:00:00Z';
    const d = (id: string, promisedAt: string | null, delayed = true) => ({ deliveryId: id, stage: 'TO_CUSTOMER', pickedUp: true, promisedAt, delayed });
    const rider = (id: string, ...ds: ReturnType<typeof d>[]) => ({ riderId: id, activeDeliveries: ds }) as never;
    const rows = lateRows([rider('A', d('D1', '2026-11-24T09:50:00Z'), d('D2', '2026-11-24T09:00:00Z', false)), rider('B', d('D3', null), d('D4', '2026-11-24T09:20:00Z'))], asOf);
    expect(rows.map((r) => [r.active.deliveryId, r.overMinutes])).toEqual([
      ['D4', 40],
      ['D1', 10],
      ['D3', null],
    ]);
  });
});
