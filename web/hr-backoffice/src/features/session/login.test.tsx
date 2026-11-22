// 인사팀 백오피스 로그인(employee-auth, app=hr-backoffice) — 백엔드 handoff 2026-11-13 clients-request-hr-backoffice §1.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TokenStore } from '@pmart/web-core';
import { API_BASE } from '../../api/client';
import { beginEmployeeLogin, beginSilentEmployeeLogin, browser, LOGIN_PENDING_KEY, LOGIN_SILENT_KEY } from '../../api/employeeAuth';
import { SESSION_STORAGE_KEY } from '../../api/sessionPersistence';
import { env } from '../../env';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

afterEach(() => {
  vi.restoreAllMocks();
  env.isMock = true;
});

describe('로그인 시작', () => {
  it('로그인 시작 주소: app=hr-backoffice, S256 challenge, 복귀 주소 <출처>/auth/callback — verifier 는 이 탭의 sessionStorage 에만', async () => {
    const store = new TokenStore();
    const url = new URL(await beginEmployeeLogin('http://192.168.0.40:8080/api/v1', '/employees', store, { origin: 'http://192.168.0.40:8081' }));
    expect(url.pathname).toBe('/api/v1/employee-auth/logins');
    expect(url.searchParams.get('app')).toBe('hr-backoffice');
    expect(url.searchParams.get('deviceId')).toBe(store.deviceId);
    expect(url.searchParams.get('codeChallengeMethod')).toBe('S256');
    expect(url.searchParams.get('codeChallenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('returnUri')).toBe('http://192.168.0.40:8081/auth/callback');
    const pending = JSON.parse(sessionStorage.getItem(LOGIN_PENDING_KEY)!) as { verifier: string };
    expect(url.toString()).not.toContain(pending.verifier);
  });

  it('실서버 모드: 버튼은 게이트웨이 로그인 시작 주소로 브라우저를 옮긴다(목 계정 버튼 없음)', async () => {
    env.isMock = false;
    sessionStorage.setItem(LOGIN_SILENT_KEY, '1'); // 조용한 로그인 확인은 이미 했다
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    renderAt('/login', null);
    expect(screen.queryByRole('button', { name: /인사 담당/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '직원 계정으로 로그인' }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign.mock.calls[0]![0]).toContain('/api/v1/employee-auth/logins?app=hr-backoffice');
  });

  it('실서버 모드: 토큰 없이 열리면 버튼보다 먼저 한 번 조용히 로그인 확인(silent=true)하러 간다', async () => {
    env.isMock = false;
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    renderAt('/employees', null);
    expect(await screen.findByRole('status')).toHaveTextContent('로그인 확인 중');
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const url = new URL(assign.mock.calls[0]![0]);
    expect(url.searchParams.get('app')).toBe('hr-backoffice');
    expect(url.searchParams.get('silent')).toBe('true');
    expect(sessionStorage.getItem(LOGIN_SILENT_KEY)).toBe('1');
  });

  it('실서버 모드: ?error=LOGIN_REQUIRED 로 돌아오면 오류 문구 없이 로그인 버튼', async () => {
    env.isMock = false;
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    await beginSilentEmployeeLogin(API_BASE, '/employees', new TokenStore());
    renderAt('/auth/callback?error=LOGIN_REQUIRED', null);
    expect(await screen.findByRole('button', { name: '직원 계정으로 로그인' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('로그인 전에는 업무 화면 대신 로그인으로 보낸다', async () => {
    renderAt('/employees', null);
    expect(await screen.findByRole('heading', { name: '인사팀 백오피스 로그인' })).toBeInTheDocument();
  });
});

describe('목 로그인(티켓 교환부터는 실제와 같은 코드)', () => {
  it('인사 담당: 티켓 교환(공개 요청·X-Device-Id·X-Source-System·Idempotency-Key) → 직원 목록, refresh 는 sessionStorage 에만', async () => {
    const view = renderAt('/login', null);
    await userEvent.click(screen.getByRole('button', { name: /인사 담당/ }));
    expect(await screen.findByRole('heading', { name: '직원 목록' })).toBeInTheDocument();
    expect(await screen.findByText('한인사')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '한인사 — 내 정보 메뉴' })).toBeInTheDocument(); // 머리줄 내 정보 메뉴 — 운영자 ID 대신 이름(2026-11-23)

    const exchange = view.mutations('/employee-auth/tokens')[0]!;
    expect(exchange.headers.get('Authorization')).toBeNull();
    expect(exchange.headers.get('X-Source-System')).toBe('hr-backoffice-web');
    expect(exchange.headers.get('X-Device-Id')).toBeTruthy();
    expect(exchange.headers.get('Idempotency-Key')).toBeTruthy();
    const body = (await exchange.json()) as { ticket: string; codeVerifier: string };
    expect(body.ticket).toBe('mock.OP-hr-1');
    expect(body.codeVerifier).toHaveLength(43);

    expect(sessionStorage.getItem(LOGIN_PENDING_KEY)).toBeNull(); // verifier 는 한 번만 쓴다
    const saved = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY)!) as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(['deviceId', 'refreshToken']); // access token 은 저장하지 않는다
    expect(window.localStorage.length).toBe(0);
  });

  it('인사 권한이 없는 직원: 안내를 보이고, 목록은 서버 403 → "이용할 수 없는 화면"(빈 목록 아님)', async () => {
    renderAt('/login', null);
    await userEvent.click(screen.getByRole('button', { name: /상품 담당/ }));
    expect(await screen.findByRole('note')).toHaveTextContent('인사 권한이 없습니다');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-state', 'forbidden');
    expect(screen.queryByText('조건에 맞는 직원이 없어요.')).not.toBeInTheDocument();
  });

  it('정지된 직원의 티켓: 로그인되지 않고 사유를 안내한다', async () => {
    renderAt('/auth/callback?ticket=mock.OP-sus-1', null);
    // 이 탭에서 시작한 로그인이 아니면(verifier 없음) 서버에 보내지 않는다
    expect(await screen.findByRole('alert')).toHaveTextContent('이 탭에서 시작한 로그인이 아니에요');
  });

  it('복귀 주소 ?error=: 코드에 맞는 안내와 다시 로그인', async () => {
    renderAt('/auth/callback?error=EMPLOYEE_NOT_REGISTERED', null);
    expect(await screen.findByRole('alert')).toHaveTextContent('PMart 직원으로 등록되지 않았어요');
    expect(screen.getByRole('link', { name: '다시 로그인' })).toBeInTheDocument();
  });
});

describe('내 세션·로그아웃', () => {
  it('내 인사 정보(/hr/employees/me)와 서버 세션을 보인다 — 인사 권한이 없어도 본인 정보는 보인다', async () => {
    renderAt('/session', as.md);
    await waitFor(() => expect(screen.getByTestId('my-profile')).toHaveTextContent('김상품')); // 머리줄 메뉴에도 이름이 있어 화면 프로필 안에서
    expect(screen.getByText('md.kim@pmart.com')).toBeInTheDocument();
    expect(await screen.findByText('인사 백오피스')).toBeInTheDocument(); // 로그인한 곳(서버 app 값을 이름으로)
  });

  it('로그아웃(SSO): 토큰을 지운 뒤 Keycloak 로그아웃 주소로 브라우저를 옮긴다', async () => {
    const idpLogoutUri = 'https://192.168.0.40:8443/iam/realms/pmart-staff/protocol/openid-connect/logout?id_token_hint=HINT';
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    server.use(http.post(`${API_BASE}/employee-auth/logouts`, () => HttpResponse.json({ idpLogoutUri })));
    renderAt('/session');
    await userEvent.click(await screen.findByRole('button', { name: '로그아웃' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(idpLogoutUri));
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('서버가 로그아웃을 확인해 주지 못하면 이동하지 않고, 로그인 화면에서 브라우저를 닫으라고 안내한다', async () => {
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    server.use(http.post(`${API_BASE}/employee-auth/logouts`, () => new HttpResponse(null, { status: 503 })));
    renderAt('/session');
    await userEvent.click(await screen.findByRole('button', { name: '로그아웃' }));
    expect(await screen.findByText(/브라우저를 닫아 주세요/)).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('로그아웃 전파 — 탭이 다시 보일 때 세션 확인(ADR-0061)', () => {
  it('탭이 다시 보이면 세션을 한 번 확인하고, 살아 있으면 화면은 그대로다(30초 안에는 다시 부르지 않는다)', async () => {
    const view = renderAt('/session');
    await screen.findByRole('button', { name: '로그아웃' });
    // 세션 응답(역할·센터) 한 번 + 내 세션 화면이 부른 한 번
    await waitFor(() => expect(view.gets('/employee-auth/sessions/current')).toHaveLength(2));
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(view.gets('/employee-auth/sessions/current')).toHaveLength(3));
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 30));
    expect(view.gets('/employee-auth/sessions/current')).toHaveLength(3);
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
  });

  it('다른 앱에서 로그아웃돼 세션이 끝나 있으면(401, 갱신 거절) 로그인 화면으로 간다', async () => {
    renderAt('/session');
    await screen.findByRole('button', { name: '로그아웃' });
    server.use(
      http.get(`${API_BASE}/employee-auth/sessions/current`, () =>
        HttpResponse.json({ type: 'about:blank', title: 'blocked', status: 401, code: 'SUBJECT_BLOCKED' }, { status: 401, headers: { 'content-type': 'application/problem+json' } }),
      ),
    );
    document.dispatchEvent(new Event('visibilitychange'));
    expect(await screen.findByRole('button', { name: /인사 담당/ })).toBeInTheDocument(); // 목 모드의 로그인 화면
  });
});
