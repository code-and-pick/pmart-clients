// 목록 줄을 누르면 펼쳐지는 상세(사용자 2026-11-26 "목록 눌러도 아무것도 안 들어가짐", "상세 정보를 볼 수가 없네") — 리포트·작업자·인력·보충관리·로케이션.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';

describe('줄 펼치기', () => {
  it('일별 출고 — 그날 TRF 상태와 MFC 별(이름)', async () => {
    renderAt('/c/CDC01/reports?v=daily&from=2026-11-20&to=2026-11-22');
    await userEvent.click((await screen.findAllByTestId('daily-row'))[0]!);
    const d = await screen.findByTestId('day-detail');
    expect(within(d).getByTestId('day-by-mfc')).toHaveTextContent('세종 MFC');
    expect(within(d).getByRole('link', { name: '이 날 대시보드' })).toHaveAttribute('href', '/c/CDC01/dashboard?date=2026-11-20');
  });

  it('작업자 실적 — 하루면 시간당·그날 근무', async () => {
    renderAt('/c/CDC01/reports?v=workers');
    await userEvent.click((await screen.findAllByTestId('throughput-row'))[0]!);
    const d = await screen.findByTestId('worker-detail');
    expect(d).toHaveTextContent('시간당 피킹 줄');
    await waitFor(() => expect(d).toHaveTextContent('보충'));
  });

  it('작업자·인력 — 줄을 누르면 근무·위치·그날 실적, 현황 칸을 누르면 그 작업자만', async () => {
    renderAt('/c/CDC01/workers');
    await userEvent.click((await screen.findAllByTestId('assignment-row'))[0]!);
    expect(await screen.findByTestId('assignment-detail')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('assignment-where')).toHaveTextContent('CDC01-G-5-63-01-2-1'));
    await waitFor(() => expect(screen.getByTestId('assignment-done')).toHaveTextContent('58'));
    const evening = screen.getAllByTestId('shift-card')[1]!;
    await userEvent.click(within(evening).getAllByTestId('staffing-row')[0]!);
    expect(screen.getByTestId('assignment-filter')).toHaveTextContent('5층 · FC 피킹');
    expect(screen.getAllByTestId('assignment-row')).toHaveLength(1);
  });

  it('보충 판단 — 어떻게 계산했는지와 사유를 문장으로', async () => {
    renderAt('/c/CDC01/replenishment');
    const row = (await screen.findAllByTestId('repl-check-row')).find((r) => r.textContent.includes('CDC01-A-5-63-01-2-1'))!;
    await userEvent.click(row);
    const d = await screen.findByTestId('check-detail');
    expect(d).toHaveTextContent('필요 = 목표 30 − 지금 4 − 이미 가는 중 0 = 26개');
    expect(within(d).getByTestId('check-reason')).toHaveTextContent('보충 작업을 만들었어요');
  });

  it('로케이션 상세 — 점유를 모르면 "모름" 대신 그 칸 지금 재고', async () => {
    renderAt('/c/CDC01/master/locations/CDC01-A-5-63-01-2-1');
    const f = await screen.findByTestId('loc-fields');
    expect(f).not.toHaveTextContent('모름');
    await waitFor(() => expect(f).toHaveTextContent('지금 재고(이 칸 현물 합)100'));
  });
});
