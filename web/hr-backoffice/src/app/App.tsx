import { ConnectionBanner, useDocumentTitle } from './PageChrome';
import { AppLauncher, UiTextProvider } from '@pmart/web-ui';
import { ConsoleBreadcrumb, ConsoleShell, type ConsoleNavGroup } from '@pmart/web-ui/console';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { createBrowserRouter, createMemoryRouter, NavLink, Outlet, RouterProvider, useLocation } from 'react-router';

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
import { useMenuCollapsed } from '../shared/sideMenu';
import { HomePage } from './HomePage';
import { LiveClock, RoleChips } from './HeaderContext';
import { QuickFind } from './QuickFind';
import { ThemeToggle } from './ThemeToggle';
import { Toasts } from './Toasts';

const nav: ReadonlyArray<readonly [string, string]> = [
  ['/', m.nav.home],
  ['/employees', m.nav.employees],
  ['/employees/new', m.nav.register],
  ['/departments', m.nav.departments],
  ['/permissions', m.nav.permissions],
];

/** 접힌 메뉴(64px)의 메뉴별 아이콘 — 인사팀은 묶음이 하나라 백오피스처럼 묶음 아이콘만 남기면 쓸 데가 없어 메뉴마다 하나씩 */
const RAIL_ICON: Readonly<Record<string, string>> = {
  '/': 'M3 11 12 4l9 7M5 10v10h14V10',
  '/employees': 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  '/employees/new': 'M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 12-4.9M19 14v6M16 17h6',
  '/departments': 'M4 21V5l8-2 8 2v16M9 21v-5h6v5M8 9h2m4 0h2M8 13h2m4 0h2',
  '/permissions': 'M12 3 4 6v6c0 4.5 3.4 8.4 8 9 4.6-.6 8-4.5 8-9V6l-8-3Z',
};

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
  const me = useMe();
  const myName = me.data?.name;
  const { pathname } = useLocation();
  const [collapsed, toggleMenu] = useMenuCollapsed();
  const current = [...nav].sort((x, y) => y[0].length - x[0].length).find(([to]) => pathname === to || pathname.startsWith(`${to}/`));
  useDocumentTitle(current?.[1] ?? null);
  // 2026-11-20 AWS 콘솔 모양(백오피스와 같은 공용 틀 @pmart/web-ui/console ConsoleShell) — 흰 머리줄·흰 왼쪽 메뉴·위치 줄
  const groups: ConsoleNavGroup[] = [
    {
      id: 'hr',
      label: m.nav.group,
      items: nav.map(([to, label]) => ({ to, label, ...(RAIL_ICON[to] ? { icon: RAIL_ICON[to] } : {}), testId: to === '/' ? 'home' : to.slice(1).replace('/', '-') })),
    },
  ];
  return (
    <>
      <ScrollToTopOnNavigate />
      <ConsoleShell
        title={m.appTitle}
        homeLabel={m.goHome}
        groups={groups}
        collapsed={collapsed}
        onToggleMenu={toggleMenu}
        expandLabel={m.nav.expand}
        collapseLabel={m.nav.collapse}
        location={<ConsoleBreadcrumb group={{ label: m.nav.group, to: '/' }} current={current?.[1]} />}
        locationAside={session && <RoleChips roles={session.roles} />}
        banner={<ConnectionBanner />}
        tools={
          <>
            {/* 직원 바로 찾기(Ctrl+K, 2026-11-19) — 로그인했을 때만 */}
            {session && <QuickFind />}
            {session && <LiveClock />}
            {env.isMock && <span className="badge badge-accent badge-sm">{m.mockBadge}</span>}
            <ThemeToggle />
            {/* 로그인 직원 — 이름(없으면 "내 세션"). 로그인 시험이 이 링크 이름으로 찾는다 */}
            <NavLink to={session ? '/session' : '/login'} className={session ? 'btn btn-ghost btn-xs font-normal' : 'btn btn-primary btn-xs'}>
              {session ? (myName ? `${m.nav.session}: ${myName}` : m.nav.session) : m.nav.login}
            </NavLink>
            <AppLauncher current="hr-backoffice" />
          </>
        }
      >
        {/* 안내만 한다 — 화면을 막지 않고, 판정은 서버(403 → 이용할 수 없는 화면) */}
        {session && !session.roles.includes('HR_ADMIN') && (
          <p role="note" className="alert alert-warning mb-4 text-sm">
            {m.noHrRole}
          </p>
        )}
        <Outlet />
      </ConsoleShell>
      {/* 처리 결과 알림(2026-11-18, 백오피스와 같음) */}
      <Toasts />
    </>
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
      { index: true, element: guarded(<HomePage />) },
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
