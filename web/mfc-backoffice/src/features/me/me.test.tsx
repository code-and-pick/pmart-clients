// 내 정보 — hr-service GET /hr/employees/me, 센터 휴게 번호(capacity 0.20.0)·직원 연락처(capacity 0.21.0) — 목(MSW) 기준.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

describe('내 정보', () => {
  it('머리줄 내 정보 메뉴 → 본인 인사 정보(서버 값 그대로), 회사 메일은 바꾸지 않음 — 옛 /session 은 내 정보로(2026-11-23)', async () => {
    const view = renderAt('/session');
    await userEvent.click(await screen.findByRole('button', { name: /내 정보 메뉴/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '내 정보' }));
    const profile = await screen.findByTestId('me-profile');
    expect(within(profile).getByText('정관리')).toBeInTheDocument();
    expect(within(profile).getByText('E-2026-0101')).toBeInTheDocument();
    expect(within(profile).getByText('sup1@pmart.test')).toBeInTheDocument();
    expect(within(profile).getByText('정규직')).toBeInTheDocument();
    expect(within(profile).getByText('센터 MFC-BSN-01')).toBeInTheDocument();
    expect(within(profile).getByText('재직')).toBeInTheDocument();
    expect(screen.getByText('회사 메일은 로그인 ID 이자 사서함이라 인사팀만 바꿔요.')).toBeInTheDocument();
    expect(view.sent.filter((r) => r.method !== 'GET' && new URL(r.url).pathname.includes('/hr/'))).toHaveLength(0);
  });

  it('센터 휴게 번호: 관리자는 여기서도 정한다(작업자 목록과 같은 카드)', async () => {
    const view = renderAt('/me');
    const card = await screen.findByTestId('break-pin');
    expect(await within(card).findByText(/아직 정하지 않았어요/)).toBeInTheDocument();
    await userEvent.type(within(card).getByLabelText('새 번호(숫자 4자리)'), '1234');
    await userEvent.type(within(card).getByLabelText('한 번 더'), '1234');
    await userEvent.click(within(card).getByRole('button', { name: '번호 정하기' }));
    expect(await within(card).findByText(/휴게 번호를 정했어요/)).toBeInTheDocument();
    const put = view.sent.find((r) => r.method === 'PUT' && new URL(r.url).pathname.endsWith('/mfcs/MFC-BSN-01/break-pin'))!;
    expect(put.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('내 연락처: 처음은 버전 0 으로 저장, 형식이 틀리면 막고, 저장하면 센터 연락처 목록에 내가 보인다', async () => {
    const view = renderAt('/me');
    const card = await screen.findByTestId('me-contact');
    expect(await within(card).findByText('아직 저장한 연락처가 없어요.')).toBeInTheDocument();
    const save = within(card).getByRole('button', { name: '연락처 저장' });
    expect(save).toBeDisabled();

    await userEvent.type(within(card).getByLabelText('휴대폰·전화'), '010-12');
    expect(within(card).getByText('숫자와 - 만, 숫자 9~11자리로 적어 주세요.')).toBeInTheDocument();
    expect(save).toBeDisabled();
    await userEvent.type(within(card).getByLabelText('휴대폰·전화'), '34-5678');
    await userEvent.type(within(card).getByLabelText('표시 이름(50자)'), '센터장 정관리');
    await userEvent.click(save);

    const puts = () => view.sent.filter((r) => r.method === 'PUT' && new URL(r.url).pathname.endsWith('/staff-contacts/me'));
    await waitFor(() => expect(puts()).toHaveLength(1));
    const put = puts()[0]!;
    expect(new URL(put.url).pathname).toContain('/mfcs/MFC-BSN-01/');
    expect(put.headers.get('X-Expected-Version')).toBe('0');
    expect(await put.clone().json()).toEqual({ name: '센터장 정관리', phone: '010-1234-5678', email: null });
    expect(await within(await screen.findByTestId('me-contact')).findByText(/^마지막 저장/)).toBeInTheDocument();

    const list = screen.getByTestId('center-contacts');
    const mine = await within(list).findByText('센터장 정관리');
    expect(mine.closest('tr')).toHaveTextContent('010-1234-5678');
    expect(mine.closest('tr')).toHaveTextContent('나');
  });

  it('센터 연락처 목록은 서버 값 — 이름이 없으면 운영자 표시, 두 센터면 고른 센터 것', async () => {
    renderAt('/me', as.sup2);
    const list = await screen.findByTestId('center-contacts');
    const row = await within(list).findByTestId('center-contact-row');
    expect(row).toHaveTextContent('010-0000-0201');
    expect(await within(row).findByText(/김현장/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('센터'), 'MFC-SEL-01');
    expect(await within(screen.getByTestId('center-contacts')).findByText('센터장 한관리')).toBeInTheDocument();
    expect(screen.getByTestId('center-contacts')).toHaveTextContent('sel-desk@pmart.test');
  });

  it('다른 곳에서 먼저 저장했으면(409 VERSION_CONFLICT) 저장됐다고 하지 않는다, 목록 조회 실패는 빈 목록이 아니라 오류', async () => {
    server.use(
      http.put(`${API_BASE}/mfcs/:mfcId/staff-contacts/me`, () =>
        HttpResponse.json({ code: 'VERSION_CONFLICT', title: 'conflict', status: 409 }, { status: 409, headers: { 'Content-Type': 'application/problem+json' } }),
      ),
      http.get(`${API_BASE}/mfcs/:mfcId/staff-contacts`, () => new HttpResponse(null, { status: 500 })),
    );
    renderAt('/me');
    const card = await screen.findByTestId('me-contact');
    await userEvent.type(await within(card).findByLabelText('연락용 이메일'), 'desk@pmart.test');
    await userEvent.click(within(card).getByRole('button', { name: '연락처 저장' }));
    expect(await within(card).findByRole('alert')).toBeInTheDocument();
    expect(within(card).queryByText('연락처를 저장했어요.')).not.toBeInTheDocument();
    expect(await within(screen.getByTestId('center-contacts')).findByRole('alert')).toHaveAttribute('data-state', 'error');
  });

  it('맡은 센터가 없으면 휴게 번호·연락처 대신 안내', async () => {
    renderAt('/me', as.admin);
    expect(await screen.findByTestId('me-no-center')).toHaveTextContent('맡은 센터가 없어');
    expect(screen.queryByTestId('break-pin')).not.toBeInTheDocument();
  });

  it('본부 소속이면 본사 부서로', async () => {
    renderAt('/me', as.sup2);
    expect(await within(await screen.findByTestId('me-profile')).findByText('본사 부서 1004')).toBeInTheDocument();
  });

  it('인사 기록이 없으면(404) 오류가 아니라 "기록 없음"', async () => {
    renderAt('/me', as.worker);
    expect(await screen.findByText('인사 기록이 없는 계정이에요. 인사팀에 확인해 주세요.')).toBeInTheDocument();
    // 작업자는 휴게 번호를 보기만(정하기는 관리자만)
    const pin = screen.getByTestId('break-pin');
    expect(within(pin).getByText('번호는 센터 관리자만 정해요.')).toBeInTheDocument();
    expect(within(pin).queryByRole('button', { name: '번호 정하기' })).not.toBeInTheDocument();
  });

  it('조회 실패는 오류(빈 화면으로 두지 않음)', async () => {
    server.use(http.get(`${API_BASE}/hr/employees/me`, () => new HttpResponse(null, { status: 500 })));
    renderAt('/me');
    expect(await screen.findByRole('alert')).toHaveAttribute('data-state', 'error');
  });
});
