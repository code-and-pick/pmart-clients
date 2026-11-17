// 직원 목록·등록·상세(계약 hr-service.yaml 0.1.0, 백엔드 handoff 2026-11-13 clients-request-hr-backoffice §2·§3).
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { db } from '../../mocks/db';
import { problem } from '../../mocks/support';
import { renderAt } from '../../test/render';
import { server } from '../../test/server';

const row = (name: string) => screen.getByText(name).closest('tr')!;

describe('직원 목록', () => {
  it('사번·이름·메일·고용 형태·소속·상태·계정 발급 단계를 보인다', async () => {
    renderAt('/employees');
    expect(await screen.findByText('이피킹')).toBeInTheDocument();
    const r = within(row('이피킹'));
    expect(r.getByText('P2026-00003')).toBeInTheDocument();
    expect(r.getByText('pick.lee@pmart.com')).toBeInTheDocument();
    expect(r.getByText('파트타임')).toBeInTheDocument();
    expect(r.getByText('센터 MFC-BSN-01')).toBeInTheDocument();
    expect(r.getByText('재직')).toBeInTheDocument();
    expect(r.getByText('완료')).toBeInTheDocument();
    expect(within(row('정실패')).getByText('실패 — 다시 시도')).toBeInTheDocument();
  });

  it('필터는 조회를 눌러야 요청에 실린다(status·q)', async () => {
    const view = renderAt('/employees');
    await screen.findByText('이피킹');
    await userEvent.type(screen.getByLabelText('검색어'), '박');
    await userEvent.selectOptions(screen.getByLabelText('상태'), 'SUSPENDED');
    await userEvent.click(screen.getByRole('button', { name: '조회' }));
    await waitFor(() => expect(screen.queryByText('이피킹')).not.toBeInTheDocument());
    expect(screen.getByText('박정지')).toBeInTheDocument();
    const last = new URL(view.gets('/hr/employees').at(-1)!.url);
    expect(last.searchParams.get('q')).toBe('박');
    expect(last.searchParams.get('status')).toBe('SUSPENDED');
  });

  it('조회 실패를 빈 목록으로 보이지 않는다', async () => {
    server.use(http.get(`${API_BASE}/hr/employees`, () => problem(500, 'INTERNAL_ERROR')));
    renderAt('/employees');
    expect(await screen.findByRole('alert')).toHaveAttribute('data-state', 'error');
    expect(screen.queryByText('조건에 맞는 직원이 없어요.')).not.toBeInTheDocument();
  });

  it('더 보기: nextCursor 로 다음 쪽을 이어 붙인다', async () => {
    server.use(
      http.get(`${API_BASE}/hr/employees`, ({ request }) => {
        const all = [...db.employees.values()].map((m) => m.employee);
        return new URL(request.url).searchParams.get('cursor') === 'c2'
          ? HttpResponse.json({ items: all.slice(3) })
          : HttpResponse.json({ items: all.slice(0, 3), nextCursor: 'c2' });
      }),
    );
    renderAt('/employees');
    expect(await screen.findByText('3명 표시')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '더 보기' }));
    expect(await screen.findByText('6명 표시')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument();
  });
});

async function fillBasics({ mailId = 'new.kim', type }: { mailId?: string; type?: string } = {}) {
  await userEvent.type(screen.getByLabelText('이름'), '김신입');
  await userEvent.type(screen.getByLabelText(/메일 ID/), mailId);
  if (type) await userEvent.selectOptions(screen.getByLabelText('고용 형태'), type);
  await userEvent.type(screen.getByLabelText('부서 코드'), 'CS');
  fireEvent.change(screen.getByLabelText('근무 시작일'), { target: { value: '2026-12-01' } });
}

describe('직원 등록', () => {
  it('등록 → 201 → 상세로 가고, 계정 발급 단계가 "발급 중"에서 "완료"로 바뀐다(다시 조회)', async () => {
    const view = renderAt('/employees/new');
    await fillBasics();
    await userEvent.click(screen.getByRole('button', { name: '등록' }));

    expect(await screen.findByRole('heading', { name: /김신입 \(P2026-/ })).toBeInTheDocument();
    expect(screen.getByText('new.kim@pmart.com')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/^완료/)).toHaveAttribute('data-step', 'DONE'), { timeout: 3000 });

    const post = view.mutations('/hr/employees')[0]!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(post.headers.get('X-Source-System')).toBe('hr-backoffice-web');
    expect(await post.json()).toEqual({
      name: '김신입',
      mailId: 'new.kim',
      employmentType: 'REGULAR',
      affiliation: { type: 'HQ_DEPARTMENT', code: 'CS' },
      startDate: '2026-12-01',
    });
  });

  it('파트타임은 계약 종료일이 있어야 등록할 수 있고, 센터 소속·요청 권한을 함께 보낸다 → 소속 센터 MFC_WORKER 는 자동 승인', async () => {
    const view = renderAt('/employees/new');
    await userEvent.type(screen.getByLabelText('이름'), '오알바');
    await userEvent.type(screen.getByLabelText(/메일 ID/), 'alba.oh');
    await userEvent.selectOptions(screen.getByLabelText('고용 형태'), 'PART_TIME');
    await userEvent.click(screen.getByRole('radio', { name: '센터' }));
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: '센터' }), 'MFC-BSN-01');
    fireEvent.change(screen.getByLabelText('근무 시작일'), { target: { value: '2026-12-01' } });
    expect(screen.getByRole('button', { name: '등록' })).toBeDisabled(); // 계약 종료일 없음
    fireEvent.change(screen.getByLabelText('계약 종료일'), { target: { value: '2027-02-28' } });

    await userEvent.click(screen.getByRole('button', { name: '권한 추가' }));
    expect(screen.getByRole('button', { name: '등록' })).toBeDisabled(); // 역할을 아직 안 골랐다
    await userEvent.selectOptions(screen.getByLabelText('역할'), 'MFC_WORKER');
    await userEvent.click(screen.getByRole('button', { name: '센터' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /MFC-BSN-01/ }));
    await userEvent.type(screen.getByLabelText('근거'), '부산진구 피킹');
    await userEvent.click(screen.getByRole('button', { name: '등록' }));

    await screen.findByRole('heading', { name: /오알바/ });
    await waitFor(() => expect(screen.getByText('승인됨')).toHaveAttribute('data-submission', 'APPROVED'), { timeout: 3000 });
    expect(await view.mutations('/hr/employees')[0]!.json()).toEqual({
      name: '오알바',
      mailId: 'alba.oh',
      employmentType: 'PART_TIME',
      affiliation: { type: 'CENTER', code: 'MFC-BSN-01' },
      startDate: '2026-12-01',
      endDate: '2027-02-28',
      requestedGrants: [{ role: 'MFC_WORKER', centers: ['MFC-BSN-01'], reason: '부산진구 피킹' }],
    });
  });

  it('이미 쓰인 메일 ID(퇴사자 포함)는 409 MAIL_ID_TAKEN 안내, 화면에 머문다', async () => {
    renderAt('/employees/new');
    await fillBasics({ mailId: 'left.choi' });
    await userEvent.click(screen.getByRole('button', { name: '등록' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-code', 'MAIL_ID_TAKEN');
    expect(alert).toHaveTextContent('이미 쓰였던 메일 ID');
    expect(screen.getByRole('heading', { name: '직원 등록' })).toBeInTheDocument();
  });

  it('응답을 잃으면 결과 불명 — 같은 Idempotency-Key 로 결과를 확인하고, 직원은 한 명만 생긴다', async () => {
    const before = db.employees.size;
    let lost = false;
    server.use(
      http.post(`${API_BASE}/hr/employees`, async ({ request }) => {
        if (lost) return undefined; // 두 번째부터는 원래 핸들러(멱등 재생)
        lost = true;
        // 서버는 처리했지만 응답이 오지 않은 상황: 원래 핸들러로 처리하고 응답을 버린다
        await fetch(new Request(request.clone(), { headers: new Headers([...request.headers, ['x-replayed', '1']]) })).catch(() => undefined);
        return HttpResponse.error();
      }),
    );
    const view = renderAt('/employees/new');
    await fillBasics();
    await userEvent.click(screen.getByRole('button', { name: '등록' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-state', 'unknown');
    expect(screen.getByRole('button', { name: '등록' })).toBeDisabled(); // 같은 행위를 새 키로 다시 못 하게

    await userEvent.click(screen.getByRole('button', { name: '같은 요청으로 결과 확인' }));
    expect(await screen.findByRole('heading', { name: /김신입/ })).toBeInTheDocument();
    const keys = view
      .mutations('/hr/employees')
      .filter((r) => !r.headers.has('x-replayed'))
      .map((r) => r.headers.get('Idempotency-Key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(db.employees.size).toBe(before + 1);
  });

  it('센터 목록을 못 불러오면 빈 목록 대신 안내와 코드 직접 입력', async () => {
    server.use(http.get(`${API_BASE}/centers`, () => problem(403, 'FORBIDDEN')));
    renderAt('/employees/new');
    await userEvent.click(screen.getByRole('radio', { name: '센터' }));
    expect(await screen.findByText(/센터 목록을 불러오지 못했어요/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: '센터' }), 'MFC-BSN-01');
    expect(screen.getByRole('textbox', { name: '센터' })).toHaveValue('MFC-BSN-01');
  });

  it('요청 권한 역할은 GET /employee-auth/roles 순서·이름 그대로(BR-57), 센터가 필요한 역할은 안내', async () => {
    renderAt('/employees/new');
    await userEvent.click(await screen.findByRole('button', { name: '권한 추가' }));
    const options = within(screen.getByLabelText('역할')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toHaveLength(14); // 고르기 + 13개
    expect(options[1]).toBe('운영 관리자 (OPERATOR_ADMIN)');
    expect(options).toContain('라이더 운영 (RIDER_OPS)');
    await userEvent.selectOptions(screen.getByLabelText('역할'), 'MFC_SUPERVISOR');
    expect(screen.getByText('이 역할은 권한 센터를 1개 이상 골라야 해요.')).toBeInTheDocument();
  });

  it('역할 목록을 못 불러오면 빈 목록이 아니라 오류 — 권한을 추가할 수 없다', async () => {
    server.use(http.get(`${API_BASE}/employee-auth/roles`, () => problem(503, 'DEPENDENCY_UNAVAILABLE')));
    renderAt('/employees/new');
    expect(await screen.findByText('정보를 불러오지 못했어요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '권한 추가' })).toBeDisabled();
  });
});

describe('직원 상세', () => {
  it('정지: 경고를 보이고, 사유·X-Expected-Version 을 보낸 뒤 서버 응답으로 상태를 바꾼다', async () => {
    const view = renderAt('/employees/OP-picker-1');
    await screen.findByRole('heading', { name: /이피킹/ });
    await userEvent.click(screen.getByRole('button', { name: '정지' }));
    const dialog = within(screen.getByRole('dialog', { name: '정지' }));
    expect(dialog.getByRole('note')).toHaveTextContent('로그인이 바로 막혀요');
    expect(dialog.getByRole('button', { name: '확인' })).toBeDisabled(); // 사유 필수
    await userEvent.type(dialog.getByLabelText('사유'), '계약 위반');
    await userEvent.click(dialog.getByRole('button', { name: '확인' }));

    await waitFor(() => expect(screen.getByText('정지', { selector: 'dd' })).toHaveAttribute('data-status', 'SUSPENDED'));
    const sent = view.mutations('/suspensions')[0]!;
    expect(sent.headers.get('X-Expected-Version')).toBe('3');
    expect(sent.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await sent.json()).toEqual({ reason: '계약 위반' });
    // 정지된 직원에게는 복귀·퇴사만 남는다
    expect(screen.queryByRole('button', { name: '정지' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '복귀' })).toBeInTheDocument();
  });

  it('그 사이 다른 변경이 있으면(VERSION_CONFLICT) 거절을 보이고 상태를 바꾸지 않는다', async () => {
    renderAt('/employees/OP-picker-1');
    await screen.findByRole('heading', { name: /이피킹/ });
    db.employees.get('OP-picker-1')!.employee.version = 9; // 다른 사람이 먼저 바꿨다
    await userEvent.click(screen.getByRole('button', { name: '퇴사' }));
    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    await userEvent.click(screen.getByRole('button', { name: '정지' }));
    const dialog = within(screen.getByRole('dialog', { name: '정지' }));
    await userEvent.type(dialog.getByLabelText('사유'), '사유');
    await userEvent.click(dialog.getByRole('button', { name: '확인' }));
    expect(await dialog.findByRole('alert')).toHaveAttribute('data-code', 'VERSION_CONFLICT');
    expect(screen.getByText('재직', { selector: 'dd' })).toBeInTheDocument();
  });

  it('소속 변경: 이전 센터 권한은 내일 00:00 자동 종료·새 권한은 따로 요청이라는 안내(hr 0.4.0)와 함께 새 소속·사유를 보낸다', async () => {
    const view = renderAt('/employees/OP-picker-1');
    await screen.findByRole('heading', { name: /이피킹/ });
    await userEvent.click(screen.getByRole('button', { name: '소속 변경' }));
    const dialog = within(screen.getByRole('dialog', { name: '소속 변경' }));
    expect(dialog.getByText(/이전 센터 권한은 내일 00:00 에 자동으로 끝나요/)).toBeInTheDocument();
    await userEvent.selectOptions(await dialog.findByRole('combobox', { name: '센터' }), 'MFC-SEL-01');
    await userEvent.type(dialog.getByLabelText('사유'), '센터 이동');
    await userEvent.click(dialog.getByRole('button', { name: '확인' }));
    expect(await screen.findByText('센터 MFC-SEL-01')).toBeInTheDocument();
    expect(await view.mutations('/affiliation-changes')[0]!.json()).toEqual({ affiliation: { type: 'CENTER', code: 'MFC-SEL-01' }, reason: '센터 이동' });
  });

  it('발급 다시 시도는 실패한 단계에서만 보이고, 누르면 다시 진행해 완료된다', async () => {
    const done = renderAt('/employees/OP-picker-1');
    await screen.findByRole('heading', { name: /이피킹/ });
    expect(screen.queryByRole('button', { name: '발급 다시 시도' })).not.toBeInTheDocument();
    done.unmount();

    renderAt('/employees/OP-fail-1');
    await screen.findByRole('heading', { name: /정실패/ });
    expect(screen.getByText('IAM_USERNAME_TAKEN')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '발급 다시 시도' }));
    await waitFor(() => expect(screen.getByText(/^완료/)).toHaveAttribute('data-step', 'DONE'), { timeout: 3000 });
    expect(screen.queryByRole('button', { name: '발급 다시 시도' })).not.toBeInTheDocument();
  });

  it('사서함 초기 비밀번호: 한 번만 보이고 닫으면 사라진다 — 저장소에 남기지 않는다', async () => {
    renderAt('/employees/OP-picker-1');
    await screen.findByRole('heading', { name: /이피킹/ });
    await userEvent.click(screen.getByRole('button', { name: '초기 비밀번호 발급' }));
    const shown = await screen.findByTestId('initial-password');
    const password = shown.textContent ?? '';
    expect(password).toMatch(/^mock-\d+-pw$/);
    expect(screen.getByText(/지금 한 번만 보여요/)).toBeInTheDocument();
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(password);
    expect(window.localStorage.length).toBe(0);

    await userEvent.click(screen.getByRole('button', { name: '닫기(비밀번호 지우기)' }));
    expect(screen.queryByTestId('initial-password')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(password);
  });

  it('사서함 비밀번호 발급 응답을 잃으면 자동으로 다시 보내지 않고, 다시 발급하라고 안내한다', async () => {
    let calls = 0;
    server.use(
      http.post(`${API_BASE}/hr/employees/:id/mailbox-password-resets`, () => {
        calls += 1;
        return HttpResponse.error();
      }),
    );
    renderAt('/employees/OP-picker-1');
    await screen.findByRole('heading', { name: /이피킹/ });
    await userEvent.click(screen.getByRole('button', { name: '초기 비밀번호 발급' }));
    expect(await screen.findByText(/발급 결과를 받지 못했어요/)).toBeInTheDocument();
    expect(calls).toBe(1);
    expect(screen.getByRole('button', { name: '초기 비밀번호 발급' })).toBeEnabled();
  });

  it('없는 직원은 오류로 보인다(빈 화면 아님)', async () => {
    renderAt('/employees/OP-none');
    expect(await screen.findByRole('alert')).toHaveAttribute('data-state', 'error');
  });
});

describe('백엔드 회신 2026-11-13 반영', () => {
  it('요청 권한의 근거와 승인 ID 를 보인다(없으면 "-")', async () => {
    renderAt('/employees/OP-picker-1');
    await screen.findByRole('heading', { name: /이피킹/ });
    const grant = within(screen.getByText('MFC_WORKER').closest('tr')!);
    expect(grant.getByText('부산진구 피킹')).toBeInTheDocument();
    expect(grant.getByText('AP-seed-3')).toBeInTheDocument();
  });

  it('요청 권한 기간: 종료일이 없으면(정규직) "기한 없음", 있으면 그 날짜', async () => {
    const regular = renderAt('/employees/OP-hr-1');
    expect(await screen.findByText('2026-03-02 ~ 기한 없음')).toBeInTheDocument();
    regular.unmount();
    renderAt('/employees/OP-picker-1');
    expect(await screen.findByText('2026-09-01 ~ 2027-02-28')).toBeInTheDocument();
    expect(screen.queryByText(/기한 없음/)).not.toBeInTheDocument();
  });

  it('퇴사도 그 사이 다른 변경이 있으면 409 VERSION_CONFLICT — 퇴사 처리되지 않는다', async () => {
    renderAt('/employees/OP-picker-1');
    await screen.findByRole('heading', { name: /이피킹/ });
    db.employees.get('OP-picker-1')!.employee.version = 9;
    await userEvent.click(screen.getByRole('button', { name: '퇴사' }));
    const dialog = within(screen.getByRole('dialog', { name: '퇴사' }));
    await userEvent.type(dialog.getByLabelText('사유'), '자진 퇴사');
    await userEvent.click(dialog.getByRole('button', { name: '확인' }));
    const alert = await dialog.findByRole('alert');
    expect(alert).toHaveAttribute('data-code', 'VERSION_CONFLICT');
    expect(alert).toHaveTextContent('다른 사람이 먼저 바꿨어요');
    expect(db.employees.get('OP-picker-1')!.employee.status).toBe('ACTIVE');
  });

  it('계약 종료일이 지난 일일크루의 복귀: 새 종료일이 없으면 400(endDate), 넣으면 복귀된다', async () => {
    const view = renderAt('/employees/OP-sus-1'); // 일일크루, 종료일 2026-10-31(지남), 정지
    await screen.findByRole('heading', { name: /박정지/ });
    await userEvent.click(screen.getByRole('button', { name: '복귀' }));
    const dialog = within(screen.getByRole('dialog', { name: '복귀' }));
    await userEvent.type(dialog.getByLabelText('사유'), '재계약');
    await userEvent.click(dialog.getByRole('button', { name: '확인' }));
    const alert = await dialog.findByRole('alert');
    expect(alert).toHaveAttribute('data-code', 'VALIDATION_FAILED');
    expect(alert).toHaveTextContent('endDate');

    fireEvent.change(dialog.getByLabelText('계약 종료일'), { target: { value: '2099-12-31' } });
    await userEvent.click(dialog.getByRole('button', { name: '확인' }));
    await waitFor(() => expect(screen.getByText('재직', { selector: 'dd' })).toHaveAttribute('data-status', 'ACTIVE'));
    expect(await view.mutations('/reinstatements').at(-1)!.json()).toEqual({ reason: '재계약', endDate: '2099-12-31' });
  });
});
