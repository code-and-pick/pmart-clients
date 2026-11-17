// 라이더 백오피스 뼈대(2026-11-17, PC 1): 직원 로그인·세션·메뉴 자리. 메뉴 화면(관제 등)은 delivery 영역(PC 5)이 채운다.
import { UiTextProvider } from '@pmart/web-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createBrowserRouter, createMemoryRouter, Link, Navigate, NavLink, Outlet, RouterProvider } from 'react-router';

import { env } from '../env';
import { CasesMenu } from '../features/cases/CasePages';
import { DeliveriesMenu } from '../features/deliveries/DeliveryPages';
import { PreparingPage } from '../features/menus/PreparingPage';
import { LoginCallbackPage, LoginPage } from '../features/session/LoginPage';
import { SessionPage } from '../features/session/SessionPage';
import { messages as m } from '../shared/messages';
import { allMenus, hasRiderAppRole, menuPath, navGroups, type MenuItem } from './nav';
import { RequireSession, SessionProvider, useSession } from './SessionContext';

function Layout() {
  const { session } = useSession();
  return (
    <div className="flex min-h-screen bg-base-200">
      <aside className="w-52 shrink-0 bg-base-100 shadow-sm">
        <div className="p-4">
          <Link to="/" className="text-lg font-bold" aria-label={m.goHome}>
            {m.appTitle}
          </Link>
          {env.isMock && <span className="badge badge-outline ml-2">{m.mockBadge}</span>}
        </div>
        <ul className="menu w-full">
          <li>
            <NavLink to={session ? '/session' : '/login'}>{session ? m.nav.session : m.nav.login}</NavLink>
          </li>
          {session &&
            navGroups.map((g) => (
              <li key={g.key}>
                <details open>
                  <summary>{m.groups[g.key]}</summary>
                  <ul>
                    {g.items.map((item) => (
                      <li key={item.key}>
                        <NavLink to={menuPath(item.segment)}>{m.menus[item.key]}</NavLink>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
        </ul>
      </aside>
      <main className="min-w-0 flex-1 space-y-4 p-6">
        <Outlet />
      </main>
    </div>
  );
}

/** 메뉴 하나. 주 역할(RIDER_OPS·OPERATOR_ADMIN)이 없으면 막지 않고 안내만 — 판정은 서버 */
function MenuScope({ menu }: { readonly menu: MenuItem }) {
  const { session } = useSession();
  if (!session) return null;
  return (
    <>
      {!hasRiderAppRole(session.roles) && (
        <p role="note" className="alert alert-warning text-sm">
          {m.noRiderRole}
        </p>
      )}
      <MenuPage menu={menu} />
    </>
  );
}

/** 만든 메뉴는 그 화면, 아직이면 "준비 중"(PC 5 — 2026-11-17 접수 건·배송 찾기부터) */
function MenuPage({ menu }: { readonly menu: MenuItem }) {
  if (!menu.ready) return <PreparingPage menu={menu} />;
  switch (menu.key) {
    case 'cases':
      return <CasesMenu />;
    case 'deliveries':
      return <DeliveriesMenu />;
    default:
      return <PreparingPage menu={menu} />;
  }
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
      { index: true, element: guarded(<Navigate to={menuPath()} replace />) },
      { path: 'session', element: guarded(<SessionPage />) },
      // 메뉴 아래 화면(목록·상세)은 메뉴 화면이 자기 Routes 로 나눈다
      ...allMenus.map((menu) => ({ path: `${menu.segment}/*`, element: guarded(<MenuScope menu={menu} />) })),
      { path: '*', element: <Navigate to="/" replace /> },
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
