// 운영 통계(2026-11-23) — 목(MSW) 기준: 날마다 RD-7(배정 5·완료 4·실패 1·늦음 1/4)·RD-8(배정 6·완료 5·실패 1·늦음 1/4), 배차 요청 12·배정 11.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

const calls = (sent: readonly Request[], path: string) => sent.filter((r) => new URL(r.url).pathname.endsWith(path));

describe('운영 통계', () => {
  it('오늘: 품질·효율·배차 효율 숫자, 센터·라이더·사고 표', async () => {
    const view = renderAt('/stats', as.riderOps);
    await userEvent.click(await screen.findByRole('button', { name: '오늘' }));
    // 완료 9 · 실패 2 → 81.8%, 늦음 2 / 판정 8 → 25%
    await waitFor(() => expect(screen.getByTestId('tile-completion')).toHaveTextContent('81.8%'));
    expect(screen.getByTestId('tile-late')).toHaveTextContent('25%');
    expect(screen.getByTestId('tile-assign')).toHaveTextContent('2분');
    expect(screen.getByTestId('tile-assign-rate')).toHaveTextContent('91.7%'); // 11 / 12
    expect(screen.getByTestId('tile-accept')).toHaveTextContent('50%'); // 10 / 20
    expect(screen.getByTestId('stats-source')).toHaveTextContent('직원 수동 배차는 없어요');
    expect(within(screen.getByTestId('stats-failure-reasons')).getByText(/라이더 없음/)).toBeInTheDocument();
    expect(screen.getAllByTestId('stats-rider-row')).toHaveLength(2);
    expect(screen.getAllByTestId('stats-mfc-row')).toHaveLength(1);
    expect(screen.getAllByTestId('stats-incident-row')[0]).toHaveTextContent('15분');
    // 라이더 운영은 센터를 안 골랐으면 정시 배송률을 묻지 않는다(서버가 센터를 요구)
    expect(screen.getByTestId('tile-on-time')).toHaveTextContent('센터를 고르면');
    expect(calls(view.sent, '/metrics/on-time-deliveries')).toHaveLength(0);
    const q = new URL(calls(view.sent, '/delivery-metrics').at(-1)!.url).searchParams;
    expect(q.get('from')).toBe(q.get('to'));
  });

  it('라이더 상세 "성과" — 그 라이더의 최근 30일', async () => {
    const view = renderAt('/riders/RD-7', as.riderOps);
    const strip = await screen.findByTestId('rider-performance');
    await waitFor(() => expect(strip).toHaveTextContent('완료율'));
    const q = new URL(calls(view.sent, '/delivery-metrics').at(-1)!.url).searchParams;
    expect(q.get('riderId')).toBe('RD-7');
    expect(strip).toHaveTextContent('80%'); // 날마다 완료 4 · 실패 1
  });
});
