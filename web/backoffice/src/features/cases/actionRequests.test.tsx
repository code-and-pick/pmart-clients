// 접수 건 행위 요청 기록(case 0.17.0) — 기록만, 대신 실행하지 않음
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('행위 요청 기록', () => {
  it('지원센터: 요청 기록 → 줄 "요청함", 결과 기록(반영됨 + 결과 ID) 뒤에는 결과 버튼이 없다', async () => {
    const view = renderAt('/cases/CASE-MOCK-1', as.riderOps);
    const section = await screen.findByRole('region', { name: '행위 요청' });
    expect(within(section).getByText('기록만 해요 — 실제 실행은 처리 대기·각 메뉴에서')).toBeInTheDocument();
    const form = within(section).getByRole('form', { name: '행위 요청 기록' });
    await userEvent.type(within(form).getByLabelText('대상 서비스'), 'delivery-execution-service');
    await userEvent.type(within(form).getByLabelText('명령'), 'requery');
    await userEvent.type(within(form).getByLabelText('대상 ID(선택)'), 'DLV-MOCK-1');
    await userEvent.click(within(form).getByRole('button', { name: '요청 기록' }));
    const row = await within(section).findByTestId('action-request');
    expect(row).toHaveAttribute('data-state', 'REQUESTED');
    expect(row).toHaveTextContent('원결과 다시 조회');
    expect(await view.mutations('/action-requests')[0]!.json()).toEqual({ actionType: 'REQUERY_RESULT', targetService: 'delivery-execution-service', command: 'requery', targetRef: 'DLV-MOCK-1' });

    await userEvent.click(within(row).getByRole('button', { name: '결과 기록' }));
    const result = within(row).getByRole('form', { name: '결과 기록' });
    await userEvent.type(within(result).getByLabelText('결과 보유 서비스'), 'delivery-execution-service');
    expect(within(result).getByText('결과 보유 서비스와 결과 ID 는 같이 넣어요.')).toBeInTheDocument();
    expect(within(result).getByRole('button', { name: '결과 남기기' })).toBeDisabled();
    await userEvent.type(within(result).getByLabelText('결과 ID'), 'EVT-1');
    await userEvent.click(within(result).getByRole('button', { name: '결과 남기기' }));
    await waitFor(() => expect(within(section).getByTestId('action-request')).toHaveAttribute('data-state', 'APPLIED'));
    expect(within(section).getByTestId('action-request-result')).toHaveTextContent('delivery-execution-service · EVT-1');
    expect(within(section).queryByRole('button', { name: '결과 기록' })).not.toBeInTheDocument();
    const res = view.mutations('/results')[0]!;
    expect(res.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await res.json()).toEqual({ state: 'APPLIED', resultSystem: 'delivery-execution-service', resultRef: 'EVT-1' });
  }, 15_000); // 입력이 많아 혼자 2초 — 전체 실행 때 5초 기본 제한을 넘어 늘림(2026-11-18)

  it('승인된 보상 실행은 승인 번호가 있어야 남긴다', async () => {
    renderAt('/cases/CASE-MOCK-1', as.riderOps);
    const form = await screen.findByRole('form', { name: '행위 요청 기록' });
    await userEvent.selectOptions(within(form).getByLabelText('종류'), '승인된 보상 실행');
    await userEvent.type(within(form).getByLabelText('대상 서비스'), 'payment-service');
    await userEvent.type(within(form).getByLabelText('명령'), 'refund');
    const send = within(form).getByRole('button', { name: '요청 기록' });
    expect(send).toBeDisabled();
    await userEvent.type(within(form).getByLabelText('승인 번호(필수)'), 'APV-1');
    expect(send).toBeEnabled();
  });

  it('상담원: 남긴 것이 없으면 칸이 없고 기록 폼도 없다', async () => {
    renderAt('/cases/CASE-MOCK-1', as.cs);
    await screen.findByTestId('case-facts');
    expect(screen.queryByRole('region', { name: '행위 요청' })).not.toBeInTheDocument();
  });
});
