// 재고관리 — 재고 현황(안전량 미설정은 "미설정", 펼치면 그 SKU 만 withPlaces), 재계수 대기 풀기(사유 필수).
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';

describe('재고 현황', () => {
  it('안전량·가용 미설정은 0 이 아니라 "미설정"', async () => {
    renderAt('/c/CDC01/inventory');
    const rows = await screen.findAllByTestId('stock-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getAllByText('미설정')).toHaveLength(2);
  });

  it('줄을 펼치면 그 SKU 만 withPlaces=true 로 LOT·위치별', async () => {
    const view = renderAt('/c/CDC01/inventory');
    const rows = await screen.findAllByTestId('stock-row');
    await userEvent.click(rows[0]!);
    const places = await screen.findByTestId('stock-places');
    expect(within(places).getByText('CDC01-A-5-63-01-2-1')).toBeInTheDocument();
    expect(within(places).getByText('보류')).toBeInTheDocument();
    const req = view.gets('/stock-snapshot').find((r) => new URL(r.url).searchParams.get('withPlaces') === 'true')!;
    expect(new URL(req.url).searchParams.get('sku')).toBe('SKU-1001');
  });
});

describe('재계수 대기', () => {
  it('대기 중만 기본, 사유를 적어 풀면 목록에서 빠진다', async () => {
    const view = renderAt('/c/CDC01/inventory?tab=recount');
    const rows = await screen.findAllByTestId('recount-row');
    expect(rows).toHaveLength(1);
    await userEvent.click(screen.getByTestId('recount-open-RCH-1'));
    expect(screen.getByTestId('recount-go')).toBeDisabled();
    await userEvent.type(screen.getByTestId('recount-reason'), '다시 세어 맞음');
    await userEvent.click(screen.getByTestId('recount-go'));
    expect(await screen.findByText('RCH-1 를 풀었어요.')).toBeInTheDocument();
    expect(await screen.findByText('재계수 대기가 없어요.')).toBeInTheDocument();
    const post = view.sent.find((r) => r.method === 'POST')!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await post.json()).toEqual({ reason: '다시 세어 맞음' });
  });
});
