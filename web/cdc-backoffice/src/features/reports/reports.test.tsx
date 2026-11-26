// 리포트·KPI(N/A 는 값 대신 사유, 잠정 표시, 기간 보내기) · 작업자·인력(계획 대비 배치·출근, 배치·출근 명령).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';

describe('리포트·KPI', () => {
  it('운영 확인 기준 6항목 — 계산된 것은 값·잠정, 원천 없는 것은 N/A 와 사유', async () => {
    const view = renderAt('/c/CDC01/reports?from=2026-11-20&to=2026-11-26');
    const cards = await screen.findAllByTestId('metric-card');
    expect(cards).toHaveLength(6);
    expect(within(cards[0]!).getByTestId('metric-value')).toHaveTextContent('76.7%');
    expect(within(cards[0]!).getByText('잠정')).toBeInTheDocument();
    expect(cards[1]).toHaveAttribute('data-status', 'NA');
    expect(within(cards[1]!).getByTestId('metric-value')).toHaveTextContent('N/A');
    expect(cards[1]).toHaveTextContent('원천 자료 없음');
    expect(cards[5]).toHaveTextContent('피킹 부족');
    expect(within(cards[5]!).getByTestId('metric-value')).toHaveTextContent('7건');
    const q = new URL(view.gets('/operating-metrics')[0]!.url).searchParams;
    expect([q.get('from'), q.get('to')]).toEqual(['2026-11-20', '2026-11-26']);
  });

  it('일별 출고는 날짜마다 한 줄, 작업자 실적은 담당자별', async () => {
    renderAt('/c/CDC01/reports?v=daily&from=2026-11-20&to=2026-11-26');
    expect(await screen.findAllByTestId('daily-row')).toHaveLength(7);
    await userEvent.click(screen.getByRole('tab', { name: '작업자 실적' }));
    const rows = await screen.findAllByTestId('throughput-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('5층 · A');
  });
});

describe('작업자·인력', () => {
  it('근무조 3개 — 계획·배치·출근 합, 출근 처리하면 서버 값으로', async () => {
    const view = renderAt('/c/CDC01/workers');
    const cards = await screen.findAllByTestId('shift-card');
    expect(cards).toHaveLength(3);
    expect(within(cards[1]!).getByTestId('shift-totals')).toHaveTextContent('배치 2 · 출근 1');
    const row = (await screen.findAllByTestId('assignment-row')).find((r) => within(r).queryByTestId('check-in'))!;
    await userEvent.click(within(row).getByTestId('check-in'));
    await waitFor(() => expect(within(screen.getAllByTestId('shift-card')[1]!).getByTestId('shift-totals')).toHaveTextContent('출근 2'));
    expect(view.sent.find((r) => r.url.endsWith('/check-ins'))!.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('근무 배치 — 계획 밖 칸도 막지 않고 현황에 더해짐', async () => {
    renderAt('/c/CDC01/workers');
    await userEvent.click(await screen.findByTestId('assign-open'));
    await userEvent.selectOptions(await screen.findByTestId('assign-shift'), 'NIGHT_DOCK');
    await userEvent.type(screen.getByTestId('assign-worker'), 'OP-cdc-worker-9');
    await userEvent.selectOptions(screen.getByTestId('assign-floor'), 'ALL');
    await userEvent.selectOptions(screen.getByTestId('assign-role'), 'LOADER');
    await userEvent.click(screen.getByTestId('assign-go'));
    await waitFor(() => expect(within(screen.getAllByTestId('shift-card')[2]!).getByTestId('shift-totals')).toHaveTextContent('배치 1'));
    expect(await screen.findAllByTestId('assignment-row')).toHaveLength(5);
  });
});
