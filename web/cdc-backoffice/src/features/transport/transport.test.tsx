// 출하·운송 — 운행(오늘 출고일·지연·다음 출차), 직원 대신 입력(입차·상차·출차·도착·인계 대조), 배차(계획완료 기대 버전·적재 초과 막음), 잔여 물량·노선.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { mockShipDate } from '../../mocks/transportHandlers';
import { renderAt } from '../../test/render';

const d = mockShipDate().replaceAll('-', '');
const row = async (testId: string, text: string) => (await screen.findAllByTestId(testId)).find((r) => r.textContent.includes(text))!;

describe('출하·운송 — 운행', () => {
  it('오늘 출고일 운행, 지연 카드로 거르기, 펼치면 정차 예상 도착·인계 대조', async () => {
    const view = renderAt('/c/CDC01/transport');
    expect(await screen.findAllByTestId('trip-row')).toHaveLength(4);
    expect(new URL(view.gets('/trips')[0]!.url).searchParams.get('shipDate')).toBe(mockShipDate());
    await userEvent.click(screen.getByTestId('trip-delayed'));
    expect(screen.getAllByTestId('trip-row')).toHaveLength(1);
    await userEvent.click(screen.getByTestId('trip-row'));
    const stops = within(await screen.findByTestId('trip-stops')).getAllByTestId('stop-row');
    expect(stops).toHaveLength(2);
    expect(within(stops[0]!).getByTestId('handover-cell')).toHaveTextContent('일치');
    expect(within(stops[1]!).getByText('지연')).toBeInTheDocument();
    expect(screen.getByTestId('trip-incidents')).toHaveTextContent('고속도로 정체');
  });

  it('입차 — 멱등키를 붙여 보내고 서버 상태로 바뀜', async () => {
    const view = renderAt('/c/CDC01/transport');
    await userEvent.click(await row('trip-row', `TO-${d}-003`));
    await userEvent.click(await screen.findByTestId('trip-checkin'));
    await waitFor(async () => expect(within(await row('trip-row', `TO-${d}-003`)).getByText('입차')).toBeInTheDocument());
    const post = view.sent.find((r) => r.method === 'POST' && r.url.endsWith('/check-ins'))!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(post.headers.get('X-Source-System')).toBe('cdc-backoffice-web');
  });

  it('상차 스캔 → 출차 → 운행 중', async () => {
    renderAt('/c/CDC01/transport');
    await userEvent.click(await row('trip-row', `TO-${d}-002`));
    expect(screen.queryByTestId('trip-depart')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByTestId('trip-loading-open'));
    expect(screen.getByTestId('loading-go')).toBeDisabled();
    await userEvent.type(screen.getByTestId('loading-lpns-TRF-20261126-0003'), 'LPN-D01, LPN-D02');
    await userEvent.click(screen.getByTestId('loading-go'));
    await userEvent.click(await screen.findByTestId('trip-depart'));
    await waitFor(async () => expect(within(await row('trip-row', `TO-${d}-002`)).getByText('운행 중')).toBeInTheDocument());
  });

  it('정차 도착 → 인계 — 한 박스 빠지면 서버가 차이로', async () => {
    renderAt('/c/CDC01/transport');
    await userEvent.click(await row('trip-row', `TO-${d}-001`));
    await userEvent.click(await screen.findByTestId('stop-arrive'));
    await userEvent.click(await screen.findByTestId('stop-handover-open'));
    await userEvent.type(screen.getByTestId('handover-lpns-TRF-20261126-0002'), 'LPN-B01 LPN-B02 LPN-B03 LPN-B04 LPN-B05');
    await userEvent.click(screen.getByTestId('handover-go'));
    await waitFor(() => expect(screen.getAllByTestId('handover-cell')[1]).toHaveTextContent('차이'));
    expect(screen.getAllByTestId('handover-cell')[1]).toHaveTextContent('LPN-B06');
    expect(await screen.findByTestId('stop-depart')).toBeInTheDocument();
  });
});

describe('출하·운송 — 배차', () => {
  it('적재 초과는 계획완료 못 함, 계획완료는 기대 버전을 붙이고 운행이 생김', async () => {
    const view = renderAt('/c/CDC01/transport?v=orders');
    await userEvent.click(await row('order-row', `TO-${d}-006`));
    expect(await screen.findByTestId('order-confirm')).toBeDisabled();
    await userEvent.click(await row('order-row', `TO-${d}-005`));
    await userEvent.click(await screen.findByTestId('order-confirm'));
    await waitFor(async () => expect(within(await row('order-row', `TO-${d}-005`)).queryByText('계획중')).not.toBeInTheDocument());
    const post = view.sent.find((r) => r.method === 'POST' && r.url.endsWith('/confirmations'))!;
    expect(post.headers.get('X-Expected-Version')).toBe('1');
    await userEvent.click(screen.getByRole('tab', { name: '운행' }));
    expect(await screen.findAllByTestId('trip-row')).toHaveLength(5);
  });

  it('배차 생성 — 만들지 못한 노선·온도대를 보여 줌', async () => {
    renderAt('/c/CDC01/transport?v=orders');
    await userEvent.click(await screen.findByTestId('orders-generate'));
    expect(await screen.findByTestId('orders-generated')).toHaveTextContent('정규차 없음');
  });

  it('잔여 물량은 기본 보류만 — 사유와 함께, 노선은 정차 순서·정규차', async () => {
    renderAt('/c/CDC01/transport?v=requests');
    const rows = await screen.findAllByTestId('request-row');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.textContent).join()).toContain('노선 없는 MFC');
    await userEvent.click(screen.getByRole('tab', { name: '노선' }));
    const cards = await screen.findAllByTestId('route-card');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent('MFC-BJG-01');
    expect(cards[0]).toHaveTextContent('최대 R/T 12');
  });
});
