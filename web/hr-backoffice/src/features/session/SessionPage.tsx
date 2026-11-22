// 내 정보(2026-11-23 — 통합 백오피스와 같은 모양, 공용 @pmart/web-ui/console MyInfoView). 이름·사번·인사 정보는 GET /hr/employees/me(모든 직원),
// 역할·센터는 sessions/current 0.6.0 응답, 로그인 칸은 GET /employee-auth/sessions/current. 비밀번호는 Keycloak 이 관리해 이 앱에서 바꾸지 않는다.
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { centerDisplayName, request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import { consoleMessages, InfoCard, InfoRow, LoginRows, MyInfoView } from '@pmart/web-ui/console';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { messages as m } from '../../shared/messages';
import { affiliationText } from '../employees/labels';
import { useMe } from './useMe';

const t = consoleMessages.account;

export function SessionPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { session, logout } = useSession();
  const current = useQuery({
    queryKey: ['employee-auth', 'session', session?.subject],
    enabled: session !== null,
    queryFn: () => request('GET', api.employeeAuth.GET('/employee-auth/sessions/current', {})),
  });
  const me = useMe();
  if (!session) return null;
  const centers = session.centers.map((c) => centerDisplayName(session, c));
  return (
    <MyInfoView
      name={me.data?.name ?? null}
      nameFallback={me.isError ? t.nameFailed : me.isPending ? '…' : t.nameUnknown}
      employeeNo={me.data?.employeeNo}
      roles={session.roles.map((r) => m.shell.roleName[r] ?? r)}
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
      extra={
        <InfoCard title={m.session.me} testId="my-hr">
          <QueryState state={toUiState(me)} onRetry={() => void me.refetch()}>
            {(e) =>
              e === null ? (
                <p className="text-sm opacity-70">{m.session.meMissing}</p>
              ) : (
                <dl>
                  <InfoRow label={m.fields.mailAddress}>{e.mailAddress}</InfoRow>
                  <InfoRow label={m.fields.employmentType}>{m.employmentType[e.employmentType]}</InfoRow>
                  <InfoRow label={m.fields.affiliation}>{affiliationText(e.affiliation)}</InfoRow>
                  <InfoRow label={m.fields.status}>{m.employmentStatus[e.status]}</InfoRow>
                </dl>
              )
            }
          </QueryState>
        </InfoCard>
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
