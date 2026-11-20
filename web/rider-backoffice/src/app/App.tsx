// 라이더 백오피스 뼈대(2026-11-17, PC 1): 직원 로그인·세션·메뉴 자리. 메뉴 화면(관제 등)은 delivery 영역(PC 5)이 채운다.
import { AppLauncher, UiTextProvider } from '@pmart/web-ui';
import { ConsoleBreadcrumb, ConsoleShell, type ConsoleNavGroup } from '@pmart/web-ui/console';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { createBrowserRouter, createMemoryRouter, Navigate, NavLink, Outlet, RouterProvider, useLocation, useNavigate } from 'react-router';

import { env } from '../env';
import { CasesMenu } from '../features/cases/CasePages';
import { ControlPage } from '../features/control/ControlPage';
import { ControlSearch } from '../features/control/ControlSearch';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { AdjustmentsMenu, SurchargesMenu } from '../features/earnings/EarningPages';
import { PayoutsMenu } from '../features/earnings/PayoutPages';
import { NoticesMenu } from '../features/ops/NoticePages';
import { StaffActionsMenu } from '../features/ops/StaffActionsPage';
import { RestrictionReviewsMenu, RidersMenu, SignupsMenu } from '../features/riders/RiderPages';
import { ConsultsMenu, HelpRequestsMenu, InquiriesMenu } from '../features/support/SupportPages';
import { DeliveriesMenu } from '../features/deliveries/DeliveryPages';
import { PreparingPage } from '../features/menus/PreparingPage';
import { LoginCallbackPage, LoginPage } from '../features/session/LoginPage';
import { SessionPage } from '../features/session/SessionPage';
import { messages as m } from '../shared/messages';
import { StaffName } from '../shared/displayNumbers';
import { Icon, type IconName } from '../shared/icons';
import { SimulatorLink } from '../shared/sim';
import { DETAIL_BAR_SLOT } from '../shared/StickyTitle';
import { ConnectionBanner, ThemeToggle, useDocumentTitle, useSlashToSearch } from './PageChrome';
import { allMenus, hasRiderAppRole, isOperatorAdmin, menuPath, navGroups, visibleGroups, type GroupKey, type MenuItem } from './nav';
import { RequireSession, SessionProvider, useSession } from './SessionContext';

/** 지금 주소의 메뉴(머리줄 "묶음 › 메뉴") */
function useCurrentMenu() {
  const { pathname } = useLocation();
  const seg = pathname.split('/')[1] ?? '';
  const group = navGroups.find((g) => g.items.some((i) => i.segment === seg));
  const item = group?.items.find((i) => i.segment === seg);
  return group && item ? { group: m.groups[group.key], menu: m.menus[item.key] } : null;
}

/** 메뉴 묶음 아이콘(카페24 관리자처럼 묶음마다 하나) */
const groupIcon: Record<GroupKey, IconName> = {
  overview: 'home',
  control: 'radar',
  riders: 'rider',
  deliveries: 'truck',
  support: 'headset',
  earnings: 'won',
  ops: 'megaphone',
};

/**
 * 메뉴 접기 — 화면 틀(Layout)은 메뉴를 옮겨도 그대로라 이 창에서 계속 유지된다.
 * 브라우저 저장소에는 두지 않는다(이 앱 규칙: 브라우저 저장소 사용 금지 — BR-03, lint).
 */
function useNavCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  const toggle = () => setCollapsed((c) => !c);
  return [collapsed, toggle] as const;
}

/** 머리줄 통합 찾기 — 주문번호·라이더 번호로 어느 화면에서나 관제의 그 라이더로 */
function HeaderSearch() {
  const navigate = useNavigate();
  return (
    <ControlSearch
      compact
      onFound={(hit) => {
        const p = new URLSearchParams();
        if (hit.mfcId) p.set('mfcId', hit.mfcId);
        p.set('rider', hit.riderId);
        if (hit.deliveryId) p.set('delivery', hit.deliveryId);
        void navigate(`/control?${p.toString()}`);
      }}
    />
  );
}

// 화면 틀(2026-11-19 — 카페24 관리자·배민 주문접수 참고): 진한 남색 왼쪽 메뉴(묶음 아이콘 + 메뉴, 접으면 아이콘만),
// 흰 머리줄(위치 · 통합 찾기 · 로그인 직원·역할), 연회색 본문은 넓은 화면을 다 쓴다.
function Layout() {
  const { session } = useSession();
  const current = useCurrentMenu();
  const [collapsed, toggle] = useNavCollapsed();
  const { pathname } = useLocation();
  const seg = pathname.split('/')[1] ?? '';
  // 브라우저 탭 제목(화면 이름 + 아직 받지 않은 도움요청 수)·'/' 로 검색 칸 — 2026-11-19 통합 백오피스와 같게
  useDocumentTitle(current?.menu ?? null, !!session);
  useSlashToSearch();
  // 2026-11-20 웹 백오피스 맞추기 4단계: 진한 남색 메뉴·data-skin=wing → 공용 콘솔 틀(@pmart/web-ui/console ConsoleShell — 흰 머리줄·흰 메뉴·위치 줄).
  // 접으면 묶음마다 아이콘 하나(그 묶음 첫 메뉴로, 이름은 링크 이름) — 전과 같음
  const groups: ConsoleNavGroup[] = session
    ? visibleGroups(session.roles).map((g) => ({
        id: g.key,
        label: m.groups[g.key],
        icon: <Icon name={groupIcon[g.key]} className="h-5 w-5" />,
        items: g.items.map((item) => ({ to: menuPath(item.segment), label: m.menus[item.key], end: false })),
      }))
    : [];
  const currentGroup = navGroups.find((g) => g.items.some((i) => i.segment === seg));
  return (
    <ConsoleShell
      title={m.appTitle}
      homeLabel={m.goHome}
      groups={groups}
      rail="groups"
      activePath={pathname}
      collapsed={collapsed}
      onToggleMenu={toggle}
      expandLabel={m.nav.expand}
      collapseLabel={m.nav.collapse}
      location={
        <ConsoleBreadcrumb
          {...(current && currentGroup?.items[0] ? { group: { label: current.group, to: menuPath(currentGroup.items[0].segment) } } : {})}
          {...(current ? { current: current.menu } : {})}
        />
      }
      locationAside={
        session ? (
          <>
            {session.roles.map((r) => (
              <span key={r} className="badge badge-ghost badge-sm">
                {r}
              </span>
            ))}
          </>
        ) : undefined
      }
      banner={
        <>
          {/* 상세 제목 띠 자리(2026-11-19) — 상세를 내리면 DetailHeader 가 여기에 얇은 제목 띠를 그린다 */}
          <div id={DETAIL_BAR_SLOT} className="sticky top-0 z-10" />
          <ConnectionBanner />
        </>
      }
      tools={
        <>
          {/* 머리줄 통합 찾기 — 주문번호·라이더 번호로 관제의 그 라이더로 */}
          {session && <HeaderSearch />}
          <SimulatorLink />
          {env.isMock && <span className="badge badge-accent badge-sm whitespace-nowrap">{m.mockBadge}</span>}
          <ThemeToggle />
          {session ? (
            <>
              <span className="text-xs" data-testid="operator">
                <StaffName operatorId={session.subject} />
              </span>
              <NavLink to="/session" className="btn btn-ghost btn-xs">
                {m.nav.session}
              </NavLink>
            </>
          ) : (
            <NavLink to="/login" className="btn btn-primary btn-xs">
              {m.nav.login}
            </NavLink>
          )}
          {/* 직원 웹 앱 바꾸기 — 머리줄 맨 오른쪽, 통합·인사팀 백오피스와 같게 */}
          <AppLauncher current="rider-backoffice" />
        </>
      }
    >
      <div className="space-y-5">
        <Outlet />
      </div>
    </ConsoleShell>
  );
}

/** 메뉴 하나. 주 역할(RIDER_OPS·OPERATOR_ADMIN)이 없으면 막지 않고 안내만 — 판정은 서버 */
function MenuScope({ menu }: { readonly menu: MenuItem }) {
  const { session } = useSession();
  if (!session) return null;
  return (
    <>
      {!hasRiderAppRole(session.roles) && (
        <p role="note" className="alert alert-warning text-sm" data-testid="no-rider-role">
          {m.noRiderRole}
        </p>
      )}
      {menu.adminOnly && !isOperatorAdmin(session.roles) ? (
        <p role="note" className="alert alert-warning text-sm" data-testid="admin-only">
          {m.adminOnly}
        </p>
      ) : (
        <MenuPage menu={menu} />
      )}
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
    case 'dashboard':
      return <DashboardPage />;
    case 'riderMap':
      return <ControlPage />;
    case 'riders':
      return <RidersMenu />;
    case 'signups':
      return <SignupsMenu />;
    case 'restrictionReviews':
      return <RestrictionReviewsMenu />;
    case 'consults':
      return <ConsultsMenu />;
    case 'helpRequests':
      return <HelpRequestsMenu />;
    case 'inquiries':
      return <InquiriesMenu />;
    case 'adjustments':
      return <AdjustmentsMenu />;
    case 'surcharges':
      return <SurchargesMenu />;
    case 'payouts':
      return <PayoutsMenu />;
    case 'appeals':
      // 소명·이의는 상담함 탭으로 합쳤다(2026-11-20) — 옛 주소·저장한 보기는 조건을 들고 그 탭으로
      return <AppealsRedirect />;
    case 'notices':
      return <NoticesMenu />;
    case 'staffActions':
      return <StaffActionsMenu />;
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
/** /appeals?… → /consults?tab=appeals&… */
function AppealsRedirect() {
  const { search } = useLocation();
  const p = new URLSearchParams(search);
  p.set('tab', 'appeals');
  return <Navigate to={`/consults?${p.toString()}`} replace />;
}

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
