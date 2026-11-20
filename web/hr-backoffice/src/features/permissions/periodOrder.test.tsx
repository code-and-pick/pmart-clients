// 기간 순서(2026-11-20 사용자 — "종료일이 시작일보다 이른데도 승인된다"): 화면이 보내기 전에 막는다. 서버 거절은 백엔드 요청(계약에 없음)
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';

describe('권한·근무 기간 순서', () => {
  it('권한 추가·변경 요청: 종료일이 시작일보다 앞이면 안내하고 승인 요청 단추가 꺼진다 — 보내지 않는다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/permissions/OP-picker-1');
    const form = await screen.findByRole('form', { name: '권한 추가·변경 요청' });
    await user.selectOptions(within(form).getAllByRole('combobox')[0]!, within(form).getAllByRole('option').find((o) => (o as HTMLOptionElement).value !== '')!);
    await user.type(within(form).getByLabelText('시작일'), '2027-03-01');
    await user.type(within(form).getByLabelText('종료일'), '2026-11-20');
    await user.type(within(form).getByLabelText('요청 사유'), '기간 시험');
    expect(within(form).getByTestId('grant-period-order')).toHaveTextContent('종료일이 시작일보다 앞이에요');
    expect(within(form).getByRole('button', { name: '승인 요청' })).toBeDisabled();
    expect(view.sent.some((r) => r.method === 'POST' && r.url.includes('/grant-requests'))).toBe(false);
    // 바로잡으면 안내가 사라진다
    await user.clear(within(form).getByLabelText('종료일'));
    await user.type(within(form).getByLabelText('종료일'), '2027-06-30');
    expect(within(form).queryByTestId('grant-period-order')).toBeNull();
  });

  it('직원 등록: 계약 종료일이 근무 시작일보다 앞이면 안내하고 등록 단추가 꺼진다', async () => {
    const user = userEvent.setup();
    renderAt('/employees/new');
    // 정규직은 계약 종료일이 없어 칸이 꺼진다 — 파트타임으로
    await user.selectOptions(await screen.findByLabelText('고용 형태'), 'PART_TIME');
    await user.type(screen.getByLabelText('근무 시작일'), '2026-12-01');
    await user.type(screen.getByLabelText('계약 종료일'), '2026-11-01');
    expect(screen.getByTestId('work-period-order')).toHaveTextContent('종료일이 시작일보다 앞이에요');
    expect(screen.getByRole('button', { name: '등록' })).toBeDisabled();
  });
});
