// 왼쪽 메뉴 묶음(백엔드 요청 2026-11-15 cs-rider-menus §1, 정본 표 pmart-backend docs/architecture/backoffice-role-menus.md §2).
// 역할은 세션 응답(sessions/current 0.6.0, 안내용). 메뉴 숨김은 편의일 뿐 — 권한은 서버가 행위마다 판정한다(숨긴 화면의 API 도 403).
// 여러 역할이면 합집합. 묶음 안 하위 메뉴가 하나도 안 보이면 묶음도 숨긴다.
// 같은 화면은 한 묶음에만 둔다: 상담원·라이더 운영이 함께 쓰는 조회 화면은 "조회·현황" 묶음으로(2026-11-16 사용자 — 두 역할 계정에서
// 같은 메뉴가 두 번 보이고 함께 강조되던 것). 정본 표는 역할→화면이 그대로이고 묶는 방법만 다르다(백엔드 알림 handoff 2026-11-16-backend-menu-shared-lookup-group).
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
  /** 이 묶음이 첫 화면을 정할 때 쓸 화면(없으면 첫 메뉴). 다른 묶음의 화면이어도 된다(고객센터 → 주문 조회). */
  readonly home?: string;
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
    id: 'lookup',
    label: m.nav.group.lookup,
    // 상담원·라이더 운영이 함께 쓰는 조회 화면(정본 표 §2 의 두 줄에 모두 있는 것). 라이더 컴플레인 기록은 상담원만(서버 판정).
    visibleTo: oneOf('CS_AGENT', 'RIDER_OPS', 'OPERATOR_ADMIN'),
    items: [
      { to: '/orders', label: m.nav.orders },
      { to: '/lookup', label: m.nav.lookup }, // BO-11, bff 0.3.0
      { to: '/live-delivery', label: m.nav.live },
      { to: '/deliveries', label: m.nav.deliveries },
      { to: '/rider-complaints', label: m.nav.riderComplaints },
    ],
  },
  {
    id: 'cs',
    label: m.nav.group.cs,
    visibleTo: oneOf('CS_AGENT', 'OPERATOR_ADMIN'),
    home: '/orders',
    items: [
      { to: '/inquiries', label: m.nav.inquiries },
      { to: '/claims', label: m.nav.claims },
    ],
  },
  {
    id: 'riderOps',
    label: m.nav.group.riderOps,
    visibleTo: oneOf('RIDER_OPS', 'OPERATOR_ADMIN'),
    items: [
      { to: '/riders', label: m.nav.riders },
      { to: '/riders/restriction-reviews', label: m.nav.restrictionReviews },
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

/**
 * 첫 화면: 역할 묶음 중 보이는 첫 묶음의 첫 화면(home 이 있으면 그것) — 상담원은 주문 조회, 라이더 운영은 라이더 찾기.
 * 함께 쓰는 조회·현황 묶음과 업무 도우미는 역할 묶음이 없을 때만. 그것도 없으면 내 세션.
 */
export function homePath(roles: readonly string[]): string {
  const groups = visibleGroups(roles);
  const own = groups.find((g) => g.id !== 'lookup' && g.id !== 'assistant') ?? groups.find((g) => g.id === 'lookup');
  return own ? (own.home ?? own.items[0]?.to ?? '/session') : '/session';
}
