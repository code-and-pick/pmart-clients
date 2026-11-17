// 권한 관리(BO-01) — 찾기, 지금 권한(effective·grants), 추가·변경 요청, 회수(확인 + 사유), 버튼 숨김 규칙.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { db } from '../../mocks/db';
import { renderAt } from '../../test/render';

describe('권한 관리', () => {
  it('찾기 → 직원을 고르면 지금 쓰는 역할(이름)·승인된 권한·자동 승인 표시', async () => {
    renderAt('/permissions');
    await userEvent.type(screen.getByLabelText('검색어'), '이피킹');
    await userEvent.click(screen.getByRole('button', { name: '찾기' }));
    const row = await screen.findByTestId('permission-candidate');
    await userEvent.click(within(row).getByRole('link', { name: '권한 보기' }));
    expect(await screen.findByTestId('effective-roles')).toHaveTextContent('센터 작업자 (MFC_WORKER)');
    const grant = screen.getByTestId('grant-row');
    expect(grant).toHaveTextContent('자동 승인');
    expect(grant).toHaveTextContent('MFC-BSN-01');
    expect(grant).toHaveTextContent('유효');
    expect(grant).toHaveTextContent('2026-09-01 ~ 2027-02-28'); // 기간은 서울 날짜만
  });

  it('승인 칸: 승인자 이름(approverName, employee-auth 0.10.0)이 있으면 ID 대신 이름', async () => {
    renderAt('/permissions/OP-md-1');
    const approver = within(await screen.findByTestId('grant-row')).getByTestId('grant-approver');
    expect(approver).toHaveTextContent('한인사');
    expect(approver).not.toHaveTextContent('OP-hr-1');
  });

  it('계정 발급 전 직원은 "계정 발급 중"(404 EMPLOYEE_NOT_FOUND 를 오류로 보이지 않는다)', async () => {
    renderAt('/permissions/OP-fail-1');
    expect(await screen.findByText(/아직 로그인 계정이 없어요/)).toBeInTheDocument();
  });

  it('회수: 확인(바로 로그아웃 안내) + 사유 → grant-revocations, 회수됨으로 바뀌고 그 직원 세션이 끊긴다', async () => {
    const view = renderAt('/permissions/OP-picker-1');
    const row = await screen.findByTestId('grant-row');
    await userEvent.click(within(row).getByRole('button', { name: '회수' }));
    expect(within(row).getByRole('alert')).toHaveTextContent('바로 로그아웃');
    expect(within(row).getByRole('button', { name: '회수하기' })).toBeDisabled(); // 사유 없음
    await userEvent.type(within(row).getByLabelText('회수 사유'), '센터 이동');
    await userEvent.click(within(row).getByRole('button', { name: '회수하기' }));
    await waitFor(() => expect(screen.getByTestId('grant-row')).toHaveTextContent('회수됨'));
    expect(screen.getByTestId('grant-row')).toHaveTextContent('회수됨(한인사,'); // revokedByName(employee-auth 0.10.0)
    expect(screen.getByTestId('effective-roles')).toHaveTextContent('-');
    const sent = view.mutations('/grant-revocations');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(sent[0]!.headers.get('X-Source-System')).toBe('hr-backoffice-web');
    expect(await sent[0]!.json()).toEqual({ grantId: 'AP-seed-3:L1', reason: '센터 이동' });
    expect(db.accountGrants.get('OP-picker-1')![0]!.revokedAt).toBeTruthy();
  });

  it('HR_ADMIN 에게는 관리자 역할(HR_ADMIN·OPERATOR_ADMIN) 줄과 자기 자신 줄에 회수 버튼이 없다', async () => {
    renderAt('/permissions/OP-hr-1'); // 자기 자신 + HR_ADMIN 줄
    const row = await screen.findByTestId('grant-row');
    expect(row).toHaveAttribute('data-role', 'HR_ADMIN');
    expect(within(row).getByTestId('grant-approver')).toHaveTextContent('OP-admin-1'); // 인사 기록 없는 승인자 — 이름 null 이면 운영자 ID
    expect(within(row).queryByRole('button', { name: '회수' })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: '권한 추가·변경 요청' })).not.toBeInTheDocument(); // 자기 권한 요청도 없음
  });

  it('추가 요청: 역할·사유 → grant-requests(X-Expected-Version) → 승인 대기, 그 뒤에는 새 요청을 막는다', async () => {
    const view = renderAt('/permissions/OP-md-1');
    const form = await screen.findByRole('form', { name: '권한 추가·변경 요청' });
    await userEvent.selectOptions(within(form).getByLabelText('역할'), 'PRODUCT_APPROVER');
    await userEvent.type(within(form).getByLabelText('요청 사유'), '상품 승인 겸직');
    await userEvent.click(within(form).getByRole('button', { name: '승인 요청' }));
    await waitFor(() => expect(screen.getAllByTestId('grant-request').some((li) => li.textContent?.includes('승인 대기'))).toBe(true));
    expect(screen.getByText(/결정되지 않은 요청이 있어/)).toBeInTheDocument();
    const sent = view.mutations('/grant-requests')[0]!;
    expect(sent.headers.get('X-Expected-Version')).toBe('3');
    expect(await sent.json()).toEqual({ grants: [{ role: 'PRODUCT_APPROVER' }], reason: '상품 승인 겸직' });
  });
});
