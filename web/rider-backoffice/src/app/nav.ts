// 메뉴 묶음 — 뼈대(2026-11-17, PC 1)는 자리만 둔다. 이름·순서·기능 목록과 화면은 delivery 영역(PC 5)이 정하고 채운다.
// 라이더 운영(RIDER_OPS)은 모든 센터를 보는 역할이라 센터 고르기가 없다(MFC 백오피스와 다르다). 화면을 만들면 그 메뉴의 `ready` 를 true 로.
import { messages as m } from '../shared/messages';

export type MenuKey = keyof typeof m.menus;
export type GroupKey = keyof typeof m.groups;

export interface MenuItem {
  readonly key: MenuKey;
  /** 경로(`/<segment>`) */
  readonly segment: string;
  /** 화면을 만들었다(false 면 "준비 중") */
  readonly ready: boolean;
  /** 서버 API 가 있는 기능 */
  readonly apiReady: readonly string[];
  /** 서버 API 가 아직 없거나 계약만 있는 기능 */
  readonly apiMissing: readonly string[];
}

export interface MenuGroup {
  readonly key: GroupKey;
  readonly items: readonly MenuItem[];
}

const done = (key: MenuKey, segment: string): MenuItem => ({ key, segment, ready: true, apiReady: [], apiMissing: [] });

// 2026-11-17(PC 5): 사용자 "추천대로 1~6번" — 대시보드·관제·라이더(찾기·가입 승인·제한 검토)·배송·지원센터(접수 건·도움요청·라이더 문의)·수행료(조정·추가 배달료).
export const navGroups: readonly MenuGroup[] = [
  { key: 'overview', items: [done('dashboard', 'dashboard')] },
  { key: 'control', items: [done('riderMap', 'control')] },
  { key: 'riders', items: [done('riders', 'riders'), done('signups', 'signups'), done('restrictionReviews', 'restriction-reviews')] },
  { key: 'deliveries', items: [done('deliveries', 'deliveries')] },
  { key: 'support', items: [done('cases', 'cases'), done('helpRequests', 'help-requests'), done('inquiries', 'inquiries')] },
  { key: 'earnings', items: [done('adjustments', 'adjustments'), done('surcharges', 'surcharges')] },
];
export const allMenus: readonly MenuItem[] = navGroups.flatMap((g) => g.items);

export const menuPath = (segment = allMenus[0]!.segment) => `/${segment}`;

/** 이 앱의 주 역할. 없으면 막지 않고 안내만(판정은 서버, API 마다 403) */
export const RIDER_APP_ROLES: readonly string[] = ['RIDER_OPS', 'OPERATOR_ADMIN'];
export const hasRiderAppRole = (roles: readonly string[]) => roles.some((r) => RIDER_APP_ROLES.includes(r));
