import { AppLauncher, UiTextProvider } from '@pmart/web-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { createBrowserRouter, createMemoryRouter, Link, Navigate, NavLink, Outlet, RouterProvider, useLocation } from 'react-router';

import { env } from '../env';
import { DepartmentsPage } from '../features/departments/departments';
import { PermissionDetailPage, PermissionsPage } from '../features/permissions/PermissionsPage';
import { EmployeeDetailPage } from '../features/employees/EmployeeDetailPage';
import { EmployeeListPage } from '../features/employees/EmployeeListPage';
import { EmployeeRegisterPage } from '../features/employees/EmployeeRegisterPage';
import { LoginCallbackPage, LoginPage } from '../features/session/LoginPage';
import { SessionPage } from '../features/session/SessionPage';
import { useMe } from '../features/session/useMe';
import { messages as m } from '../shared/messages';
import { RequireSession, SessionProvider, useSession } from './SessionContext';

const nav: ReadonlyArray<readonly [string, string]> = [
  ['/employees', m.nav.employees],
  ['/employees/new', m.nav.register],
  ['/departments', m.nav.departments],
  ['/permissions', m.nav.permissions],
];

/**
 * 메뉴로 다른 화면에 가면 새 화면을 맨 위부터 보인다(사용자 2026-11-17 — 아래쪽 메뉴를 누르면 스크롤을 다시 올려야 했다).
 * 같은 화면에서 거르기·탭(쿼리)만 바뀔 때는 그대로 둔다(경로가 바뀔 때만).
 */
function ScrollToTopOnNavigate() {
  const { pathname } = useLocation();
  useEffect(() => {
    (document.scrollingElement ?? document.documentElement).scrollTop = 0;
  }, [pathname]);
  return null;
}

function Layout() {
  const { session } = useSession();
  // 메뉴에는 이름을 보인다(운영자 ID 는 길다). 이름을 아직 못 받았거나 인사 기록이 없으면 "내 세션"만.
  const me = useMe();
  const myName = me.data?.name;
  const { pathname } = useLocation();
  // 머리줄 위치(가장 긴 메뉴 경로 — /employees/new 는 직원 등록, /employees/xxx 는 직원 목록)
  const current = [...nav].sort((x, y) => y[0].length - x[0].length).find(([to]) => pathname === to || pathname.startsWith(`${to}/`));
  // 화면 틀(2026-11-18 — PC 5 요청 "관리자 형식", 사본: rider-backoffice App.tsx Layout PR #93 461ff31 — 이 앱에서 따로 고친다)
  return (
    <div className="flex min-h-screen bg-base-200">
      <ScrollToTopOnNavigate />
      {/* 메뉴는 화면 높이에 고정하고 길면 메뉴만 따로 스크롤(오른쪽 화면을 내려도 메뉴는 그 자리) */}
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col self-start overflow-y-auto bg-neutral text-neutral-content" data-testid="side-menu">
        <div className="flex h-14 shrink-0 items-center justify-between gap-1 border-b border-neutral-content/10 pl-5 pr-2">
          <Link to="/" className="truncate text-base font-bold text-neutral-content" aria-label={m.goHome}>
            {m.appTitle}
          </Link>
        </div>
        <nav aria-label="메뉴" className="flex-1 py-3">
          <p className="px-5 pb-1 text-xs font-semibold text-neutral-content/45">{m.nav.group}</p>
          <ul>
            {nav.map(([to, label]) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end
                  className={({ isActive }) =>
                    `flex items-center border-l-[3px] px-5 py-2 text-sm ${isActive ? 'border-accent bg-neutral-content/10 font-semibold text-neutral-content' : 'border-transparent text-neutral-content/75 hover:bg-neutral-content/5 hover:text-neutral-content'}`
                  }
                >
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-base-300 bg-base-100 px-6">
          <p className="truncate text-sm text-base-content/60" data-testid="page-title">
            {current ? (
              <>
                {m.nav.group} <span className="px-1 text-base-content/30">›</span>
                <span className="font-semibold text-base-content">{current[1]}</span>
              </>
            ) : null}
          </p>
          <div className="flex items-center gap-2 text-sm">
            {env.isMock && <span className="badge badge-accent badge-sm">{m.mockBadge}</span>}
            {/* 로그인 직원 — 이름(없으면 "내 세션"). 로그인 시험이 이 링크 이름으로 찾는다 */}
            <NavLink to={session ? '/session' : '/login'} className={session ? 'btn btn-ghost btn-xs font-normal' : 'btn btn-primary btn-xs'}>
              {session ? (myName ? `${m.nav.session}: ${myName}` : m.nav.session) : m.nav.login}
            </NavLink>
            {/* 직원 웹 앱 바꾸기(백엔드 요청 all/2026-11-17-request-app-launcher) — 2026-11-18 사용자: Google 앱 런처처럼 머리줄 맨 오른쪽("내 세션" 오른쪽, 사용자 2026-11-18). 링크만, 세션을 읽지 않는다 */}
            <AppLauncher current="hr-backoffice" />
          </div>
        </header>
        <main className="min-w-0 flex-1 space-y-4 p-6">
          {/* 안내만 한다 — 화면을 막지 않고, 판정은 서버(403 → 이용할 수 없는 화면) */}
          {session && !session.roles.includes('HR_ADMIN') && (
            <p role="note" className="alert alert-warning text-sm">
              {m.noHrRole}
            </p>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const guarded = (element: ReactNode) => <RequireSession>{element}</RequireSession>;

const routes = [
  { path: '/login', element: <LoginPage /> },
  // employee-auth 복귀 주소(백엔드 허용 목록의 <출처>/auth/callback)
  { path: '/auth/callback', element: <LoginCallbackPage /> },
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/employees" replace /> },
      { path: 'session', element: guarded(<SessionPage />) },
      { path: 'employees', element: guarded(<EmployeeListPage />) },
      { path: 'employees/new', element: guarded(<EmployeeRegisterPage />) },
      { path: 'employees/:operatorId', element: guarded(<EmployeeDetailPage />) },
      { path: 'departments', element: guarded(<DepartmentsPage />) },
      { path: 'permissions', element: guarded(<PermissionsPage />) },
      { path: 'permissions/:operatorId', element: guarded(<PermissionDetailPage />) },
    ],
  },
];

/** 재시도는 pmartFetch(429·retryable) 규칙만 따른다. TanStack Query 의 자동 재시도는 끈다. */
export function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

export function App({
  queryClient = createQueryClient(),
  memory = false,
  initialPath = '/',
  initialToken,
}: {
  readonly queryClient?: QueryClient;
  readonly memory?: boolean;
  readonly initialPath?: string;
  /** 테스트에서 바로 세션을 시작한다. */
  readonly initialToken?: string;
}) {
  const router = memory ? createMemoryRouter(routes, { initialEntries: [initialPath] }) : createBrowserRouter(routes);
  return (
    <QueryClientProvider client={queryClient}>
      <UiTextProvider problem={m.problem} reason={m.reason}>
        <SessionProvider {...(initialToken ? { initialToken } : {})}>
          <RouterProvider router={router} />
        </SessionProvider>
      </UiTextProvider>
    </QueryClientProvider>
  );
}
