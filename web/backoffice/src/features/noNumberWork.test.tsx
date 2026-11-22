// 번호를 몰라도 일하기(2026-11-19 사용자 "배송 번호가 길어 사람이 기억할 수 없다 — 시스템적으로 해결")
// 1 그 배송이 있는 곳에서 바로 시작(번호가 채워진 입력 화면) · 2 사람이 아는 것(최근 본·고객 연락처·라이더 전화)으로 찾아 고르기
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('그 배송이 있는 곳에서 바로 시작', () => {
  it('배송 상세: 오배송 접수를 누르면 그 배송이 채워진 접수 화면', async () => {
    const user = userEvent.setup();
    renderAt('/deliveries/DLV-MOCK-2', as.cs);
    const start = await screen.findByTestId('start-misdelivery');
    expect(screen.getByTestId('start-complaint')).toBeInTheDocument();
    await user.click(start);
    expect(await screen.findByLabelText(/배송 번호/)).toHaveValue('DLV-MOCK-2');
  });

  it('역할로 열 수 없는 메뉴의 단추는 없다(MD)', async () => {
    renderAt('/deliveries/DLV-MOCK-2', as.md);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByTestId('start-misdelivery')).not.toBeInTheDocument();
  });
});

describe('번호를 몰라도 찾아 고르기', () => {
  it('고객 연락처 → 그 고객 주문의 배송 → 고르면 칸에 배송 번호, 찾았다고 확인', async () => {
    const user = userEvent.setup();
    const view = renderAt('/cases/new-misdelivery', as.cs);
    await user.click(await screen.findByTestId('delivery-picker-open'));
    const picker = screen.getByTestId('delivery-picker');
    await user.click(within(picker).getByRole('tab', { name: '고객 연락처로' }));
    await user.type(within(picker).getByLabelText('고객(수령인) 연락처'), '010-1234-5678{Enter}');
    const row = (await within(picker).findAllByTestId('picker-row'))[0]!;
    expect(row).toHaveTextContent('D74939001');
    await user.click(row);
    expect(screen.getByLabelText(/배송 번호/)).toHaveValue('D74939001');
    await waitFor(() => expect(screen.getByTestId('ref-status-delivery')).toHaveAttribute('data-state', 'found'));
    // 연락처는 주소창에 남지 않는다
    expect(view.sent.filter((r) => new URL(r.url).pathname.endsWith('/orders/lookups')).every((r) => new URL(r.url).searchParams.get('receiverPhone') === '01012345678')).toBe(true);
    expect(window.location.search).not.toContain('01012345678');
  });

  it('라이더 전화 → 그 라이더의 배송', async () => {
    const user = userEvent.setup();
    renderAt('/cases/new-misdelivery', as.riderOps);
    await user.click(await screen.findByTestId('delivery-picker-open'));
    const picker = screen.getByTestId('delivery-picker');
    await user.click(within(picker).getByRole('tab', { name: '라이더 전화로' }));
    await user.type(within(picker).getByLabelText('라이더 전화번호'), '01011112222{Enter}');
    expect((await within(picker).findAllByTestId('picker-row')).length).toBeGreaterThan(0);
  });

  it('없는 라이더 전화는 "라이더가 없어요" — 빈 목록을 "배송 없음"으로 보이지 않는다', async () => {
    const user = userEvent.setup();
    renderAt('/cases/new-misdelivery', as.riderOps);
    await user.click(await screen.findByTestId('delivery-picker-open'));
    const picker = screen.getByTestId('delivery-picker');
    await user.click(within(picker).getByRole('tab', { name: '라이더 전화로' }));
    await user.type(within(picker).getByLabelText('라이더 전화번호'), '01099998888{Enter}');
    expect(await within(picker).findByText('그 전화번호의 라이더가 없어요.')).toBeInTheDocument();
  });
});
