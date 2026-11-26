// 재고관리 [이동 이력] — 상품·칸 없이 안 부름, 칸으로 거르면 이동의 출발·도착을 한 줄에, 다른 탭에서 바로 오기.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';

describe('재고 이동 이력', () => {
  it('상품·칸이 없으면 부르지 않고, 상품을 넣으면 최신 순 원장 줄', async () => {
    const view = renderAt('/c/CDC01/inventory?tab=history');
    expect(await screen.findByTestId('history-need')).toBeInTheDocument();
    expect(screen.getByTestId('history-go')).toBeDisabled();
    expect(view.gets('/stock-movements')).toHaveLength(0);
    await userEvent.type(screen.getByTestId('history-sku'), 'SKU-1001');
    await userEvent.click(screen.getByTestId('history-go'));
    const rows = await screen.findAllByTestId('history-row');
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveTextContent('출발(출고)');
    expect(rows[0]).toHaveTextContent('운송 중');
    expect(rows[0]).toHaveTextContent('+30');
    expect(new URL(view.gets('/stock-movements')[0]!.url).searchParams.get('sku')).toBe('SKU-1001');
  });

  it('칸으로 거르면 보충 이동의 출발·도착 칸이 같이, 종류로 더 거르기', async () => {
    const view = renderAt('/c/CDC01/inventory?tab=history&loc=CDC01-A-5-63-01-2-1');
    const rows = await screen.findAllByTestId('history-row');
    const move = rows.find((r) => r.textContent.includes('칸 이동'))!;
    expect(within(move).getByTestId('history-deltas')).toHaveTextContent('CDC01-A-5-03-02-1-1');
    expect(within(move).getByTestId('history-deltas')).toHaveTextContent('-24');
    await userEvent.selectOptions(screen.getByTestId('history-kind'), 'MOVE');
    await userEvent.click(screen.getByTestId('history-go'));
    expect(await screen.findAllByTestId('history-row')).toHaveLength(1);
    expect(new URL(view.gets('/stock-movements').at(-1)!.url).searchParams.get('kind')).toBe('MOVE');
  });

  it('재계수 대기 줄의 "이력" → 그 칸·상품 이력', async () => {
    renderAt('/c/CDC01/inventory?tab=recount');
    await userEvent.click(await screen.findByTestId('recount-history'));
    const rows = await screen.findAllByTestId('history-row');
    expect(rows[0]).toHaveTextContent('실사 조정');
    expect(rows[0]).toHaveTextContent('-2');
  });
});
