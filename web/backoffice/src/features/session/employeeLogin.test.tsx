// 직원 로그인 employee-auth(실서버 모드 — 게이트웨이 로그인 시작·티켓 교환·갱신·SSO 로그아웃) — 백엔드 handoff 2026-11-12, 계약 employee-auth-service.yaml.
// 목 계정 버튼 로그인은 mockLogin.test.tsx.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_BASE, createApi, SOURCE_SYSTEM, tokens } from '../../api/client';
import { SESSION_STORAGE_KEY } from '../../api/sessionPersistence';
import {
  beginEmployeeLogin,
  beginSilentEmployeeLogin,
  browser,
  canTrySilentLogin,
  codeChallenge,
  completeEmployeeLogin,
  EmployeeLoginError,
  LOGIN_PENDING_KEY,
  LOGIN_SILENT_KEY,
  logoutEmployee,
  refreshEmployeeTokens,
} from '../../api/employeeAuth';
import { PmartFailure } from '@pmart/web-core';
import { createPmartFetch } from '@pmart/web-core';
import { mockOperatorToken } from '@pmart/web-core';
import { sha256Fallback } from '@pmart/web-core';
import { TokenStore, watchEmployeeSessionOnVisible } from '@pmart/web-core';
import { App } from '../../app/App';
import { env } from '../../env';
import { problem } from '../../mocks/support';
import { server } from '../../test/server';

// 이 파일은 실서버 모드의 로그인 화면(목 계정 버튼 없음)을 본다.
// 조용한 로그인 확인(silent)은 이미 한 것으로 둔다 — 그 흐름은 아래 '조용한 로그인 확인' 에서 따로 본다.
beforeEach(() => {
  env.isMock = false;
  sessionStorage.setItem(LOGIN_SILENT_KEY, '1');
});
afterEach(() => {
  env.isMock = true;
  vi.restoreAllMocks();
});

const ORIGIN = 'http://192.168.0.40';
const IDP_LOGOUT = 'https://192.168.0.40:8443/iam/realms/pmart-staff/protocol/openid-connect/logout?id_token_hint=HINT&post_logout_redirect_uri=http%3A%2F%2F192.168.0.40%2Flogin';
const access = (roles: readonly string[] = ['PRICE_APPROVER']) =>
  mockOperatorToken({ sub: 'OP-ea-1', roles, centers: ['MFC-GANGNAM'], sid: 'SES-ea-1', exp: 1_800_000_000 });
const pair = (accessToken = access(), refreshToken = 'ea-refresh-1') => ({
  accessToken,
  refreshToken,
  refreshTransport: 'BODY' as const,
  accessTokenExpiresAt: '2026-11-12T10:15:00Z',
  refreshTokenExpiresAt: '2026-11-12T22:00:00Z',
  sessionId: 'SES-ea-1',
});

/**
 * 앱과 같은 구성의 독립 클라이언트. credentialsOf 는 실제로 fetch 에 넘어간 Request 의 credentials 를 경로 끝으로 찾는다
 * (MSW 핸들러의 request 는 credentials 를 옮겨 주지 않아 늘 same-origin 으로 보인다 — fetch 바로 앞에서 본다).
 */
function client() {
  const store = new TokenStore();
  const fetched: Request[] = [];
  const api: ReturnType<typeof createApi> = createApi(
    createPmartFetch({
      sourceSystem: SOURCE_SYSTEM,
      tokens: store,
      refresh: () => refreshEmployeeTokens(api, store),
      sleep: () => Promise.resolve(),
      fetchImpl: (r) => {
        fetched.push(r);
        return fetch(r);
      },
    }),
  );
  const credentialsOf = (pathEnd: string) => fetched.filter((r) => new URL(r.url).pathname.endsWith(pathEnd)).map((r) => r.credentials);
  return { api, store, credentialsOf };
}

interface Sent {
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
}

/** 티켓 교환 가짜. reply 가 응답을 고른다 */
function exchangeHandler(reply: () => Response = () => HttpResponse.json({ operatorId: 'OP-ea-1', roles: ['PRICE_APPROVER'], centers: ['MFC-GANGNAM'], tokens: pair() })) {
  const sent: Sent[] = [];
  server.use(
    http.post('*/api/v1/employee-auth/tokens', async ({ request }) => {
      sent.push({ headers: request.headers, body: (await request.json()) as Record<string, unknown> });
      return reply();
    }),
  );
  return sent;
}

const pending = () => JSON.parse(sessionStorage.getItem(LOGIN_PENDING_KEY)!) as { verifier: string; deviceId: string; from: string };
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

describe('SHA-256·code_challenge', () => {
  it('순수 JS SHA-256 이 표준 값과 같다(LAN 은 http 라 crypto.subtle 이 없다)', async () => {
    const enc = new TextEncoder();
    expect(toHex(sha256Fallback(enc.encode('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(toHex(sha256Fallback(enc.encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const n of [55, 56, 63, 64, 65, 1000]) {
      const data = crypto.getRandomValues(new Uint8Array(n));
      expect(toHex(sha256Fallback(data))).toBe(toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data))));
    }
  });

  it('code_challenge 가 RFC 7636 부록 B 예시와 같다', async () => {
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('로그인 시작', () => {
  it('게이트웨이 로그인 시작 주소: app·deviceId·codeChallenge(S256)·returnUri /auth/callback, verifier 는 싣지 않는다', async () => {
    const store = new TokenStore();
    const url = new URL(await beginEmployeeLogin('http://192.168.0.40:8080/api/v1', '/prices', store, { origin: ORIGIN }));
    expect(`${url.origin}${url.pathname}`).toBe('http://192.168.0.40:8080/api/v1/employee-auth/logins');
    const q = url.searchParams;
    const p = pending();
    expect(q.get('app')).toBe('backoffice');
    expect(q.get('deviceId')).toBe(store.deviceId);
    expect(q.get('codeChallengeMethod')).toBe('S256');
    expect(q.get('returnUri')).toBe('http://192.168.0.40/auth/callback');
    expect(p.verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(q.get('codeChallenge')).toBe(await codeChallenge(p.verifier));
    expect(url.href).not.toContain(p.verifier);
    expect(p).toMatchObject({ deviceId: store.deviceId, from: '/prices' });
  });
});

describe('티켓 교환', () => {
  it('티켓 + verifier 를 시작한 기기 ID 로 보내 토큰을 받는다 — 페이지가 다시 열려도 기기 ID 를 되살리고, 기록은 한 번만 쓴다', async () => {
    const sent = exchangeHandler();
    const before = new TokenStore();
    await beginEmployeeLogin(API_BASE, '/prices', before, { origin: ORIGIN });
    const p = pending();
    const { api, store } = client(); // 복귀 뒤의 새 페이지(기기 ID 가 새로 만들어진 상태)
    expect(store.deviceId).not.toBe(p.deviceId);

    expect(await completeEmployeeLogin(api, new URLSearchParams({ ticket: 'TICKET-1' }), store)).toBe('/prices');

    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({ ticket: 'TICKET-1', codeVerifier: p.verifier });
    expect(sent[0]!.headers.get('X-Device-Id')).toBe(p.deviceId);
    expect(sent[0]!.headers.get('X-Source-System')).toBe(SOURCE_SYSTEM);
    expect(sent[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(sent[0]!.headers.has('Authorization')).toBe(false);
    expect(store.accessToken).toBe(access());
    expect(store.refreshToken).toBe('ea-refresh-1');
    expect(store.deviceId).toBe(p.deviceId);
    expect(sessionStorage.getItem(LOGIN_PENDING_KEY)).toBeNull();
  });

  it('같은 티켓으로 두 번 불러도(StrictMode) 요청은 한 번', async () => {
    const sent = exchangeHandler();
    const { api, store } = client();
    await beginEmployeeLogin(API_BASE, '/prices', store, { origin: ORIGIN });
    const params = new URLSearchParams({ ticket: 'TICKET-2' });
    const [a, b] = await Promise.all([completeEmployeeLogin(api, params, store), completeEmployeeLogin(api, params, store)]);
    expect([a, b]).toEqual(['/prices', '/prices']);
    expect(sent).toHaveLength(1);
  });

  it('복귀 주소 ?error= 는 코드 그대로, 모르는 값은 UNKNOWN — 토큰을 요청하지 않는다', async () => {
    const sent = exchangeHandler();
    const { api, store } = client();
    for (const [error, code] of [
      ['ACCOUNT_NOT_AVAILABLE', 'ACCOUNT_NOT_AVAILABLE'],
      ['IDP_UNAVAILABLE', 'IDP_UNAVAILABLE'],
      ['something_else', 'UNKNOWN'],
    ] as const) {
      await beginEmployeeLogin(API_BASE, '/prices', store, { origin: ORIGIN });
      await expect(completeEmployeeLogin(api, new URLSearchParams({ error }), store)).rejects.toMatchObject({ code });
      expect(sessionStorage.getItem(LOGIN_PENDING_KEY)).toBeNull();
    }
    expect(sent).toHaveLength(0);
  });

  it('이 탭에서 시작한 기록이 없으면 NO_PENDING, 티켓이 없으면 TICKET_INVALID — 요청하지 않는다', async () => {
    const sent = exchangeHandler();
    const { api, store } = client();
    await expect(completeEmployeeLogin(api, new URLSearchParams({ ticket: 'TICKET-3' }), store)).rejects.toMatchObject({ code: 'NO_PENDING' });
    await beginEmployeeLogin(API_BASE, '/prices', store, { origin: ORIGIN });
    await expect(completeEmployeeLogin(api, new URLSearchParams(), store)).rejects.toMatchObject({ code: 'TICKET_INVALID' });
    expect(sent).toHaveLength(0);
  });

  it('서버 거절: 401 → TICKET_INVALID, 403 ACCOUNT_NOT_AVAILABLE, 5xx → NETWORK(결과 불명 — 같은 티켓을 다시 보내지 않는다)', async () => {
    for (const [reply, code] of [
      [() => problem(401, 'TICKET_INVALID'), 'TICKET_INVALID'],
      [() => problem(403, 'ACCOUNT_NOT_AVAILABLE'), 'ACCOUNT_NOT_AVAILABLE'],
      [() => new HttpResponse(null, { status: 502 }), 'NETWORK'],
    ] as const) {
      const sent = exchangeHandler(reply);
      const { api, store } = client();
      await beginEmployeeLogin(API_BASE, '/prices', store, { origin: ORIGIN });
      const error: unknown = await completeEmployeeLogin(api, new URLSearchParams({ ticket: `T-${code}` }), store).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(EmployeeLoginError);
      expect((error as EmployeeLoginError).code).toBe(code);
      expect(sent).toHaveLength(1);
      expect(store.accessToken).toBeNull();
    }
  });
});

describe('갱신·로그아웃', () => {
  function refreshHandler(reply: () => Response) {
    const sent: Sent[] = [];
    server.use(
      http.post('*/api/v1/employee-auth/tokens/refresh', async ({ request }) => {
        sent.push({ headers: request.headers, body: (await request.json()) as Record<string, unknown> });
        return reply();
      }),
    );
    return sent;
  }

  it('갱신: refresh token 을 로그인한 기기 ID 로 보내고 새 쌍으로 바꾼다(회전)', async () => {
    const next = access(['PRICE_APPROVER', 'MD']);
    const sent = refreshHandler(() => HttpResponse.json(pair(next, 'ea-refresh-2')));
    const { api, store } = client();
    store.setPair(pair());
    expect(await refreshEmployeeTokens(api, store)).toBe(next);
    expect(sent[0]!.body).toEqual({ refreshToken: 'ea-refresh-1' });
    expect(sent[0]!.headers.get('X-Device-Id')).toBe(store.deviceId);
    expect(sent[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(store.refreshToken).toBe('ea-refresh-2');
  });

  it('갱신 거절(TOKEN_INVALID·TOKEN_REUSED)은 세션 종료(null), 5xx 는 종료로 단정하지 않고 던진다', async () => {
    for (const code of ['TOKEN_INVALID', 'TOKEN_REUSED']) {
      refreshHandler(() => problem(401, code));
      const { api, store } = client();
      store.setPair(pair());
      expect(await refreshEmployeeTokens(api, store)).toBeNull();
    }
    refreshHandler(() => problem(503, 'DEPENDENCY_UNAVAILABLE'));
    const { api, store } = client();
    store.setPair(pair());
    await expect(refreshEmployeeTokens(api, store)).rejects.toBeInstanceOf(PmartFailure);
    expect(store.refreshToken).toBe('ea-refresh-1');
  });

  function logoutHandler(reply: () => Response) {
    const sent: Sent[] = [];
    server.use(
      http.post('*/api/v1/employee-auth/logouts', async ({ request }) => {
        sent.push({ headers: request.headers, body: (await request.json()) as Record<string, unknown> });
        return reply();
      }),
    );
    return sent;
  }

  it('로그아웃(SSO): 직원 토큰으로 POST /employee-auth/logouts → 200 idpLogoutUri 를 돌려주고 토큰을 지운다', async () => {
    const sent = logoutHandler(() => HttpResponse.json({ idpLogoutUri: IDP_LOGOUT }));
    const { api, store } = client();
    store.setPair(pair());
    expect(await logoutEmployee(api, store)).toEqual({ idpLogoutUri: IDP_LOGOUT, idpSessionMayRemain: false });
    expect(store.accessToken).toBeNull();
    expect(store.refreshToken).toBeNull();
    expect(sent[0]!.headers.get('Authorization')).toBe(`Bearer ${access()}`);
    expect(sent[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(sent[0]!.body).toEqual({ allDevices: false });
  });

  it('로그아웃: 이미 끝난 세션(200, 주소 없음)은 그대로 끝, http(s) 가 아닌 주소는 버린다', async () => {
    for (const body of [{}, { idpLogoutUri: 'javascript:alert(1)' }, { idpLogoutUri: 'not a url' }]) {
      logoutHandler(() => HttpResponse.json(body));
      const { api, store } = client();
      store.setPair(pair());
      expect(await logoutEmployee(api, store)).toEqual({ idpSessionMayRemain: false });
      expect(store.accessToken).toBeNull();
    }
  });

  it('로그아웃: 서버가 실패해도 이 탭의 토큰은 지우고, Keycloak 세션이 남았을 수 있다고 알린다', async () => {
    logoutHandler(() => new HttpResponse(null, { status: 500 }));
    const { api, store } = client();
    store.setPair(pair());
    expect(await logoutEmployee(api, store)).toEqual({ idpSessionMayRemain: true });
    expect(store.accessToken).toBeNull();
    expect(store.refreshToken).toBeNull();
  });
});

describe('화면', () => {
  /** 0.6.0: 화면의 역할·센터는 이 응답에서 읽는다 */
  function sessionHandler(roles: readonly string[] = ['PRICE_APPROVER'], centers: readonly string[] = []) {
    server.use(
      http.get('*/api/v1/employee-auth/sessions/current', () =>
        HttpResponse.json({ sessionId: 'SES-ea-1', operatorId: 'OP-ea-1', app: 'backoffice', issuedAt: '2026-11-12T01:00:00Z', expiresAt: '2026-11-12T01:15:00Z', roles, centers }),
      ),
    );
  }

  it('로그인 화면은 "직원 계정으로 로그인" 버튼만 — 아이디·비밀번호를 받지 않는다', () => {
    render(<App memory initialPath="/login" />);
    expect(screen.getByRole('button', { name: '직원 계정으로 로그인' })).toBeInTheDocument();
    expect(screen.queryByLabelText('비밀번호')).not.toBeInTheDocument();
  });

  it('/auth/callback?ticket= 으로 돌아오면 토큰을 받아 원래 화면으로 — 세션은 employee-auth 에서 읽고 비밀번호 변경은 없다', async () => {
    const exchanged = exchangeHandler();
    sessionHandler();
    await beginEmployeeLogin(API_BASE, '/session', new TokenStore(), { origin: ORIGIN });
    const paths: string[] = [];
    const listener = ({ request }: { request: Request }) => void paths.push(new URL(request.url).pathname);
    server.events.on('request:start', listener);

    render(<App memory initialPath="/auth/callback?ticket=TICKET-UI" />);

    expect(await screen.findByRole('heading', { name: '내 정보' })).toBeInTheDocument();
    // 머리줄 링크: 이름 · 사번(목에 없는 직원이면 "내 세션"만) — 운영자 ID 는 글자로 안 보인다(ADR-0070 덧붙임). 내 세션 화면 본문의 ID 는 상세라 그대로
    expect(screen.getByTestId('operator')).toHaveTextContent(/^.?내 정보/); // 목에 없는 직원 — 머리글자 "?" + "내 정보"
    expect(screen.getByTestId('operator')).not.toHaveTextContent('OP-ea-1');
    expect(screen.getByTestId('my-profile')).toHaveTextContent('가격 승인');
    expect(await screen.findByText('SES-ea-1')).toBeInTheDocument(); // 접힌 시스템 번호 칸
    expect(screen.getByText('통합 백오피스')).toBeInTheDocument();
    expect(screen.getByText(/직원 계정\(Keycloak\)에서 관리해요/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '비밀번호 변경' })).not.toBeInTheDocument();
    server.events.removeListener('request:start', listener);

    expect(exchanged).toHaveLength(1);
    expect(exchanged[0]!.body['ticket']).toBe('TICKET-UI');
  });

  it('역할이 비어 있으면 권한 승인 대기 안내', async () => {
    exchangeHandler(() => HttpResponse.json({ operatorId: 'OP-ea-1', roles: [], centers: [], tokens: pair(access([])) }));
    sessionHandler([]);
    await beginEmployeeLogin(API_BASE, '/session', new TokenStore(), { origin: ORIGIN });
    render(<App memory initialPath="/auth/callback?ticket=TICKET-NOROLE" />);
    expect(await screen.findByText(/권한 승인 대기/)).toBeInTheDocument();
  });

  it('?error=ACCOUNT_NOT_AVAILABLE 로 돌아오면 사유 안내 + 다시 로그인, 토큰을 요청하지 않는다', async () => {
    const exchanged = exchangeHandler();
    await beginEmployeeLogin(API_BASE, '/session', new TokenStore(), { origin: ORIGIN });
    render(<App memory initialPath="/auth/callback?error=ACCOUNT_NOT_AVAILABLE" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('정지되었거나 퇴사 처리된 계정이에요');
    expect(screen.getByRole('link', { name: '다시 로그인' })).toBeInTheDocument();
    expect(exchanged).toHaveLength(0);
  });
});

describe('refresh 쿠키(ADR-0059, handoff 2026-11-13 web-common-request-refresh-cookie)', () => {
  const CSRF = 'CSRF-VALUE-1';
  const cookiePair = (accessToken = access()) => ({
    accessToken,
    refreshToken: null,
    refreshTransport: 'COOKIE' as const,
    accessTokenExpiresAt: '2026-11-12T10:15:00Z',
    refreshTokenExpiresAt: '2026-11-12T22:00:00Z',
    sessionId: 'SES-ea-1',
  });
  const withCsrfCookie = (value: string | null = CSRF) =>
    vi.spyOn(browser, 'cookies').mockReturnValue(value === null ? 'other=1' : `other=1; __Secure-pmart_ea_csrf_SES-ea-1=${value}; __Secure-pmart_ea_csrf_SES-other=NOPE`);

  interface SentRefresh {
    readonly url: URL;
    readonly headers: Headers;
    readonly body: string;
  }
  function cookieRefreshHandler(reply: () => Response) {
    const sent: SentRefresh[] = [];
    server.use(
      http.post('*/api/v1/employee-auth/tokens/refresh/:sessionId', async ({ request }) => {
        sent.push({ url: new URL(request.url), headers: request.headers, body: await request.text() });
        return reply();
      }),
    );
    return sent;
  }
  /** 쿠키 방식으로 로그인한 상태 */
  function cookieClient() {
    const c = client();
    c.store.setPair(cookiePair());
    return c;
  }

  it('티켓 교환은 credentials: include, 응답이 COOKIE 면 refresh token 없이 세션 ID 만 둔다', async () => {
    server.use(
      http.post('*/api/v1/employee-auth/tokens', () =>
        HttpResponse.json({ operatorId: 'OP-ea-1', roles: ['PRICE_APPROVER'], centers: ['MFC-GANGNAM'], tokens: cookiePair() }),
      ),
    );
    const { api, store, credentialsOf } = client();
    await beginEmployeeLogin(API_BASE, '/prices', store, { origin: ORIGIN });
    await completeEmployeeLogin(api, new URLSearchParams({ ticket: 'TICKET-C' }), store);
    expect(credentialsOf('/employee-auth/tokens')).toEqual(['include']);
    expect(store.accessToken).toBe(access());
    expect(store.refreshToken).toBeNull();
    expect(store.cookieSessionId).toBe('SES-ea-1');
  });

  it('갱신: POST /tokens/refresh/{sessionId} — 그 세션의 CSRF 쿠키 값을 X-CSRF-Token 으로, credentials: include, 본문 없음', async () => {
    const next = access(['PRICE_APPROVER', 'MD']);
    const sent = cookieRefreshHandler(() => HttpResponse.json(cookiePair(next)));
    withCsrfCookie();
    const { api, store, credentialsOf } = cookieClient();
    expect(await refreshEmployeeTokens(api, store)).toBe(next);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url.pathname).toBe('/api/v1/employee-auth/tokens/refresh/SES-ea-1');
    expect(sent[0]!.headers.get('X-CSRF-Token')).toBe(CSRF);
    expect(sent[0]!.headers.get('X-Device-Id')).toBe(store.deviceId);
    expect(sent[0]!.headers.get('X-Source-System')).toBe(SOURCE_SYSTEM);
    expect(sent[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(sent[0]!.headers.has('Authorization')).toBe(false);
    expect(credentialsOf('/employee-auth/tokens/refresh/SES-ea-1')).toEqual(['include']);
    expect(sent[0]!.body).toBe('');
    expect(store.accessToken).toBe(next);
    expect(store.cookieSessionId).toBe('SES-ea-1');
  });

  it('CSRF 쿠키가 없으면 요청하지 않고 이 탭의 세션을 끝낸다(null)', async () => {
    const sent = cookieRefreshHandler(() => HttpResponse.json(cookiePair()));
    withCsrfCookie(null);
    const { api, store } = cookieClient();
    expect(await refreshEmployeeTokens(api, store)).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('403 CSRF_INVALID·401 TOKEN_INVALID·TOKEN_REUSED 는 세션 끝(null)', async () => {
    withCsrfCookie();
    for (const [status, code] of [
      [403, 'CSRF_INVALID'],
      [401, 'TOKEN_INVALID'],
      [401, 'TOKEN_REUSED'],
    ] as const) {
      cookieRefreshHandler(() => problem(status, code));
      const { api, store } = cookieClient();
      expect(await refreshEmployeeTokens(api, store)).toBeNull();
    }
  });

  it('결과를 모르는 갱신(연결 끊김·본문 없는 5xx)은 다시 보내지 않고 세션 끝으로 본다(null) — 옛 쿠키 재사용 방지', async () => {
    withCsrfCookie();
    for (const reply of [() => HttpResponse.error(), () => new HttpResponse(null, { status: 502 })]) {
      const sent = cookieRefreshHandler(reply);
      const { api, store } = cookieClient();
      expect(await refreshEmployeeTokens(api, store)).toBeNull();
      expect(sent).toHaveLength(1);
    }
  });

  it('401 → 쿠키 갱신 한 번 → 원 요청을 새 토큰으로 다시 보낸다. 갱신이 거절되면 토큰·세션 ID 를 비운다', async () => {
    const next = access(['PRICE_APPROVER', 'MD']);
    const sent = cookieRefreshHandler(() => HttpResponse.json(cookiePair(next)));
    withCsrfCookie();
    const seen: Array<string | null> = [];
    server.use(
      http.get('*/api/v1/employee-auth/sessions/current', ({ request }) => {
        seen.push(request.headers.get('Authorization'));
        return request.headers.get('Authorization') === `Bearer ${next}`
          ? HttpResponse.json({ sessionId: 'SES-ea-1', operatorId: 'OP-ea-1', app: 'backoffice', issuedAt: '2026-11-12T01:00:00Z', expiresAt: '2026-11-12T01:15:00Z', roles: ['PRICE_APPROVER'], centers: [] })
          : problem(401, 'TOKEN_EXPIRED');
      }),
    );
    const { api, store, credentialsOf } = cookieClient();
    const [a, b] = await Promise.all([api.employeeAuth.GET('/employee-auth/sessions/current', {}), api.employeeAuth.GET('/employee-auth/sessions/current', {})]);
    expect(a.response.status).toBe(200);
    expect(b.response.status).toBe(200);
    expect(sent).toHaveLength(1); // single-flight
    expect(new Set(credentialsOf('/employee-auth/sessions/current'))).toEqual(new Set(['same-origin'])); // 다른 API 는 쿠키 없이 Bearer 만
    expect(seen.filter((h) => h === `Bearer ${next}`)).toHaveLength(2);

    cookieRefreshHandler(() => problem(401, 'TOKEN_REUSED'));
    store.setPair(cookiePair());
    await expect(api.employeeAuth.GET('/employee-auth/sessions/current', {})).rejects.toBeInstanceOf(PmartFailure);
    expect(store.accessToken).toBeNull();
    expect(store.cookieSessionId).toBeNull();
  });

  it('로그아웃은 credentials: include(쿠키 삭제), 서버가 실패해도 세션 ID 를 지운다', async () => {
    server.use(http.post('*/api/v1/employee-auth/logouts', () => new HttpResponse(null, { status: 500 })));
    const { api, store, credentialsOf } = cookieClient();
    expect(await logoutEmployee(api, store)).toEqual({ idpSessionMayRemain: true });
    expect(credentialsOf('/employee-auth/logouts')).toEqual(['include']);
    expect(store.cookieSessionId).toBeNull();
  });

  it('화면: 쿠키 로그인 뒤 sessionStorage 에는 세션 ID·기기 ID 만 — 새로고침하면 쿠키 갱신으로 세션을 되살린다', async () => {
    server.use(
      http.post('*/api/v1/employee-auth/tokens', () =>
        HttpResponse.json({ operatorId: 'OP-ea-1', roles: ['PRICE_APPROVER'], centers: ['MFC-GANGNAM'], tokens: cookiePair() }),
      ),
      http.get('*/api/v1/employee-auth/sessions/current', () =>
        HttpResponse.json({ sessionId: 'SES-ea-1', operatorId: 'OP-ea-1', app: 'backoffice', issuedAt: '2026-11-12T01:00:00Z', expiresAt: '2026-11-12T01:15:00Z', roles: ['PRICE_APPROVER'], centers: ['MFC-GANGNAM'] }),
      ),
    );
    const sent = cookieRefreshHandler(() => HttpResponse.json(cookiePair()));
    withCsrfCookie();
    await beginEmployeeLogin(API_BASE, '/session', new TokenStore(), { origin: ORIGIN });
    const first = render(<App memory initialPath="/auth/callback?ticket=TICKET-COOKIE" />);
    expect(await screen.findByRole('heading', { name: '내 정보' })).toBeInTheDocument();
    const saved = sessionStorage.getItem(SESSION_STORAGE_KEY)!;
    expect(Object.keys(JSON.parse(saved) as Record<string, unknown>).sort()).toEqual(['deviceId', 'sessionId']);
    expect(saved).not.toContain('refresh');

    // 새로고침: 메모리 토큰은 사라지고 sessionStorage 만 남는다.
    first.unmount();
    tokens.accessToken = null;
    sessionStorage.setItem(SESSION_STORAGE_KEY, saved);
    render(<App memory initialPath="/session" />);
    expect(await screen.findByRole('heading', { name: '내 정보' })).toBeInTheDocument();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers.get('X-CSRF-Token')).toBe(CSRF);
  });

  it('화면: 새로고침했는데 쿠키 갱신이 거절되면 보관을 지우고 조용한 로그인 확인으로 넘어간다', async () => {
    cookieRefreshHandler(() => problem(403, 'CSRF_INVALID'));
    withCsrfCookie();
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    sessionStorage.removeItem(LOGIN_SILENT_KEY);
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ sessionId: 'SES-ea-1', deviceId: 'dev-1' }));
    render(<App memory initialPath="/prices" />);
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const url = new URL(assign.mock.calls[0]![0]);
    expect(url.searchParams.get('silent')).toBe('true');
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(pending().from).toBe('/prices');
  });
});

describe('조용한 로그인 확인(silent — handoff 2026-11-13 web-common-request-silent-login)', () => {
  beforeEach(() => sessionStorage.removeItem(LOGIN_SILENT_KEY));

  it('시작 주소에 silent=true, 이 탭에서 한 번만 — 두 번째는 null', async () => {
    const store = new TokenStore();
    expect(canTrySilentLogin()).toBe(true);
    const url = new URL((await beginSilentEmployeeLogin(API_BASE, '/prices', store, { origin: ORIGIN }))!);
    expect(url.pathname).toBe('/api/v1/employee-auth/logins');
    expect(url.searchParams.get('silent')).toBe('true');
    expect(url.searchParams.get('app')).toBe('backoffice');
    expect(url.searchParams.get('codeChallenge')).toBe(await codeChallenge(pending().verifier));
    expect(url.searchParams.get('returnUri')).toBe('http://192.168.0.40/auth/callback');
    expect(canTrySilentLogin()).toBe(false);
    expect(await beginSilentEmployeeLogin(API_BASE, '/prices', store, { origin: ORIGIN })).toBeNull();
    // 버튼 로그인 주소에는 silent 가 없다
    expect(new URL(await beginEmployeeLogin(API_BASE, '/prices', store, { origin: ORIGIN })).searchParams.has('silent')).toBe(false);
  });

  it('?error=LOGIN_REQUIRED 는 가려던 경로와 함께 알리고 토큰을 요청하지 않는다 — 다시 확인하지 않는다', async () => {
    const sent = exchangeHandler();
    const { api, store } = client();
    await beginSilentEmployeeLogin(API_BASE, '/prices?x=1', store, { origin: ORIGIN });
    await expect(completeEmployeeLogin(api, new URLSearchParams({ error: 'LOGIN_REQUIRED' }), store)).rejects.toMatchObject({ code: 'LOGIN_REQUIRED', from: '/prices?x=1' });
    expect(sent).toHaveLength(0);
    expect(canTrySilentLogin()).toBe(false);
  });

  it('티켓으로 돌아와 세션이 생기면 표시를 지운다(그 세션이 끝난 뒤 한 번 더 확인할 수 있다). 로그아웃하면 다시 표시한다', async () => {
    exchangeHandler();
    server.use(http.post('*/api/v1/employee-auth/logouts', () => HttpResponse.json({})));
    const { api, store } = client();
    await beginSilentEmployeeLogin(API_BASE, '/prices', store, { origin: ORIGIN });
    expect(await completeEmployeeLogin(api, new URLSearchParams({ ticket: 'TICKET-S' }), store)).toBe('/prices');
    expect(canTrySilentLogin()).toBe(true);
    await logoutEmployee(api, store);
    expect(canTrySilentLogin()).toBe(false);
  });

  it('화면: 토큰 없이 열리면 버튼을 보이기 전에 한 번 확인하러 간다(가려던 경로 보존)', async () => {
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    render(<App memory initialPath="/prices?state=ACTIVE" />);
    expect(await screen.findByRole('status')).toHaveTextContent('로그인 확인 중');
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(new URL(assign.mock.calls[0]![0]).searchParams.get('silent')).toBe('true');
    expect(screen.queryByRole('button', { name: '직원 계정으로 로그인' })).not.toBeInTheDocument();
    expect(pending().from).toBe('/prices?state=ACTIVE');
  });

  it('화면: ?error=LOGIN_REQUIRED 로 돌아오면 오류 문구 없이 로그인 버튼 — 버튼은 가려던 경로로 로그인을 시작한다', async () => {
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    await beginSilentEmployeeLogin(API_BASE, '/prices', new TokenStore(), { origin: ORIGIN });
    render(<App memory initialPath="/auth/callback?error=LOGIN_REQUIRED" />);
    const button = await screen.findByRole('button', { name: '직원 계정으로 로그인' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled(); // 다시 확인하러 가지 않는다
    await userEvent.click(button);
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(new URL(assign.mock.calls[0]![0]).searchParams.has('silent')).toBe(false);
    expect(pending().from).toBe('/prices');
  });
});

describe('운영자 계정 화면(없앰 — 직원 등록·권한은 인사팀 백오피스)', () => {
  it('메뉴에 없고, 계정 API 를 부르지 않는다', async () => {
    const paths: string[] = [];
    const listener = ({ request }: { request: Request }) => void paths.push(new URL(request.url).pathname);
    server.events.on('request:start', listener);
    render(<App memory initialPath="/approvals" initialToken={access(['OPERATOR_ADMIN'])} />);
    expect(await screen.findByRole('link', { name: '승인함' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '운영자 계정' })).not.toBeInTheDocument();
    server.events.removeListener('request:start', listener);
    expect(paths.some((p) => p.includes('/operator-accounts') || p.includes('/auth/operator-logins'))).toBe(false);
  });
});

describe('로그아웃 화면(SSO)', () => {
  afterEach(() => vi.restoreAllMocks());

  function signedIn(logoutReply: () => Response) {
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    server.use(
      http.get('*/api/v1/employee-auth/sessions/current', () =>
        HttpResponse.json({ sessionId: 'SES-ea-1', operatorId: 'OP-ea-1', app: 'backoffice', issuedAt: '2026-11-12T01:00:00Z', expiresAt: '2026-11-12T01:15:00Z', roles: ['PRICE_APPROVER'], centers: [] }),
      ),
      http.post('*/api/v1/employee-auth/logouts', () => logoutReply()),
    );
    render(<App memory initialPath="/session" initialToken={access()} />);
    return assign;
  }

  it('로그인 시작 버튼은 게이트웨이 로그인 시작 주소로 브라우저를 옮긴다', async () => {
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    render(<App memory initialPath="/login" />);
    await userEvent.click(screen.getByRole('button', { name: '직원 계정으로 로그인' }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign.mock.calls[0]![0]).toContain('/api/v1/employee-auth/logins?app=backoffice');
  });

  it('로그아웃하면 토큰을 지운 뒤 Keycloak 로그아웃 주소로 브라우저를 옮긴다', async () => {
    const assign = signedIn(() => HttpResponse.json({ idpLogoutUri: IDP_LOGOUT }));
    expect(screen.getByText(/공용 PC 에서는 자리를 뜰 때 꼭 로그아웃/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: '로그아웃' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(IDP_LOGOUT));
    expect(sessionStorage.getItem('pmart.backoffice.session')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('서버가 로그아웃을 확인해 주지 못하면 이동하지 않고, 로그인 화면에서 브라우저를 닫으라고 안내한다', async () => {
    const assign = signedIn(() => new HttpResponse(null, { status: 503 }));
    await userEvent.click(await screen.findByRole('button', { name: '로그아웃' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('브라우저를 닫아 주세요');
    expect(screen.getByRole('button', { name: '직원 계정으로 로그인' })).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('로그아웃 전파 — 탭이 다시 보일 때 세션 확인(ADR-0061)', () => {
  /** 가짜 document: visibilityState 를 바꾸고 visibilitychange 를 낸다 */
  function fakeDoc() {
    const target = new EventTarget();
    const doc = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    };
    const show = (state: DocumentVisibilityState = 'visible') => {
      doc.visibilityState = state;
      target.dispatchEvent(new Event('visibilitychange'));
    };
    return { doc: doc as unknown as Document, show };
  }
  const SESSION = { sessionId: 'SES-ea-1', operatorId: 'OP-ea-1', app: 'backoffice', issuedAt: '2026-11-12T01:00:00Z', expiresAt: '2026-11-12T01:15:00Z', roles: ['PRICE_APPROVER'], centers: [] };
  /** sessions/current 호출을 모은다(Authorization 값) */
  function currentHandler(reply: () => Response | Promise<Response>) {
    const calls: Array<string | null> = [];
    server.use(
      http.get('*/api/v1/employee-auth/sessions/current', ({ request }) => {
        calls.push(request.headers.get('Authorization'));
        return reply();
      }),
    );
    return calls;
  }
  const settle = () => new Promise((r) => setTimeout(r, 30));

  it('보이게 될 때 세션이 있으면 한 번 확인한다(Bearer, 쿠키 없음). 200 이면 그대로', async () => {
    const calls = currentHandler(() => HttpResponse.json(SESSION));
    const { api, store, credentialsOf } = client();
    store.setPair(pair());
    const { doc, show } = fakeDoc();
    watchEmployeeSessionOnVisible(api, store, { doc });
    show('hidden');
    await settle();
    expect(calls).toHaveLength(0); // 가려질 때는 부르지 않는다
    show();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toBe(`Bearer ${access()}`);
    expect(credentialsOf('/employee-auth/sessions/current')).toEqual(['same-origin']);
    expect(store.accessToken).toBe(access());
  });

  it('세션이 없으면 부르지 않는다. 그만 보면(해제) 부르지 않는다', async () => {
    const calls = currentHandler(() => HttpResponse.json(SESSION));
    const { api, store } = client();
    const { doc, show } = fakeDoc();
    const stop = watchEmployeeSessionOnVisible(api, store, { doc });
    show();
    await settle();
    expect(calls).toHaveLength(0);
    store.setPair(pair());
    stop();
    show();
    await settle();
    expect(calls).toHaveLength(0);
  });

  it('마지막 확인 뒤 30초 안이면 건너뛴다', async () => {
    const calls = currentHandler(() => HttpResponse.json(SESSION));
    const { api, store } = client();
    store.setPair(pair());
    const { doc, show } = fakeDoc();
    let at = 1_000_000;
    watchEmployeeSessionOnVisible(api, store, { doc, now: () => at });
    show();
    await waitFor(() => expect(calls).toHaveLength(1));
    at += 29_999;
    show();
    await settle();
    expect(calls).toHaveLength(1);
    at += 1;
    show();
    await waitFor(() => expect(calls).toHaveLength(2));
  });

  it('401 이고 갱신도 거절되면(다른 앱에서 로그아웃) 이 탭의 세션을 지운다', async () => {
    currentHandler(() => problem(401, 'SUBJECT_BLOCKED'));
    server.use(http.post('*/api/v1/employee-auth/tokens/refresh', () => problem(401, 'TOKEN_INVALID')));
    const { api, store } = client();
    store.setPair(pair());
    const { doc, show } = fakeDoc();
    watchEmployeeSessionOnVisible(api, store, { doc });
    show();
    await waitFor(() => expect(store.accessToken).toBeNull());
    expect(store.refreshToken).toBeNull();
  });

  it('네트워크 오류·5xx 는 아무것도 하지 않는다(세션 그대로)', async () => {
    const { api, store } = client();
    store.setPair(pair());
    const { doc, show } = fakeDoc();
    let at = 0;
    watchEmployeeSessionOnVisible(api, store, { doc, now: () => (at += 60_000) });
    for (const reply of [() => HttpResponse.error(), () => new HttpResponse(null, { status: 503 })]) {
      const calls = currentHandler(reply);
      show();
      await waitFor(() => expect(calls.length).toBeGreaterThan(0));
      await settle();
      expect(store.accessToken).toBe(access());
    }
  });

  it('앱: 탭으로 돌아왔을 때 세션이 끝나 있으면 로그인 화면으로 간다', async () => {
    currentHandler(() => problem(401, 'SUBJECT_BLOCKED'));
    server.use(http.post('*/api/v1/employee-auth/tokens/refresh', () => problem(401, 'TOKEN_INVALID')));
    render(<App memory initialPath="/session" initialToken={access()} />);
    await screen.findByRole('button', { name: '로그아웃' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(await screen.findByRole('button', { name: '직원 계정으로 로그인' })).toBeInTheDocument();
  });
});
