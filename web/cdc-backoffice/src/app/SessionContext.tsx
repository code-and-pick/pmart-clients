// 직원 세션(employee-auth-service, app=cdc-backoffice). access token 은 메모리, refresh token 은 HttpOnly 쿠키(ADR-0059 — 이 탭의 sessionStorage 에는 세션 ID 만. 목·시험은 본문 refresh token).
// 로그인: 게이트웨이 로그인 시작 → Keycloak 화면 → /auth/callback?ticket= → 티켓 교환. 401 → refresh 회전(pmartFetch), 갱신 거절 → 세션 종료.
// 화면에 보이는 역할·센터는 `GET /employee-auth/sessions/current` 응답에서 읽는다(employee-auth 0.6.0, @pmart/web-core operatorSession — 토큰을 풀지 않는다. 판정은 서버).
// 로그인·갱신·로그아웃 로직은 @pmart/web-core(createEmployeeAuth) — 백오피스와 같은 코드다.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { createOperatorSessionSource, parseOperatorToken, type OperatorSession } from '@pmart/web-core';
import { QueryState, uiStateFromError } from '@pmart/web-ui';
import { API_BASE, tokens } from '../api/client';
import {
  beginEmployeeLogin,
  beginSilentEmployeeLogin,
  browser,
  CALLBACK_PATH,
  canTrySilentLogin,
  completeEmployeeLogin,
  logoutEmployee,
  refreshEmployeeTokens,
} from '../api/employeeAuth';
import { clearSavedSession, loadSavedSession, syncSavedSession } from '../api/sessionPersistence';
import { messages as m } from '../shared/messages';
import { useApi } from './ApiContext';

interface SessionValue {
  /** 서버가 준 지금 세션(역할·센터). 받기 전·실패면 null — 로그인 여부는 signedIn 으로 본다 */
  readonly session: OperatorSession | null;
  /** 이 탭에 토큰이 있다(세션 응답을 받기 전에도 참) */
  readonly signedIn: boolean;
  /** 세션 응답 받기: 'loading'(처음 받는 중)·'failed'(처음 받기 실패 — failure)·'ready'·'signed-out' */
  readonly sessionStatus: 'signed-out' | 'loading' | 'ready' | 'failed';
  readonly sessionFailure: unknown;
  /** 세션 응답을 다시 받는다(실패 뒤 "다시 시도") */
  readonly reloadSession: () => void;
  /** 새로고침 뒤 보관한 refresh 로 세션을 되살리는 중. 끝날 때까지 로그인으로 보내지 않는다. */
  readonly restoring: boolean;
  /** 게이트웨이 로그인 시작 주소로 브라우저를 옮긴다(돌아올 앱 경로) */
  readonly startLogin: (from: string) => Promise<void>;
  /** 이 탭에서 조용한 로그인 확인(silent)을 아직 하지 않았다 — 로그인 버튼을 보이기 전에 한 번 한다 */
  readonly canTrySilentLogin: () => boolean;
  /**
   * 조용한 로그인 확인: 화면 없이 Keycloak 세션만 확인하러 브라우저를 옮긴다(→ /auth/callback?ticket= 또는 ?error=LOGIN_REQUIRED).
   * 옮겼으면 true, 이미 한 번 했으면 false(로그인 버튼을 보인다).
   */
  readonly startSilentLogin: (from: string) => Promise<boolean>;
  /**
   * 목 모드 전용: Keycloak 화면 대신 목 티켓으로 복귀 주소(앱 안 경로)를 돌려준다 — 호출한 쪽이 그 경로로 이동한다.
   * 티켓 교환부터는 실제와 같은 코드가 돈다.
   */
  readonly startMockLogin: (from: string, operatorId: string) => Promise<string>;
  /** 복귀 주소의 쿼리(ticket 또는 error)로 토큰을 받는다. 돌아갈 앱 경로 */
  readonly completeLogin: (params: URLSearchParams) => Promise<string>;
  /**
   * 로그아웃(SSO). 토큰을 지운 뒤 Keycloak 로그아웃 주소로 브라우저를 옮긴다(→ /login 으로 돌아온다).
   * 'idp-session-may-remain' = 서버 확인을 못 받아 Keycloak 세션이 남았을 수 있다(signOutUnconfirmed 로 로그인 화면에서 안내).
   */
  readonly logout: () => Promise<'done' | 'redirecting' | 'idp-session-may-remain'>;
  readonly signOutUnconfirmed: boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ initialToken, children }: { readonly initialToken?: string; readonly children: ReactNode }) {
  const api = useApi();
  const [source] = useState(() => {
    tokens.accessToken = initialToken ?? null;
    // initialToken 은 시험 전용(목 토큰) — 첫 화면을 그 클레임으로 채우고 곧 sessions/current 응답으로 바꾼다. 실제 로그인은 토큰을 풀지 않는다.
    return createOperatorSessionSource(api, tokens, initialToken ? parseOperatorToken(initialToken) : null);
  });
  const state = useSyncExternalStore(source.subscribe, source.getState);
  const [saved] = useState(() => (!initialToken && tokens.accessToken === null ? loadSavedSession() : null));
  const [restoring, setRestoring] = useState(saved !== null);
  const restoreStarted = useRef(false);
  const [signOutUnconfirmed, setSignOutUnconfirmed] = useState(false);

  // 토큰이 바뀌면 refresh 보관을 맞춘다(없으면 지운다).
  useEffect(() => tokens.subscribe(() => syncSavedSession(tokens)), []);

  // 세션 응답 받기: 토큰이 생기거나 바뀔 때(로그인·복원·갱신)와 탭이 다시 보일 때(로그아웃 전파 ADR-0061 확인 — 30초 안에는 다시 안 한다).
  useEffect(() => source.start(), [source]);

  // 새로고침 복원: 보관한 refresh 로 한 번 갱신한다. 세션이 끝났으면(거절) 보관을 지우고 로그인으로.
  // 네트워크 등으로 결과를 모르면 보관은 두고 이번에는 로그인으로 보낸다(다음 로드에서 다시 시도).
  useEffect(() => {
    if (!restoring || restoreStarted.current || !saved) return;
    restoreStarted.current = true;
    tokens.restore(saved);
    void refreshEmployeeTokens(api, tokens)
      .then((access) => {
        if (access === null) {
          tokens.clear();
          clearSavedSession();
        }
      })
      .catch(() => undefined)
      .finally(() => setRestoring(false));
  }, [api, restoring, saved]);

  const startLogin = useCallback(async (from: string) => {
    setSignOutUnconfirmed(false);
    browser.assign(await beginEmployeeLogin(API_BASE, from, tokens));
  }, []);

  const startSilentLogin = useCallback(async (from: string) => {
    const url = await beginSilentEmployeeLogin(API_BASE, from, tokens);
    if (url === null) return false;
    browser.assign(url);
    return true;
  }, []);

  const startMockLogin = useCallback(async (from: string, operatorId: string) => {
    setSignOutUnconfirmed(false);
    await beginEmployeeLogin(API_BASE, from, tokens); // verifier·기기 ID 를 실제와 같이 남긴다
    return `${CALLBACK_PATH}?ticket=${encodeURIComponent(`mock.${operatorId}`)}`;
  }, []);

  const completeLogin = useCallback((params: URLSearchParams) => completeEmployeeLogin(api, params, tokens), [api]);

  const logout = useCallback(async () => {
    const outcome = await logoutEmployee(api, tokens);
    if (outcome.idpLogoutUri) {
      browser.assign(outcome.idpLogoutUri);
      return 'redirecting' as const;
    }
    setSignOutUnconfirmed(outcome.idpSessionMayRemain);
    return outcome.idpSessionMayRemain ? ('idp-session-may-remain' as const) : ('done' as const);
  }, [api]);

  const reloadSession = useCallback(() => void source.reload(), [source]);

  const value = useMemo(
    () => ({
      session: state.status === 'ready' ? state.session : null,
      signedIn: state.status !== 'signed-out',
      sessionStatus: state.status,
      sessionFailure: state.status === 'failed' ? state.failure : null,
      reloadSession,
      restoring,
      startLogin,
      canTrySilentLogin,
      startSilentLogin,
      startMockLogin,
      completeLogin,
      logout,
      signOutUnconfirmed,
    }),
    [state, reloadSession, restoring, startLogin, startSilentLogin, startMockLogin, completeLogin, logout, signOutUnconfirmed],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('SessionProvider 가 없다');
  return v;
}

/**
 * 세션이 없으면 로그인 화면으로 보낸다(돌아올 경로를 쿼리에). 토큰은 있는데 세션 응답을 아직 못 받았으면 기다리고,
 * 처음 받기가 실패하면 실패로 보인다(빈 역할로 메뉴를 그리지 않는다). 권한 판정은 서버.
 */
export function RequireSession({ children }: { readonly children: ReactNode }) {
  const { session, sessionStatus, sessionFailure, reloadSession, restoring } = useSession();
  const location = useLocation();
  if (session) return <>{children}</>;
  if (sessionStatus === 'failed') return <QueryState state={uiStateFromError(sessionFailure)} onRetry={reloadSession}>{() => null}</QueryState>;
  if (sessionStatus === 'loading' || restoring) {
    return (
      <p role="status" className="p-6 text-sm opacity-70">
        {m.loading}
      </p>
    );
  }
  const from = `${location.pathname}${location.search}`;
  return <Navigate to={`/login?from=${encodeURIComponent(from)}`} replace />;
}
