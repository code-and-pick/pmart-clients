// 운영 통계(2026-11-23) — 목(MSW) 기준: 날마다 RD-7(배정 5·완료 4·실패 1·늦음 1/4)·RD-8(배정 6·완료 5·실패 1·늦음 1/4), 배차 요청 12·배정 11.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { server } from '../../test/server';

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

  it('배송 통계를 못 읽으면 0 이 아니라 오류 안내(조회 실패 ≠ 0)', async () => {
    server.use(http.get(`${API_BASE}/delivery-metrics`, () => HttpResponse.json({ type: 'about:blank', title: 'unavailable', status: 503, code: 'DEPENDENCY_UNAVAILABLE' }, { status: 503 })));
    renderAt('/stats', as.riderOps);
    await waitFor(() => expect(screen.queryByTestId('tile-completion')).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: /다시/ })).toBeInTheDocument();
    expect(screen.queryByText('완료 0 · 실패 0')).not.toBeInTheDocument();
  });

  it('배차 불가 자동 취소 n건을 누르면 건별 목록 — 취소됨·막힘(거절 코드), 결과로 거르기', async () => {
    renderAt('/stats', as.riderOps);
    await userEvent.click(await screen.findByTestId('tile-auto-cancel'));
    const list = await screen.findByTestId('auto-cancel-list');
    await waitFor(() => expect(within(list).getAllByTestId('auto-cancel-row')).toHaveLength(2));
    expect(list).toHaveTextContent('D31110001');
    expect(list).toHaveTextContent('거절 ORDER_NOT_CANCELLABLE');
    await userEvent.click(within(list).getByRole('radio', { name: '막힘' }));
    await waitFor(() => expect(within(list).getAllByTestId('auto-cancel-row')).toHaveLength(1));
    expect(within(list).getByTestId('auto-cancel-row')).toHaveTextContent('D31110002');
  });

  it('관제 "자동 취소 막힘" — 막혔고 아직 대기인 건이 있으면 카드, 누르면 목록', async () => {
    server.use(
      http.get(`${API_BASE}/metrics/auto-cancellations`, () =>
        HttpResponse.json({
          from: '',
          to: '',
          items: [{ deliveryId: 'DLV-AC-3', orderId: 'ORD-AC-3', mfcId: 'MFC-BSJ-01', deliveryNumber: 'D31110003', promisedAt: null, attemptedAt: new Date().toISOString(), result: 'BLOCKED', rejectCode: 'ORDER_NOT_CANCELLABLE', deliveryState: 'DISPATCHING' }],
        }),
      ),
    );
    renderAt('/control?mfcId=MFC-BSJ-01', as.riderOps);
    const tile = await screen.findByTestId('control-stat-auto-cancel-blocked');
    await waitFor(() => expect(tile).toHaveTextContent('1건'));
    await userEvent.click(tile);
    const open = await screen.findByTestId('auto-cancel-open');
    await waitFor(() => expect(within(open).getByTestId('auto-cancel-row')).toHaveTextContent('아직 배차 대기'));
    expect(open).toHaveTextContent('D31110003');
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

describe('운영 통계 — 날짜별·센터별 누르기, 탈퇴 라이더 빼기(사용자 2026-11-25)', () => {
  it('날짜 줄을 누르면 그날 센터별이 펼쳐지고 다시 누르면 접힌다', async () => {
    renderAt('/stats', as.riderOps);
    const days = await screen.findAllByTestId('stats-day-row');
    expect(screen.queryByTestId('stats-day-center')).toBeNull();
    await userEvent.click(days[0]!);
    expect(await screen.findAllByTestId('stats-day-center')).not.toHaveLength(0);
    expect(days[0]).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(days[0]!);
    expect(screen.queryByTestId('stats-day-center')).toBeNull();
  });

  it('직원 라이더 목록에 없는(탈퇴한) 라이더는 라이더별 성과에서 빠진다', async () => {
    server.use(
      http.get(`${API_BASE}/riders`, ({ request }) => {
        const ids = (new URL(request.url).searchParams.get('riderIds') ?? '').split(',').filter(Boolean);
        // RD-8 은 탈퇴 — 목록이 돌려주지 않는다
        return HttpResponse.json({ items: ids.filter((id) => id !== 'RD-8').map((id) => ({ riderId: id, riderNumber: 'R1234', nameMasked: '김*수' })), page: 0, size: ids.length, total: ids.length });
      }),
    );
    renderAt('/stats', as.riderOps);
    await waitFor(() => expect(screen.getAllByTestId('stats-rider-row')).toHaveLength(1));
  });
});
