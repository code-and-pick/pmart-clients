// 직원 이름에 쓸 수 없는 문자(hr-service 0.5.1 — 백엔드 회신 hr-backoffice/2026-11-17-reply-keycloak-400-provisioning)
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { problem } from '../../mocks/support';
import { renderAt } from '../../test/render';
import { server } from '../../test/server';
import { prohibitedInName } from './grantRules';

async function fillRest() {
  await userEvent.type(screen.getByLabelText(/메일 ID/), 'name.check');
  await userEvent.type(screen.getByLabelText('부서 코드'), 'CS');
  fireEvent.change(screen.getByLabelText('근무 시작일'), { target: { value: '2026-12-01' } });
}

describe('직원 이름 규칙', () => {
  it('대괄호 같은 문자를 쓰면 칸 아래에 바로 알리고 등록을 막는다(계정 발급 실패를 미리 막기)', async () => {
    const view = renderAt('/employees/new');
    await userEvent.type(await screen.findByLabelText('이름'), '[[시험] 나검사');
    await fillRest();
    expect(screen.getByTestId('name-prohibited')).toHaveTextContent('이름에 쓸 수 없는 문자가 있어요([ ])');
    expect(screen.getByLabelText('이름')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: '등록' })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('이름'));
    await userEvent.type(screen.getByLabelText('이름'), '시험 나검사');
    expect(screen.queryByTestId('name-prohibited')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '등록' })).toBeEnabled();
    expect(view.mutations('/hr/employees')).toHaveLength(0);
  });

  it('서버가 이름 칸을 거절하면(400 field name) 서버 문장을 이름 칸 아래에', async () => {
    server.use(http.post(`${API_BASE}/hr/employees`, () => problem(400, 'VALIDATION_FAILED', [{ field: 'name', reason: 'INVALID_FORMAT' }], '서버 문장 — 이름에 쓸 수 없는 문자가 있습니다')));
    renderAt('/employees/new');
    await userEvent.type(await screen.findByLabelText('이름'), '시험 나검사');
    await fillRest();
    await userEvent.click(screen.getByRole('button', { name: '등록' }));
    expect(await screen.findByTestId('name-rejected')).toHaveTextContent('서버 문장 — 이름에 쓸 수 없는 문자가 있습니다');
    expect(screen.getByLabelText('이름')).toHaveAttribute('aria-invalid', 'true');
  });

  it('규칙: Keycloak 이름 금지 문자만 골라낸다(한글·공백·점·하이픈은 된다)', () => {
    expect(prohibitedInName('[시험] 상담(1)')).toEqual(['[', ']', '(', ')']);
    expect(prohibitedInName('홍길동 Kim-Lee.J')).toEqual([]);
  });
});
