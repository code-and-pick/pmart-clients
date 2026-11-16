// 왼쪽 메뉴 묶음(백엔드 요청 2026-11-15 cs-rider-menus §1, 정본 표 pmart-backend docs/architecture/backoffice-role-menus.md §2).
// 역할은 세션 응답(sessions/current 0.6.0, 안내용). 메뉴 숨김은 편의일 뿐 — 권한은 서버가 행위마다 판정한다(숨긴 화면의 API 도 403).
// 여러 역할이면 합집합. 묶음 안 하위 메뉴가 하나도 안 보이면 묶음도 숨긴다. 같은 화면이 두 묶음에 있어도 된다.
// MFC 메뉴는 넣지 않는다(2026-11-15 사용자 결정 — MFC 백오피스는 따로 앱).
import { messages as m } from '../shared/messages';

export interface NavItem {
  readonly to: string;
  readonly label: string;
}

export interface NavGroup {
  readonly id: string;
  readonly label: string;
  /** 이 묶음을 보는 역할(하나라도 있으면 보인다). 'ALL' = 모든 직원 */
  readonly visibleTo: 'ALL' | ((role: string) => boolean);
  readonly items: readonly NavItem[];
}

const oneOf =
  (...roles: string[]) =>
  (role: string) =>
    roles.includes(role);

export const navGroups: readonly NavGroup[] = [
  {
    id: 'catalog',
    label: m.nav.group.catalog,
    // OPERATOR_ADMIN 도(사용자 2026-11-15, 백엔드 알림 backoffice/2026-11-15-notice-product-menu-operator-admin). 판매 상태 변경만 MD.
    visibleTo: oneOf('MD', 'OPERATOR_ADMIN'),
    items: [
      { to: '/products', label: m.nav.products },
      { to: '/products/drafts/new', label: m.nav.productNew },
      { to: '/products/import', label: m.nav.productImport },
      { to: '/categories', label: m.nav.categories },
      { to: '/contents/drafts/new', label: m.nav.contentNew },
      { to: '/contents/import', label: m.nav.contentImport },
      { to: '/prices', label: m.nav.prices },
      { to: '/prices/import', label: m.nav.priceImport },
      { to: '/handlings', label: m.nav.handlings },
    ],
  },
  {
    id: 'approval',
    label: m.nav.group.approval,
    // *_APPROVER(PRODUCT·DISPLAY·PRICE·SERVICEABILITY·CENTER_MASTER·INVENTORY) + OPERATOR_ADMIN
    visibleTo: (role) => role.endsWith('_APPROVER') || role === 'OPERATOR_ADMIN',
    items: [
      { to: '/approvals', label: m.nav.approvals },
      { to: '/views/approval-inbox', label: m.nav.bffInbox },
    ],
  },
  {
    id: 'cs',
    label: m.nav.group.cs,
    visibleTo: oneOf('CS_AGENT', 'OPERATOR_ADMIN'),
    items: [
      { to: '/orders', label: m.nav.orders },
      // 통합 조회(BO-11, bff 0.3.0) — 고객센터·라이더 운영 묶음 모두 두 번째(첫 화면 = 묶음 첫 메뉴는 그대로)
      { to: '/lookup', label: m.nav.lookup },
      { to: '/live-delivery', label: m.nav.live },
      { to: '/inquiries', label: m.nav.inquiries },
      { to: '/rider-complaints', label: m.nav.riderComplaints },
      { to: '/claims', label: m.nav.claims },
      { to: '/deliveries', label: m.nav.deliveries },
    ],
  },
  {
    id: 'riderOps',
    label: m.nav.group.riderOps,
    visibleTo: oneOf('RIDER_OPS', 'OPERATOR_ADMIN'),
    items: [
      { to: '/riders', label: m.nav.riders },
      { to: '/lookup', label: m.nav.lookup },
      { to: '/live-delivery', label: m.nav.live },
      { to: '/riders/restriction-reviews', label: m.nav.restrictionReviews },
      { to: '/deliveries', label: m.nav.deliveriesRiderOps },
      { to: '/rider-complaints', label: m.nav.riderComplaints },
      { to: '/orders', label: m.nav.orders },
    ],
  },
  {
    id: 'support',
    label: m.nav.group.support,
    // 지원센터 = RIDER_OPS(사용자 2026-11-16). OPERATOR_ADMIN 모두, CS_AGENT 는 보기 + 오배송 열기만(서버 판정).
    visibleTo: oneOf('RIDER_OPS', 'OPERATOR_ADMIN', 'CS_AGENT'),
    items: [
      { to: '/cases', label: m.nav.cases },
      { to: '/cases/new-misdelivery', label: m.nav.misdelivery },
    ],
  },
  {
    id: 'pending',
    label: m.nav.group.pending,
    // 본사 관리자(OPERATOR_ADMIN)만 — 모든 센터를 본다(사용자 2026-11-15). 센터 관리자는 MFC 백오피스.
    visibleTo: oneOf('OPERATOR_ADMIN'),
    items: [{ to: '/pending', label: m.nav.pendingWork }],
  },
  {
    id: 'assistant',
    label: m.nav.group.assistant,
    visibleTo: 'ALL',
    items: [{ to: '/assistant', label: m.nav.assistant }],
  },
];

/** 이 역할들로 보이는 묶음(순서 유지). */
export function visibleGroups(roles: readonly string[]): NavGroup[] {
  return navGroups.filter((g) => g.items.length > 0 && (g.visibleTo === 'ALL' || roles.some(g.visibleTo)));
}

/** 메뉴 항목이 지금 경로의 화면인가(하위 경로 포함 — 상세 화면에서도 묶음을 펼쳐 둔다). */
export function covers(item: NavItem, pathname: string): boolean {
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/** 첫 화면: 보이는 첫 메뉴. 역할에 맞는 메뉴가 없으면 내 세션. */
export function homePath(roles: readonly string[]): string {
  return visibleGroups(roles).find((g) => g.id !== 'assistant')?.items[0]?.to ?? '/session';
}
