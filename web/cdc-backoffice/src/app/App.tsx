// DC 백오피스 화면 틀(2026-11-25 — 백엔드 요청 clients/all/2026-11-25-request-cdc-backoffice). 겉모양은 MFC 백오피스와 같게(사용자 2026-11-25):
// 공용 콘솔 틀(@pmart/web-ui/console ConsoleShell) — 흰 머리줄·왼쪽 메뉴·위치 줄. 모든 메뉴가 DC 하나(`/c/:cdcId/…`) 아래에 있다.
import { AppLauncher, UiTextProvider } from '@pmart/web-ui';
import { AccountMenu, ConsoleBreadcrumb, ConsoleShell, RoleText, type ConsoleNavGroup } from '@pmart/web-ui/console';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentType, ReactNode } from 'react';
import { createBrowserRouter, createMemoryRouter, Link, Navigate, NavLink, Outlet, RouterProvider, useLocation, useNavigate, useParams } from 'react-router';

import { env } from '../env';
import { CenterSwitcher } from '../features/centers/centers';
import { useMe } from '../features/me/useMe';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { FloorMenu } from '../features/floor/FloorPage';
import { MfcFlowMenu } from '../features/mfc-flow/MfcFlowPage';
import { InboundMenu, ReplenishmentMenu } from '../features/inbound/PutawayPages';
import { InventoryMenu } from '../features/inventory/InventoryPages';
import { MasterMenu } from '../features/master/MasterPages';
import { PreparingPage } from '../features/menus/PreparingPage';
import { PickingMenu } from '../features/picking/PickingPage';
import { ShippingMenu } from '../features/shipping/ShippingPage';
import { TransportMenu } from '../features/transport/TransportPage';
import { ReportsMenu } from '../features/reports/ReportsPage';
import { WorkforceMenu } from '../features/workforce/WorkforcePage';
import { TasksMenu } from '../features/tasks/TaskPages';
import { TrfWaveMenu } from '../features/trf-wave/TrfWavePages';
import { LoginCallbackPage, LoginPage } from '../features/session/LoginPage';
import { SessionPage } from '../features/session/SessionPage';
import { messages as m } from '../shared/messages';
import { LiveClock } from './LiveClock';
import { allMenus, centerPath, isDcManager, isWorkerOnly, navGroups, type MenuItem, type MenuKey } from './nav';
import { ConnectionBanner, ShortcutHelp, useDocumentTitle, useSlashToSearch } from './PageChrome';
import { RequireSession, SessionProvider, useSession } from './SessionContext';
import { useDcCenters } from './dcCenters';
import { groupIcon, useMenuCollapsed } from './sideMenu';
import { ThemeToggle } from './ThemeToggle';

/** 주소의 DC(`/c/:cdcId/…`). 세션 centers 중 DC(useDcCenters)에 있을 때만 그 DC */
function useCenter(): { readonly cdcId: string; readonly mine: boolean } | null {
  const { cdcId } = useParams();
  const dc = useDcCenters();
  if (!cdcId) return null;
  return { cdcId, mine: dc.centers.includes(cdcId) };
}

/** 머리줄 내 정보 메뉴 — 이름·사번은 내 정보 화면과 같은 hr 본인 조회 */
function DcAccountMenu() {
  const { session, logout } = useSession();
  const me = useMe();
  const navigate = useNavigate();
  if (!session) return null;
  return (
    <AccountMenu
      name={me.data?.name ?? null}
      employeeNo={me.data?.employeeNo}
      roles={session.roles.map((r) => m.roleName[r] ?? r)}
      profileTo="/me"
      onLogout={() =>
        void logout().then((result) => {
          if (result !== 'redirecting') void navigate('/login', { replace: true });
        })
      }
    />
  );
}

function Layout() {
  const { session } = useSession();
  const center = useCenter();
  const { pathname } = useLocation();
  const [collapsed, toggleMenu] = useMenuCollapsed();
  const dc = useDcCenters();
  const target = center?.mine ? center.cdcId : dc.centers[0];
  // 지금 메뉴(`/c/:cdcId/<segment>/…`) — DC 를 바꾸면 같은 메뉴로 간다
  // DC 밖 주소(/me 등)는 메뉴가 아니다 — 위치 줄에 첫 메뉴(대시보드)가 나오지 않게(2026-11-26 UI 점검)
  const inCenter = pathname.startsWith('/c/');
  const segment = (inCenter ? pathname.split('/')[3] : undefined) ?? allMenus[0]!.segment;
  const showMenus = !!target && !isWorkerOnly(session?.roles ?? []);
  const currentGroup = inCenter ? navGroups.find((g) => g.items.some((i) => i.segment === segment)) : undefined;
  const currentItem = currentGroup?.items.find((i) => i.segment === segment);
  useDocumentTitle(currentItem ? m.menus[currentItem.key] : null);
  useSlashToSearch();
  const groups: ConsoleNavGroup[] = showMenus
    ? navGroups.map((g) => ({
        id: g.key,
        label: m.groups[g.key],
        ...(groupIcon[g.key] ? { icon: groupIcon[g.key] } : {}),
        items: g.items.map((item) => ({ to: centerPath(target, item.segment), label: m.menus[item.key], end: false })),
      }))
    : [];
  return (
    <ConsoleShell
      title={m.appTitle}
      homeLabel={m.goHome}
      groups={groups}
      rail="groups"
      activePath={pathname}
      collapsed={collapsed}
      onToggleMenu={toggleMenu}
      expandLabel={m.nav.expand}
      collapseLabel={m.nav.collapse}
      navLabel={m.nav.menu}
      location={
        <ConsoleBreadcrumb
          {...(currentGroup && currentGroup.key !== 'overview' && currentGroup.items[0] && target ? { group: { label: m.groups[currentGroup.key], to: centerPath(target, currentGroup.items[0].segment) } } : {})}
          {...(currentItem ? { current: m.menus[currentItem.key] } : {})}
        />
      }
      locationAside={session && session.roles.length > 0 ? <RoleText roles={session.roles.map((r) => m.roleName[r] ?? r)} /> : undefined}
      banner={
        <>
          <ConnectionBanner />
          {/* 메뉴가 접혔을 때(좁은 화면 — 휴대폰) 묶음 아이콘만 남으니, 지금 묶음의 메뉴를 화면 위 줄로(2026-11-26 사용자 "목록이 안 뜨고 4개만 버튼처럼") */}
          {collapsed && showMenus && currentGroup && (
            <nav aria-label={m.nav.groupMenu(m.groups[currentGroup.key])} className="flex gap-1.5 overflow-x-auto px-6 pb-2" data-testid="group-chips">
              {currentGroup.items.map((item) => (
                <NavLink
                  key={item.key}
                  to={centerPath(target, item.segment)}
                  className={({ isActive }) => `btn btn-xs shrink-0 whitespace-nowrap ${isActive ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
                >
                  {m.menus[item.key]}
                </NavLink>
              ))}
            </nav>
          )}
        </>
      }
      tools={
        <>
          <LiveClock />
          {/* 좁은 화면에서는 DC 이름을 숨긴다 — 머리줄이 화면 밖으로 넘쳐 페이지 전체가 넓어지지 않게(2026-11-26 휴대폰) */}
          {session && center?.mine && (
            <span className="hidden min-w-0 sm:contents">
              <CenterSwitcher centers={dc.centers} current={center.cdcId} segment={segment} />
            </span>
          )}
          {env.isMock && <span className="badge badge-accent badge-sm hidden sm:inline-flex">{m.mockBadge}</span>}
          <span className="hidden sm:contents">
            <ShortcutHelp />
            <ThemeToggle />
          </span>
          {session ? (
            <DcAccountMenu />
          ) : (
            <NavLink to="/login" className="btn btn-ghost btn-xs shrink-0 font-normal">
              {m.nav.login}
            </NavLink>
          )}
          <AppLauncher current="cdc-backoffice" />
        </>
      }
    >
      <div className="space-y-4">
        <Outlet />
      </div>
    </ConsoleShell>
  );
}

/** DC 하나 아래 화면들. 권한 안내(막지 않음)·작업자 전용 계정 차단·남의 DC 차단을 한 곳에서 */
function CenterScope({ menu }: { readonly menu: MenuItem }) {
  const { session } = useSession();
  const center = useCenter();
  const dc = useDcCenters();
  if (!session || !center) return null;
  if (isWorkerOnly(session.roles)) return <WorkerOnly />;
  if (dc.loading) return <Loading />;
  if (!center.mine) {
    return (
      <div className="space-y-3">
        <p role="alert" className="alert alert-warning text-sm">
          {dc.centers.length === 0 ? m.center.none : m.center.notMine}
        </p>
        {dc.centers.length > 0 && (
          <ul className="menu rounded-box bg-base-100 w-fit">
            {dc.centers.map((c) => (
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
      {!isDcManager(session.roles) && (
        <p role="note" className="alert alert-warning text-sm">
          {m.noSupervisor}
        </p>
      )}
      <MenuPage menu={menu} cdcId={center.cdcId} />
    </>
  );
}

/** 만든 메뉴 화면(nav.ts `ready`). 아직이면 "준비 중" */
const menuPages: Partial<Record<MenuKey, ComponentType<{ readonly cdcId: string }>>> = {
  dashboard: DashboardPage,
  floor: FloorMenu,
  mfcFlow: MfcFlowMenu,
  inbound: InboundMenu,
  replenishment: ReplenishmentMenu,
  trfWave: TrfWaveMenu,
  tasks: TasksMenu,
  master: MasterMenu,
  inventory: InventoryMenu,
  shipping: ShippingMenu,
  transport: TransportMenu,
  reports: ReportsMenu,
  workers: WorkforceMenu,
  picking: PickingMenu,
};

function MenuPage({ menu, cdcId }: { readonly menu: MenuItem; readonly cdcId: string }) {
  const Page = menu.ready ? menuPages[menu.key] : undefined;
  return Page ? <Page cdcId={cdcId} /> : <PreparingPage menu={menu} />;
}

function Loading() {
  return (
    <p role="status" className="p-6 text-sm opacity-70">
      {m.loading}
    </p>
  );
}

function WorkerOnly() {
  return (
    <p role="alert" className="alert alert-warning text-sm">
      {m.workerOnly}
    </p>
  );
}

/** 첫 화면: 맡은 첫 DC 의 첫 메뉴로. DC 가 없거나 작업자 전용이면 안내 */
function Home() {
  const { session } = useSession();
  const dc = useDcCenters();
  if (!session) return null;
  if (isWorkerOnly(session.roles)) return <WorkerOnly />;
  if (dc.loading) return <Loading />;
  const first = dc.centers[0];
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
      { path: 'me', element: guarded(<SessionPage />) },
      { path: 'c/:cdcId', element: guarded(<Home />) },
      ...allMenus.map((menu) => ({ path: `c/:cdcId/${menu.segment}/*`, element: guarded(<CenterScope menu={menu} />) })),
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
