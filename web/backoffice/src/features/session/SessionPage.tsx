// 내 정보(2026-11-23 사용자 "마이페이지처럼" → "권한 버튼처럼 나오는 거 별론데 … 이게 최선이야?") — 설정 화면처럼 한 장:
// 위에 이름·사번·역할(글자로만, 꼬리표·단추 모양 없이), 아래 줄마다 "이름 — 값"(업무·로그인·보안). 같은 내용을 두 번 보이지 않는다.
// 세션 ID·운영자 ID 는 접힌 "시스템 번호"에만. 로그인 상태는 sessions/current 0.6.0, 이름·사번은 hr employee-labels.
// 비밀번호는 Keycloak 이 관리해 여기서 바꾸지 않는다. "남은 시간"은 서버가 준 끝 시각을 보여 주는 것일 뿐 — 로그인 유지 판단은 서버.
import { useEffect, useState, type ReactNode } from 'react';
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

function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="border-t border-base-300 px-6 py-4">
      <h2 className="mb-1 text-xs font-semibold text-base-content/55">{title}</h2>
      <dl>{children}</dl>
    </div>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-6 py-1.5 text-sm">
      <dt className="w-32 shrink-0 font-normal text-base-content/60">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

/** 끝 시각까지 남은 분(표시만, 1분마다 다시 그림) */
function useMinutesLeft(until: string | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  if (!until) return null;
  const ms = Date.parse(until) - now;
  return Number.isNaN(ms) ? null : Math.max(0, Math.round(ms / 60_000));
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
  const left = useMinutesLeft(current.data?.expiresAt);
  if (!session) return null;
  const name = label.data?.name ?? null;
  const roles = session.roles.map((r) => m.shell.roleName[r] ?? r);
  const centers = session.centers.map((c) => centerDisplayName(session, c));
  const signOut = () =>
    void logout().then((result) => {
      // 'redirecting' 이면 브라우저가 Keycloak 로그아웃 주소로 떠난다(→ /login 으로 돌아온다).
      if (result !== 'redirecting') void navigate('/login', { replace: true });
    });

  return (
    <section className="max-w-2xl space-y-3">
      <h1 className="text-xl font-bold">{t.title}</h1>
      <div className="rounded-box border border-base-300 bg-base-100">
        {/* 프로필 — 이름이 가장 크게, 사번·역할은 한 줄 글자로 */}
        <div className="flex items-center gap-4 px-6 py-5" data-testid="my-profile">
          <Avatar name={name} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{name ?? (label.isError ? t.nameFailed : label.isPending ? '…' : t.nameUnknown)}</p>
            <p className="text-sm text-base-content/60">{[label.data?.employeeNo, roles.join(', ')].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        {session.roles.length === 0 && (
          <p role="alert" className="alert alert-warning alert-soft mx-6 mb-4 text-sm">
            {m.employeeLogin.noRoles}
          </p>
        )}

        <Group title={t.work}>
          <Row label={t.centers}>{centers.length > 0 ? centers.join(', ') : t.allCenters}</Row>
        </Group>

        <Group title={t.login}>
          <QueryState state={toUiState(current)} onRetry={() => void current.refetch()}>
            {(s) => (
              <>
                <Row label={t.app}>{t.appName[s.app] ?? s.app}</Row>
                <Row label={t.issuedAt}>{formatSeoul(s.issuedAt)}</Row>
                <Row label={t.expiresAt}>
                  {formatSeoul(s.expiresAt)}
                  {left !== null && <span className="ml-2 text-base-content/55">{t.minutesLeft(left)}</span>}
                </Row>
              </>
            )}
          </QueryState>
        </Group>

        <Group title={t.security}>
          <Row label={t.password}>
            <span className="text-base-content/75">{m.employeeLogin.passwordNote}</span>
          </Row>
          <Row label={m.session.signOut}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-base-content/75">{m.employeeLogin.sharedPcNote}</span>
              <button type="button" className="btn btn-sm btn-outline btn-error" onClick={signOut}>
                {m.session.signOut}
              </button>
            </div>
          </Row>
        </Group>
      </div>

      <SystemNumbers
        ids={[
          { label: t.operatorId, id: session.subject },
          { label: t.sessionId, id: current.data?.sessionId },
        ]}
      />
    </section>
  );
}
