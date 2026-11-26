// 재고관리 > 품질·폐기·리콜 — 보류 걸기(멱등키), 해제 결정(본인 결정은 서버 422 그대로), 폐기 실행(승인 수량 넘으면 못 보냄), 리콜(본사 승인 번호 필수).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';

describe('품질 보류', () => {
  it('목록 → 펼치면 줄별 보류·남은 수량과 해제 요청', async () => {
    renderAt('/c/CDC01/inventory?tab=quality');
    const row = await screen.findByTestId('hold-row');
    expect(within(row).getByText('온도 이탈')).toBeInTheDocument();
    expect(within(row).getByText('보류 중')).toBeInTheDocument();
    await userEvent.click(row);
    const detail = await screen.findByTestId('hold-detail');
    expect(within(detail).getByText('결정 대기')).toBeInTheDocument();
  });

  it('보류 걸기 — SKU·LOT 없으면 못 보내고, 보내면 멱등키와 함께', async () => {
    const view = renderAt('/c/CDC01/inventory?tab=quality');
    await userEvent.click(await screen.findByTestId('hold-new'));
    expect(screen.getByTestId('hold-go')).toBeDisabled();
    await userEvent.type(screen.getByTestId('hold-sku-0'), 'SKU-2001');
    await userEvent.type(screen.getByTestId('hold-lot-0'), 'LOT-Z');
    await userEvent.click(screen.getByTestId('hold-go'));
    expect(await screen.findByText(/보류 QH-\d+ 를 만들었어요/)).toBeInTheDocument();
    const post = view.sent.find((r) => r.method === 'POST' && r.url.endsWith('/quality-holds'))!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await post.json()).toEqual({ reason: 'MANUAL', lines: [{ sku: 'SKU-2001', lot: 'LOT-Z' }] });
    await waitFor(() => expect(screen.getAllByTestId('hold-row')).toHaveLength(2));
  });

  it('해제 승인 → 서버 상태(일부 해제)로 다시 읽기', async () => {
    renderAt('/c/CDC01/inventory?tab=quality');
    await userEvent.click(await screen.findByTestId('hold-row'));
    const decide = await screen.findByTestId('release-decide-QR-0001');
    await userEvent.click(within(decide).getByRole('button', { name: '승인' }));
    await waitFor(() => expect(within(screen.getByTestId('hold-row')).getByText('일부 해제')).toBeInTheDocument());
    expect(within(screen.getByTestId('release-row')).getByText('해제됨')).toBeInTheDocument();
  });

  it('반려는 결정 사유가 있어야', async () => {
    renderAt('/c/CDC01/inventory?tab=quality');
    await userEvent.click(await screen.findByTestId('hold-row'));
    const decide = await screen.findByTestId('release-decide-QR-0001');
    expect(within(decide).getByRole('button', { name: '반려' })).toBeDisabled();
  });
});

describe('폐기', () => {
  it('실행 — 승인 수량을 넘으면 못 보내고, 증빙과 수량을 적으면 끝남', async () => {
    renderAt('/c/CDC01/inventory?tab=quality&qv=disposals');
    await userEvent.click(await screen.findByTestId('disposal-row'));
    await userEvent.type(await screen.findByTestId('exec-qty-0'), '4');
    await userEvent.type(screen.getByTestId('exec-evidence'), 'PHOTO-1');
    expect(screen.getByTestId('exec-go')).toBeDisabled();
    await userEvent.clear(screen.getByTestId('exec-qty-0'));
    await userEvent.type(screen.getByTestId('exec-qty-0'), '3');
    await userEvent.click(screen.getByTestId('exec-go'));
    await waitFor(() => expect(within(screen.getByTestId('disposal-row')).getByText('끝남')).toBeInTheDocument());
  });
});

describe('리콜', () => {
  it('본사 승인 번호 없이는 못 보내고, 상세는 센터별 보류·출발 물량', async () => {
    renderAt('/c/CDC01/inventory?tab=quality&qv=recalls');
    await userEvent.click(await screen.findByTestId('recall-row'));
    const detail = await screen.findByTestId('recall-detail');
    expect(within(detail).getByText('QH-0002')).toBeInTheDocument();
    expect(within(detail).getByText('MFC-BJG-01')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('recall-new'));
    await userEvent.type(screen.getByTestId('recall-sku'), 'SKU-1001');
    await userEvent.type(screen.getByTestId('recall-lots'), 'LOT-A1, LOT-A2');
    expect(screen.getByTestId('recall-go')).toBeDisabled();
    await userEvent.type(screen.getByTestId('recall-approval'), 'HQ-1');
    await userEvent.click(screen.getByTestId('recall-go'));
    expect(await screen.findByText(/리콜 RC-\d+ 를 발령했어요/)).toBeInTheDocument();
  });
});
