// 직원 로그인(employee-auth-service, app=backoffice — ADR-0056, handoff 2026-11-12). 버튼 → 게이트웨이 로그인 시작 → Keycloak 화면 → /auth/callback 으로 돌아온다.
// 이 앱은 비밀번호를 받지 않는다. 목 모드에는 Keycloak 이 없어 목 계정 버튼으로 복귀 주소를 바로 연다(티켓 교환부터는 같은 코드).
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';

import { EmployeeLoginError, type EmployeeLoginErrorCode } from '../../api/employeeAuth';
import { useSession } from '../../app/SessionContext';
import { env } from '../../env';
import { mockAccounts } from '../../mocks/operators';
import { messages as m } from '../../shared/messages';
import { LoginShell } from './LoginShell';

/** 열린 리디렉트 방지: 앱 안 경로만 */
// 갈 곳이 없으면(로그인 화면을 바로 연 경우) 첫 화면 = 대시보드(2026-11-19 사용자 — 전에는 승인함. PC 1 영역이지만 사용자 허락으로 이 한 줄만)
const safeFrom = (from: string | null) => (from && from.startsWith('/') && !from.startsWith('//') ? from : '/');

type MockAccount = (typeof mockAccounts)[number];
type AccountGroupId = 'admin' | 'product' | 'center' | 'support';

/** 목 시험 계정을 역할 묶음으로(첫 역할 기준, 역할 없이 센터만이면 센터). 묶음 순서 고정, 빈 묶음은 뺀다 */
function accountGroups(): { id: AccountGroupId; accounts: MockAccount[] }[] {
  const groupOf = (a: MockAccount): AccountGroupId => {
    const roles: readonly string[] = a.roles;
    if (roles.includes('OPERATOR_ADMIN')) return 'admin';
    if (roles.length === 0) return 'center';
    if (roles.some((r) => r === 'MD' || r.endsWith('_APPROVER'))) return 'product';
    return 'support';
  };
  const order: AccountGroupId[] = ['admin', 'product', 'center', 'support'];
  return order
    .map((id) => ({ id, accounts: mockAccounts.filter((a) => groupOf(a) === id) }))
    .filter((g) => g.accounts.length > 0);
}

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
    <LoginShell title={m.login.title} lead={m.login.lead}>
      {env.isMock ? (
        <div className="space-y-3">
          <p className="text-sm font-semibold">{m.login.mockAccounts}</p>
          {/* 시험 계정은 역할 묶음(운영 관리 · 상품 · 센터 · 고객센터·라이더)별 카드. 단추 이름(읽기 도구·시험이 찾는 이름)은 예전 그대로 "이름 · 역할" — aria-label */}
          {accountGroups().map((g) => (
            <section key={g.id} aria-labelledby={`mock-group-${g.id}`} className="space-y-2">
              <h2 id={`mock-group-${g.id}`} className="text-xs font-semibold tracking-wide text-base-content/60">
                {m.login.groups[g.id]}
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {g.accounts.map((a) => {
                  const tags = a.roles.length > 0 ? a.roles.map((r) => m.shell.roleName[r] ?? r) : a.centers;
                  return (
                    <li key={a.operatorId}>
                      <button
                        type="button"
                        aria-label={`${a.label} · ${a.roles.join(', ') || a.centers.join(', ')}`}
                        className="flex h-full w-full items-start gap-3 rounded-box border border-base-300 bg-base-100 p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                        disabled={phase === 'starting'}
                        onClick={() => {
                          setPhase('starting');
                          startMockLogin(from, a.operatorId)
                            .then((callback) => navigate(callback, { replace: true }))
                            .catch(() => setPhase('failed'));
                        }}
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
                          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="8" r="4" />
                            <path d="M4 21a8 8 0 0 1 16 0" />
                          </svg>
                        </span>
                        <span className="block min-w-0 flex-1 space-y-1">
                          <span className="block truncate text-sm font-semibold">{a.label}</span>
                          <span className="flex flex-wrap gap-1">
                            {tags.map((t) => (
                              <span key={t} className="badge badge-ghost badge-sm">
                                {t}
                              </span>
                            ))}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-lg w-full"
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
      <p className="border-t border-base-300 pt-4 text-xs text-base-content/60">{m.employeeLogin.note}</p>
    </LoginShell>
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
    <LoginShell title={m.login.title}>
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
    </LoginShell>
  );
}
