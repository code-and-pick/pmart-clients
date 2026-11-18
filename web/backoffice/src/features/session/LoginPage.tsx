// 직원 로그인(employee-auth-service, app=backoffice — ADR-0056, handoff 2026-11-12). 버튼 → 게이트웨이 로그인 시작 → Keycloak 화면 → /auth/callback 으로 돌아온다.
// 이 앱은 비밀번호를 받지 않는다. 목 모드에는 Keycloak 이 없어 목 계정 버튼으로 복귀 주소를 바로 연다(티켓 교환부터는 같은 코드).
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';

import { EmployeeLoginError, type EmployeeLoginErrorCode } from '../../api/employeeAuth';
import { useSession } from '../../app/SessionContext';
import { env } from '../../env';
import { mockAccounts } from '../../mocks/operators';
import { messages as m } from '../../shared/messages';

/** 열린 리디렉트 방지: 앱 안 경로만 */
const safeFrom = (from: string | null) => (from && from.startsWith('/') && !from.startsWith('//') ? from : '/approvals');

export function LoginPage() {
  const { signedIn, restoring, startEmployeeLogin, canTrySilentLogin, startSilentLogin, startMockLogin, signOutUnconfirmed } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const from = safeFrom(params.get('from'));
  const [phase, setPhase] = useState<'idle' | 'starting' | 'failed'>('idle');
  // 조용한 로그인 확인(silent — handoff 2026-11-13): 버튼을 보이기 전에 이 탭에서 한 번, 화면 없이 Keycloak 세션만 확인한다.
  // 같은 브라우저의 다른 백오피스에 로그인해 있으면 버튼 없이 들어간다. 목 모드에는 Keycloak 이 없어 하지 않는다.
  const [checking, setChecking] = useState(() => !env.isMock && canTrySilentLogin());
  const silentStarted = useRef(false);
  useEffect(() => {
    // 새로고침 복원(쿠키 갱신)이 먼저다 — 끝나고도 세션이 없을 때만 확인한다.
    if (!checking || signedIn || restoring || silentStarted.current) return;
    silentStarted.current = true;
    startSilentLogin(from)
      .then((moved) => {
        if (!moved) setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [checking, signedIn, restoring, startSilentLogin, from]);

  if (signedIn) return <Navigate to={from} replace />;
  if (checking || restoring) {
    return (
      <p role="status" className="p-6 text-sm opacity-70">
        {m.employeeLogin.checking}
      </p>
    );
  }

  return (
    <section className="mx-auto max-w-sm space-y-4 pt-10">
      <h1 className="text-xl font-bold">{m.login.title}</h1>
      <div className="space-y-3 rounded-box bg-base-100 p-6 shadow-sm">
        {env.isMock ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold">{m.login.mockAccounts}</p>
            {mockAccounts.map((a) => (
              <button
                key={a.operatorId}
                type="button"
                className="btn btn-primary btn-sm w-full"
                disabled={phase === 'starting'}
                onClick={() => {
                  setPhase('starting');
                  startMockLogin(from, a.operatorId)
                    .then((callback) => navigate(callback, { replace: true }))
                    .catch(() => setPhase('failed'));
                }}
              >
                {`${a.label} · ${a.roles.join(', ') || a.centers.join(', ')}`}
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={phase === 'starting'}
            onClick={() => {
              setPhase('starting');
              startEmployeeLogin(from).catch(() => setPhase('failed'));
            }}
          >
            {phase === 'starting' ? m.employeeLogin.starting : m.employeeLogin.start}
          </button>
        )}
        {phase === 'failed' && (
          <p role="alert" className="alert alert-error text-sm">
            {m.employeeLogin.startFailed}
          </p>
        )}
        {signOutUnconfirmed && (
          <p role="alert" className="alert alert-warning alert-soft text-sm">
            {m.employeeLogin.signOutUnconfirmed}
          </p>
        )}
        <p className="text-xs opacity-70">{m.employeeLogin.note}</p>
      </div>
    </section>
  );
}

/** 로그인 뒤 돌아오는 곳(복귀 주소 ?ticket= 또는 ?error=). 티켓을 토큰으로 바꾸고 원래 가려던 화면으로 */
export function LoginCallbackPage() {
  const { completeEmployeeLogin } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<EmployeeLoginErrorCode | null>(null);

  useEffect(() => {
    let live = true;
    completeEmployeeLogin(params)
      .then((from) => {
        // 주소창에서 ticket 을 지운다(replace)
        if (live) void navigate(safeFrom(from), { replace: true });
      })
      .catch((e: unknown) => {
        if (!live) return;
        // 조용한 로그인 확인인데 Keycloak 세션이 없다 — 오류가 아니다. 가려던 경로를 들고 로그인 버튼 화면으로.
        if (e instanceof EmployeeLoginError && e.code === 'LOGIN_REQUIRED') {
          void navigate(`/login?from=${encodeURIComponent(safeFrom(e.from ?? null))}`, { replace: true });
          return;
        }
        setError(e instanceof EmployeeLoginError ? e.code : 'NETWORK');
      });
    return () => {
      live = false;
    };
  }, [completeEmployeeLogin, navigate, params]);

  return (
    <section className="mx-auto max-w-sm space-y-4 pt-10">
      <h1 className="text-xl font-bold">{m.login.title}</h1>
      <div className="space-y-3 rounded-box bg-base-100 p-6 shadow-sm">
        {error === null ? (
          <p role="status" className="text-sm opacity-70">
            {m.employeeLogin.completing}
          </p>
        ) : (
          <>
            <p role="alert" className="alert alert-error text-sm">
              {m.employeeLogin.errors[error]}
            </p>
            <Link to="/login" replace className="btn btn-primary w-full">
              {m.employeeLogin.retry}
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
