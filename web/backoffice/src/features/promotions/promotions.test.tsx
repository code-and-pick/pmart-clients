// 행사·쿠폰(promotion 0.2.0, ADR-0082 — 사용자 결정 2026-11-20)
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

/** datetime-local(서울) 값 — 지금에서 시간 더하기 */
const local = (hours: number) => {
  const d = new Date(Date.now() + hours * 3_600_000);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(' ', 'T');
};

describe('행사·쿠폰', () => {
  it('목록: 서버 상태·단계·할인·발급 수 그대로, 상담원은 보기만(만들기 단추 없음)', async () => {
    renderAt('/promotions', as.cs);
    const rows = await screen.findAllByTestId('promotion-row');
    expect(rows).toHaveLength(2);
    const coupon = rows.find((r) => r.textContent?.includes('첫 주문 3천원 쿠폰'))!;
    expect(coupon).toHaveTextContent('승인됨');
    expect(coupon).toHaveTextContent('진행 중');
    expect(coupon).toHaveTextContent('3,000원');
    expect(coupon).toHaveTextContent('12 / 1,000장 발급 · 4장 사용');
    expect(rows.find((r) => r.textContent?.includes('겨울 과일'))).toHaveTextContent('1곳'); // 서버 problems
    expect(screen.queryByRole('link', { name: '행사 만들기' })).not.toBeInTheDocument();
    expect(screen.getByTestId('promotion-stage-note')).toHaveTextContent('주문 금액');
  });

  it('쿠폰 만들기 → 저장하고 승인 요청(제출 → change-requests PROMOTION) → 만든 본인은 승인 못 하고 다른 마케터가 승인 → 진행 중', async () => {
    const user = userEvent.setup();
    const view = renderAt('/promotions/new', as.marketing);
    const form = await screen.findByRole('form', { name: '행사 만들기' });
    await user.type(within(form).getByLabelText('이름(고객에게 보여요)'), '주말 5천원 쿠폰');
    fireEvent.change(within(form).getByLabelText('시작'), { target: { value: local(-1) } });
    fireEvent.change(within(form).getByLabelText('받기 끝'), { target: { value: local(72) } });
    await user.selectOptions(within(form).getByLabelText('할인 방식'), 'AMOUNT');
    await user.type(within(form).getByLabelText('할인액(원)'), '5000');
    await user.selectOptions(within(form).getByLabelText('받는 방법'), 'ADMIN');
    await user.click(within(form).getByRole('button', { name: '저장하고 승인 요청' }));
    expect(await screen.findByText('승인을 요청했어요. 승인되면 시작 시각부터 고객에게 적용돼요.')).toBeInTheDocument();
    const cr = view.mutations('/change-requests')[0]!;
    const body = (await cr.clone().json()) as { type: string; targetService: string; allowedActions: string[] };
    expect(body).toMatchObject({ type: 'PROMOTION', targetService: 'promotion-service', allowedActions: ['ACTIVATE_PROMOTION'] });
    expect(cr.headers.get('Idempotency-Key')).toBeTruthy();
    const href = screen.getByRole('link', { name: '승인 보기' }).getAttribute('href')!;
    view.unmount();

    // 만든 본인 — 승인 단추 꺼짐(자기 승인 금지)
    const mine = renderAt(href, as.marketing);
    await screen.findByTestId('promotion-line');
    expect(screen.getByTestId('promotion-line')).toHaveTextContent('주말 5천원 쿠폰');
    expect(screen.getByRole('button', { name: '승인' })).toBeDisabled();
    mine.unmount();

    // 다른 마케터가 승인 → 행사 화면에서 승인됨·진행 중
    renderAt(href, as.marketing2);
    await user.click(await screen.findByRole('button', { name: '승인' }));
    await user.click(await screen.findByRole('link', { name: '행사 화면으로' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('승인됨'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('진행 중');
  });

  it('기간 할인에 대상이 없으면 저장은 되고 제출은 422 PROMOTION_INVALID — 고칠 곳을 칸 이름으로, 승인 요청은 보내지 않는다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/promotions/new', as.marketing);
    const form = await screen.findByRole('form', { name: '행사 만들기' });
    await user.click(within(form).getByRole('radio', { name: '기간 할인' }));
    await user.type(within(form).getByLabelText('이름(고객에게 보여요)'), '사과 할인');
    fireEvent.change(within(form).getByLabelText('시작'), { target: { value: local(1) } });
    fireEvent.change(within(form).getByLabelText('끝'), { target: { value: local(48) } });
    await user.type(within(form).getByLabelText('할인율(%)'), '10');
    await user.click(within(form).getByRole('button', { name: '저장하고 승인 요청' }));
    const problems = await screen.findByTestId('promotion-problems');
    expect(problems).toHaveTextContent('대상');
    expect(view.mutations('/change-requests')).toHaveLength(0);
  });

  it('지정 발급(ADMIN 진행 중): 상담원이 고객별 결과 — 한도면 건너뜀', async () => {
    const user = userEvent.setup();
    const view = renderAt('/promotions/PRM-seed-1', as.cs);
    const form = await screen.findByRole('form', { name: '쿠폰 지정 발급' });
    await user.type(within(form).getByLabelText('고객 ID(줄바꿈·쉼표로 나눠 최대 100명)'), 'C-1, C-2');
    await user.type(within(form).getByLabelText('발급 사유(보상 등, 200자까지)'), '배송 지연 보상');
    await user.click(within(form).getByRole('button', { name: '발급하기' }));
    expect(await screen.findByText(/2명 중 2명 발급/)).toBeInTheDocument();
    const body = (await view.mutations('/coupon-grants')[0]!.clone().json()) as { accountIds: string[] };
    expect(body.accountIds).toEqual(['C-1', 'C-2']);
    // 같은 고객 다시 — 1인 1장이라 건너뜀
    await user.clear(within(form).getByLabelText('고객 ID(줄바꿈·쉼표로 나눠 최대 100명)'));
    await user.type(within(form).getByLabelText('고객 ID(줄바꿈·쉼표로 나눠 최대 100명)'), 'C-1');
    await user.click(within(form).getByRole('button', { name: '발급하기' }));
    expect(await screen.findByText('한도라 건너뜀')).toBeInTheDocument();
    // 상담원은 조기 종료 없음(만들기·종료는 MARKETING·OPERATOR_ADMIN)
    expect(screen.queryByRole('form', { name: '조기 종료' })).not.toBeInTheDocument();
  });

  it('조기 종료: 사유 → end-submissions → 승인 요청(END_PROMOTION)', async () => {
    const user = userEvent.setup();
    const view = renderAt('/promotions/PRM-seed-1', as.marketing);
    const form = await screen.findByRole('form', { name: '조기 종료' });
    await user.type(within(form).getByLabelText('종료 사유(200자까지)'), '예산 소진');
    await user.click(within(form).getByRole('button', { name: '조기 종료 승인 요청' }));
    expect(await screen.findByText('조기 종료 승인을 요청했어요.')).toBeInTheDocument();
    const body = (await view.mutations('/change-requests')[0]!.clone().json()) as { allowedActions: string[] };
    expect(body.allowedActions).toEqual(['END_PROMOTION']);
  });

  it('메뉴: 마케팅·관리자·상담원에게 행사·쿠폰 묶음, MD 에게는 없음', async () => {
    const view = renderAt('/promotions', as.marketing);
    await screen.findAllByTestId('promotion-row');
    expect(screen.getAllByRole('link', { name: '행사 만들기' }).length).toBeGreaterThan(0);
    expect(screen.getByTestId('nav-group-marketing')).toBeInTheDocument();
    view.unmount();
    renderAt('/products', as.md);
    await screen.findByTestId('side-menu');
    expect(screen.queryByTestId('nav-group-marketing')).not.toBeInTheDocument();
  });
});
