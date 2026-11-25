// 내 정보(라이더·MFC 백오피스와 같은 공용 MyInfoView). 역할·DC 는 sessions/current 응답, 이름·사번은 hr 본인 조회(useMe).
// 비밀번호는 Keycloak 이 관리해 이 앱에서 바꾸지 않는다.
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { centerDisplayName, request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import { consoleMessages, LoginRows, MyInfoView } from '@pmart/web-ui/console';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { messages as m } from '../../shared/messages';
import { useMe } from '../me/useMe';

const t = consoleMessages.account;

export function SessionPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { session, logout } = useSession();
  const me = useMe();
  const current = useQuery({
    queryKey: ['employee-auth', 'session', session?.subject],
    enabled: session !== null,
    queryFn: () => request('GET', api.employeeAuth.GET('/employee-auth/sessions/current', {})),
  });
  if (!session) return null;
  const centers = session.centers.map((c) => centerDisplayName(session, c));
  return (
    <MyInfoView
      name={me.data?.name ?? null}
      nameFallback={me.isError ? t.nameFailed : me.isPending ? '…' : t.nameUnknown}
      employeeNo={me.data?.employeeNo}
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
