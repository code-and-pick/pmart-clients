import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLauncher, UiTextProvider } from '@pmart/web-ui';
import { useEffect, useState, type ReactNode } from 'react';
import { createBrowserRouter, createMemoryRouter, Link, Navigate, NavLink, Outlet, RouterProvider, useLocation } from 'react-router';

import { ApprovalDetailPage } from '../features/approvals/ApprovalDetailPage';
import { ApprovalInboxPage } from '../features/approvals/ApprovalInboxPage';
import { ApprovalListPage } from '../features/approvals/ApprovalListPage';
import { AssistantProvider } from '../features/assistant/AssistantContext';
import { AssistantAnswerPage, AssistantPage } from '../features/assistant/AssistantPage';
import { createDraftAssistantMock } from '../features/assistant/draftMock';
import { createHttpAssistant } from '../features/assistant/httpAssistant';
import type { AssistantPort } from '../features/assistant/port';
import { CategoryTreePage } from '../features/categories/CategoryTreePage';
import { ContentDraftPage, NewContentDraftPage } from '../features/contents/ContentDraftPage';
import { ContentImportPage, NewContentImportPage } from '../features/contents/ContentImportPage';
import { SkuHandlingPage } from '../features/handlings/SkuHandlingPage';
import { ClaimDetailPage, ClaimListPage } from '../features/claims/ClaimPages';
import { ReturnIntakePage } from '../features/claims/ReturnClaim';
import { PendingPage } from '../features/pending/PendingPage';
import { PiiAccessLogDetailPage, PiiAccessLogListPage } from '../features/piiAccess/PiiAccessLogPages';
import { UnifiedLookupPage } from '../features/lookup/UnifiedLookupPage';
import { LiveDeliveryPage } from '../features/live/LiveDeliveryPage';
import { PackingHandoverPage } from '../features/live/PackingHandoverPage';
import { CaseDetailPage, CaseListPage, NewMisdeliveryPage } from '../features/cases/CasePages';
import { CsFollowUpPage } from '../features/cases/FollowUps';
import { HandoverPage } from '../features/cases/HandoverPages';
import { DeliveryDetailPage, DeliveryOpenPage } from '../features/deliveries/DeliveryPages';
import { CaseMetricsPage } from '../features/cases/CaseMetricsPage';
import { CaseSlaPage } from '../features/cases/CaseSlaPage';
import { InquiryDetailPage, InquiryListPage } from '../features/inquiries/InquiryPages';
import { SatisfactionPage } from '../features/inquiries/SatisfactionPage';
import { NewCsIntakePage } from '../features/csIntakes/CsIntakePages';
import { OrderDetailPage, OrderLookupPage } from '../features/orders/OrderLookupPages';
import { NewRiderComplaintPage, RiderComplaintDetailPage, RiderComplaintListPage } from '../features/riderComplaints/RiderComplaintPages';
import { RiderDetailPage, RiderOpsMovedPage } from '../features/riders/RiderPages';
import { NewPriceImportPage, PriceImportPage } from '../features/prices/PriceImportPage';
import { PricePage } from '../features/prices/PricePage';
import { ProductDetailPage } from '../features/products/ProductDetailPage';
import { NewProductDraftPage, ProductDraftPage } from '../features/products/ProductDraftPage';
import { NewProductImportPage, ProductImportPage } from '../features/products/ProductImportPage';
import { ProductListPage } from '../features/products/ProductListPage';
import { LoginCallbackPage, LoginPage } from '../features/session/LoginPage';
import { SessionPage } from '../features/session/SessionPage';
import type { Api } from '../api/client';
import { env } from '../env';
import { messages as m } from '../shared/messages';
import { useApi } from './ApiContext';
import { covers, homePath, visibleGroups, type NavGroup } from './nav';
import { RequireSession, SessionProvider, useSession } from './SessionContext';
import { MenuGroupAlert, MenuItemAlerts } from './MenuAlerts';

/** 업무 도우미: 목 모드는 draftMock(계약 모양), 실서버 모드(local·lan)는 게이트웨이의 ai-assistant-service(2026-11-09 LAN 배포). */
const defaultAssistantPort = (api: Api): AssistantPort =>
  import.meta.env.VITE_PMART_ENV === 'mock' ? createDraftAssistantMock({ delayMs: 400 }) : createHttpAssistant(api);

/**
 * 접고 펴는 메뉴 묶음 — 진한 메뉴의 작은 회색 묶음 제목, 선택된 메뉴는 민트 왼쪽 막대
 * (사본: web/rider-backoffice/src/app/App.tsx Layout, PR #93 461ff31 — 이 앱에서 따로 고친다).
 * 기본 백오피스는 묶음·메뉴가 많아 접고 펴기는 그대로 둔다. 지금 화면이 든 묶음은 펼친 채로 시작한다(사용자가 접으면 그대로 둔다).
 */
function NavGroupMenu({ group, pathname }: { readonly group: NavGroup; readonly pathname: string }) {
  const active = group.items.some((i) => covers(i, pathname));
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? active;
  return (
    <details open={open} onToggle={(e) => setManual(e.currentTarget.open)} data-testid={`nav-group-${group.id}`} className="mb-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-1 text-xs font-semibold text-neutral-content/45 hover:text-neutral-content/70">
        <span>{group.label}</span>
        {/* 업무 알림 합계 — 접혀 있을 때만(2026-11-18 사용자 "메뉴에 업무 알람") */}
        <span className="ml-auto" aria-hidden="true">
          <MenuGroupAlert items={group.items} open={open} />
        </span>
      </summary>
      <ul>
        {group.items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end
              className={({ isActive }) =>
                `flex items-center gap-1 border-l-[3px] px-5 py-2 text-sm ${isActive ? 'border-accent bg-neutral-content/10 font-semibold text-neutral-content' : 'border-transparent text-neutral-content/75 hover:bg-neutral-content/5 hover:text-neutral-content'}`
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
function currentMenu(groups: readonly NavGroup[], pathname: string): { readonly group: string; readonly menu: string } | null {
  let best: { group: string; menu: string; len: number } | null = null;
  for (const g of groups) for (const i of g.items) if (covers(i, pathname) && (!best || i.to.length > best.len)) best = { group: g.label, menu: i.label, len: i.to.length };
  return best ? { group: best.group, menu: best.menu } : null;
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

// 화면 틀(2026-11-18 — PC 5 요청 "관리자 형식", 배민 관리자 화면 참고): 진한 왼쪽 메뉴(묶음 제목 + 메뉴), 흰 머리줄(위치 · 로그인 직원·역할), 연회색 본문.
function Layout() {
  const { session } = useSession();
  const { pathname } = useLocation();
  const groups = session ? visibleGroups(session.roles) : [];
  const current = currentMenu(groups, pathname);
  return (
    <div className="flex min-h-screen bg-base-200">
      <ScrollToTopOnNavigate />
      {/* 메뉴는 화면 높이에 고정하고 길면 메뉴만 따로 스크롤(오른쪽 화면을 내려도 메뉴는 그 자리) */}
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col self-start overflow-y-auto bg-neutral text-neutral-content" data-testid="side-menu">
        <div className="flex h-14 shrink-0 items-center justify-between gap-1 border-b border-neutral-content/10 pl-5 pr-2">
          <Link to="/" className="truncate text-base font-bold text-neutral-content" aria-label={m.goHome}>
            {m.appTitle}
          </Link>
        </div>
        <nav aria-label="메뉴" className="flex-1 py-3">
          {groups.map((g) => (
            <NavGroupMenu key={g.id} group={g} pathname={pathname} />
          ))}
          {session && groups.every((g) => g.id === 'assistant') && <p className="px-5 text-xs text-neutral-content/60">{m.nav.noMenu}</p>}
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
          <div className="flex items-center gap-2 text-sm">
            {env.isMock && <span className="badge badge-accent badge-sm">{m.mockBadge}</span>}
            {/* 직원 웹 앱 바꾸기(백엔드 요청 all/2026-11-17-request-app-launcher) — 2026-11-18 사용자: Google 앱 런처처럼 머리줄 오른쪽. 링크만, 세션을 읽지 않는다 */}
            <AppLauncher current="backoffice" />
            {session ? (
              <>
                {/* 로그인 직원 — "내 세션: 직원 ID" 링크(로그인 시험이 이 이름으로 찾는다). 역할은 내 세션 화면에서 본다(머리줄에 두 번 보이지 않게) */}
                <NavLink to="/session" className="btn btn-ghost btn-xs font-normal" data-testid="operator">
                  {`${m.nav.session}: ${session.subject}`}
                </NavLink>
              </>
            ) : (
              <NavLink to="/login" className="btn btn-primary btn-xs">
                {m.nav.login}
              </NavLink>
            )}
          </div>
        </header>
        <main className="min-w-0 flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const guarded = (element: ReactNode) => <RequireSession>{element}</RequireSession>;

/** 첫 화면: 역할로 보이는 첫 메뉴(없으면 내 세션). */
function Home() {
  const { session } = useSession();
  return <Navigate to={homePath(session?.roles ?? [])} replace />;
}

const routes = [
  { path: '/login', element: <LoginPage /> },
  // 직원 로그인 복귀 주소(handoff 2026-11-12 §3 — 백엔드 허용 목록의 <출처>/auth/callback)
  { path: '/auth/callback', element: <LoginCallbackPage /> },
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: guarded(<Home />) },
      { path: 'session', element: guarded(<SessionPage />) },
      { path: 'approvals', element: guarded(<ApprovalListPage />) },
      { path: 'approvals/:approvalId', element: guarded(<ApprovalDetailPage />) },
      { path: 'views/approval-inbox', element: guarded(<ApprovalInboxPage />) },
      { path: 'categories', element: guarded(<CategoryTreePage />) },
      { path: 'products', element: guarded(<ProductListPage />) },
      { path: 'products/drafts/new', element: guarded(<NewProductDraftPage />) },
      { path: 'products/drafts/:draftId', element: guarded(<ProductDraftPage />) },
      { path: 'products/import', element: guarded(<NewProductImportPage />) },
      { path: 'products/import/:batchId', element: guarded(<ProductImportPage />) },
      { path: 'products/:productId', element: guarded(<ProductDetailPage />) },
      { path: 'contents/drafts/new', element: guarded(<NewContentDraftPage />) },
      { path: 'contents/drafts/:draftId', element: guarded(<ContentDraftPage />) },
      { path: 'contents/import', element: guarded(<NewContentImportPage />) },
      { path: 'contents/import/:batchId', element: guarded(<ContentImportPage />) },
      { path: 'prices', element: guarded(<PricePage />) },
      { path: 'prices/import', element: guarded(<NewPriceImportPage />) },
      { path: 'prices/import/:batchId', element: guarded(<PriceImportPage />) },
      { path: 'handlings', element: guarded(<SkuHandlingPage />) },
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
