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

export const navGroups: readonly MenuGroup[] = [
  {
    key: 'control',
    items: [
      {
        key: 'riderMap',
        segment: 'control',
        ready: false,
        apiReady: ['진행 중 배송·배차·라이더·열린 사건(bff /views/live-delivery)', '배송 한 건 도착 예정(delivery-tracking /deliveries/{id}/eta·stream)'],
        apiMissing: ['직원용 라이더 위치 목록(delivery-tracking — 아직 없음)', '운행 중 라이더 목록(운행 상태·신규배차·제한 — rider-service, 아직 없음)'],
      },
    ],
  },
  {
    key: 'riders',
    items: [
      {
        key: 'riders',
        segment: 'riders',
        ready: false,
        apiReady: ['라이더 찾기(ID·전화 완전 일치)·상세(가림)·원문 열람(사유)', '계정 제한 걸기·이력, 제한 검토', '산정 불가 수행료 조정', '라이더 컴플레인'],
        apiMissing: ['이름·상태로 찾기, 라이더 목록 넘기기'],
      },
    ],
  },
  {
    key: 'deliveries',
    items: [{ key: 'deliveries', segment: 'deliveries', ready: true, apiReady: [], apiMissing: [] }],
  },
  {
    key: 'support',
    items: [{ key: 'cases', segment: 'cases', ready: true, apiReady: [], apiMissing: [] }],
  },
];
export const allMenus: readonly MenuItem[] = navGroups.flatMap((g) => g.items);

export const menuPath = (segment = allMenus[0]!.segment) => `/${segment}`;

/** 이 앱의 주 역할. 없으면 막지 않고 안내만(판정은 서버, API 마다 403) */
export const RIDER_APP_ROLES: readonly string[] = ['RIDER_OPS', 'OPERATOR_ADMIN'];
export const hasRiderAppRole = (roles: readonly string[]) => roles.some((r) => RIDER_APP_ROLES.includes(r));
