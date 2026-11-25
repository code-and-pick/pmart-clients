// 문의 닫기(case 0.19.0) — 답변 역할 직원만, 사유 필수, 다시 열기 없음
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('문의 닫기', () => {
  it('상담원: 경고 + 사유(2자 이상) → closures → "종료 · 직원이 닫음"·사유, 답변 칸 대신 안내, 닫기 버튼 없음', async () => {
    const view = renderAt('/inquiries/INQ-MOCK-3', as.cs);
    await userEvent.click(await screen.findByRole('button', { name: '문의 닫기' }));
    const form = screen.getByRole('form', { name: '문의 닫기' });
    expect(within(form).getByRole('note')).toHaveTextContent('다시 열 수 없어요');
    const submit = within(form).getByRole('button', { name: '닫기' });
    await userEvent.type(within(form).getByLabelText('닫는 사유(필수, 2~500자)'), '중');
    expect(submit).toBeDisabled();
    await userEvent.type(within(form).getByLabelText('닫는 사유(필수, 2~500자)'), '복 문의');
    await userEvent.click(submit);

    const closed = await screen.findByTestId('inquiry-closed');
    expect(closed).toHaveTextContent('직원이 닫음');
    expect(closed).toHaveTextContent('중복 문의');
    expect(screen.getByTestId('inquiry-status')).toHaveTextContent('종료');
    expect(screen.getByText(/종료된 문의라 답변할 수 없어요/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '문의 닫기' })).not.toBeInTheDocument();
    const sent = view.mutations('/closures');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await sent[0]!.json()).toEqual({ reason: '중복 문의' });
  });

  it('관리자는 보기만 — 닫기 버튼 없음', async () => {
    renderAt('/inquiries/INQ-MOCK-3', as.admin);
    await screen.findByTestId('inquiry-body');
    expect(screen.queryByRole('button', { name: '문의 닫기' })).not.toBeInTheDocument();
  });

  it('라이더 문의는 지원센터가 닫는다(상담원 아님)', async () => {
    renderAt('/rider-inquiries/INQ-MOCK-R1', as.riderOps);
    expect(await screen.findByRole('button', { name: '문의 닫기' })).toBeInTheDocument();
  });
});
