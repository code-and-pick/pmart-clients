// 고객 메뉴(2026-11-20, bff 0.22.0 BF-2) — 찾기는 하나만·완전 일치, 상세 칸 실패는 "확인 못 함", 원문은 사유 → 열람 기록 뒤.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { filterBy } from '../../test/filter';
import { as, renderAt } from '../../test/render';

const searchCalls = (sent: readonly Request[]) => sent.map((r) => new URL(r.url)).filter((u) => u.pathname.endsWith('/views/customer-search'));

describe('고객 찾기', () => {
  it('전화번호로 찾으면 그 조건 하나만 보내고(하이픈 뺌), 가린 이름·연락처 줄 → 상세 링크', async () => {
    const user = userEvent.setup();
    const view = renderAt('/customers', as.cs);
    await filterBy(user, '전화번호', '010-1234-5678');
    const row = await screen.findByTestId('customer-row');
    expect(row).toHaveTextContent('김*객');
    expect(row).toHaveTextContent('010-****-5678');
    expect(within(row).getByRole('link', { name: '482913' })).toHaveAttribute('href', '/customers/CUS-1001');
    const q = searchCalls(view.sent).at(-1)!.searchParams;
    expect([q.get('phone'), q.get('customerNumber'), q.get('orderNumber')]).toEqual(['01012345678', null, null]);
  });

  it('다른 조건을 고르면 앞 조건은 지운다(하나만 — 둘이면 서버 400)', async () => {
    const user = userEvent.setup();
    const view = renderAt('/customers?customerNumber=482913', as.cs);
    await screen.findByTestId('customer-row');
    await filterBy(user, '주문번호', '74939005');
    await waitFor(() => expect(screen.getByTestId('customer-row')).toHaveTextContent('517204'));
    const q = searchCalls(view.sent).at(-1)!.searchParams;
    expect([q.get('orderNumber'), q.get('customerNumber')]).toEqual(['74939005', null]);
    expect(screen.getAllByTestId('filter-chip')).toHaveLength(1);
  });

  it('맞는 고객이 없으면 "없어요" — 조건이 없으면 부르지 않는다', async () => {
    const view = renderAt('/customers', as.cs);
    await screen.findByRole('combobox', { name: '속성으로 거르기' });
    expect(searchCalls(view.sent)).toHaveLength(0);
    view.unmount();
    renderAt('/customers?customerNumber=999999', as.cs);
    expect(await screen.findByTestId('customer-empty')).toHaveTextContent('맞는 고객이 없어요');
  });
});

describe('고객 상세', () => {
  it('머리·기본 정보는 가린 값, 주문·문의·상담원 접수 칸 → 각 상세', async () => {
    renderAt('/customers/CUS-1001', as.cs);
    const d = await screen.findByTestId('customer-detail');
    expect(within(d).getByRole('heading', { level: 1 })).toHaveTextContent('김*객 · 482913');
    expect(screen.getByTestId('customer-name')).toHaveAttribute('data-masked', 'true');
    expect(within(screen.getByTestId('customer-orders')).getByRole('link', { name: '74939001' })).toHaveAttribute('href', '/orders/ORD-MOCK-1001'); // 목 주문과 이어진다
    expect(within(screen.getByTestId('customer-inquiries')).getByRole('link', { name: '30418' })).toHaveAttribute('href', '/inquiries/INQ-MOCK-3');
    expect(within(screen.getByTestId('customer-intakes')).getByText('[목] 상담원')).toBeInTheDocument();
  });

  it('원천을 못 읽은 칸은 "확인 못 함" — 0건으로 보이지 않는다', async () => {
    renderAt('/customers/CUS-1005', as.cs);
    expect(await screen.findByTestId('customer-intakes-failed')).toHaveTextContent('확인 못 함');
  });

  it('원문 열람: 사유 2자 이상이어야 누를 수 있고, 열면 고른 항목만 원문 + 열람 기록, 다시 가리기', async () => {
    const user = userEvent.setup();
    const view = renderAt('/customers/CUS-1001', as.admin);
    const form = await screen.findByRole('form', { name: '원문 열람' });
    const open = within(form).getByRole('button', { name: '열람' });
    expect(open).toBeDisabled();
    await user.click(within(form).getByRole('checkbox', { name: '연락처' })); // 이름만
    await user.type(within(form).getByLabelText('열람 사유'), '고객 전화 본인 확인');
    await user.click(open);
    await waitFor(() => expect(screen.getByTestId('customer-name')).toHaveTextContent('김고객'));
    expect(screen.getByTestId('customer-phone')).toHaveAttribute('data-masked', 'true');
    const post = view.sent.find((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/customers/CUS-1001/pii-reveals'))!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await post.clone().json()).toEqual({ reason: '고객 전화 본인 확인', fields: ['NAME'] });
    await user.click(screen.getByRole('button', { name: '다시 가리기' }));
    expect(screen.getByTestId('customer-name')).toHaveAttribute('data-masked', 'true');
  });
});
