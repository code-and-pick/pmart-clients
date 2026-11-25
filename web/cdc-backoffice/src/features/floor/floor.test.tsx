// 센터 평면도 — 층 탭, 통로 번호판을 누르면 그 통로 칸 재고(locationPrefix = CDC01-{구역}-{층}-{통로}-), 도면 없는 DC 는 "없음".
import { screen, within } from '@testing-library/react';
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
    await userEvent.click(screen.getByRole('button', { name: '통로 A03' }));
    const panel = await screen.findByTestId('aisle-panel');
    expect(panel).toHaveTextContent('CDC01-A-5-03-');
    await screen.findByTestId('location-stock-row');
    expect(view.gets('/location-stocks').map((r) => new URL(r.url).searchParams.get('locationPrefix'))).toContain('CDC01-A-5-03-');
    expect(within(panel).getByRole('link', { name: /로케이션 목록/ })).toHaveAttribute('href', '/c/CDC01/master?tab=locations&area=A&floor=5');
  });

  it('6층으로 바꾸면 냉장 B 통로', async () => {
    renderAt('/c/CDC01/floor');
    await userEvent.click(await screen.findByRole('tab', { name: '6F 냉장' }));
    expect(screen.getByRole('button', { name: '통로 B01' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '통로 A01' })).not.toBeInTheDocument();
  });
});
