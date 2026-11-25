// 메뉴 묶음(백엔드 계획 docs/cdc/cdc-backoffice-plan.md §2 — 2026-11-25). 모든 메뉴가 DC 하나(`/c/:cdcId/…`) 아래에 있다.
// 빼는 것(사용자 2026-11-25 "설비센서자산 같은 건 제외"): 시설·설비, 환경·품질(온도·HACCP), 물류 자산 — 자리도 두지 않는다.
// 화면을 만들면 그 메뉴의 `ready` 를 true 로 바꾼다. 그 전에는 "준비 중"(지어낸 숫자를 보이지 않는다).
import { messages as m } from '../shared/messages';

export type MenuKey = keyof typeof m.menus;
export type GroupKey = keyof typeof m.groups;

export interface MenuItem {
  readonly key: MenuKey;
  /** DC 아래 경로(`/c/:cdcId/<segment>`) */
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
    key: 'overview',
    items: [
      {
        key: 'dashboard',
        segment: 'dashboard',
        ready: true,
        apiReady: ['그날 TRF 상태별 수·수량 합·진행률, Wave·작업 상태별(cdc-outbound 0.11.0 outbound-summary)'],
        apiMissing: ['입고 진행(입고 서비스 없음)', '층·구역 현황·병목·KPI 집계'],
      },
    ],
  },
  {
    key: 'outbound',
    items: [
      {
        key: 'trfWave',
        segment: 'trf-wave',
        ready: true,
        apiReady: ['TRF 목록·상세(줄별 승인·할당·피킹·부족)', 'Wave 목록·상세·만들기·내리기(release)', '미출발 취소'],
        apiMissing: [],
      },
      {
        key: 'tasks',
        segment: 'tasks',
        ready: true,
        apiReady: ['작업 목록·상세', '구역(regions)'],
        apiMissing: ['재배정·보류·우선순위 변경'],
      },
      {
        key: 'picking',
        segment: 'picking',
        ready: false,
        apiReady: ['FC 피킹 작업(묶음 피킹 지역)'],
        apiMissing: ['DPS·AutoStore·분배·DAS·Wheel Sorter·자키 작업(작업 화면만 — 설비 상태는 두지 않음)'],
      },
      {
        key: 'shipping',
        segment: 'shipping',
        ready: true,
        apiReady: ['출발 검증 결과(0.16.0)', 'TRF 출발 준비(TRF 상세)'],
        apiMissing: ['LPN·출고 대기 목록'],
      },
      {
        key: 'transport',
        segment: 'transport',
        ready: false,
        apiReady: [],
        apiMissing: ['배차·운송(transport-*·fleet 계약만, 서비스 없음)'],
      },
    ],
  },
  {
    key: 'stock',
    items: [
      {
        key: 'master',
        segment: 'master',
        ready: true,
        apiReady: ['상품 취급·온도대(sku-handlings)', '로케이션 목록·상세·상태 변경', '통로별 피킹 방식(aisle-pick-methods)'],
        apiMissing: ['거래처·차량·기사·노선'],
      },
      {
        key: 'inbound',
        segment: 'inbound',
        ready: false,
        apiReady: [],
        apiMissing: ['ASN·검수·적치(cdc-inbound 계약만, 서비스 없음)'],
      },
      {
        key: 'inventory',
        segment: 'inventory',
        ready: true,
        apiReady: ['SKU별 현물·가용·예약, LOT·위치별(cdc-inventory stock-snapshot)'],
        apiMissing: ['재고 원장·이동·실사', '격리·리콜·폐기(cdc-quality 계약만)'],
      },
      {
        key: 'replenishment',
        segment: 'replenishment',
        ready: false,
        apiReady: [],
        apiMissing: ['보충 이동(cdc-inbound replenishment-moves 계약만)'],
      },
      {
        key: 'returns',
        segment: 'returns',
        ready: false,
        apiReady: [],
        apiMissing: ['반품·회수(계약 없음)'],
      },
    ],
  },
  {
    key: 'people',
    items: [
      {
        key: 'workers',
        segment: 'workers',
        ready: false,
        apiReady: [],
        apiMissing: ['근무조·배치·생산성(계정은 인사팀 백오피스)'],
      },
      {
        key: 'reports',
        segment: 'reports',
        ready: false,
        apiReady: [],
        apiMissing: ['리포트·KPI 집계'],
      },
      {
        key: 'system',
        segment: 'system',
        ready: false,
        apiReady: [],
        apiMissing: ['바코드·PDA·연동 상태(권한은 통합 백오피스, 감사 기록은 audit)'],
      },
    ],
  },
];

export const allMenus: readonly MenuItem[] = navGroups.flatMap((g) => g.items);

export const centerPath = (cdcId: string, segment = allMenus[0]!.segment) => `/c/${encodeURIComponent(cdcId)}/${segment}`;

/** 백오피스를 쓰지 않는 계정: CDC_WORKER 만 있다(현장은 PDA) */
export const isWorkerOnly = (roles: readonly string[]) => roles.length > 0 && roles.every((r) => r === 'CDC_WORKER');

/** DC 화면을 쓰는 역할(백엔드 요청 §1) — 판정은 서버, 화면은 안내만 */
export const isDcManager = (roles: readonly string[]) => roles.includes('CDC_SUPERVISOR') || roles.includes('OPERATOR_ADMIN');
