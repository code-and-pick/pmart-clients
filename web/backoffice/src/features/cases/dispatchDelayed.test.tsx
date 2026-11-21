// 배차 지연 접수 건(case 0.27.0 R-9) + 배차 불가로 취소(claim 0.7.0 CL-5) — 2026-11-19 백엔드 요청
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('배차 지연 접수 건', () => {
  it('상담원 팀 종류 — 상담원 사건함 종류 거르기에 "배차 지연"이 있고 그 건이 보인다', async () => {
    renderAt('/cases?tab=all', as.cs);
    const rows = await screen.findAllByTestId('case-row');
    expect(rows.some((r) => r.textContent?.includes('배차 지연'))).toBe(true);
    expect(screen.getByRole('option', { name: '배차 지연' })).toBeInTheDocument();
  });

  it('지원센터(라이더 운영)에게는 보이지 않는다', async () => {
    renderAt('/cases?tab=all', as.riderOps);
    const rows = await screen.findAllByTestId('case-row');
    expect(rows.some((r) => r.textContent?.includes('배차 지연'))).toBe(false);
  });

  it('배차 불가로 취소: 확인 상자를 거쳐 주문 전체·DISPATCH_UNAVAILABLE·본인 확인 없이·접수 건 연결로 보내고, 서버가 준 클레임 상태만 보인다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/cases/CASE-MOCK-R9', as.cs);
    const box = await screen.findByTestId('dispatch-cancel');
    await waitFor(() => expect(within(box).getByTestId('dispatch-cancel-open')).toBeEnabled());
    // 그만두면 아무것도 보내지 않는다
    await user.click(within(box).getByTestId('dispatch-cancel-open'));
    await user.click(within(screen.getByTestId('dispatch-cancel-confirm')).getByRole('button', { name: '그만두기' }));
    expect(screen.queryByTestId('dispatch-cancel-confirm')).not.toBeInTheDocument();
    expect(view.mutations('/claims')).toHaveLength(0);
    // 확인하면 보낸다 — 확인 상자에 보상 쿠폰 안내(ADR-0082 5단계)
    await user.click(within(box).getByTestId('dispatch-cancel-open'));
    expect(screen.getByTestId('dispatch-cancel-confirm')).toHaveTextContent('2,000원 쿠폰(받은 날 포함 30일, 최소 주문 없음)');
    await user.click(within(screen.getByTestId('dispatch-cancel-confirm')).getByRole('button', { name: '취소하고 전액 환불' }));
    await waitFor(() => expect(view.mutations('/claims')).toHaveLength(1));
    const body = (await view.mutations('/claims')[0]!.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ orderId: 'ORD-MOCK-1005', type: 'CANCEL', reason: 'DISPATCH_UNAVAILABLE', channel: 'CS', caseRef: 'CASE-MOCK-R9' });
    expect(body).not.toHaveProperty('identityCheck');
    expect(await screen.findByTestId('dispatch-cancel-done')).toHaveTextContent('취소를 접수했어요');
    expect(view.mutations('/claims')[0]!.headers.get('Idempotency-Key')).toBeTruthy();
  });
});
