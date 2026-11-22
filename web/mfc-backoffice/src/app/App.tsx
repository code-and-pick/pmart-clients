import { AppLauncher, UiTextProvider } from '@pmart/web-ui';
import { AccountMenu, ConsoleBreadcrumb, ConsoleShell, RoleText, type ConsoleNavGroup } from '@pmart/web-ui/console';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentType, ReactNode } from 'react';
import { createBrowserRouter, createMemoryRouter, Link, Navigate, NavLink, Outlet, RouterProvider, useLocation, useNavigate, useParams } from 'react-router';

import { env } from '../env';
import { AssignmentsMenu } from '../features/assignments/AssignmentPages';
import { CenterSwitcher } from '../features/centers/centers';
import { CenterDeliveriesMenu, DispatchFailuresMenu } from '../features/delivery/CenterDeliveryPages';
import { DispatchDelaysMenu } from '../features/delivery/DispatchDelayPage';
import { PackingHandoverMenu } from '../features/delivery/PackingHandoverPage';
import { ReturnHandoversMenu } from '../features/delivery/ReturnHandoverPage';
import { InboundMenu } from '../features/inbound/InboundPages';
import { InventoryMenu } from '../features/inventory/InventoryPages';
import { LocationsMenu } from '../features/locations/LocationPages';
import { MovesMenu } from '../features/moves/MovePages';
import { OpsMenu } from '../features/ops/OpsBoard';
import { DashboardMenu } from '../features/dashboard/CenterDashboard';
import { FloorMenu } from '../features/floor/FloorPage';
import { QualityMenu } from '../features/quality/QualityPages';
import { RestrictionsMenu } from '../features/restrictions/RestrictionPages';
import { TasksMenu } from '../features/tasks/TaskPages';
import { WorkersMenu } from '../features/workers/WorkerPages';
import { PreparingPage } from '../features/menus/PreparingPage';
import { LoginCallbackPage, LoginPage } from '../features/session/LoginPage';
import { useMe } from '../features/me/useMe';
import { MyInfoPage } from '../features/me/MyInfoPage';
import { messages as m } from '../shared/messages';
import { allMenus, centerPath, isWorkerOnly, navGroups, type MenuItem, type MenuKey } from './nav';
import { ConnectionBanner, ShortcutHelp, TaskAlertBadge, useDocumentTitle, useSlashToSearch } from './PageChrome';
import { RequireSession, SessionProvider, useSession } from './SessionContext';
import { LiveClock } from './LiveClock';
import { groupIcon, useMenuCollapsed } from './sideMenu';
import { ThemeToggle } from './ThemeToggle';
import { DETAIL_BAR_SLOT } from '../shared/StickyTitle';

/** 주소의 센터(`/c/:mfcId/…`). 세션 centers(sessions/current)에 있을 때만 그 센터 */
function useCenter(): { readonly mfcId: string; readonly mine: boolean } | null {
  const { mfcId } = useParams();
  const { session } = useSession();
  if (!mfcId) return null;
  return { mfcId, mine: session?.centers.includes(mfcId) ?? false };
}

/** 머리줄 내 정보 메뉴 — 이름·사번은 내 정보 화면과 같은 hr 본인 조회 */
function MfcAccountMenu() {
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

/** 화면 틀 — 통합 백오피스(web/backoffice)와 같은 모양(2026-11-19 사용자 "다른 통합 백오피스 앱 참조", PC 2 요청 "같은 느낌으로"):
 *  왼쪽 진한 남색 메뉴(P 배지 로고 · 홈 · 묶음 아이콘+이름 · 고른 메뉴 파란 채움·흰 글자) + 위 머리줄(묶음 › 메뉴 · 역할 · 센터 · 목 · 내 정보·세션)
 *  + 상세 제목 띠 자리 + 인터넷 끊김 띠. 본문은 쿠팡 윙 느낌(index.css data-skin=wing). 탭 제목에 약속 초과 수, '/' 키로 검색 칸. */
function Layout() {
  const { session } = useSession();
  const center = useCenter();
  const { pathname } = useLocation();
  const [collapsed, toggleMenu] = useMenuCollapsed();
  const target = center?.mine ? center.mfcId : session?.centers[0];
  // 지금 메뉴(`/c/:mfcId/<segment>/…`) — 센터를 바꾸면 같은 메뉴로 간다
  const segment = pathname.split('/')[3] ?? allMenus[0]!.segment;
  const showMenus = !!target && !isWorkerOnly(session?.roles ?? []);
  const currentGroup = navGroups.find((g) => g.items.some((i) => i.segment === segment));
  const currentItem = currentGroup?.items.find((i) => i.segment === segment);
  useDocumentTitle(currentItem ? m.menus[currentItem.key] : null, showMenus && center?.mine ? center.mfcId : null);
  useSlashToSearch();
  // 2026-11-20 웹 백오피스 맞추기 3단계: 쿠팡 윙(진한 남색 메뉴·data-skin=wing) → 공용 콘솔 틀(@pmart/web-ui/console ConsoleShell — 흰 머리줄·흰 메뉴·위치 줄)
  const groups: ConsoleNavGroup[] = showMenus
    ? navGroups.map((g) => ({
        id: g.key,
        label: m.groups[g.key],
        ...(groupIcon[g.key] ? { icon: groupIcon[g.key] } : {}),
        items: g.items.map((item) => ({
          to: centerPath(target, item.segment),
          label: m.menus[item.key],
          end: false,
          ...(item.key === 'tasks' && center?.mine ? { badge: <TaskAlertBadge mfcId={center.mfcId} /> } : {}),
        })),
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
      locationAside={
        // 역할은 단추·꼬리표 모양 없이 글자로(2026-11-23 통합 백오피스와 같은 공용 RoleText)
        session && session.roles.length > 0 ? <RoleText roles={session.roles.map((r) => m.roleName[r] ?? r)} /> : undefined
      }
      banner={
        <>
          {/* 상세 제목 띠 자리 — 상세를 내리면 얇은 제목 띠가 여기에 붙는다 */}
          <div id={DETAIL_BAR_SLOT} className="sticky top-0 z-[9]" />
          <ConnectionBanner />
        </>
      }
      tools={
        <>
          <LiveClock />
          {session && center?.mine && <CenterSwitcher centers={session.centers} current={center.mfcId} segment={segment} />}
          {/* 좁은 화면에서는 목 표시·단축키 도움·밝기 바꾸기·내 정보를 숨겨 머리줄이 넘치지 않게(2026-11-21) */}
          {env.isMock && <span className="badge badge-accent badge-sm hidden sm:inline-flex">{m.mockBadge}</span>}
          <span className="hidden sm:contents">
            <ShortcutHelp />
            <ThemeToggle />
          </span>
          {/* 내 정보 메뉴(2026-11-23 — 통합 백오피스와 같은 공용 AccountMenu): 머리글자 + 이름, 누르면 사번·역할·내 정보·로그아웃. 옛 "내 정보"·"내 세션" 링크 둘을 합침 */}
          {session ? (
            <MfcAccountMenu />
          ) : (
            <NavLink to="/login" className="btn btn-ghost btn-xs shrink-0 font-normal">
              {m.nav.login}
            </NavLink>
          )}
          {/* 직원 웹 앱 바꾸기 — 머리줄 맨 오른쪽, 통합·인사팀 백오피스와 같게 */}
          <AppLauncher current="mfc-backoffice" />
        </>
      }
    >
      <div className="space-y-4">
        <Outlet />
      </div>
    </ConsoleShell>
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
  // 센터 표시·고르기는 위 바(Layout)에 있다.
  return (
    <>
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
  ops: OpsMenu,
  dashboard: DashboardMenu,
  floor: FloorMenu,
  locations: LocationsMenu,
  moves: MovesMenu,
  workers: WorkersMenu,
  tasks: TasksMenu,
  assignments: AssignmentsMenu,
  packingHandover: PackingHandoverMenu,
  deliveries: CenterDeliveriesMenu,
  dispatchFailures: DispatchFailuresMenu,
  dispatchDelays: DispatchDelaysMenu,
  returnHandovers: ReturnHandoversMenu,
  inbound: InboundMenu,
  inventory: InventoryMenu,
  quality: QualityMenu,
  restrictions: RestrictionsMenu,
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

/** 첫 화면: 맡은 첫 센터의 센터 운영판(첫 메뉴)으로. 센터가 없거나 워커 전용이면 안내 */
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
      // 옛 내 세션 — 내 정보(/me)에 합침(2026-11-23)
      { path: 'session', element: <Navigate to="/me" replace /> },
      { path: 'me', element: guarded(<MyInfoPage />) },
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
