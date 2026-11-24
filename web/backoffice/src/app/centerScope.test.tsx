// 머리줄 센터 고르기(2026-11-23 — PC 1 요청서 backoffice/2026-11-23-request-center-filter) — 보기만 거른다
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';
import { centerScopeOf } from '../shared/centerScope';

const calls = (sent: readonly Request[], path: string) => sent.filter((r) => r.method === 'GET' && new URL(r.url).pathname.endsWith(path)).map((r) => new URL(r.url).searchParams);

describe('센터 고르기', () => {
  it('고를 수 있는 것은 "전체 센터"와 운영 중 MFC 만(CDC·준비 중 센터는 빠짐)', async () => {
    renderAt('/orders', as.admin);
    const pick = await screen.findByRole('combobox', { name: '보는 센터' });
    await waitFor(() => expect([...(pick as HTMLSelectElement).options].map((o) => o.text)).toEqual(['전체 센터', '부산진구 MFC', '목포 MFC']));
  });

  it('고르면 주문 조회가 mfcId 로 묻고, 화면을 옮겨도 그대로 — 배송·배차 확인도 mfcId', async () => {
    const user = userEvent.setup();
    const view = renderAt('/orders', as.admin);
    const pick = await screen.findByRole('combobox', { name: '보는 센터' });
    await waitFor(() => expect((pick as HTMLSelectElement).options.length).toBe(3));
    await user.selectOptions(pick, 'MFC-MOKPO-01');
    await waitFor(() => expect(calls(view.sent, '/orders/lookups').at(-1)?.get('mfcId')).toBe('MFC-MOKPO-01'));
    expect(screen.queryByTestId('center-scope-note')).not.toBeInTheDocument(); // 거를 수 있는 화면은 알림 없음
    await user.click(screen.getByRole('link', { name: '배송·배차 확인' }));
    expect(await screen.findByRole('combobox', { name: '보는 센터' })).toHaveValue('MFC-MOKPO-01');
    await waitFor(() => expect(calls(view.sent, '/deliveries/counts').at(-1)?.get('mfcId')).toBe('MFC-MOKPO-01'));
  });

  it('고객 문의는 centerId 로 거르고(case 0.40.0), 센터 없는 문의는 늘 함께 "센터 없음" — 알림 없음(2026-11-24 사용자 결정 b)', async () => {
    const user = userEvent.setup();
    const view = renderAt('/inquiries', as.admin);
    const pick = await screen.findByRole('combobox', { name: '보는 센터' });
    await waitFor(() => expect((pick as HTMLSelectElement).options.length).toBe(3));
    await user.selectOptions(pick, 'MFC-MOKPO-01');
    await waitFor(() => expect(calls(view.sent, '/inquiries').at(-1)?.get('centerId')).toBe('MFC-MOKPO-01'));
    expect(screen.queryByTestId('center-scope-note')).not.toBeInTheDocument();
    // 목 고객 문의는 모두 부산진구 주문이거나 주문 없음 → 목포를 고르면 주문 없는 문의만 "센터 없음"으로 남는다
    const rows = await screen.findAllByTestId('inquiry-row');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(within(row).getByTestId('inquiry-no-center')).toBeInTheDocument();
  });

  it('센터 적용표: 통합 조회는 아직 못 거름(알림), 고객·라이더 문의는 거름', () => {
    expect(centerScopeOf('/lookup')).toBe('notApplied');
    expect(centerScopeOf('/inquiries')).toBe('applied');
    expect(centerScopeOf('/rider-inquiries')).toBe('applied');
  });

  it('접수 건은 case-inbox centerId, 대시보드는 "일부 칸만" 알림', async () => {
    sessionStorage.setItem('pmart.backoffice.centerScope', 'MFC-BSN-01');
    const view = renderAt('/cases', as.admin);
    await waitFor(() => expect(calls(view.sent, '/views/case-inbox').at(-1)?.get('centerId')).toBe('MFC-BSN-01'));
    expect(centerScopeOf('/')).toBe('partial');
    expect(centerScopeOf('/products')).toBeNull(); // 상품은 센터별이 아님 — 알리지 않는다
    expect(centerScopeOf('/cases/handovers')).toBe('notApplied');
  });

  it('클레임(bff centerId·claim counts mfcId)·라이더 컴플레인·CS 후속·처리 대기도 고른 센터로 — 알림 없음(2026-11-23 CL-8·R-12·BF-4)', async () => {
    sessionStorage.setItem('pmart.backoffice.centerScope', 'MFC-MOKPO-01');
    const view = renderAt('/claims', as.admin);
    await waitFor(() => expect(calls(view.sent, '/views/claims').at(-1)?.get('centerId')).toBe('MFC-MOKPO-01'));
    await waitFor(() => expect(calls(view.sent, '/claims/counts').at(-1)?.get('mfcId')).toBe('MFC-MOKPO-01'));
    expect(screen.queryByTestId('center-scope-note')).not.toBeInTheDocument();
    for (const p of ['/rider-complaints', '/follow-ups/cs', '/pending']) expect(centerScopeOf(p)).toBe('applied');
  });

  it('bff 0.24.0 centerUnfilteredSources: 센터를 골라도 못 거른 원천(멈춘 주문 처리·사건 지표)은 "모든 센터" 꼬리 — 안 고르면 없음', async () => {
    const view = renderAt('/pending', as.admin);
    await screen.findAllByTestId('pending-item');
    expect(screen.queryByTestId('all-centers-tag')).not.toBeInTheDocument();
    view.unmount();
    sessionStorage.setItem('pmart.backoffice.centerScope', 'MFC-BSN-01');
    const v2 = renderAt('/pending', as.admin);
    const stuck = await screen.findByRole('region', { name: '멈춘 주문 처리' });
    expect(within(stuck).getByTestId('all-centers-tag')).toHaveTextContent('모든 센터');
    v2.unmount();
    renderAt('/?tab=ops', as.admin);
    expect(await within(await screen.findByTestId('dash-risk-payment')).findByTestId('all-centers-tag')).toBeInTheDocument();
    expect(within(screen.getByTestId('dash-risk-issue')).queryByTestId('all-centers-tag')).not.toBeInTheDocument(); // 이행 확인은 센터로 거름
    expect(await within(await screen.findByTestId('dash-work-cases-open')).findByTestId('all-centers-tag')).toBeInTheDocument(); // 사건 지표는 범위 밖
  });
});
