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
import { InquiryDetailPage, InquiryListPage } from '../features/inquiries/InquiryPages';
import { SatisfactionPage } from '../features/inquiries/SatisfactionPage';
import { NewCsIntakePage } from '../features/csIntakes/CsIntakePages';
import { OrderDetailPage, OrderLookupPage } from '../features/orders/OrderLookupPages';
import { NewRiderComplaintPage, RiderComplaintDetailPage, RiderComplaintListPage } from '../features/riderComplaints/RiderComplaintPages';
import { RestrictionReviewPage } from '../features/riders/RestrictionReviewPage';
import { RiderDetailPage, RiderSearchPage } from '../features/riders/RiderPages';
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
import { CaseNavBadges } from '../features/cases/CaseBadges';

/** 업무 도우미: 목 모드는 draftMock(계약 모양), 실서버 모드(local·lan)는 게이트웨이의 ai-assistant-service(2026-11-09 LAN 배포). */
const defaultAssistantPort = (api: Api): AssistantPort =>
  import.meta.env.VITE_PMART_ENV === 'mock' ? createDraftAssistantMock({ delayMs: 400 }) : createHttpAssistant(api);

/** 접고 펴는 메뉴 묶음. 지금 화면이 든 묶음은 펼친 채로 시작한다(사용자가 접으면 그대로 둔다). */
function NavGroupMenu({ group, pathname }: { readonly group: NavGroup; readonly pathname: string }) {
  const active = group.items.some((i) => covers(i, pathname));
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? active;
  return (
    <li>
      <details open={open} onToggle={(e) => setManual(e.currentTarget.open)} data-testid={`nav-group-${group.id}`}>
        <summary className="font-bold">{group.label}</summary>
        <ul>
          {group.items.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} end>
                {item.label}
                {/* 접수 건 알림 배지(1분마다 개수 — 지원센터·관리자) */}
                {item.to === '/cases' && <CaseNavBadges />}
              </NavLink>
            </li>
          ))}
        </ul>
      </details>
    </li>
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

function Layout() {
  const { session } = useSession();
  const { pathname } = useLocation();
  const groups = session ? visibleGroups(session.roles) : [];
  return (
    <div className="flex min-h-screen bg-base-200">
      {/* 메뉴는 화면 높이에 고정하고 길면 메뉴만 따로 스크롤(오른쪽 화면을 내려도 메뉴는 그 자리) */}
      <ScrollToTopOnNavigate />
      <aside className="sticky top-0 h-screen w-56 shrink-0 self-start overflow-y-auto bg-base-100 shadow-sm" data-testid="side-menu">
        <div className="flex items-start justify-between gap-1 p-4">
          <div>
            <Link to="/" className="text-lg font-bold" aria-label={m.goHome}>
              {m.appTitle}
            </Link>
            {env.isMock && <span className="badge badge-outline ml-2">{m.mockBadge}</span>}
          </div>
          {/* 직원 웹 앱 바꾸기(백엔드 요청 all/2026-11-17-request-app-launcher, web-ui #92) — 링크만, 세션을 읽지 않는다 */}
          <AppLauncher current="backoffice" />
        </div>
        <ul className="menu w-full" aria-label="메뉴">
          <li>
            <NavLink to={session ? '/session' : '/login'}>
              {session ? `${m.nav.session}: ${session.subject}` : m.nav.login}
            </NavLink>
          </li>
          {groups.map((g) => (
            <NavGroupMenu key={g.id} group={g} pathname={pathname} />
          ))}
        </ul>
        {session && groups.every((g) => g.id === 'assistant') && <p className="px-4 text-xs opacity-60">{m.nav.noMenu}</p>}
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <Outlet />
      </main>
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
      { path: 'riders', element: guarded(<RiderSearchPage />) },
      { path: 'riders/restriction-reviews', element: guarded(<RestrictionReviewPage />) },
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
