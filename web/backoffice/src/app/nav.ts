// 왼쪽 메뉴 묶음(백엔드 요청 2026-11-15 cs-rider-menus §1, 정본 표 pmart-backend docs/architecture/backoffice-role-menus.md §2).
// 역할은 세션 응답(sessions/current 0.6.0, 안내용). 메뉴 숨김은 편의일 뿐 — 권한은 서버가 행위마다 판정한다(숨긴 화면의 API 도 403).
// 여러 역할이면 합집합. 묶음 안 하위 메뉴가 하나도 안 보이면 묶음도 숨긴다.
// 같은 화면은 한 묶음에만 둔다: 상담원·라이더 운영이 함께 쓰는 조회 화면은 "조회·현황" 묶음으로(2026-11-16 사용자 — 두 역할 계정에서
// 같은 메뉴가 두 번 보이고 함께 강조되던 것). 정본 표는 역할→화면이 그대로이고 묶는 방법만 다르다(백엔드 알림 handoff 2026-11-16-backend-menu-shared-lookup-group).
// MFC 메뉴는 넣지 않는다(2026-11-15 사용자 결정 — MFC 백오피스는 따로 앱).
// 라이더 운영 묶음(라이더 찾기·계정 제한·제한 검토)은 2026-11-18 라이더 백오피스로 옮겨 내렸다(ADR-0068). 라이더 상세(/riders/:id)는 보기만 남김.
import { messages as m } from '../shared/messages';

export interface NavItem {
  readonly to: string;
  readonly label: string;
  /** 이 메뉴로 켤 다른 주소(앞부분) — 메뉴를 합치며 옛 화면 주소를 그대로 둘 때 */
  readonly also?: readonly string[];
  /** 묶음 안에서 이 항목만 보는 역할(없으면 묶음 역할 그대로) */
  readonly visibleTo?: (role: string) => boolean;
  /** 토큰에 센터가 있어야 쓰는 화면(서버가 centers 클레임으로 판정 — 없으면 늘 403이라 메뉴에서 숨긴다) */
  readonly needsCenter?: boolean;
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
    // 메뉴 정리(2026-11-19 상품 묶음 합치기 — 9개 → 5개): 콘텐츠 등록은 상품 상세 "고객 화면" 탭·상품 등록에서, 가격 관리는 상품 목록 위 단추·상세 "가격" 탭에서,
    // 일괄 등록 셋은 한 메뉴(탭). 옛 주소는 그대로 열리고 also 로 그 메뉴가 켜진다. "등록 진행 중"은 초안 목록 API 가 없어 아직(handoff product-flow-questions)
    items: [
      { to: '/products', label: m.nav.products, also: ['/prices', '/contents'] },
      { to: '/products/drafts/new', label: m.nav.productNew, also: ['/products/drafts', '/contents/drafts'] },
      { to: '/imports', label: m.nav.imports, also: ['/products/import', '/contents/import', '/prices/import'] },
      { to: '/categories', label: m.nav.categories },
      // 홈 진열 편성(storefront 0.7.0, ADR-0075 ② — 배너·상품 테마, 편성 MD·OPERATOR_ADMIN, 승인 DISPLAY_APPROVER)
      { to: '/display/home', label: m.nav.homeLayout },
      // 센터 취급(mfc/cdc-inventory sku-handlings)은 토큰 centers 에 그 센터가 있어야만 된다(계약 "없으면 403") — 센터 없는 본사 역할에는 숨긴다(2026-11-20)
      { to: '/handlings', label: m.nav.handlings, needsCenter: true },
      // 결과 0건 검색어(search 0.4.0, ADR-0073) — 동의어·상품명 고칠 근거. 묶음 역할(MD·OPERATOR_ADMIN)과 서버 역할이 같다
      { to: '/search/zero-results', label: m.nav.zeroResults },
      // 검색 동의어(search 0.5.0 + approval SEARCH_SYNONYM, ADR-0073) — 요청 MD·OPERATOR_ADMIN, 승인 OPERATOR_ADMIN
      { to: '/search/synonyms', label: m.nav.synonyms },
    ],
  },
  {
    id: 'approval',
    label: m.nav.group.approval,
    // *_APPROVER(PRODUCT·DISPLAY·PRICE·SERVICEABILITY·CENTER_MASTER·INVENTORY) + OPERATOR_ADMIN
    visibleTo: (role) => role.endsWith('_APPROVER') || role === 'OPERATOR_ADMIN',
    items: [
      { to: '/approvals', label: m.nav.approvals },
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
      // 포장 인계 현황(bff 0.11.0) — 본사 셋, 센터 필수
      { to: '/packing-handover', label: m.nav.packing },
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
      // 고객(bff 0.22.0 BF-2, 2026-11-20) — 고객번호·전화·주문번호로 찾기(완전 일치) → 가린 상세 → 사유 적고 원문
      { to: '/customers', label: m.nav.customers },
      { to: '/inquiries', label: m.nav.inquiries },
      { to: '/cs-intakes/new', label: m.nav.csIntake }, // case 0.12.0 — 전화·채팅·메일로 받은 연락 기록
      // 문의 만족도(case 0.15.0) — 관리자만(상담원 평가에 쓰지 않음)
      { to: '/inquiry-satisfaction', label: m.nav.satisfaction, visibleTo: oneOf('OPERATOR_ADMIN') },
      { to: '/claims', label: m.nav.claims },
      // 반품 접수(claim 0.2.0 — 백엔드 요청 2026-11-17 request-return-recovery §2). 상담원·관리자
      { to: '/return-intake', label: m.nav.returnIntake },
      // 후속 처리(case 0.8.0 의무, owner=CS) — 상담원이 고객 연락 등의 결과를 남긴다
      { to: '/follow-ups/cs', label: m.nav.csFollowUps },
    ],
  },
  {
    id: 'support',
    label: m.nav.group.support,
    // 지원센터 = RIDER_OPS(사용자 2026-11-16). OPERATOR_ADMIN 모두, CS_AGENT 는 보기 + 오배송 열기만(서버 판정).
    visibleTo: oneOf('RIDER_OPS', 'OPERATOR_ADMIN', 'CS_AGENT'),
    items: [
      { to: '/cases', label: m.nav.cases },
      // 라이더 문의(case 0.13.0 — 백엔드 요청 2026-11-16 request-rider-inquiries). 지원센터·관리자만(상담원은 403)
      { to: '/rider-inquiries', label: m.nav.riderInquiries, visibleTo: oneOf('RIDER_OPS', 'OPERATOR_ADMIN') },
      { to: '/cases/new-misdelivery', label: m.nav.misdelivery },
      // 교대 인계(case 0.9.0 — 백엔드 PR #42). 쓰기·받기 모두 지원센터·관리자(case 0.13.1 — 상담원 403)
      { to: '/cases/handovers', label: m.nav.handovers, visibleTo: oneOf('RIDER_OPS', 'OPERATOR_ADMIN') },
    ],
  },
  {
    id: 'pending',
    label: m.nav.group.pending,
    // 본사 관리자(OPERATOR_ADMIN)만 — 모든 센터를 본다(사용자 2026-11-15). 센터 관리자는 MFC 백오피스.
    visibleTo: oneOf('OPERATOR_ADMIN'),
    // 접수 건 현황 건수(case 0.18.0) — 관리자만
    items: [
      { to: '/pending', label: m.nav.pendingWork },
      { to: '/case-metrics', label: m.nav.caseMetrics },
      // 처리 기한 지킴(bff 0.13.0 CASE_SLA) — 다른 지표는 501 이라 메뉴에 두지 않는다
      { to: '/case-sla', label: m.nav.caseSla },
    ],
  },
  {
    id: 'audit',
    label: m.nav.group.audit,
    // 개인정보 열람 기록 — OPERATOR_ADMIN 만(ADR-0062 결정 10, 백엔드 알림 2026-11-16-notice-pii-access-log-api). 본인 기록 보기·감사 역할 없음.
    visibleTo: oneOf('OPERATOR_ADMIN'),
    items: [{ to: '/pii-access-logs', label: m.nav.piiAccessLogs }],
  },
  {
    id: 'assistant',
    label: m.nav.group.assistant,
    visibleTo: 'ALL',
    items: [{ to: '/assistant', label: m.nav.assistant }],
  },
];

/** 이 역할들로 보이는 묶음(순서 유지). */
export function visibleGroups(roles: readonly string[], centers: readonly string[] = []): NavGroup[] {
  return navGroups
    .filter((g) => g.visibleTo === 'ALL' || roles.some(g.visibleTo))
    .map((g) => ({ ...g, items: g.items.filter((i) => (!i.visibleTo || roles.some(i.visibleTo)) && (!i.needsCenter || centers.length > 0)) }))
    .filter((g) => g.items.length > 0);
}

/** 메뉴 항목이 지금 경로의 화면인가(하위 경로 포함 — 상세 화면에서도 묶음을 펼쳐 둔다). */
/**
 * 옛 주소(also)로 켤 메뉴 — 가장 길게 맞는 also 하나만(/prices/import 는 /prices(상품)보다 /prices/import(일괄 등록)).
 * 메뉴 주소 자체와 똑같으면 NavLink 가 켜므로 여기서는 also 만 본다.
 */
export function aliasMenu(items: readonly NavItem[], pathname: string): string | null {
  let best: { to: string; len: number } | null = null;
  for (const i of items) for (const a of i.also ?? []) if ((pathname === a || pathname.startsWith(`${a}/`)) && (!best || a.length > best.len)) best = { to: i.to, len: a.length };
  if (items.some((i) => i.to === pathname)) return null;
  return best?.to ?? null;
}

export function covers(item: NavItem, pathname: string): boolean {
  const hit = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  return hit(item.to) || (item.also ?? []).some(hit);
}
