// 지급 관리·소명·이의(2026-11-19, PC 5) — 목(MSW) 기준. 실서버 확인은 아니다.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

const posts = (sent: readonly Request[], part: string) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.includes(part));

describe('지급 관리', () => {
  it('관리자: 묶음을 보고 지급 완료로 표시한다(멱등 키)', async () => {
    const view = renderAt('/payouts', as.admin);
    const rows = await screen.findAllByTestId('payout-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('확정(지급 전)');
    expect(rows[0]).toHaveTextContent('10,500');
    const form = within(rows[0]!).getByRole('form', { name: /지급 결과 표시 RD-7/ });
    await userEvent.selectOptions(within(form).getByLabelText('결과'), 'PAID');
    await userEvent.click(within(form).getByRole('button', { name: '표시' }));
    // 표시가 끝나면 줄이 지급 완료로 바뀌어 입력 칸이 없어진다 — 결과는 위 알림에 남는다
    expect(await screen.findByTestId('payout-done')).toHaveTextContent('482913 · 2026-11-19 묶음을 지급 완료(으)로 표시했어요.');
    expect(await within(screen.getAllByTestId('payout-row')[0]!).findByText('지급 완료')).toBeInTheDocument();
    const req = posts(view.sent, '/rider-payouts/RD-7/2026-11-19/results')[0]!;
    expect(req.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await req.clone().json()).toEqual({ result: 'PAID' });
  });

  it('지급 실패는 사유가 있어야 표시할 수 있다', async () => {
    renderAt('/payouts', as.admin);
    const rows = await screen.findAllByTestId('payout-row');
    const form = within(rows[1]!).getByRole('form', { name: /RD-8/ });
    await userEvent.selectOptions(within(form).getByLabelText('결과'), 'FAILED');
    expect(within(form).getByRole('button', { name: '표시' })).toBeDisabled();
    await userEvent.type(within(form).getByLabelText(/실패 사유/), '은행 점검');
    await userEvent.click(within(form).getByRole('button', { name: '표시' }));
    expect(await screen.findByTestId('payout-done')).toHaveTextContent('지급 실패(으)로 표시했어요.');
  });

  it('예정일 전이면 서버 거절(PAYOUT_NOT_DUE)을 그대로 알린다', async () => {
    renderAt('/payouts?payoutDate=2026-11-21', as.admin);
    const row = (await screen.findAllByTestId('payout-row'))[0]!;
    const form = within(row).getByRole('form');
    await userEvent.selectOptions(within(form).getByLabelText('결과'), 'PAYING');
    await userEvent.click(within(form).getByRole('button', { name: '표시' }));
    expect(await within(form).findByText(/지급 예정일이 아직 안 됐어요/)).toBeInTheDocument();
  });

  it('라이더 운영은 보기만(결과 표시는 관리자)', async () => {
    renderAt('/payouts', as.riderOps);
    const rows = await screen.findAllByTestId('payout-row');
    expect(within(rows[0]!).queryByRole('form')).not.toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('관리자만 표시할 수 있어요');
  });
});

describe('소명·이의', () => {
  it('제한 소명을 인정하면 결정 메모와 함께 보낸다', async () => {
    const view = renderAt('/appeals', as.riderOps);
    const rows = await screen.findAllByTestId('appeal-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('계정 제한 소명');
    expect(rows[0]).toHaveTextContent('일시 중지');
    const form = within(rows[0]!).getByRole('form');
    expect(within(form).getByRole('button', { name: '인정' })).toBeDisabled();
    await userEvent.type(within(form).getByLabelText(/결정 메모/), '포장 불량 사진 확인 — 제한 풀어요');
    await userEvent.click(within(form).getByRole('button', { name: '인정' }));
    // 결정하면 "결정 대기" 목록에서 빠진다 — 결과는 위 알림에(제한 소명이면 조정 버튼 없음)
    expect(await screen.findByTestId('appeal-done')).toHaveTextContent('계정 제한 소명(730115)을 인정(으)로 결정했어요.');
    expect(screen.queryByTestId('to-adjustment')).not.toBeInTheDocument();
    expect(await screen.findAllByTestId('appeal-row')).toHaveLength(1);
    expect(await posts(view.sent, '/rider-appeals/AP-1/decisions')[0]!.clone().json()).toEqual({ decision: 'ACCEPTED', note: '포장 불량 사진 확인 — 제한 풀어요' });
  });

  it('수행료 이의를 인정하면 그 배송 수행료 조정으로 가는 버튼', async () => {
    renderAt('/appeals', as.riderOps);
    const rows = await screen.findAllByTestId('appeal-row');
    const form = within(rows[1]!).getByRole('form');
    await userEvent.type(within(form).getByLabelText(/결정 메모/), '고장 확인');
    await userEvent.click(within(form).getByRole('button', { name: '인정' }));
    const link = await screen.findByTestId('to-adjustment');
    expect(link).toHaveAttribute('href', '/adjustments?deliveryId=DLV-3');
    await userEvent.click(link);
    // 조정 대기 목록에 없는 배송이면 숨기지 않고 이유를 알린다
    expect(await screen.findByTestId('adjust-only')).toHaveTextContent('DLV-3');
    expect(await screen.findByText(/조정 대기 목록에 없어요/)).toBeInTheDocument();
  });

  it('결정된 신청은 상태로 거르면 메모와 함께 보인다', async () => {
    renderAt('/appeals?state=UPHELD', as.riderOps);
    const row = (await screen.findAllByTestId('appeal-row'))[0]!;
    expect(within(row).getByTestId('appeal-decided')).toHaveTextContent('경로 확인 결과 정상 산정이에요.');
  });
});
