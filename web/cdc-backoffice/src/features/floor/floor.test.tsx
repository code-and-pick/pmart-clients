// 센터 평면도 — 층 탭, 통로 번호판을 누르면 그 통로 칸 재고(locationPrefix = CDC01-{구역}-{층}-{통로}-), 도면 없는 DC 는 "없음".
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';
import { aislePrefix } from './FloorPage';

describe('센터 평면도', () => {
  it('통로 앞부분 코드 = 계약 LocationCode 앞 4구간', () => {
    expect(aislePrefix('CDC01', '5', { zone: 'A', no: 3 })).toBe('CDC01-A-5-03-');
  });

  it('층 탭과 통로 — 누르면 그 통로 칸 재고를 서버에 묻는다', async () => {
    const view = renderAt('/c/CDC01/floor');
    expect(await screen.findByTestId('floor-svg')).toBeInTheDocument();
    expect(within(screen.getByTestId('floor-tabs')).getAllByRole('tab')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: '통로 G03' }));
    const panel = await screen.findByTestId('aisle-panel');
    expect(panel).toHaveTextContent('CDC01-G-5-03-');
    await waitFor(() => expect(view.gets('/location-stocks').map((r) => new URL(r.url).searchParams.get('locationPrefix'))).toContain('CDC01-G-5-03-'));
    expect(within(panel).getByRole('link', { name: /로케이션 목록/ })).toHaveAttribute('href', '/c/CDC01/master?tab=locations&area=G&floor=5');
  });

  it('6층으로 바꾸면 상온 A~D 통로(시뮬레이터 R-25)', async () => {
    renderAt('/c/CDC01/floor');
    await userEvent.click(await screen.findByRole('tab', { name: '6F 상온' }));
    expect(screen.getByRole('button', { name: '통로 B01' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '통로 G01' })).not.toBeInTheDocument();
  });
});

describe('평면도 작업자', () => {
  it('최근 스캔(FRESH)만 점, 오래된 위치는 목록에 "모름"', async () => {
    renderAt('/c/CDC01/floor?f=5');
    await waitFor(() => expect(screen.getAllByTestId('floor-worker')).toHaveLength(1));
    const rows = await screen.findAllByTestId('floor-worker-row');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent('위치 모름');
  });
});
