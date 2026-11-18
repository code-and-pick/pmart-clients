// 내 세션: 역할·센터(sessions/current 0.6.0 응답)·서버 세션(GET /employee-auth/sessions/current, handoff 2026-11-12 §3)·로그아웃.
// 비밀번호는 Keycloak 이 관리해 백오피스에서 바꾸지 않는다(백오피스는 Keycloak 주소를 갖지 않아 링크도 두지 않는다).
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { centerDisplayName, request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { messages as m } from '../../shared/messages';

export function SessionPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { session, logout } = useSession();
  const current = useQuery({
    queryKey: ['employee-auth', 'session', session?.subject],
    enabled: session !== null,
    queryFn: () => request('GET', api.employeeAuth.GET('/employee-auth/sessions/current', {})),
  });

  return (
    <section className="max-w-2xl space-y-4">
      <h1 className="text-xl font-bold">{m.session.title}</h1>
      {session && (
        <>
          <div className="card bg-base-100 shadow-sm">
            <div className="card-body">
              <dl className="grid grid-cols-[8rem_1fr] gap-1 text-sm">
                <dt>{m.session.subject}</dt>
                <dd>{session.subject || m.none}</dd>
                <dt>{m.session.roles}</dt>
                <dd>{session.roles.join(', ') || m.none}</dd>
                <dt>{m.session.centers}</dt>
                <dd>{session.centers.map((c) => centerDisplayName(session, c)).join(', ') || m.none}</dd>
              </dl>
              {session.roles.length === 0 && (
                <p role="alert" className="alert alert-warning alert-soft text-sm">
                  {m.employeeLogin.noRoles}
                </p>
              )}
              <h2 className="mt-2 text-sm font-semibold">{m.session.current}</h2>
              <QueryState state={toUiState(current)} onRetry={() => void current.refetch()}>
                {(s) => (
                  <dl className="grid grid-cols-[8rem_1fr] gap-1 text-sm">
                    <dt>{m.session.sessionId}</dt>
                    <dd>{s.sessionId}</dd>
                    <dt>{m.employeeLogin.app}</dt>
                    <dd>{s.app}</dd>
                    <dt>{m.employeeLogin.issuedAt}</dt>
                    <dd>{formatSeoul(s.issuedAt)}</dd>
                    <dt>{m.employeeLogin.tokenExpiresAt}</dt>
                    <dd>{formatSeoul(s.expiresAt)}</dd>
                  </dl>
                )}
              </QueryState>
              <button
                type="button"
                className="btn btn-sm w-fit"
                onClick={() =>
                  void logout().then((result) => {
                    // 'redirecting' 이면 브라우저가 Keycloak 로그아웃 주소로 떠난다(→ /login 으로 돌아온다).
                    if (result !== 'redirecting') void navigate('/login', { replace: true });
                  })
                }
              >
                {m.session.signOut}
              </button>
            </div>
          </div>
          <div className="space-y-1 rounded-box bg-base-100 p-4 text-sm">
            <p>{m.employeeLogin.passwordNote}</p>
            <p>{m.employeeLogin.sharedPcNote}</p>
          </div>
        </>
      )}
    </section>
  );
}
