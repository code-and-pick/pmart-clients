// 작업 따라 해 보기(2026-11-18)에서 찾은 것: 첫 화면 "내 할 일", 할 일 → 그 일만 걸러 둔 목록, 줄 전체 누르기, 답한 뒤 다음 문의.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('내 할 일(첫 화면)', () => {
  it('상담원: 통계(한눈에 카드)가 위, 내 할 일은 그 아래(사용자 2026-11-18) — 답변 대기 문의를 누르면 "접수" 탭이 골라진 목록', async () => {
    const user = userEvent.setup();
    renderAt('/', as.cs);
    const work = await screen.findByTestId('dash-my-work');
    expect(within(work).getByRole('heading', { name: '오늘의 할 일' })).toBeInTheDocument();
    // 숫자 띠(2026-11-19 사용자가 보여 준 관제 화면 — 탭과 상관없이 맨 위): 내 할 일 띠가 오늘 주문 카드보다 앞
    const orders = screen.queryByTestId('dash-kpi-orders');
    if (orders) expect(orders.compareDocumentPosition(work) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    // 상담원은 접수 건을 맡지 않으므로 접수 건 할 일은 없다
    expect(within(work).queryByTestId('dash-kpi-casesOverdue')).not.toBeInTheDocument();
    await user.click(within(work).getByTestId('dash-kpi-inquiries'));
    expect(await screen.findByRole('radio', { name: '접수', checked: true })).toBeInTheDocument();
  });

  it('지원센터: 기한 넘김 → 아무도 안 맡음 순서, 개수는 서버 조회 그대로', async () => {
    renderAt('/', as.riderOps);
    const work = await screen.findByTestId('dash-my-work');
    const ids = [...work.querySelectorAll('[data-testid^="dash-kpi-"]')].map((e) => e.getAttribute('data-testid'));
    expect(ids.slice(0, 2)).toEqual(['dash-kpi-casesOverdue', 'dash-kpi-casesUnassigned']);
    expect(await within(screen.getByTestId('dash-kpi-casesOverdue')).findByText('1')).toBeInTheDocument();
  });
});

describe('목록 줄 전체 누르기', () => {
  it('승인함: 줄(굵은 요약)을 누르면 바로 승인 상세(미리보기 없음 — 2026-11-20 "터치 2번")', async () => {
    const user = userEvent.setup();
    renderAt('/approvals?view=all', as.admin);
    const row = (await screen.findAllByTestId('approval-row')).find((r) => r.textContent?.includes('기본가 변경 1건'))!;
    await user.click(within(row).getByText('기본가 변경 1건'));
    expect(await screen.findByTestId('next-action')).toBeInTheDocument(); // 승인 상세의 다음 할 일
  });
});

describe('가격 화면 — 무엇의 가격인지', () => {
  it('SKU 로 열면 서랍 바꾸기 줄에 상품 이름, 아래 단추는 그 상품의 가격 탭(2026-11-20 가격 흐름)', async () => {
    renderAt('/prices?sku=E-00000001', as.md);
    const row = await screen.findByTestId('price-form-row');
    await waitFor(() => expect(row).toHaveTextContent('사과 1.5kg'));
    expect(await screen.findByRole('link', { name: '상품 가격 탭' })).toHaveAttribute('href', '/products/P-00000001?tab=price');
  });
});

describe('접수 건 상세 — 기록은 탭 하나로', () => {
  it('메모·행위 요청·고객 연락 기록·이력 탭, 처음은 메모, 누르면 그 탭', async () => {
    const user = userEvent.setup();
    renderAt('/cases/CASE-MOCK-1', as.admin);
    const tabs = await screen.findByTestId('case-record-tabs');
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['메모', '행위 요청', '고객 연락 기록', '이력']);
    expect(within(tabs).getByRole('tab', { name: '메모' })).toHaveAttribute('aria-selected', 'true');
    await user.click(within(tabs).getByRole('tab', { name: '이력' }));
    expect(within(tabs).getByRole('tab', { name: '이력' })).toHaveAttribute('aria-selected', 'true');
  });
});
