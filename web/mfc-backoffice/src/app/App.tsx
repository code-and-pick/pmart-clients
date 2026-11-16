import { UiTextProvider } from '@pmart/web-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentType, ReactNode } from 'react';
import { createBrowserRouter, createMemoryRouter, Link, Navigate, NavLink, Outlet, RouterProvider, useParams } from 'react-router';

import { env } from '../env';
import { CenterSwitcher } from '../features/centers/centers';
import { CenterDeliveriesMenu, DispatchFailuresMenu } from '../features/delivery/CenterDeliveryPages';
import { LocationsMenu } from '../features/locations/LocationPages';
import { MovesMenu } from '../features/moves/MovePages';
import { WorkersMenu } from '../features/workers/WorkerPages';
import { PreparingPage } from '../features/menus/PreparingPage';
import { LoginCallbackPage, LoginPage } from '../features/session/LoginPage';
import { SessionPage } from '../features/session/SessionPage';
import { messages as m } from '../shared/messages';
import { allMenus, centerPath, isWorkerOnly, navGroups, type MenuItem, type MenuKey } from './nav';
import { RequireSession, SessionProvider, useSession } from './SessionContext';

/** 주소의 센터(`/c/:mfcId/…`). 세션 centers(sessions/current)에 있을 때만 그 센터 */
function useCenter(): { readonly mfcId: string; readonly mine: boolean } | null {
  const { mfcId } = useParams();
  const { session } = useSession();
  if (!mfcId) return null;
  return { mfcId, mine: session?.centers.includes(mfcId) ?? false };
}

function Layout() {
  const { session } = useSession();
  const center = useCenter();
  const target = center?.mine ? center.mfcId : session?.centers[0];
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
          {/* 센터가 정해져야 메뉴 주소가 생긴다(맡은 센터가 없으면 묶음을 보이지 않는다) */}
          {target &&
            !isWorkerOnly(session?.roles ?? []) &&
            navGroups.map((g) => (
              <li key={g.key}>
                <details open>
                  <summary>{m.groups[g.key]}</summary>
                  <ul>
                    {g.items.map((item) => (
                      <li key={item.key}>
                        <NavLink to={centerPath(target, item.segment)}>{m.menus[item.key]}</NavLink>
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

/** 센터 하나 아래 화면들. 권한 안내(막지 않음)·워커 전용 계정 차단·남의 센터 차단을 한 곳에서 */
function CenterScope({ menu }: { readonly menu: MenuItem }) {
  const { session } = useSession();
  const center = useCenter();
  if (!session || !center) return null;
  if (isWorkerOnly(session.roles)) return <WorkerOnly />;
  if (!center.mine) {
    return (
      <div className="space-y-3">
        <p role="alert" className="alert alert-warning text-sm">
          {session.centers.length === 0 ? m.center.none : m.center.notMine}
        </p>
        {session.centers.length > 0 && (
          <ul className="menu rounded-box bg-base-100 w-fit">
            {session.centers.map((c) => (
              <li key={c}>
                <Link to={centerPath(c, menu.segment)}>{c}</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <>
      <CenterSwitcher centers={session.centers} current={center.mfcId} segment={menu.segment} />
      {!session.roles.includes('MFC_SUPERVISOR') && (
        <p role="note" className="alert alert-warning text-sm">
          {m.noSupervisor}
        </p>
      )}
      <MenuPage menu={menu} mfcId={center.mfcId} />
    </>
  );
}

/** 만든 메뉴 화면(nav.ts `ready`). 아직이면 "준비 중" */
const menuPages: Partial<Record<MenuKey, ComponentType<{ readonly mfcId: string }>>> = {
  locations: LocationsMenu,
  moves: MovesMenu,
  workers: WorkersMenu,
  deliveries: CenterDeliveriesMenu,
  dispatchFailures: DispatchFailuresMenu,
};

function MenuPage({ menu, mfcId }: { readonly menu: MenuItem; readonly mfcId: string }) {
  const Page = menu.ready ? menuPages[menu.key] : undefined;
  return Page ? <Page mfcId={mfcId} /> : <PreparingPage menu={menu} />;
}

function WorkerOnly() {
  return (
    <p role="alert" className="alert alert-warning text-sm">
      {m.workerOnly}
    </p>
  );
}

/** 첫 화면: 맡은 첫 센터의 첫 메뉴로. 센터가 없거나 워커 전용이면 안내 */
function Home() {
  const { session } = useSession();
  if (!session) return null;
  if (isWorkerOnly(session.roles)) return <WorkerOnly />;
  const first = session.centers[0];
  if (!first) {
    return (
      <p role="alert" className="alert alert-warning text-sm">
        {m.center.none}
      </p>
    );
  }
  return <Navigate to={centerPath(first)} replace />;
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
      { index: true, element: guarded(<Home />) },
      { path: 'session', element: guarded(<SessionPage />) },
      { path: 'c/:mfcId', element: guarded(<Home />) },
      // 메뉴 아래 화면(목록·상세·등록)은 메뉴 화면이 자기 Routes 로 나눈다
      ...allMenus.map((menu) => ({ path: `c/:mfcId/${menu.segment}/*`, element: guarded(<CenterScope menu={menu} />) })),
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
