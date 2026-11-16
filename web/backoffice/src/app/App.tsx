import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UiTextProvider } from '@pmart/web-ui';
import { useState, type ReactNode } from 'react';
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
import { PendingPage } from '../features/pending/PendingPage';
import { PiiAccessLogDetailPage, PiiAccessLogListPage } from '../features/piiAccess/PiiAccessLogPages';
import { UnifiedLookupPage } from '../features/lookup/UnifiedLookupPage';
import { LiveDeliveryPage } from '../features/live/LiveDeliveryPage';
import { CaseDetailPage, CaseListPage, NewMisdeliveryPage } from '../features/cases/CasePages';
import { DeliveryDetailPage, DeliveryOpenPage } from '../features/deliveries/DeliveryPages';
import { InquiryDetailPage, InquiryListPage } from '../features/inquiries/InquiryPages';
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
              </NavLink>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

function Layout() {
  const { session } = useSession();
  const { pathname } = useLocation();
  const groups = session ? visibleGroups(session.roles) : [];
  return (
    <div className="flex min-h-screen bg-base-200">
      <aside className="w-56 shrink-0 bg-base-100 shadow-sm">
        <div className="p-4">
          <Link to="/" className="text-lg font-bold" aria-label={m.goHome}>
            {m.appTitle}
          </Link>
          {env.isMock && <span className="badge badge-outline ml-2">{m.mockBadge}</span>}
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
      { path: 'inquiries/:inquiryId', element: guarded(<InquiryDetailPage />) },
      // 고객센터·라이더 운영(백엔드 요청 2026-11-15 cs-rider-menus)
      { path: 'orders', element: guarded(<OrderLookupPage />) },
      { path: 'orders/:orderId', element: guarded(<OrderDetailPage />) },
      { path: 'pending', element: guarded(<PendingPage />) },
      { path: 'pii-access-logs', element: guarded(<PiiAccessLogListPage />) },
      { path: 'pii-access-logs/:piiAccessLogId', element: guarded(<PiiAccessLogDetailPage />) },
      { path: 'lookup', element: guarded(<UnifiedLookupPage />) },
      { path: 'live-delivery', element: guarded(<LiveDeliveryPage />) },
      { path: 'cases', element: guarded(<CaseListPage />) },
      { path: 'cases/new-misdelivery', element: guarded(<NewMisdeliveryPage />) },
      { path: 'cases/:caseId', element: guarded(<CaseDetailPage />) },
      { path: 'rider-complaints', element: guarded(<RiderComplaintListPage />) },
      { path: 'rider-complaints/new', element: guarded(<NewRiderComplaintPage />) },
      { path: 'rider-complaints/:complaintId', element: guarded(<RiderComplaintDetailPage />) },
      { path: 'claims', element: guarded(<ClaimListPage />) },
      { path: 'claims/:claimId', element: guarded(<ClaimDetailPage />) },
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
