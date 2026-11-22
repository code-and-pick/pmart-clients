// 내 정보(2026-11-23 사용자 "내 세션 상세 페이지 UI 좀 고쳐. 마이페이지처럼") — 위에 프로필(머리글자·이름·사번·역할·센터),
// 아래에 로그인 정보(앱·로그인 시각·자동 로그아웃 시각)와 계정·보안(비밀번호 안내·로그아웃). 세션 ID·운영자 ID 는 접힌 "시스템 번호"에만.
// 로그인 상태·역할·센터는 sessions/current 0.6.0 응답, 이름·사번은 hr employee-labels. 비밀번호는 Keycloak 이 관리해 여기서 바꾸지 않는다.
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { centerDisplayName, request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { Avatar } from '../../app/UserMenu';
import { SystemNumbers } from '../../shared/displayNumber';
import { useEmployeeLabel } from '../../shared/employeeLabels';
import { messages as m } from '../../shared/messages';

const t = m.myPage;

function Card({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="rounded-box border border-base-300 bg-base-100 p-5">
      <h2 className="mb-3 text-sm font-semibold text-base-content/70">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 border-b border-base-200 py-2 text-sm last:border-b-0">
      <dt className="w-28 shrink-0 text-base-content/60">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

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
  const name = label.data?.name ?? null;
  const centers = session.centers.map((c) => centerDisplayName(session, c));
  const signOut = () =>
    void logout().then((result) => {
      // 'redirecting' 이면 브라우저가 Keycloak 로그아웃 주소로 떠난다(→ /login 으로 돌아온다).
      if (result !== 'redirecting') void navigate('/login', { replace: true });
    });

  return (
    <section className="max-w-3xl space-y-4">
      <h1 className="text-xl font-bold">{t.title}</h1>

      {/* 프로필 */}
      <div className="flex flex-wrap items-center gap-5 rounded-box border border-base-300 bg-base-100 p-5" data-testid="my-profile">
        <Avatar name={name} size="lg" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-lg font-semibold">{name ?? (label.isError ? t.nameFailed : label.isPending ? '…' : t.nameUnknown)}</p>
          {/* 사번 · 역할을 회색 글자 한 줄로(2026-11-23 "권한 버튼처럼 나오는 거 별론데") */}
          <p className="text-sm text-base-content/60">{[label.data?.employeeNo, session.roles.map((r) => m.shell.roleName[r] ?? r).join(', ')].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      {session.roles.length === 0 && (
        <p role="alert" className="alert alert-warning alert-soft text-sm">
          {m.employeeLogin.noRoles}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t.work}>
          <dl>
            <Row label={t.roles}>{session.roles.map((r) => m.shell.roleName[r] ?? r).join(', ') || m.none}</Row>
            <Row label={t.centers}>{centers.length > 0 ? centers.join(', ') : t.allCenters}</Row>
          </dl>
        </Card>

        <Card title={t.login}>
          <QueryState state={toUiState(current)} onRetry={() => void current.refetch()}>
            {(s) => (
              <dl>
                <Row label={t.app}>{t.appName[s.app] ?? s.app}</Row>
                <Row label={t.issuedAt}>{formatSeoul(s.issuedAt)}</Row>
                <Row label={t.expiresAt}>{formatSeoul(s.expiresAt)}</Row>
              </dl>
            )}
          </QueryState>
        </Card>
      </div>

      <Card title={t.security}>
        <div className="space-y-1 text-sm text-base-content/75">
          <p>{m.employeeLogin.passwordNote}</p>
          <p>{m.employeeLogin.sharedPcNote}</p>
        </div>
        <button type="button" className="btn btn-sm btn-outline btn-error mt-4" onClick={signOut}>
          {m.session.signOut}
        </button>
      </Card>

      <SystemNumbers
        ids={[
          { label: t.operatorId, id: session.subject },
          { label: t.sessionId, id: current.data?.sessionId },
        ]}
      />
    </section>
  );
}
