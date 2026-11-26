// 메뉴 묶음(백엔드 계획 docs/cdc/cdc-backoffice-plan.md §2 — 2026-11-25). 모든 메뉴가 DC 하나(`/c/:cdcId/…`) 아래에 있다.
// 빼는 것(사용자 2026-11-25 "설비센서자산 같은 건 제외"): 시설·설비, 환경·품질(온도·HACCP), 물류 자산 — 자리도 두지 않는다.
// 상품 발주(사용자 2026-11-26 "상품 발주 목록 없애" — 서버 계약 없이 목 전용이던 메뉴), 반품·회수(사용자 2026-11-25 "회수는 빼" — TMS D-11)와 시스템관리도 뺐다(사용자 2026-11-26 빈 메뉴 정리 — 권한은 통합 백오피스 HR·권한 승인, 감사 기록은 audit).
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
      {
        // 2D 평면도(사용자 2026-11-26 "MFC 백오피스처럼") — 배치는 시뮬레이터, 칸 재고는 서버
        // MFC 재고 이동(사용자 2026-11-26 "mfc로의 실시간 재고이동을 바로 볼 수 있는 거") — transfers·departures·outbound-summary·stock-snapshot
        key: 'mfcFlow',
        segment: 'mfc-flow',
        ready: true,
        apiReady: ['TRF 단계·MFC(transfers)', '출발 검증(departures)', '오늘 MFC 별(outbound-summary byMfc)', '운송 중(stock-snapshot transit)'],
        apiMissing: ['MFC 수령 확인 목록(운송 중 대사 — 내부 경로만)'],
      },
      {
        key: 'floor',
        segment: 'floor',
        ready: true,
        apiReady: ['통로 칸 재고(location-stocks)', '작업자 위치(workers — PDA 스캔)'],
        apiMissing: ['칸 좌표 서버 API(시뮬레이터 배치를 씀)'],
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
        apiReady: ['TRF 목록·상세(줄별 승인·할당·피킹·부족)', 'Wave 목록·상세·만들기·내리기(release)', 'Wave 보류·취소·합치기·나누기', '미출발 취소'],
        apiMissing: [],
      },
      {
        key: 'tasks',
        segment: 'tasks',
        ready: true,
        apiReady: ['작업 목록·상세', '구역(regions)', '담당 바꾸기·보류·우선순위'],
        apiMissing: [],
      },
      {
        key: 'picking',
        segment: 'picking',
        ready: true,
        apiReady: ['FC 피킹 작업(묶음 피킹 지역)', '피킹 부족 재할당(shortages)'],
        apiMissing: ['DPS·AutoStore·분배·DAS·Wheel Sorter·자키 작업(작업 화면만 — 설비 상태는 두지 않음)'],
      },
      {
        key: 'shipping',
        segment: 'shipping',
        ready: true,
        apiReady: ['출발 검증 결과(0.16.0)', 'TRF 출발 준비(TRF 상세)', 'LPN 목록(lpns)'],
        apiMissing: [],
      },
      {
        key: 'transport',
        segment: 'transport',
        ready: true,
        apiReady: ['운행·정차·예상 도착·인계 대조·예외(transport-execution 0.2.0)', '배차 생성·계획완료·결행·취소·요청서 옮기기, 잔여 물량, 노선(transport-planning 0.2.0)'],
        apiMissing: ['도크 배정(층 도크 확정 뒤)', '노선 등록·정규차 지정 화면(다음 단계)', '실시간 위치(GPS 없음)'],
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
        apiMissing: ['거래처·차량·기사(fleet — 화면 다음 단계)'],
      },
      {
        key: 'inbound',
        segment: 'inbound',
        ready: true,
        apiReady: ['적치 지시·목록·취소(cdc-inbound 0.2.0)'],
        apiMissing: ['입고 예정(ASN)·실수령·검수(3단계)'],
      },
      {
        key: 'inventory',
        segment: 'inventory',
        ready: true,
        apiReady: ['SKU별 현물·가용·예약, LOT·위치별(cdc-inventory stock-snapshot)', '품질 보류·해제·폐기·리콜(cdc-quality)', '재고 이동 이력(stock-movements 0.20.0)'],
        apiMissing: [],
      },
      {
        key: 'replenishment',
        segment: 'replenishment',
        ready: true,
        apiReady: ['자동 보충 작업(putaway-tasks kind=REPLENISHMENT)', '피킹 선반별 보충 판단(replenishment-checks)'],
        apiMissing: ['수동 보충 지시(서버에 없음 — 적치 지시로)'],
      },
    ],
  },
  {
    key: 'people',
    items: [
      {
        key: 'workers',
        segment: 'workers',
        ready: true,
        apiReady: ['근무조·계획 인원(시뮬레이터 값)·배치·출근·현황(cdc-outbound 0.29.0)', '작업자 실적(worker-throughput 0.27.0 — 리포트)'],
        apiMissing: ['작업 받기의 근무·자격 검사(서버에 아직 없음)'],
      },
      {
        key: 'reports',
        segment: 'reports',
        ready: true,
        apiReady: ['운영 확인 기준(operating-metrics 0.28.0 — 있는 자료만, 나머지 N/A)', '일별 출고(outbound-summary/daily 0.27.0)', '작업자 실적(worker-throughput 0.27.0)'],
        apiMissing: ['원수요 충족률·사용 준비 시간·약속 준수(원천 없음 — N/A)'],
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
