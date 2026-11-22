// 목 모드 로그인(목 계정 버튼 → 목 티켓) — 티켓 교환부터는 실서버와 같은 코드(employee-auth-service).
// 세션 복원·갱신(refresh 회전)·로그아웃을 목 서버로 끝까지 돌려 본다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { createPmartFetch, request, TokenStore } from '@pmart/web-core';
import { API_BASE, createApi, SOURCE_SYSTEM, tokens } from '../../api/client';
import { beginEmployeeLogin, completeEmployeeLogin, LOGIN_PENDING_KEY, refreshEmployeeTokens } from '../../api/employeeAuth';
import { SESSION_STORAGE_KEY } from '../../api/sessionPersistence';
import { App } from '../../app/App';
import { mockAuthPolicy } from '../../mocks/authHandlers';
import { db } from '../../mocks/db';
import { mockAccounts, mockTokenFor } from '../../mocks/operators';
import { server } from '../../test/server';

const ACCESS = mockAuthPolicy.accessSeconds;
afterEach(() => {
  mockAuthPolicy.accessSeconds = ACCESS;
});

/** 앱과 같은 구성의 독립 클라이언트(토큰 저장소를 테스트가 들여다본다) */
function client() {
  const store = new TokenStore();
  const api: ReturnType<typeof createApi> = createApi(
    createPmartFetch({ sourceSystem: SOURCE_SYSTEM, tokens: store, refresh: () => refreshEmployeeTokens(api, store) }),
  );
  return { api, store };
}

/** 화면 없이 목 계정으로 로그인한다(로그인 시작 → 목 티켓 교환) */
async function signIn(api: ReturnType<typeof createApi>, store: TokenStore, operatorId = 'op-md-1') {
  await beginEmployeeLogin(API_BASE, '/products', store);
  await completeEmployeeLogin(api, new URLSearchParams({ ticket: `mock.${operatorId}` }), store);
}

function recordRequests() {
  const sent: Request[] = [];
  const listener = ({ request: r }: { request: Request }) => {
    sent.push(r.clone());
  };
  server.events.on('request:start', listener);
  return { sent, stop: () => server.events.removeListener('request:start', listener) };
}

// 시험 계정은 역할 안에 있어 처음 화면에는 없다(2026-11-20) — 위 검색칸에 이름을 치면 바로 나온다. 단추 이름은 그대로.
const clickAccount = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  await user.type(await screen.findByRole('searchbox', { name: '시험 계정 찾기' }), name.source);
  await user.click(await screen.findByRole('button', { name }));
};

describe('목 로그인 화면', () => {
  it('세션이 없으면 로그인으로 보내고, 목 계정으로 로그인하면 가려던 화면으로 돌아간다 — 아이디·비밀번호를 받지 않는다', async () => {
    const user = userEvent.setup();
    const rec = recordRequests();
    render(<App memory initialPath="/products?saleState=ON_SALE" />);

    expect(await screen.findByRole('heading', { name: '운영자 로그인' })).toBeInTheDocument();
    expect(screen.queryByLabelText('비밀번호')).not.toBeInTheDocument();
    await clickAccount(user, /MD 김/);

    expect(await screen.findByRole('heading', { name: '상품 조회' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '[목] 김엠디 — 내 정보 메뉴' })).toBeInTheDocument(); // 운영자 ID 대신 이름 · 사번(ADR-0070 덧붙임)

    const post = rec.sent.find((r) => new URL(r.url).pathname.endsWith('/employee-auth/tokens'));
    expect(post?.headers.get('X-Source-System')).toBe('backoffice-web');
    expect(post?.headers.get('X-Device-Id')).toMatch(/[0-9a-f-]{36}/);
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(post?.headers.has('Authorization')).toBe(false);
    const body = (await post!.json()) as { ticket: string; codeVerifier: string };
    expect(body.ticket).toBe('mock.op-md-1');
    expect(body.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(sessionStorage.getItem(LOGIN_PENDING_KEY)).toBeNull(); // verifier 는 한 번만 쓴다
    // 옛 운영자 로그인 경로는 부르지 않는다
    expect(rec.sent.some((r) => new URL(r.url).pathname.includes('/auth/operator-logins'))).toBe(false);
    // 로그인 뒤 요청은 Bearer 를 붙인다
    await waitFor(() => {
      const list = rec.sent.find((r) => new URL(r.url).pathname.endsWith('/products'));
      expect(list?.headers.get('Authorization')).toMatch(/^Bearer /);
    });
    rec.stop();
  });

  it('로그인 화면을 바로 열어 로그인하면(갈 곳 없음) 첫 화면은 대시보드(2026-11-19 사용자)', async () => {
    const user = userEvent.setup();
    render(<App memory initialPath="/login" />);
    expect(await screen.findByRole('heading', { name: '운영자 로그인' })).toBeInTheDocument();
    await clickAccount(user, /관리자/);
    expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '승인함' })).not.toBeInTheDocument();
  });

  it('새로고침(앱 다시 마운트)해도 이 탭에 보관한 refresh token 으로 세션을 되살려 로그인 화면으로 보내지 않는다', async () => {
    const user = userEvent.setup();
    const first = render(<App memory initialPath="/products" />);
    await clickAccount(user, /MD 김/);
    expect(await screen.findByRole('heading', { name: '상품 조회' })).toBeInTheDocument();
    const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
    expect(Object.keys(JSON.parse(saved!) as Record<string, unknown>).sort()).toEqual(['deviceId', 'refreshToken']); // access 는 저장하지 않는다
    expect(window.localStorage.length).toBe(0);
    const savedRefresh = (JSON.parse(saved!) as { refreshToken: string }).refreshToken;

    // 새로고침: 메모리 토큰은 사라지고 sessionStorage 만 남는다.
    first.unmount();
    tokens.accessToken = null;
    sessionStorage.setItem(SESSION_STORAGE_KEY, saved!);
    render(<App memory initialPath="/products" />);

    expect(await screen.findByRole('heading', { name: '상품 조회' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '운영자 로그인' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '[목] 김엠디 — 내 정보 메뉴' })).toBeInTheDocument(); // 운영자 ID 대신 이름 · 사번(ADR-0070 덧붙임)
    // refresh 는 회전된다(같은 값을 다시 쓰지 않는다).
    const rotated = (JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY)!) as { refreshToken: string }).refreshToken;
    expect(rotated).not.toBe(savedRefresh);
  });

  it('보관한 refresh token 이 더는 유효하지 않으면(세션 종료) 보관을 지우고 로그인 화면으로 보낸다', async () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ refreshToken: 'rt-gone', deviceId: 'dev-1' }));
    render(<App memory initialPath="/products" />);

    expect(await screen.findByRole('heading', { name: '운영자 로그인' })).toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('내 정보는 employee-auth 서버 세션을 보이고, 로그아웃하면 서버 세션을 끝내고 로그인 화면으로 간다', async () => {
    const user = userEvent.setup();
    render(<App memory initialPath="/session" />);
    await clickAccount(user, /승인자 이/);

    expect(await screen.findByRole('heading', { name: '내 정보' })).toBeInTheDocument();
    expect(await screen.findByText('통합 백오피스')).toBeInTheDocument();
    expect(screen.getByTestId('my-profile')).toHaveTextContent('상품 승인, 전시 승인, 가격 승인'); // 역할은 한글 이름, 글자로만(2026-11-23)
    expect(screen.queryByRole('button', { name: '비밀번호 변경' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '로그아웃' }));

    expect(await screen.findByRole('heading', { name: '운영자 로그인' })).toBeInTheDocument();
    expect([...db.sessions.values()].every((s) => s.revoked)).toBe(true);
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('역할이 없는 계정은 권한 승인 대기 안내를 본다', async () => {
    const user = userEvent.setup();
    render(<App memory initialPath="/session" />);
    await clickAccount(user, /센터 박/);
    expect(await screen.findByText(/권한 승인 대기/)).toBeInTheDocument();
  });

  it('토큰을 갱신할 수 없으면(세션 종료) 로그인 화면으로 보낸다', async () => {
    const expired = mockTokenFor(mockAccounts[1], 'sess-gone');
    db.sessions.set('sess-gone', {
      sessionId: 'sess-gone',
      operatorId: 'op-md-1',
      deviceId: 'x',
      refreshToken: 'rt-x',
      used: new Set(),
      revoked: true,
      issuedAt: '2026-10-30T00:00:00Z',
    });
    render(<App memory initialPath="/products" initialToken={expired} />);
    expect(await screen.findByRole('heading', { name: '운영자 로그인' })).toBeInTheDocument();
  });

  it('목 서버는 모르는 계정의 티켓을 거절한다', async () => {
    const { api, store } = client();
    await beginEmployeeLogin(API_BASE, '/products', store);
    await expect(completeEmployeeLogin(api, new URLSearchParams({ ticket: 'mock.op-nobody' }), store)).rejects.toMatchObject({ code: 'TICKET_INVALID' });
    expect(store.accessToken).toBeNull();
  });
});

describe('토큰 갱신(refresh 회전) — 목 서버', () => {
  it('동시에 401 이 나도 갱신은 한 번, 새 refresh token 으로 바꾸고 원 요청을 다시 보낸다', async () => {
    const { api, store } = client();
    mockAuthPolicy.accessSeconds = -1; // 이미 만료된 access token
    await signIn(api, store);
    mockAuthPolicy.accessSeconds = ACCESS;
    const firstRefresh = store.refreshToken;
    const rec = recordRequests();

    const [a, b] = await Promise.all([request('GET', api.approval.GET('/approvals', {})), request('GET', api.product.GET('/products', {}))]);

    expect(a.items).toBeDefined();
    expect(b.items).toBeDefined();
    const refreshes = rec.sent.filter((r) => new URL(r.url).pathname.endsWith('/employee-auth/tokens/refresh'));
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]?.headers.get('X-Device-Id')).toBe(store.deviceId);
    expect(refreshes[0]?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(refreshes[0]?.headers.has('Authorization')).toBe(false);
    expect(store.refreshToken).not.toBe(firstRefresh);
    rec.stop();
  });

  it('이미 쓴 refresh token 을 다시 보내면 TOKEN_REUSED → 세션 종료(null)', async () => {
    const { api, store } = client();
    await signIn(api, store);
    const old = store.refreshToken!;
    expect(await refreshEmployeeTokens(api, store)).toBeTruthy();

    store.setPair({ accessToken: store.accessToken!, refreshToken: old });
    expect(await refreshEmployeeTokens(api, store)).toBeNull();
    expect([...db.sessions.values()][0]?.revoked).toBe(true);
  });

  it('갱신 때 역할을 다시 읽는다(바뀐 역할이 새 토큰에 반영)', async () => {
    const { api, store } = client();
    await signIn(api, store);
    db.grants.set('op-md-1', { roles: ['MD', 'PRICE_APPROVER'], centers: [] });
    const access = await refreshEmployeeTokens(api, store);
    const claims = JSON.parse(atob(access!.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { roles: string[] };
    expect(claims.roles).toEqual(['MD', 'PRICE_APPROVER']);
  });
});

describe('머리줄 내 정보 메뉴(2026-11-23)', () => {
  it('누르면 이름·사번·역할과 "내 정보"·"로그아웃" — 운영자 ID 는 글자로 안 보인다, Esc 로 닫힘', async () => {
    const user = userEvent.setup();
    render(<App memory initialPath="/products" />);
    await clickAccount(user, /MD 김/);
    const trigger = await screen.findByRole('button', { name: '[목] 김엠디 — 내 정보 메뉴' });
    await user.click(trigger);
    const menu = screen.getByTestId('user-menu');
    expect(menu).toHaveTextContent('P2026-00002');
    expect(menu).toHaveTextContent('MD');
    expect(menu).not.toHaveTextContent(/OP-/);
    expect(within(menu).getByRole('menuitem', { name: '내 정보' })).toHaveAttribute('href', '/session');
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('user-menu')).not.toBeInTheDocument();
  });
});
