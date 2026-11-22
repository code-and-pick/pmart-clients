// 번호로 넣기(2026-11-19 사용자 "주문·라이더·배달 ID 같은 난수를 일일이 확인 안 하고 불러올 방법") — 화면 번호를 넣으면 서버에서 찾아 그 ID 로
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('화면 번호로 넣기', () => {
  it('오배송 접수: 배송 번호(D74939002)를 넣으면 찾았다고 보이고, 그 배송 ID 로 접수', async () => {
    const view = renderAt('/cases/new-misdelivery', as.cs);
    await userEvent.type(await screen.findByLabelText(/배송 번호/), 'D74939002');
    expect(await screen.findByText(/✓ 배송 D74939002 을\(를\) 찾았어요/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('요약'), '옆 동으로 감');
    await userEvent.click(screen.getByRole('radio', { name: '지도·시스템 오류' }));
    await userEvent.click(screen.getByRole('button', { name: '오배송 접수하기' }));
    await waitFor(() => expect(view.mutations('/cases')).toHaveLength(1));
    expect(await view.mutations('/cases')[0]!.json()).toMatchObject({ subjectRef: 'DLV-MOCK-2' });
  });

  it('없는 배송 번호는 "찾지 못했어요" — 접수 단추는 막힌다(다른 값으로 바꾸지 않음)', async () => {
    renderAt('/cases/new-misdelivery', as.cs);
    await userEvent.type(await screen.findByLabelText(/배송 번호/), 'D74939002-9');
    expect(await screen.findByText(/D74939002-9 을\(를\) 찾지 못했어요/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('요약'), '요약');
    await userEvent.click(screen.getByRole('radio', { name: '지도·시스템 오류' }));
    expect(screen.getByRole('button', { name: '오배송 접수하기' })).toBeDisabled();
  });

  it('라이더 컴플레인: 라이더 번호(6자리)로 거르면 그 라이더 ID 로 묻는다', async () => {
    const view = renderAt('/rider-complaints?riderId=R4785', as.riderOps);
    await waitFor(() => expect(screen.getByTestId('ref-status-rider')).toHaveAttribute('data-state', 'found'));
    await waitFor(() => expect(view.sent.some((r) => new URL(r.url).pathname.endsWith('/rider-complaints') && new URL(r.url).searchParams.get('riderId') === 'RID-MOCK-1')).toBe(true));
  });

  it('배송 확인 바로 열기: 배송 번호로 그 배송 상세', async () => {
    const view = renderAt('/deliveries', as.riderOps);
    await userEvent.type(await screen.findByRole('textbox', { name: '배송 번호' }), 'D74939001');
    await userEvent.click(screen.getByRole('button', { name: /^열기$/ }));
    await waitFor(() => expect(view.sent.some((r) => new URL(r.url).pathname.endsWith('/deliveries/DLV-MOCK-1'))).toBe(true));
  });
});
