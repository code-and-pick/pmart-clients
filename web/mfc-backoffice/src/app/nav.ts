// 메뉴 묶음(handoff mfc-backoffice/2026-11-15-request-mfc-backoffice §2) — 모든 메뉴가 센터 하나(`/c/:mfcId/…`) 아래에 있다.
// 기능 목록은 §2-1(2026-11-15 백엔드 점검)을 옮겼다. 화면을 만들면 그 메뉴의 `ready` 를 true 로 바꾼다.
import { messages as m } from '../shared/messages';

export type MenuKey = keyof typeof m.menus;
export type GroupKey = keyof typeof m.groups;

export interface MenuItem {
  readonly key: MenuKey;
  /** 센터 아래 경로(`/c/:mfcId/<segment>`) */
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
    key: 'people',
    items: [
      {
        key: 'workers',
        segment: 'workers',
        ready: true,
        apiReady: ['작업자 목록·상세', '등록·업무·자격·상태·속도 변경', '근무 목록·등록·취소', '휴게·일일크루 등록'],
        apiMissing: [],
      },
      {
        key: 'assignments',
        segment: 'assignments',
        ready: true,
        apiReady: ['배정 목록', '배정·재배정', '배정 추천 계산·확정·조회'],
        apiMissing: ['배정 추천 계획 목록'],
      },
    ],
  },
  {
    key: 'work',
    items: [
      {
        key: 'tasks',
        segment: 'tasks',
        ready: true,
        apiReady: ['작업 목록·상세', '작업 풀기', '포장 상세·인계 상태'],
        apiMissing: ['확인 필요 포장 목록·확인(지금은 현장 작업자만 — 백엔드 결정 대기)'],
      },
      {
        key: 'moves',
        segment: 'moves',
        ready: true,
        apiReady: ['이동 지시 목록·상세', '이동 지시 만들기·취소'],
        apiMissing: [],
      },
      {
        key: 'inbound',
        segment: 'inbound',
        ready: true,
        apiReady: ['입고 작업 목록·상세', '품질검사·적치', '회수품 반입·조회', '초기 보유 수령', '공급 요청 만들기·수정·철회·조회'],
        apiMissing: ['입고 예정(TRF) — 계약만', '초기 보유 센터별 수령 대기 목록', '회수품 목록', '공급 요청 목록'],
      },
    ],
  },
  {
    // 우리 센터 배송(2026-11-16 백엔드 요청 request-center-deliveries-and-dispatch-failures — bff 0.3.1·case 0.5.2, 보기만)
    key: 'delivery',
    items: [
      {
        key: 'deliveries',
        segment: 'deliveries',
        ready: true,
        apiReady: ['진행 중 배송(수행·배차·열린 사건)'],
        apiMissing: [],
      },
      {
        key: 'dispatchFailures',
        segment: 'dispatch-failures',
        ready: true,
        apiReady: ['배차 실패 사건 목록·상세(보기만)'],
        apiMissing: [],
      },
    ],
  },
  {
    key: 'stock',
    items: [
      {
        key: 'inventory',
        segment: 'inventory',
        ready: true,
        apiReady: ['상품별 재고(상품 코드 필수)', '위치·LOT 정정', '순환 실사 만들기·입력·승인', '보충 기준', '출하 부적격 LOT', '상품 취급'],
        apiMissing: ['센터 전체 재고 목록(상품 코드 없이)', '실사 세션 목록'],
      },
      {
        key: 'quality',
        segment: 'quality',
        ready: true,
        apiReady: ['격리·해제 요청', '해제 승인(다른 관리자)', '폐기 요청·결정·실행', '회수품 검수', '단건 조회'],
        apiMissing: ['해제 승인 대기·폐기·검수 목록', '품질 사고 — 계약만'],
      },
    ],
  },
  {
    key: 'center',
    items: [
      {
        key: 'locations',
        segment: 'locations',
        ready: true,
        apiReady: ['칸 목록·상세·등록·수정', '닫기·열기·폐지', '적치 후보'],
        apiMissing: [],
      },
      {
        key: 'restrictions',
        segment: 'restrictions',
        ready: false,
        apiReady: ['운영 제한 목록·상세', '등록(승인 근거 필수)·해제'],
        apiMissing: [],
      },
    ],
  },
];

export const allMenus: readonly MenuItem[] = navGroups.flatMap((g) => g.items);

export const centerPath = (mfcId: string, segment = allMenus[0]!.segment) => `/c/${encodeURIComponent(mfcId)}/${segment}`;

/** 센터 관리자 앱을 쓰지 않는 계정: MFC_WORKER 만 있다(현장은 PDA 앱) */
export const isWorkerOnly = (roles: readonly string[]) => roles.length > 0 && roles.every((r) => r === 'MFC_WORKER');
