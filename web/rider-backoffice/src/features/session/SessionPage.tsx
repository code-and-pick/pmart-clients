// 내 정보(2026-11-23 — 통합 백오피스와 같은 모양, 공용 @pmart/web-ui/console MyInfoView). 역할·센터는 sessions/current 0.6.0 응답,
// 로그인 칸은 GET /employee-auth/sessions/current, 이름·사번은 hr employee-labels. 비밀번호는 Keycloak 이 관리해 이 앱에서 바꾸지 않는다.
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { centerDisplayName, request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import { consoleMessages, LoginRows, MyInfoView } from '@pmart/web-ui/console';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { useEmployeeLabel } from '../../shared/employeeLabels';
import { messages as m } from '../../shared/messages';

const t = consoleMessages.account;

export function SessionPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { session, logout } = useSession();
  const label = useEmployeeLabel(session?.subject);
  const current = useQuery({
    queryKey: ['employee-auth', 'session', session?.subject],
    enabled: session !== null,
    queryFn: () => request('GET', api.employeeAuth.GET('/employee-auth/sessions/current', {})),
  });
  if (!session) return null;
  const centers = session.centers.map((c) => centerDisplayName(session, c));
  return (
    <MyInfoView
      name={label.data?.name ?? null}
      nameFallback={label.isError ? t.nameFailed : label.isPending ? '…' : t.nameUnknown}
      employeeNo={label.data?.employeeNo}
      roles={session.roles.map((r) => m.roleName[r] ?? r)}
      noRolesNote={
        session.roles.length === 0 && (
          <p role="alert" className="alert alert-warning text-sm">
            {m.employeeLogin.noRoles}
          </p>
        )
      }
      work={[[t.centers, centers.length > 0 ? centers.join(', ') : t.allCenters]]}
      login={
        <QueryState state={toUiState(current)} onRetry={() => void current.refetch()}>
          {(s) => <LoginRows app={s.app} issuedAt={formatSeoul(s.issuedAt)} expiresAt={formatSeoul(s.expiresAt)} />}
        </QueryState>
      }
      notes={[m.employeeLogin.passwordNote, m.employeeLogin.sharedPcNote, m.session.ssoNote]}
      onLogout={() =>
        void logout().then((result) => {
          // 'redirecting' 이면 브라우저가 Keycloak 로그아웃 주소로 떠난다(→ /login 으로 돌아온다).
          if (result !== 'redirecting') void navigate('/login', { replace: true });
        })
      }
      systemIds={[
        { label: t.operatorId, id: session.subject },
        { label: t.sessionId, id: current.data?.sessionId },
      ]}
    />
  );
}
