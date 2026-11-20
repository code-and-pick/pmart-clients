import { ImportsPage } from '../features/products/ImportsPage';
import { ContentsRedirect } from '../features/contents/ContentListPage';
import { DETAIL_BAR_SLOT } from '../shared/StickyTitle';
import { HelpPanelSlot, HelpProvider, HelpToggle } from '../shared/HelpPanel';
import { ConnectionBanner, useDocumentTitle } from './PageChrome';
import { useStaffText } from '../shared/employeeLabels';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLauncher, QueryState, UiTextProvider } from '@pmart/web-ui';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { createBrowserRouter, createMemoryRouter, Link, Navigate, NavLink, Outlet, RouterProvider, useLocation, useNavigate } from 'react-router';

import { AssistantProvider } from '../features/assistant/AssistantContext';
import { AssistantAnswerPage, AssistantPage } from '../features/assistant/AssistantPage';
import { createDraftAssistantMock } from '../features/assistant/draftMock';
import { createHttpAssistant } from '../features/assistant/httpAssistant';
import type { AssistantPort } from '../features/assistant/port';
import { DashboardPage } from './DashboardPage';
import { LoginCallbackPage, LoginPage } from '../features/session/LoginPage';
import { SessionPage } from '../features/session/SessionPage';
import type { Api } from '../api/client';
import { env } from '../env';
import { useMenuCollapsed } from '../shared/sideMenu';
import { QuickJump } from './QuickJump';
import { ShortcutHelp } from './ShortcutHelp';
import { ThemeToggle } from './ThemeToggle';
import { Toasts } from './Toasts';
import { messages as m } from '../shared/messages';
import { useApi } from './ApiContext';
import { aliasMenu, covers, visibleGroups, type NavGroup } from './nav';
import { RequireSession, SessionProvider, useSession } from './SessionContext';
import { GroupIcon } from './groupIcons';
import { GroupAlertBadge, MenuAlertLegend, MenuGroupAlert, MenuItemAlerts } from './MenuAlerts';
import { NavRail } from './NavRail';
import { AlertsAutoRefresh } from './AlertsAutoRefresh';
import { LiveClock, RoleChips } from './HeaderContext';
import { SectionMenuContext } from '../shared/admin';
import { WidgetMenuButton } from '../shared/WidgetMenu';

// 화면은 열 때 받는다(2026-11-19 — 앱 전체가 파일 하나라 첫 화면이 느렸다). 로그인·세션·대시보드·업무 도우미 틀은 처음부터.
const ApprovalDetailPage = lazy(() => import('../features/approvals/ApprovalDetailPage').then((x) => ({ default: x.ApprovalDetailPage })));
const ApprovalListPage = lazy(() => import('../features/approvals/ApprovalListPage').then((x) => ({ default: x.ApprovalListPage })));
const CategoryTreePage = lazy(() => import('../features/categories/CategoryTreePage').then((x) => ({ default: x.CategoryTreePage })));
const ContentDraftPage = lazy(() => import('../features/contents/ContentDraftPage').then((x) => ({ default: x.ContentDraftPage })));
const PromotionListPage = lazy(() => import('../features/promotions/PromotionPages').then((x) => ({ default: x.PromotionListPage })));
const PromotionNewPage = lazy(() => import('../features/promotions/PromotionPages').then((x) => ({ default: x.PromotionNewPage })));
const PromotionDetailPage = lazy(() => import('../features/promotions/PromotionPages').then((x) => ({ default: x.PromotionDetailPage })));
const ContentDraftListPage = lazy(() => import('../features/contents/ContentDraftListPage').then((x) => ({ default: x.ContentDraftListPage })));
const NewContentDraftPage = lazy(() => import('../features/contents/ContentDraftPage').then((x) => ({ default: x.NewContentDraftPage })));
const ContentImportPage = lazy(() => import('../features/contents/ContentImportPage').then((x) => ({ default: x.ContentImportPage })));
const NewContentImportPage = lazy(() => import('../features/contents/ContentImportPage').then((x) => ({ default: x.NewContentImportPage })));
const HomeLayoutListPage = lazy(() => import('../features/display/HomeLayoutPages').then((x) => ({ default: x.HomeLayoutListPage })));
const HomeLayoutDraftPage = lazy(() => import('../features/display/HomeLayoutPages').then((x) => ({ default: x.HomeLayoutDraftPage })));
const SynonymRulesPage = lazy(() => import('../features/search/SynonymRulesPage').then((x) => ({ default: x.SynonymRulesPage })));
const ZeroResultKeywordsPage = lazy(() => import('../features/search/ZeroResultKeywordsPage').then((x) => ({ default: x.ZeroResultKeywordsPage })));
const SkuHandlingPage = lazy(() => import('../features/handlings/SkuHandlingPage').then((x) => ({ default: x.SkuHandlingPage })));
const ClaimDetailPage = lazy(() => import('../features/claims/ClaimPages').then((x) => ({ default: x.ClaimDetailPage })));
const ClaimListPage = lazy(() => import('../features/claims/ClaimPages').then((x) => ({ default: x.ClaimListPage })));
const ReturnIntakePage = lazy(() => import('../features/claims/ReturnClaim').then((x) => ({ default: x.ReturnIntakePage })));
const PendingPage = lazy(() => import('../features/pending/PendingPage').then((x) => ({ default: x.PendingPage })));
const PiiAccessLogDetailPage = lazy(() => import('../features/piiAccess/PiiAccessLogPages').then((x) => ({ default: x.PiiAccessLogDetailPage })));
const PiiAccessLogListPage = lazy(() => import('../features/piiAccess/PiiAccessLogPages').then((x) => ({ default: x.PiiAccessLogListPage })));
const UnifiedLookupPage = lazy(() => import('../features/lookup/UnifiedLookupPage').then((x) => ({ default: x.UnifiedLookupPage })));
const LiveDeliveryPage = lazy(() => import('../features/live/LiveDeliveryPage').then((x) => ({ default: x.LiveDeliveryPage })));
const PackingHandoverPage = lazy(() => import('../features/live/PackingHandoverPage').then((x) => ({ default: x.PackingHandoverPage })));
const CaseDetailPage = lazy(() => import('../features/cases/CasePages').then((x) => ({ default: x.CaseDetailPage })));
const CaseListPage = lazy(() => import('../features/cases/CasePages').then((x) => ({ default: x.CaseListPage })));
const NewMisdeliveryPage = lazy(() => import('../features/cases/CasePages').then((x) => ({ default: x.NewMisdeliveryPage })));
const CsFollowUpPage = lazy(() => import('../features/cases/FollowUps').then((x) => ({ default: x.CsFollowUpPage })));
const HandoverPage = lazy(() => import('../features/cases/HandoverPages').then((x) => ({ default: x.HandoverPage })));
const DeliveryDetailPage = lazy(() => import('../features/deliveries/DeliveryPages').then((x) => ({ default: x.DeliveryDetailPage })));
const DeliveryOpenPage = lazy(() => import('../features/deliveries/DeliveryPages').then((x) => ({ default: x.DeliveryOpenPage })));
const CaseMetricsPage = lazy(() => import('../features/cases/CaseMetricsPage').then((x) => ({ default: x.CaseMetricsPage })));
const CaseSlaPage = lazy(() => import('../features/cases/CaseSlaPage').then((x) => ({ default: x.CaseSlaPage })));
const InquiryDetailPage = lazy(() => import('../features/inquiries/InquiryPages').then((x) => ({ default: x.InquiryDetailPage })));
const InquiryListPage = lazy(() => import('../features/inquiries/InquiryPages').then((x) => ({ default: x.InquiryListPage })));
const SatisfactionPage = lazy(() => import('../features/inquiries/SatisfactionPage').then((x) => ({ default: x.SatisfactionPage })));
const NewCsIntakePage = lazy(() => import('../features/csIntakes/CsIntakePages').then((x) => ({ default: x.NewCsIntakePage })));
const CustomerSearchPage = lazy(() => import('../features/customers/CustomerPages').then((x) => ({ default: x.CustomerSearchPage })));
const CustomerDetailPage = lazy(() => import('../features/customers/CustomerPages').then((x) => ({ default: x.CustomerDetailPage })));
const OrderDetailPage = lazy(() => import('../features/orders/OrderLookupPages').then((x) => ({ default: x.OrderDetailPage })));
const OrderLookupPage = lazy(() => import('../features/orders/OrderLookupPages').then((x) => ({ default: x.OrderLookupPage })));
const NewRiderComplaintPage = lazy(() => import('../features/riderComplaints/RiderComplaintPages').then((x) => ({ default: x.NewRiderComplaintPage })));
const RiderComplaintDetailPage = lazy(() => import('../features/riderComplaints/RiderComplaintPages').then((x) => ({ default: x.RiderComplaintDetailPage })));
const RiderComplaintListPage = lazy(() => import('../features/riderComplaints/RiderComplaintPages').then((x) => ({ default: x.RiderComplaintListPage })));
const RiderDetailPage = lazy(() => import('../features/riders/RiderPages').then((x) => ({ default: x.RiderDetailPage })));
const RiderOpsMovedPage = lazy(() => import('../features/riders/RiderPages').then((x) => ({ default: x.RiderOpsMovedPage })));
const NewPriceImportPage = lazy(() => import('../features/prices/PriceImportPage').then((x) => ({ default: x.NewPriceImportPage })));
const PriceImportPage = lazy(() => import('../features/prices/PriceImportPage').then((x) => ({ default: x.PriceImportPage })));
const PricePage = lazy(() => import('../features/prices/PricePage').then((x) => ({ default: x.PricePage })));
const ProductDetailPage = lazy(() => import('../features/products/ProductDetailPage').then((x) => ({ default: x.ProductDetailPage })));
const NewProductDraftPage = lazy(() => import('../features/products/ProductDraftPage').then((x) => ({ default: x.NewProductDraftPage })));
const ProductDraftPage = lazy(() => import('../features/products/ProductDraftPage').then((x) => ({ default: x.ProductDraftPage })));
const NewProductImportPage = lazy(() => import('../features/products/ProductImportPage').then((x) => ({ default: x.NewProductImportPage })));
const ProductImportPage = lazy(() => import('../features/products/ProductImportPage').then((x) => ({ default: x.ProductImportPage })));
const ProductListPage = lazy(() => import('../features/products/ProductListPage').then((x) => ({ default: x.ProductListPage })));

/** 업무 도우미: 목 모드는 draftMock(계약 모양), 실서버 모드(local·lan)는 게이트웨이의 ai-assistant-service(2026-11-09 LAN 배포). */
const defaultAssistantPort = (api: Api): AssistantPort =>
  import.meta.env.VITE_PMART_ENV === 'mock' ? createDraftAssistantMock({ delayMs: 400 }) : createHttpAssistant(api);

/**
 * 접고 펴는 메뉴 묶음 — 진한 메뉴의 작은 회색 묶음 제목, 선택된 메뉴는 민트 왼쪽 막대
 * (사본: web/rider-backoffice/src/app/App.tsx Layout, PR #93 461ff31 — 이 앱에서 따로 고친다).
 * 기본 백오피스는 묶음·메뉴가 많아 접고 펴기는 그대로 둔다.
 * 한 번에 한 묶음만 펼친다(2026-11-18 사용자 "다른 묶음 열면 전 묶음이 안 닫혀 밑으로 줄줄 흐른다"):
 * 묶음 이름을 누르면 그 묶음만 열리고 나머지는 닫힌다. 다른 묶음의 화면으로 옮기면 그 묶음이 열린다. 열린 묶음을 다시 누르면 닫힌다.
 */
function NavGroupMenu({ group, pathname, open, onToggle }: { readonly group: NavGroup; readonly pathname: string; readonly open: boolean; readonly onToggle: () => void }) {
  const active = group.items.some((i) => covers(i, pathname));
  const alias = aliasMenu(group.items, pathname); // 옛 주소로 켤 메뉴(2026-11-19 메뉴 정리)
  return (
    // 묶음 이름(2026-11-20 AWS 개편 2단계, ADR-0004): 흰 메뉴의 굵은 묶음 제목 — 왼쪽 펼침 화살표(▸ → 펼치면 ▾), 아이콘·바탕 없음.
    // 알림 합계는 오른쪽 끝(접혀 있을 때만, 2026-11-18 사용자 "메뉴에 업무 알람").
    <details open={open} data-testid={`nav-group-${group.id}`} data-current={active || undefined} className="mb-1">
      <summary
        onClick={(e) => {
          e.preventDefault(); // 브라우저가 따로 열고 닫지 않게 — 열림은 위(한 묶음만)에서 정한다
          onToggle();
        }}
        className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-[5px] text-sm font-bold text-base-content transition-colors hover:text-primary"
      >
        <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 shrink-0 fill-none stroke-current transition-transform ${open ? 'rotate-90' : ''}`} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-testid="nav-group-chevron">
          <path d="m9 6 6 6-6 6" />
        </svg>
        <span data-group-label>{group.label}</span>
        <span className="ml-auto flex items-center gap-2" aria-hidden="true">
          <MenuGroupAlert items={group.items} open={open} />
        </span>
      </summary>
      <ul className="pb-1">
        {group.items.map((item) => (
          <li key={item.to}>
            {/* 지금 메뉴는 파랑 굵은 글자, 바탕 없음(AWS) */}
            <NavLink
              to={item.to}
              end
              data-active={alias === item.to ? 'alias' : undefined}
              className={({ isActive }) =>
                `flex items-center gap-1 py-[5px] pl-9 pr-3 text-sm transition-colors ${isActive || alias === item.to ? 'font-semibold text-primary' : 'text-base-content/85 hover:text-primary'}`
              }
            >
              {item.label}
              {/* 업무 알림(1분마다 개수 — 접수 건·승인함·문의 답변·라이더 문의·처리 대기) */}
              <MenuItemAlerts to={item.to} />
            </NavLink>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** 지금 주소의 메뉴(머리줄 "묶음 › 메뉴") — 하위 경로는 가장 긴 메뉴 경로로 */
// 메뉴를 합치며 그 메뉴 아래로 옮긴 화면(also)은 머리줄에 화면 이름을 하나 더(2026-11-20 사용자 "가격 화면인데 상품 조회로 나간 줄 알았다")
const SUB_PAGE: ReadonlyArray<readonly [string, string]> = [['/prices', m.prices.title]];

function currentMenu(groups: readonly NavGroup[], pathname: string): { readonly group: string; readonly groupTo: string; readonly menu: string; readonly menuTo: string; readonly sub: string | null } | null {
  let best: { group: string; groupTo: string; menu: string; menuTo: string; len: number } | null = null;
  for (const g of groups)
    for (const i of g.items)
      if (covers(i, pathname) && (!best || i.to.length > best.len)) best = { group: g.label, groupTo: g.home ?? g.items[0]?.to ?? '/', menu: i.label, menuTo: i.to, len: i.to.length };
  const sub = SUB_PAGE.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1] ?? null;
  return best ? { group: best.group, groupTo: best.groupTo, menu: best.menu, menuTo: best.menuTo, sub } : null;
}

/** 위치 줄(AWS 빵부스러기): 묶음 / 메뉴 / (하위 화면) — 앞은 밑줄 링크, 마지막은 굵은 글자. 시험은 data-testid=page-title 의 글자로 찾는다. */
function Breadcrumbs({ current, pathname }: { readonly current: ReturnType<typeof currentMenu>; readonly pathname: string }) {
  if (!current) return <p className="truncate text-sm" data-testid="page-title" />;
  const crumbs: { label: string; to: string }[] = [{ label: current.group, to: current.groupTo }, { label: current.menu, to: current.menuTo }];
  if (current.sub) crumbs.push({ label: current.sub, to: pathname });
  return (
    <p className="flex min-w-0 items-center truncate text-sm" data-testid="page-title">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={`${i}-${c.label}`} className="flex items-center">
            {i > 0 && <span className="px-2 text-base-content/40" aria-hidden="true">/</span>}
            {last || c.to === pathname ? (
              <span className={last ? 'font-semibold text-base-content' : 'text-base-content/70'}>{c.label}</span>
            ) : (
              <Link to={c.to} className="text-base-content/80 underline underline-offset-2 hover:text-primary">
                {c.label}
              </Link>
            )}
          </span>
        );
      })}
    </p>
  );
}

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

// 화면 틀 — 2026-11-20 AWS 콘솔 개편 2단계로 다시 짬(아래 return 주석). 예전: 2026-11-18 PC 5 요청 "관리자 형식"(진한 왼쪽 메뉴).
function Layout() {
  const { session, signedIn, restoring } = useSession();
  const { pathname } = useLocation();
  const groups = session ? visibleGroups(session.roles, session.centers) : [];
  // 한 번에 한 묶음만 펼침 — 지금 화면의 묶음이 바뀌면 그 묶음을 연다(대시보드처럼 묶음 밖이면 그대로)
  const activeGroup = groups.find((g) => g.items.some((i) => covers(i, pathname)))?.id ?? null;
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroup);
  const [seenActive, setSeenActive] = useState(activeGroup);
  if (activeGroup !== seenActive) {
    setSeenActive(activeGroup);
    if (activeGroup) setOpenGroup(activeGroup);
  }
  const current = currentMenu(groups, pathname);
  // 브라우저 탭 제목 — 화면 이름 + 기한 넘긴 접수 건 수(2026-11-19)
  useDocumentTitle(pathname === '/' && session ? m.chrome.home : (current?.sub ?? current?.menu ?? null));
  // 메뉴 접기(2026-11-19) — 접으면 묶음 아이콘만(마우스를 올리면 이름, 누르면 그 묶음 첫 화면), 업무 알림 개수는 그대로
  const [collapsed, toggleMenu] = useMenuCollapsed();
  // 머리줄 내 세션 — 이름 · 사번(OP-… 대신, ADR-0070 덧붙임). 읽는 중·못 읽음은 "내 세션"만
  const staff = useStaffText(signedIn && !restoring ? session?.subject : null); // 세션 복원이 끝난 뒤에만(복원 중에 부르면 401 → 토큰 갱신이 한 번 더)
  const myName = staff && staff !== '…' && !staff.startsWith('직원 ·') ? staff : '';
  const navigate = useNavigate();
  return (
    // 화면 틀(2026-11-20 AWS 개편 2단계, ADR-0004 · docs/apps/backoffice-ui-guide.md §2):
    // 맨 위 전체 폭 흰 머리줄(로고 · 번호 찾기 · 도구 · 내 세션 · 앱 바꾸기) → 그 아래 흰 왼쪽 메뉴 | 위치 줄(묶음 / 메뉴) + 본문.
    <HelpProvider>
    {/* 구역 상자 오른쪽 위 메뉴 = 대시보드 위젯 ⋮(공용 Section 이 그린다 — 위젯 밖이면 스스로 안 그림) */}
    <SectionMenuContext.Provider value={<WidgetMenuButton />}>
    <div className="flex min-h-screen flex-col bg-base-200">
      <ScrollToTopOnNavigate />
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-base-300 bg-base-100 px-4">
        <Link to="/" className="flex shrink-0 items-center gap-2 font-bold text-base-content" aria-label={m.goHome}>
          {/* 로고 배지(2026-11-19 — 라이더 백오피스와 같게) */}
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-accent text-xs text-accent-content" aria-hidden="true">
            P
          </span>
          <span className="truncate text-[15px]">{m.appTitle}</span>
        </Link>
        {/* 번호로 바로 찾기(Ctrl+K, 2026-11-18) — 로그인했을 때만. AWS 처럼 로고 바로 옆 */}
        {session && <QuickJump />}
        <div className="ml-auto flex items-center gap-2 text-sm">
            {session && <LiveClock />}
            {env.isMock && <span className="badge badge-accent badge-sm">{m.mockBadge}</span>}
            {/* 단축키 안내(2026-11-19) */}
            <ShortcutHelp />
            <ThemeToggle />
            {session ? (
              <>
                {/* 로그인 직원 — "내 세션: 직원 ID" 링크(로그인 시험이 이 이름으로 찾는다). 역할은 내 세션 화면에서 본다(머리줄에 두 번 보이지 않게) */}
                <NavLink to="/session" className="btn btn-ghost btn-xs font-normal" data-testid="operator">
                  {myName ? `${m.nav.session}: ${myName}` : m.nav.session}
                </NavLink>
              </>
            ) : (
              <NavLink to="/login" className="btn btn-primary btn-xs">
                {m.nav.login}
              </NavLink>
            )}
            {/* 직원 웹 앱 바꾸기(백엔드 요청 all/2026-11-17-request-app-launcher) — 2026-11-18 사용자: Google 앱 런처처럼 머리줄 맨 오른쪽("내 세션" 오른쪽, 사용자 2026-11-18). 링크만, 세션을 읽지 않는다 */}
            {/* 이 앱 메뉴 칸 — 칸마다 그 묶음 할 일 개수(왼쪽 메뉴와 같은 조회, 2026-11-18 사용자) */}
            <AppLauncher
              current="backoffice"
              menu={{
                title: m.menuAlerts.launcherMenu,
                items: groups.map((g) => {
                  const href = g.home ?? g.items[0]?.to ?? '/';
                  return {
                    id: g.id,
                    label: g.label,
                    icon: <GroupIcon id={g.id} className="h-5 w-5" />,
                    href,
                    onSelect: (to: string) => void navigate(to),
                    badge: <GroupAlertBadge items={g.items} />,
                    active: g.items.some((i) => covers(i, pathname)),
                  };
                }),
              }}
            />
        </div>
      </header>
      <div className="flex min-w-0 flex-1">
        {/* 흰 왼쪽 메뉴 — 화면 높이에 고정하고 길면 메뉴만 따로 스크롤(오른쪽 화면을 내려도 메뉴는 그 자리) */}
        <aside className={`sticky top-0 flex h-screen shrink-0 flex-col self-start overflow-y-auto border-r pb-11 border-base-300 bg-base-100 text-base-content transition-[width] ${collapsed ? 'w-20' : 'w-[220px]'}`} data-testid="side-menu" data-collapsed={collapsed}>
          <div className={`flex h-10 shrink-0 items-center ${collapsed ? 'justify-center px-1' : 'justify-end px-2'}`}>
            <button type="button" className="btn btn-ghost btn-sm h-8 w-8 p-0 text-base-content/70" onClick={toggleMenu} aria-label={collapsed ? m.nav.expand : m.nav.collapse} title={collapsed ? m.nav.expand : m.nav.collapse} data-testid="menu-toggle">
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {collapsed ? <path d="m9 6 6 6-6 6M4 4v16" /> : <path d="m15 6-6 6 6 6M20 4v16" />}
              </svg>
            </button>
          </div>
          {collapsed ? (
            <NavRail groups={groups} pathname={pathname} showDashboard={!!session} />
          ) : (
            <nav aria-label="메뉴" className="flex-1 pb-3">
              {session && (
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) => `mb-1 flex items-center px-4 py-[5px] text-sm font-bold transition-colors ${isActive ? 'text-primary' : 'text-base-content hover:text-primary'}`}
                  data-testid="nav-dashboard"
                >
                  {m.dashboard.title}
                </NavLink>
              )}
              {groups.map((g) => (
                <NavGroupMenu key={g.id} group={g} pathname={pathname} open={openGroup === g.id} onToggle={() => setOpenGroup((cur) => (cur === g.id ? null : g.id))} />
              ))}
              {session && groups.every((g) => g.id === 'assistant') && <p className="px-4 text-xs text-base-content/60">{m.nav.noMenu}</p>}
            </nav>
          )}
          {/* 숫자 보는 법(2026-11-20 사용자 "뭐가 파랑이고 뭐가 빨강인지") — 펼친 메뉴에만 */}
          {!collapsed && session && <MenuAlertLegend />}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 위치 줄(AWS 빵부스러기) + 맥락 꼬리표(내 역할) */}
          <div className="flex h-10 shrink-0 items-center gap-3 px-6">
            <Breadcrumbs current={current} pathname={pathname} />
            {session && <RoleChips roles={session.roles} />}
            {/* 도움말 열기(화면이 설명을 걸었을 때만, 3단계) */}
            <HelpToggle />
          </div>
          {/* 상세 제목 띠 자리(2026-11-19) — 상세를 내리면 DetailHeader 가 여기에 얇은 제목 띠를 그린다 */}
          <div id={DETAIL_BAR_SLOT} className="sticky top-0 z-20" />
          {/* 인터넷 끊김 띠(2026-11-19) */}
          <ConnectionBanner />
          {/* 본문 겉모습은 index.css "AWS 콘솔 겉모습"(2026-11-20 개편 시범, 공용 wing 겉모습은 이 앱에서 뺐다) */}
          <main className="min-w-0 flex-1 px-6 pb-6 pt-1">
            {/* 화면을 받는 동안 뼈대(QueryState 불러오는 중 모양, 2026-11-19) */}
            <Suspense fallback={<QueryState state={{ kind: 'loading' }}>{() => null}</QueryState>}>
              <Outlet />
            </Suspense>
          </main>
          {/* 처리 결과 알림(2026-11-18) */}
          <Toasts />
        </div>
        {/* 오른쪽 도움말 패널(AWS Help panel) */}
        <HelpPanelSlot />
      </div>
    </div>
    </SectionMenuContext.Provider>
    </HelpProvider>
  );
}

const guarded = (element: ReactNode) => <RequireSession>{element}</RequireSession>;


const routes = [
  { path: '/login', element: <LoginPage /> },
  // 직원 로그인 복귀 주소(handoff 2026-11-12 §3 — 백엔드 허용 목록의 <출처>/auth/callback)
  { path: '/auth/callback', element: <LoginCallbackPage /> },
  {
    path: '/',
    element: <Layout />,
    children: [
      // 첫 화면 = 대시보드(2026-11-18 사용자 — 참고 관리자 화면의 메인처럼; 예전엔 역할 첫 메뉴로 바로 갔다)
      { index: true, element: guarded(<DashboardPage />) },
      { path: 'session', element: guarded(<SessionPage />) },
      { path: 'approvals', element: guarded(<ApprovalListPage />) },
      // 고객(bff 0.22.0 BF-2, 2026-11-20)
      { path: 'customers', element: guarded(<CustomerSearchPage />) },
      { path: 'customers/:customerId', element: guarded(<CustomerDetailPage />) },
      { path: 'approvals/:approvalId', element: guarded(<ApprovalDetailPage />) },
      // "모든 승인 한눈에"는 승인함과 같은 목록이라 합침(2026-11-20) — 예전 주소는 승인함으로
      { path: 'views/approval-inbox', element: <Navigate to="/approvals" replace /> },
      { path: 'categories', element: guarded(<CategoryTreePage />) },
      { path: 'products', element: guarded(<ProductListPage />) },
      { path: 'products/drafts/new', element: guarded(<NewProductDraftPage />) },
      { path: 'products/drafts/:draftId', element: guarded(<ProductDraftPage />) },
      { path: 'imports', element: guarded(<ImportsPage />) }, // 일괄 등록 한 메뉴(2026-11-19)
      { path: 'products/import', element: guarded(<NewProductImportPage />) },
      { path: 'products/import/:batchId', element: guarded(<ProductImportPage />) },
      { path: 'products/:productId', element: guarded(<ProductDetailPage />) },
      // 콘텐츠 조회는 상품으로 합침(2026-11-19 상품 묶음 1단계) — 옛 주소는 상품 목록으로(미게시 보기는 콘텐츠 거르기로)
      { path: 'contents', element: guarded(<ContentsRedirect />) },
      { path: 'contents/drafts', element: guarded(<ContentDraftListPage />) },
      // 행사·쿠폰(promotion 0.2.0, ADR-0082)
      { path: 'promotions', element: guarded(<PromotionListPage />) },
      { path: 'promotions/new', element: guarded(<PromotionNewPage />) },
      { path: 'promotions/:promotionId', element: guarded(<PromotionDetailPage />) },
      { path: 'contents/drafts/new', element: guarded(<NewContentDraftPage />) },
      { path: 'contents/drafts/:draftId', element: guarded(<ContentDraftPage />) },
      { path: 'contents/import', element: guarded(<NewContentImportPage />) },
      { path: 'contents/import/:batchId', element: guarded(<ContentImportPage />) },
      { path: 'prices', element: guarded(<PricePage />) },
      { path: 'prices/import', element: guarded(<NewPriceImportPage />) },
      { path: 'prices/import/:batchId', element: guarded(<PriceImportPage />) },
      { path: 'handlings', element: guarded(<SkuHandlingPage />) },
      { path: 'search/zero-results', element: guarded(<ZeroResultKeywordsPage />) },
      { path: 'search/synonyms', element: guarded(<SynonymRulesPage />) },
      { path: 'display/home', element: guarded(<HomeLayoutListPage />) },
      { path: 'display/home/:draftId', element: guarded(<HomeLayoutDraftPage />) },
      { path: 'inquiries', element: guarded(<InquiryListPage />) },
      { path: 'inquiry-satisfaction', element: guarded(<SatisfactionPage />) },
      { path: 'inquiries/:inquiryId', element: guarded(<InquiryDetailPage />) },
      { path: 'rider-inquiries', element: guarded(<InquiryListPage kind="RIDER" />) },
      { path: 'rider-inquiries/:inquiryId', element: guarded(<InquiryDetailPage kind="RIDER" />) },
      { path: 'cs-intakes/new', element: guarded(<NewCsIntakePage />) },
      // 고객센터·라이더 운영(백엔드 요청 2026-11-15 cs-rider-menus)
      { path: 'orders', element: guarded(<OrderLookupPage />) },
      { path: 'orders/:orderId', element: guarded(<OrderDetailPage />) },
      { path: 'pending', element: guarded(<PendingPage />) },
      { path: 'follow-ups/cs', element: guarded(<CsFollowUpPage />) },
      { path: 'cases/handovers', element: guarded(<HandoverPage />) },
      { path: 'pii-access-logs', element: guarded(<PiiAccessLogListPage />) },
      { path: 'pii-access-logs/:piiAccessLogId', element: guarded(<PiiAccessLogDetailPage />) },
      { path: 'lookup', element: guarded(<UnifiedLookupPage />) },
      { path: 'live-delivery', element: guarded(<LiveDeliveryPage />) },
      { path: 'packing-handover', element: guarded(<PackingHandoverPage />) },
      { path: 'cases', element: guarded(<CaseListPage />) },
      { path: 'case-metrics', element: guarded(<CaseMetricsPage />) },
      // 처리 기한 지킴(bff 0.13.0 CASE_SLA — 백엔드 PR #164 병합 전, 목으로만)
      { path: 'case-sla', element: guarded(<CaseSlaPage />) },
      { path: 'cases/new-misdelivery', element: guarded(<NewMisdeliveryPage />) },
      { path: 'cases/:caseId', element: guarded(<CaseDetailPage />) },
      { path: 'rider-complaints', element: guarded(<RiderComplaintListPage />) },
      { path: 'rider-complaints/new', element: guarded(<NewRiderComplaintPage />) },
      { path: 'rider-complaints/:complaintId', element: guarded(<RiderComplaintDetailPage />) },
      { path: 'claims', element: guarded(<ClaimListPage />) },
      { path: 'claims/:claimId', element: guarded(<ClaimDetailPage />) },
      { path: 'return-intake', element: guarded(<ReturnIntakePage />) },
      { path: 'deliveries', element: guarded(<DeliveryOpenPage />) },
      { path: 'deliveries/:deliveryId', element: guarded(<DeliveryDetailPage />) },
      // 라이더 찾기·제한 검토는 라이더 백오피스로(2026-11-18, ADR-0068) — 옛 주소는 안내, 상세만 보기로 남김(다른 화면이 여기로 연결)
      { path: 'riders', element: guarded(<RiderOpsMovedPage path="riders" />) },
      { path: 'riders/restriction-reviews', element: guarded(<RiderOpsMovedPage path="restriction-reviews" />) },
      { path: 'riders/:riderId', element: guarded(<RiderDetailPage />) },
      { path: 'delivery-help-requests', element: <Navigate to="/cases?kind=RIDER_HELP" replace /> }, // 도움요청 대기는 사건함으로(백엔드 알림 2026-11-16 §3)
      { path: 'assistant', element: guarded(<AssistantPage />) },
      { path: 'assistant/answers/:answerId', element: guarded(<AssistantAnswerPage />) },
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
  assistantPort,
}: {
  readonly queryClient?: QueryClient;
  readonly memory?: boolean;
  readonly initialPath?: string;
  /** 테스트·목 모드에서 바로 세션을 시작한다. */
  readonly initialToken?: string;
  /** 테스트에서 업무 도우미 목 시나리오를 주입한다. */
  readonly assistantPort?: AssistantPort;
}) {
  const router = memory ? createMemoryRouter(routes, { initialEntries: [initialPath] }) : createBrowserRouter(routes);
  const api = useApi();
  const [port] = useState(() => assistantPort ?? defaultAssistantPort(api));
  return (
    <QueryClientProvider client={queryClient}>
      {/* 처리한 뒤 알림·대시보드 숫자 바로 맞추기(2026-11-19) */}
      <AlertsAutoRefresh />
      <UiTextProvider problem={m.problem} reason={m.reason}>
        <SessionProvider {...(initialToken ? { initialToken } : {})}>
          <AssistantProvider port={port}>
            <RouterProvider router={router} />
          </AssistantProvider>
        </SessionProvider>
      </UiTextProvider>
    </QueryClientProvider>
  );
}
