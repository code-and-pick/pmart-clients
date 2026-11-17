// 권한 "연장"(백엔드 요청 hr-backoffice/2026-11-18-request-grant-extension) · 새 거절 코드 CENTER_ROLE_MIX(hr-service 0.7.0, 알림 2026-11-18-notice-center-role-mix)
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { db } from '../../mocks/db';
import { renderAt } from '../../test/render';
import { extensionStart, followingGrants } from '../employees/grantRules';

describe('권한 연장', () => {
  it('끝나는 날이 있는 권한 줄의 "연장" → 같은 역할·센터, 시작일 = validUntil 의 서울 날짜로 새 요청(역할·센터 잠금)', async () => {
    const view = renderAt('/permissions/OP-picker-1'); // 센터 작업자 · MFC-BSN-01 · ~2027-02-28
    const row = await screen.findByTestId('grant-row');
    await userEvent.click(within(row).getByRole('button', { name: '연장' }));
    const form = await screen.findByRole('form', { name: '권한 추가·변경 요청' });
    expect(within(form).getByTestId('grant-extending')).toHaveTextContent('지금 마지막 날 2027-02-28, 새 권한은 2027-03-01부터');
    expect(within(form).getByLabelText('역할')).toBeDisabled();
    expect(within(form).getByLabelText('시작일')).toHaveValue('2027-03-01');
    await userEvent.type(within(form).getByLabelText('종료일'), '2027-08-31');
    await userEvent.type(within(form).getByLabelText('요청 사유'), '계약 연장');
    await userEvent.click(within(form).getByRole('button', { name: '승인 요청' }));
    await waitFor(() => expect(screen.getAllByTestId('grant-request').some((li) => li.textContent?.includes('승인 대기'))).toBe(true));
    expect(await view.mutations('/grant-requests')[0]!.json()).toEqual({
      grants: [{ role: 'MFC_WORKER', centers: ['MFC-BSN-01'], validFrom: '2027-03-01', validTo: '2027-08-31' }],
      reason: '계약 연장',
    });
  });

  it('"일반 요청으로" 를 누르면 잠금이 풀린 빈 요청 칸', async () => {
    renderAt('/permissions/OP-picker-1');
    await userEvent.click(within(await screen.findByTestId('grant-row')).getByRole('button', { name: '연장' }));
    const form = await screen.findByRole('form', { name: '권한 추가·변경 요청' });
    await userEvent.click(within(form).getByRole('button', { name: '일반 요청으로' }));
    const fresh = await screen.findByRole('form', { name: '권한 추가·변경 요청' });
    expect(within(fresh).queryByTestId('grant-extending')).not.toBeInTheDocument();
    expect(within(fresh).getByLabelText('역할')).toBeEnabled();
    expect(within(fresh).getByLabelText('역할')).toHaveValue('');
  });

  it('기한 없는 권한 줄에는 "연장" 이 없다', async () => {
    renderAt('/permissions/OP-md-1'); // MD · 기한 없음
    const row = await screen.findByTestId('grant-row');
    expect(within(row).queryByRole('button', { name: '연장' })).not.toBeInTheDocument();
  });

  it('이어지는 같은 권한이 있으면 줄에 표시하고, 회수 확인에 "이어지는 같은 권한도" 안내', async () => {
    const [first] = db.accountGrants.get('OP-picker-1')!;
    db.accountGrants.set('OP-picker-1', [first!, { ...first!, grantId: 'AP-ext-1:L1', approvalId: 'AP-ext-1', validFrom: first!.validUntil!, validUntil: '2027-09-01T00:00:00+09:00' }]);
    renderAt('/permissions/OP-picker-1');
    const rows = await screen.findAllByTestId('grant-row');
    expect(within(rows[0]!).getByTestId('grant-continued')).toHaveTextContent('2027-08-31까지');
    await userEvent.click(within(rows[0]!).getByRole('button', { name: '회수' }));
    expect(within(rows[0]!).getByTestId('revoke-following')).toHaveTextContent('끝내려면 그 줄도 회수해야 해요');
  });

  it('규칙: 시작일은 validUntil 의 서울 날짜 그대로(전날 아님), 이어지는 줄은 같은 역할·센터·끝난 뒤 시작', () => {
    expect(extensionStart('2027-03-01T00:00:00+09:00')).toBe('2027-03-01');
    expect(extensionStart('2027-02-28T15:00:00Z')).toBe('2027-03-01');
    const g = { grantId: 'A', approvalId: 'A', approverId: 'x', role: 'MFC_WORKER', centers: ['C1'], validFrom: '2026-09-01T00:00:00+09:00', validUntil: '2027-03-01T00:00:00+09:00', appliedAt: '2026-09-01T00:00:00Z' };
    const next = { ...g, grantId: 'B', validFrom: '2027-03-01T00:00:00+09:00', validUntil: null };
    const other = { ...g, grantId: 'C', centers: ['C2'], validFrom: '2027-03-01T00:00:00+09:00' };
    expect(followingGrants([g, next, other], g).map((x) => x.grantId)).toEqual(['B']);
  });
});

describe('CENTER_ROLE_MIX(센터마다 다른 MFC 역할)', () => {
  it('다른 센터로 다른 MFC 역할을 고르면 미리 경고, 보내면 409 — 서버 문장 그대로 + 섞이는 기존 권한 줄 강조', async () => {
    renderAt('/permissions/OP-picker-1'); // 센터 작업자 @ MFC-BSN-01
    const form = await screen.findByRole('form', { name: '권한 추가·변경 요청' });
    await userEvent.selectOptions(within(form).getByLabelText('역할'), 'MFC_SUPERVISOR');
    await userEvent.click(within(form).getByRole('button', { name: '센터' }));
    await userEvent.click(within(form).getByRole('checkbox', { name: /MFC-SEL-01/ }));
    expect(within(form).getByTestId('grant-role-mix')).toHaveTextContent('센터마다 다른 MFC 역할은 줄 수 없어요');
    await userEvent.type(within(form).getByLabelText('요청 사유'), '서울 센터 관리');
    await userEvent.click(within(form).getByRole('button', { name: '승인 요청' }));
    expect(await within(form).findByTestId('grant-problem-detail')).toHaveTextContent('센터가 다른 MFC 역할이라 섞입니다');
    expect(within(form).getByTestId('grant-role-mix-rejected')).toBeInTheDocument();
    expect(within(form).getByTestId('current-grant')).toHaveAttribute('data-conflict', 'true');
  });

  it('같은 센터의 다른 MFC 역할은 경고하지 않는다', async () => {
    renderAt('/permissions/OP-picker-1');
    const form = await screen.findByRole('form', { name: '권한 추가·변경 요청' });
    await userEvent.selectOptions(within(form).getByLabelText('역할'), 'MFC_SUPERVISOR');
    await userEvent.click(within(form).getByRole('button', { name: '센터' }));
    await userEvent.click(within(form).getByRole('checkbox', { name: /MFC-BSN-01/ }));
    expect(within(form).queryByTestId('grant-role-mix')).not.toBeInTheDocument();
  });
});
