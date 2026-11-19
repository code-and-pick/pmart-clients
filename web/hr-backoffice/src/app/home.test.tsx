// 첫 화면(2026-11-19) — 바로 가기, 숫자 띠(hr 0.9.0 counts — 누르면 그 직원만 거른 목록), 최근 등록 5명
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../api/client';
import { renderAt } from '../test/render';
import { server } from '../test/server';

describe('첫 화면', () => {
  it('바로 가기 4개', async () => {
    renderAt('/');
    const shortcuts = await screen.findByTestId('home-shortcuts');
    expect(within(shortcuts).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/employees/new', '/employees', '/permissions', '/departments']);
    expect(screen.getByTestId('page-title')).toHaveTextContent('첫 화면');
  });

  it('숫자 띠: 서버가 센 수, 칸마다 그 직원만 거른 목록으로', async () => {
    renderAt('/');
    const strip = await screen.findByTestId('home-counts');
    await waitFor(() => expect(within(strip).getByTestId('count-active')).toHaveTextContent(/\d/));
    expect(within(strip).getByTestId('count-provisioning-failed')).toHaveAttribute('href', '/employees?provisioningStep=FAILED,COMPENSATED');
    expect(within(strip).getByTestId('count-grant-pending')).toHaveAttribute('href', '/employees?status=ACTIVE&grantSubmission=SUBMITTED');
    expect(within(strip).getByTestId('count-ending-soon').getAttribute('href')).toMatch(/endDateFrom=2026-11-19&endDateTo=2026-11-25&sort=END_DATE_ASC/);
    expect(within(strip).getByTestId('count-provisioning-failed')).toHaveTextContent('1'); // 목: 발급 실패 1명
  });

  it('수를 못 읽으면 칸마다 "?" — 0 으로 보이지 않는다', async () => {
    server.use(http.get(`${API_BASE}/hr/employees/counts`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 503, code: 'DEPENDENCY_UNAVAILABLE', traceId: 't' }, { status: 503, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/');
    const strip = await screen.findByTestId('home-counts');
    await waitFor(() => expect(within(strip).getByTestId('count-active')).toHaveTextContent('?'), { timeout: 5000 });
    expect(screen.getByText(/수를 읽지 못했어요/)).toBeInTheDocument();
  });

  it('발급 실패 칸을 누르면 그 조건으로 거른 직원 목록 — 거른 조건이 보이고 지울 수 있다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/');
    await user.click(await screen.findByTestId('count-provisioning-failed'));
    expect(await screen.findByRole('heading', { name: '직원 목록' })).toBeInTheDocument();
    expect(await screen.findByTestId('extra-filter')).toHaveTextContent('계정 발급 실패');
    await waitFor(() => expect(view.sent.some((r) => new URL(r.url).pathname.endsWith('/hr/employees') && new URL(r.url).searchParams.get('provisioningStep') === 'FAILED,COMPENSATED')).toBe(true));
  });

  it('최근 등록 5명 — 이름·사번·상태, 누르면 상세', async () => {
    renderAt('/');
    const rows = await within(await screen.findByTestId('home-recent')).findAllByTestId('recent-employee');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(rows[0]!.getAttribute('href')).toMatch(/^\/employees\//);
  });
});
