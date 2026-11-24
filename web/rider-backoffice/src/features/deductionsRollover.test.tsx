// 오배송 차감(execution 0.41.0)·지급 실패 자동 넘김(0.42.0) — 2026-11-24, PC 5. 목(MSW) 기준이고 실서버 확인은 아니다.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

const posts = (sent: readonly Request[], part: string) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.includes(part));

describe('오배송 차감', () => {
  it('기본은 이의 결정 대기 — 라이더 이의 글이 보이고, 받아들이면 메모와 함께 보낸다(멱등 키)', async () => {
    const view = renderAt('/deductions', as.riderOps);
    const rows = await screen.findAllByTestId('deduction-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('이의 결정 대기');
    expect(within(rows[0]!).getByTestId('deduction-amount')).toHaveTextContent('18,900');
    expect(within(rows[0]!).getByTestId('deduction-objection')).toHaveTextContent('동 호수를 잘못');
    expect(within(rows[0]!).getByTestId('deduction-case-link')).toHaveAttribute('href', '/consults/cases/CASE-LS-1');
    const accept = within(rows[0]!).getByRole('button', { name: '이의 받아들임' });
    expect(accept).toBeDisabled(); // 메모 2자 이상
    await userEvent.type(within(rows[0]!).getByLabelText(/결정 메모/), '고객 주소 오기 확인');
    await userEvent.click(accept);
    // 결정한 건은 "결정 대기" 목록에서 빠지고, 결과는 위 알림에 남는다
    expect(await screen.findByTestId('deduction-done')).toHaveTextContent('−18,900원 차감을 취소(으)로 결정했어요.');
    const req = posts(view.sent, '/rider-deductions/DED-1/decisions')[0]!;
    expect(req.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await req.clone().json()).toEqual({ decision: 'ACCEPT', note: '고객 주소 오기 확인' });
  });

  it('전체: 이의 기간은 기한을, 확정은 남은 금액과 정산에서 뺀 기록을, 취소는 결정 메모를 보인다', async () => {
    renderAt('/deductions?state=ALL', as.riderOps);
    const rows = await screen.findAllByTestId('deduction-row');
    expect(rows).toHaveLength(4);
    const pending = rows.find((r) => r.textContent?.includes('이의 기간'))!;
    expect(within(pending).getByTestId('deduction-action')).toHaveTextContent('이의를 기다려요');
    const confirmed = rows.find((r) => r.textContent?.includes('확정') && r.querySelector('[data-testid="deduction-remaining"]'))!;
    expect(within(confirmed).getByTestId('deduction-remaining')).toHaveTextContent('12,000');
    expect(within(confirmed).getByTestId('deduction-applied')).toHaveTextContent('11/19 지급 −3,500');
    const cancelled = rows.find((r) => r.textContent?.includes('이의 받아들임(차감 취소)'))!;
    expect(cancelled).toHaveTextContent('라이더 귀책 아님');
  });

  it('상담원은 보기만(결정은 라이더 운영·관리자)', async () => {
    renderAt('/deductions', as.cs);
    const row = (await screen.findAllByTestId('deduction-row'))[0]!;
    expect(within(row).queryByRole('button', { name: '이의 받아들임' })).toBeNull();
    expect(row).toHaveTextContent('라이더 운영·관리자만 결정할 수 있어요');
  });

  it('메뉴 옆 숫자 = 결정 대기 이의 수', async () => {
    renderAt('/dashboard', as.riderOps);
    expect(await screen.findByTestId('menu-badge-deductions')).toHaveTextContent('1');
  });
});

describe('지급 실패 자동 넘김', () => {
  it('넘어온 묶음은 "실패분 n", 차감이 있는 묶음은 차감·지급할 금액', async () => {
    renderAt('/payouts?payoutDate=2026-11-24', as.admin);
    const row = (await screen.findAllByTestId('payout-row'))[0]!;
    expect(within(row).getByTestId('payout-rolled-in')).toHaveTextContent('실패분 1');
  });

  it('차감이 있는 묶음은 차감·지급할 금액(서버 netTotal)', async () => {
    renderAt('/payouts?payoutDate=2026-11-21', as.admin);
    const rows = await screen.findAllByTestId('payout-row');
    const ded = rows.map((r) => r.querySelector('[data-testid="payout-deduction"]')).find(Boolean)!;
    expect(ded).toHaveTextContent('오배송 차감 −3,500');
    expect(ded.parentElement).toHaveTextContent('지급 0');
  });

  it('넘김 기록: 실패한 날 → 다시 지급할 날·사유', async () => {
    renderAt('/payouts', as.riderOps);
    const box = await screen.findByTestId('payout-rollovers');
    const r = (await within(box).findAllByTestId('rollover-row'))[0]!;
    expect(r).toHaveTextContent('2026-11-21');
    expect(r).toHaveTextContent('계좌 오류');
    expect(within(r).getByRole('link', { name: '2026-11-24' })).toHaveAttribute('href', '/payouts?payoutDate=2026-11-24');
  });

  it('지급 실패로 표시하면 다음 지급일로 넘긴 날을 알린다', async () => {
    renderAt('/payouts', as.admin);
    const rows = await screen.findAllByTestId('payout-row');
    const form = within(rows[1]!).getByRole('form', { name: /RD-8/ });
    await userEvent.selectOptions(within(form).getByLabelText('결과'), 'FAILED');
    await userEvent.type(within(form).getByLabelText(/실패 사유/), '은행 점검');
    await userEvent.click(within(form).getByRole('button', { name: '표시' }));
    expect(await screen.findByTestId('payout-done')).toHaveTextContent('실패한 줄은 2026-11-20로 넘겼어요.');
  });
});

describe('넘김 상한 3번·직접 차감(execution 0.43.0)', () => {
  it('상한을 다 쓴 묶음은 날짜와 상관없이 맨 위 "직접 지급" 경고, 묶음 줄에 꼬리표', async () => {
    renderAt('/payouts?payoutDate=2026-11-12', as.admin);
    const banner = await screen.findByTestId('payout-escalated-banner');
    expect(banner).toHaveTextContent('직접 지급해야 할 묶음 1건 — 자동 넘김 3번을 다 썼어요');
    expect(banner).toHaveTextContent('11/12');
    const row = (await screen.findAllByTestId('payout-row'))[0]!;
    expect(within(row).getByTestId('payout-escalated')).toHaveTextContent('직접 지급');
  });

  it('넘김 기록에 몇 번째 넘김인지, 마지막 자동 시도 표시', async () => {
    renderAt('/payouts', as.riderOps);
    const rows = await within(await screen.findByTestId('payout-rollovers')).findAllByTestId('rollover-count');
    expect(rows.map((r) => r.textContent)).toEqual(['1번째', '3번째마지막']);
  });

  it('직접 차감: 사유·사건 번호를 적어 만들면(멱등 키) 위에 결과, 이미 있으면 서버 문구', async () => {
    const view = renderAt('/deductions', as.riderOps);
    await userEvent.click(await screen.findByTestId('deduction-create-toggle'));
    const form = await screen.findByTestId('deduction-create');
    const submit = within(form).getByRole('button', { name: '차감 만들기' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(form).getByLabelText(/배송 번호/), 'DLV-9');
    await userEvent.type(within(form).getByLabelText('오배송 사건 번호'), 'CASE-LS-1');
    await userEvent.type(within(form).getByLabelText(/차감 사유/), '회수품 폐기');
    await userEvent.click(submit);
    expect(await screen.findByTestId('deduction-done')).toHaveTextContent('직접 차감 −12,000원 을 만들었어요.');
    const req = posts(view.sent, '/rider-deductions').find((r) => new URL(r.url).pathname.endsWith('/rider-deductions'))!;
    expect(req.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await req.clone().json()).toEqual({ deliveryId: 'DLV-9', caseId: 'CASE-LS-1', reason: '회수품 폐기' });

    // 같은 배송·사건으로 또 만들면 409 DEDUCTION_EXISTS
    await userEvent.click(screen.getByTestId('deduction-create-toggle'));
    const again = await screen.findByTestId('deduction-create');
    await userEvent.type(within(again).getByLabelText(/배송 번호/), 'DLV-9');
    await userEvent.type(within(again).getByLabelText('오배송 사건 번호'), 'CASE-LS-1');
    await userEvent.type(within(again).getByLabelText(/차감 사유/), '다시');
    await userEvent.click(within(again).getByRole('button', { name: '차감 만들기' }));
    expect(await within(again).findByText(/이미 차감이 있어요/)).toBeInTheDocument();
  });

  it('직접 만든 차감은 꼬리표와 사유·만든 직원', async () => {
    renderAt('/deductions?state=CONFIRMED', as.riderOps);
    const row = (await screen.findAllByTestId('deduction-row'))[0]!;
    expect(within(row).getByTestId('deduction-manual')).toHaveTextContent('직접 차감');
    expect(within(row).getByTestId('deduction-reason')).toHaveTextContent('회수품이 상해 폐기');
  });

  it('상담원에게는 직접 차감 단추가 없다', async () => {
    renderAt('/deductions', as.cs);
    await screen.findAllByTestId('deduction-row');
    expect(screen.queryByTestId('deduction-create-toggle')).toBeNull();
  });
});
