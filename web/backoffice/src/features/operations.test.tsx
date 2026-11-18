import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { db } from '../mocks/db';
import { as, renderAt } from '../test/render';

describe('판매 상태', () => {
  it('판매중지를 승인 없이 보내면 APPROVAL_REQUIRED 를 보여 주고 상태는 그대로다', async () => {
    const user = userEvent.setup();
    renderAt('/products/P-00000001');
    await screen.findByTestId('sale-state');
    await user.selectOptions(screen.getByLabelText('판매 상태'), 'SALE_STOPPED');
    await user.type(screen.getByLabelText('사유'), '품질 이슈');
    await user.click(screen.getByRole('button', { name: '변경 요청' }));

    expect(await screen.findByRole('alert')).toHaveAttribute('data-code', 'APPROVAL_REQUIRED');
    expect(screen.getByTestId('sale-state')).toHaveTextContent('판매중');
    expect(db.products.get('P-00000001')?.saleState).toBe('ON_SALE');
  });

  it('일시품절은 바로 반영되고 X-Expected-Version 을 보낸다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/products/P-00000001');
    await screen.findByTestId('sale-state');
    await user.type(screen.getByLabelText('사유'), '입고 지연');
    await user.click(screen.getByRole('button', { name: '변경 요청' }));

    expect(await screen.findByText('판매 상태가 바뀌었어요.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('sale-state')).toHaveTextContent('일시품절'));
    expect(view.mutations('/sale-state-changes')[0]?.headers.get('X-Expected-Version')).toBe('1');
    view.stop();
  });

  it('OPERATOR_ADMIN 은 상품을 보지만 판매 상태 변경은 없다 — "MD 만 바꿀 수 있습니다"', async () => {
    renderAt('/products/P-00000001', as.admin);
    await screen.findByTestId('sale-state');
    expect(screen.getByText('판매 상태는 MD 만 바꿀 수 있습니다.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '변경 요청' })).not.toBeInTheDocument();
  });
});

describe('가격', () => {
  it('가격 미설정은 0원이 아니라 미설정(판매 불가)으로 보인다', async () => {
    renderAt('/prices?sku=E-00000002');
    expect(await screen.findByText('가격 미설정(판매 불가). 0원이 아니에요.')).toBeInTheDocument();
    expect(screen.queryByText('0원')).not.toBeInTheDocument();
  });

  it('현재 기본가는 서버 값을 그대로 표시한다', async () => {
    renderAt('/prices?sku=E-00000001');
    expect(await screen.findByTestId('base-price')).toHaveTextContent('4,500원');
  });
});

describe('센터 취급', () => {
  it('레코드가 없으면 OFF 이고, 켜기는 version 0 을 기대 버전으로 보낸다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/handlings?type=MFC&center=MFC-BSN-01', as.center);
    expect(await screen.findByTestId('handling-E-00000001')).toHaveTextContent('OFF');

    await user.click(screen.getAllByRole('button', { name: '켜기' })[0]!);
    await waitFor(() => expect(screen.getByTestId('handling-E-00000001')).toHaveTextContent('ON'));
    expect(view.mutations('/sku-handlings')[0]?.headers.get('X-Expected-Version')).toBe('0');
    view.stop();
  });

  it('자기 센터가 아니면 FORBIDDEN 화면이다(빈 목록이 아님)', async () => {
    renderAt('/handlings?type=MFC&center=MFC-OTHER-01', as.center);
    expect(await screen.findByText('이용할 수 없는 화면이에요')).toBeInTheDocument();
    expect(screen.queryByText('표시할 내용이 없어요')).not.toBeInTheDocument();
  });
});



describe('이동', () => {
  // 2026-11-18: 홈 = 대시보드(예전엔 역할 첫 메뉴로 바로 갔다)
  it('상단 PMart 로고를 누르면 대시보드 — 승인자는 심사 대기 승인 카드, 주문 카드는 없다', async () => {
    const user = userEvent.setup();
    renderAt('/prices', as.approver);
    await user.click(screen.getByRole('link', { name: 'PMart 백오피스 홈으로' }));
    expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('dash-kpi-approvals')).toBeInTheDocument();
    expect(screen.queryByTestId('dash-kpi-orders')).not.toBeInTheDocument();
  });

  it('상품 상세의 "콘텐츠·이미지 등록"은 상품 ID 를 채운 콘텐츠 등록으로 가고 이미지 안내를 보인다', async () => {
    const user = userEvent.setup();
    renderAt('/products/P-00000001');
    await user.click(await screen.findByRole('link', { name: '콘텐츠·이미지 등록' }));

    expect(await screen.findByRole('heading', { name: '콘텐츠 등록(개별)' })).toBeInTheDocument();
    expect(screen.getByLabelText('상품 ID(승인된 상품)')).toHaveValue('P-00000001');
    expect(screen.getByText(/초안과 함께 올라가요/)).toBeInTheDocument();
    expect(screen.getByLabelText('대표 이미지 추가')).toBeInTheDocument();
  });
});
