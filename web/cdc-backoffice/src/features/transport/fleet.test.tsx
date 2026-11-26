// 차량·기사(fleet)·노선 등록·정규차 지정 — 멱등키·기대 버전, 고를 수 있는 정규차만, 서버 거절(시각·같은 MFC)은 그대로 알림.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';

describe('차량·기사', () => {
  it('차량 등록 → 목록에, 기사 등록', async () => {
    const view = renderAt('/c/CDC01/transport?v=fleet');
    expect(await screen.findAllByTestId('vehicle-row')).toHaveLength(8);
    await userEvent.click(screen.getByTestId('vehicle-new'));
    await userEvent.type(screen.getByTestId('vehicle-id'), '50');
    await userEvent.click(screen.getByTestId('vehicle-go'));
    await waitFor(() => expect(screen.getAllByTestId('vehicle-row')).toHaveLength(9));
    expect(view.sent.find((r) => r.method === 'POST' && r.url.endsWith('/vehicles'))!.headers.get('Idempotency-Key')).toBeTruthy();
    await userEvent.click(screen.getByTestId('driver-new'));
    await userEvent.type(screen.getByTestId('driver-id'), '50');
    await userEvent.type(screen.getByTestId('driver-name'), '기사 50');
    await userEvent.click(screen.getByTestId('driver-go'));
    await waitFor(() => expect(screen.getAllByTestId('driver-row')).toHaveLength(8));
  });

  it('차량 바꾸기는 기대 버전을 붙임', async () => {
    const view = renderAt('/c/CDC01/transport?v=fleet');
    const row = (await screen.findAllByTestId('vehicle-row'))[0]!;
    await userEvent.click(within(row).getByTestId('vehicle-edit'));
    const rt = screen.getByTestId('vehicle-maxrt');
    await userEvent.clear(rt);
    await userEvent.type(rt, '14');
    await userEvent.click(screen.getByTestId('vehicle-save'));
    await waitFor(() => expect(within(screen.getAllByTestId('vehicle-row')[0]!).getByText('14')).toBeInTheDocument());
    expect(view.sent.find((r) => r.url.endsWith('/changes'))!.headers.get('X-Expected-Version')).toBe('1');
  });
});

describe('노선', () => {
  it('노선 등록 — 같은 MFC 가 다른 노선에 있으면 서버 거절, 바꾸면 등록', async () => {
    renderAt('/c/CDC01/transport?v=routes');
    await userEvent.click(await screen.findByTestId('route-new'));
    await userEvent.type(screen.getByTestId('route-id'), '04');
    await userEvent.type(screen.getByTestId('route-name'), '동부');
    await userEvent.type(screen.getByTestId('route-mfc-0'), 'MFC-BJG-01');
    await userEvent.click(screen.getByTestId('route-go'));
    expect(await screen.findByRole('alert')).toHaveAttribute('data-code', 'MFC_ALREADY_ROUTED');
    await userEvent.clear(screen.getByTestId('route-mfc-0'));
    await userEvent.type(screen.getByTestId('route-mfc-0'), 'MFC-GANG-01');
    await userEvent.click(screen.getByTestId('route-go'));
    await waitFor(() => expect(screen.getAllByTestId('route-card')).toHaveLength(4));
  });

  it('정규차 지정 — 그 온도대 사용 중 정규차만 고를 수 있음', async () => {
    renderAt('/c/CDC01/transport?v=routes');
    const card = (await screen.findAllByTestId('route-card'))[2]!;
    await userEvent.click(within(card).getByTestId('regular-open'));
    await userEvent.selectOptions(await screen.findByTestId('regular-temp'), 'FROZEN');
    const options = within(await screen.findByTestId('regular-vehicle')).getAllByRole('option');
    expect(options.map((o) => o.getAttribute('value'))).toEqual(['VH-21', 'VH-33']);
    await userEvent.selectOptions(screen.getByTestId('regular-vehicle'), 'VH-33');
    await userEvent.click(screen.getByTestId('regular-go'));
    await waitFor(() => expect(screen.getAllByTestId('route-card')[2]).toHaveTextContent('냉동 · VH-33'));
  });
});
