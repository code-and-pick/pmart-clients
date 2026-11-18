// 라이더 백오피스 뼈대(2026-11-17, PC 1): 직원 로그인·세션·메뉴 자리. 메뉴 화면(관제 등)은 delivery 영역(PC 5)이 채운다.
import { UiTextProvider } from '@pmart/web-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createBrowserRouter, createMemoryRouter, Link, Navigate, NavLink, Outlet, RouterProvider, useLocation } from 'react-router';

import { env } from '../env';
import { CasesMenu } from '../features/cases/CasePages';
import { ControlPage } from '../features/control/ControlPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { AdjustmentsMenu, SurchargesMenu } from '../features/earnings/EarningPages';
import { PayoutsMenu } from '../features/earnings/PayoutPages';
import { AppealsMenu } from '../features/support/AppealPages';
import { NoticesMenu } from '../features/ops/NoticePages';
import { StaffActionsMenu } from '../features/ops/StaffActionsPage';
import { RestrictionReviewsMenu, RidersMenu, SignupsMenu } from '../features/riders/RiderPages';
import { HelpRequestsMenu, InquiriesMenu } from '../features/support/SupportPages';
import { DeliveriesMenu } from '../features/deliveries/DeliveryPages';
import { PreparingPage } from '../features/menus/PreparingPage';
import { LoginCallbackPage, LoginPage } from '../features/session/LoginPage';
import { SessionPage } from '../features/session/SessionPage';
import { messages as m } from '../shared/messages';
import { SimulatorLink } from '../shared/sim';
import { allMenus, hasRiderAppRole, isOperatorAdmin, menuPath, navGroups, visibleGroups, type MenuItem } from './nav';
import { RequireSession, SessionProvider, useSession } from './SessionContext';

/** 지금 주소의 메뉴(머리줄 "묶음 › 메뉴") */
function useCurrentMenu() {
  const { pathname } = useLocation();
  const seg = pathname.split('/')[1] ?? '';
  const group = navGroups.find((g) => g.items.some((i) => i.segment === seg));
  const item = group?.items.find((i) => i.segment === seg);
  return group && item ? { group: m.groups[group.key], menu: m.menus[item.key] } : null;
}

// 화면 틀(2026-11-18 — 배민 관리자 화면 참고): 진한 왼쪽 메뉴(묶음 제목 + 메뉴), 흰 머리줄(위치 · 로그인 직원·역할), 연회색 본문.
function Layout() {
  const { session } = useSession();
  const current = useCurrentMenu();
  return (
    <div className="flex min-h-screen bg-base-200">
      <aside className="flex w-56 shrink-0 flex-col bg-neutral text-neutral-content">
        <div className="flex h-14 items-center gap-2 border-b border-neutral-content/10 px-5">
          <Link to="/" className="text-base font-bold text-neutral-content" aria-label={m.goHome}>
            {m.appTitle}
          </Link>
          {env.isMock && <span className="badge badge-accent badge-sm">{m.mockBadge}</span>}
        </div>
        <nav aria-label="메뉴" className="flex-1 overflow-y-auto py-3">
          {session &&
            visibleGroups(session.roles).map((g) => (
              <div key={g.key} className="mb-3">
                <p className="px-5 pb-1 text-xs font-semibold text-neutral-content/45">{m.groups[g.key]}</p>
                <ul>
                  {g.items.map((item) => (
                    <li key={item.key}>
                      <NavLink
                        to={menuPath(item.segment)}
                        className={({ isActive }) =>
                          `flex items-center border-l-[3px] px-5 py-2 text-sm ${isActive ? 'border-accent bg-neutral-content/10 font-semibold text-neutral-content' : 'border-transparent text-neutral-content/75 hover:bg-neutral-content/5 hover:text-neutral-content'}`
                        }
                      >
                        {m.menus[item.key]}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-base-300 bg-base-100 px-6">
          <p className="truncate text-sm text-base-content/60" data-testid="page-title">
            {current ? (
              <>
                {current.group} <span className="px-1 text-base-content/30">›</span>
                <span className="font-semibold text-base-content">{current.menu}</span>
              </>
            ) : null}
          </p>
          <div className="flex items-center gap-3 text-sm">
            <SimulatorLink />
            {session ? (
              <>
                <span className="font-mono text-xs" data-testid="operator">
                  {session.subject}
                </span>
                {session.roles.map((r) => (
                  <span key={r} className="badge badge-outline badge-sm">
                    {r}
                  </span>
                ))}
                <NavLink to="/session" className="btn btn-ghost btn-xs">
                  {m.nav.session}
                </NavLink>
              </>
            ) : (
              <NavLink to="/login" className="btn btn-primary btn-xs">
                {m.nav.login}
              </NavLink>
            )}
          </div>
        </header>
        <main className="min-w-0 flex-1 space-y-5 p-6">
          <Outlet />
        </main>
      </div>
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
      return <AppealsMenu />;
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
