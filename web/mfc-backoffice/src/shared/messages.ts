// 화면 문구(1차 한국어). 컴포넌트에 문구를 흩어 쓰지 않는다. 공통 문구는 @pmart/web-ui.
import { employeeLoginMessages, uiMessages } from '@pmart/web-ui';

export const messages = {
  appTitle: 'PMart MFC',
  goHome: 'PMart MFC 백오피스 홈으로',
  mockBadge: '목 데이터',
  ...uiMessages,

  nav: {
    session: '내 세션',
    login: '로그인',
  },

  /** 메뉴 묶음·하위 메뉴(handoff 2026-11-15 §2 — 이름·순서는 클라이언트가 정해도 된다) */
  groups: {
    people: '인력',
    work: '작업',
    stock: '재고·품질',
    center: '센터',
  },
  menus: {
    workers: '작업자',
    assignments: '배정',
    tasks: '작업 현황',
    moves: '이동·보충',
    inbound: '입고',
    inventory: '재고',
    quality: '품질',
    locations: '위치(칸)',
    restrictions: '운영 제한',
  },

  center: {
    label: '센터',
    choose: '센터 고르기',
    /** 세션 centers 가 비었다 — 서버가 센터 API 를 모두 403 으로 막는다 */
    none: '맡은 센터가 없어요. 센터 관리자(MFC_SUPERVISOR) 권한을 센터와 함께 받아야 이 화면을 쓸 수 있어요.',
    /** 주소의 센터가 세션 centers 에 없다 */
    notMine: '이 센터 권한이 없습니다. 맡은 센터를 골라 주세요.',
    namesFailed: '센터 이름을 불러오지 못해 센터 코드로만 보여요.',
  },

  /** MFC_WORKER 만 있는 계정(현장은 PDA 앱) */
  workerOnly: '센터 관리자만 쓰는 화면입니다. 현장 작업은 PDA 앱(MFC 앱)에서 해 주세요.',
  /** MFC_SUPERVISOR 가 없는 그 밖 역할 — 막지 않고 안내만(판정은 서버, API 마다 403) */
  noSupervisor: '센터 관리자(MFC_SUPERVISOR) 권한이 없어요. 서버가 허락하지 않는 화면은 "이 센터 권한이 없습니다"로 보여요.',

  preparing: {
    title: '화면 준비 중',
    body: '이 메뉴의 화면은 아직 만들지 않았어요.',
    apiMissing: '서버 API 가 아직 없는 기능(백엔드가 만들면 알려 주기로 했어요)',
    apiReady: '서버 API 가 있는 기능(다음 차례에 화면을 만들어요)',
  },

  /** 위치(칸) — mfc-location-service 0.7.1 */
  locations: {
    intro: '센터 안 칸(선반·수령·포장·격리 등)을 등록하고 고쳐요. 닫은 칸에는 새 적치·이동이 들어가지 않아요.',
    register: '칸 등록',
    filter: '거르기',
    all: '전체',
    more: '더 보기',
    empty: '조건에 맞는 칸이 없어요.',
    back: '칸 목록',
    notFound: '칸을 찾지 못했어요.',
    fields: {
      code: '칸 코드',
      zone: '구역 종류',
      temperatureZone: '온도대',
      areaCode: '구역 코드',
      state: '상태',
      stateReason: '상태 사유',
      pickSequence: '피킹 순서',
      categoryId: '진열 카테고리 ID',
      highTurnover: '고회전 선반',
      widthMm: '폭(mm)',
      depthMm: '깊이(mm)',
      heightMm: '높이(mm)',
      slotCount: '슬롯 수',
      maxWeightG: '최대 무게(g)',
      positionX: '도면 x(m, 동쪽)',
      positionZ: '도면 z(m, 남쪽)',
      version: '버전',
      updatedAt: '바뀐 시각',
    },
    zone: {
      RECEIVING: '수령',
      STORAGE: '보관 선반',
      PICKING: '피킹 선반',
      PACKING: '포장',
      QUARANTINE: '격리',
      DISPATCH_STAGING: '출고 대기',
      RETURN: '회수',
      DISPOSAL: '폐기',
      CART: '이동 카트',
    } as Readonly<Record<string, string>>,
    temperature: { AMBIENT: '상온', CHILLED: '냉장', FROZEN: '냉동' } as Readonly<Record<string, string>>,
    state: { ACTIVE: '사용 중', CLOSED: '닫힘', COUNT_LOCKED: '실사 잠금', RETIRED: '폐지' } as Readonly<Record<string, string>>,
    yes: '예',
    no: '아니요',
    codeHint:
      '선반·피킹: 온도대-구역-랙-단-칸 (예 C-S1-03-2-04, 온도대 글자 A 상온·C 냉장·F 냉동). 그 밖: 접두-온도대-번호 (예 RCV-C-01 — RCV 수령·PAK 포장·QRT 격리·DSP 출고 대기·RTN 회수·DSL 폐기·CRT 이동 카트). 형식은 서버가 확인해요.',
    areaHint: '선반·피킹은 비우면 코드의 구역으로 채워요.',
    categoryHint: '상품 카테고리 ID(그 아래 카테고리 상품도 받아요). 비우면 기타 칸(아무 상품).',
    highTurnoverHint: '고회전 선반은 같은 상품이 여러 칸에 있어도 돼요(그 밖 선반은 한 상품 한 자리).',
    positionHint: '작업자가 서서 집는 지점. 둘 다 넣거나 둘 다 비워요. 비우면 지워져요.',
    positionPair: '도면 x 와 z 는 둘 다 넣거나 둘 다 비워 주세요.',
    attributes: '속성',
    edit: '속성 고치기',
    save: '저장',
    saved: '저장했어요.',
    created: '등록했어요.',
    codeFixed: '칸 코드는 등록 뒤 바꿀 수 없어요.',
    stateSection: '상태',
    reason: '사유',
    reasonRequired: '사유를 적어 주세요.',
    close: '닫기',
    open: '다시 열기',
    closed: '닫았어요.',
    opened: '다시 열었어요.',
    closeHint: '닫으면 새 적치·이동이 들어가지 않아요. 남은 재고는 그대로예요.',
    countLocked: '실사 중이라 잠겼어요. 실사가 끝나면 풀려요.',
    retire: '폐지',
    retireHint: '닫힌 칸 중 재고가 없을 때만 폐지돼요. 폐지는 되돌릴 수 없어요.',
    retireConfirm: '이 칸을 폐지합니다(되돌릴 수 없음)',
    retired: '폐지했어요.',
    retiredState: '폐지된 칸이라 바꿀 수 없어요.',
  },

  login: {
    title: 'MFC 백오피스 로그인',
    mockAccounts: '목 계정으로 로그인(목 모드에는 Keycloak 이 없어요)',
  },
  employeeLogin: employeeLoginMessages,

  session: {
    title: '내 세션',
    signOut: '로그아웃',
    current: '서버 세션',
    sessionId: '세션 ID',
    subject: '운영자 ID',
    roles: '역할',
    centers: '센터',
    ssoNote: '로그아웃하면 같은 브라우저의 다른 백오피스도 다음에 비밀번호를 다시 물어요(직원 계정 로그인을 함께 써요).',
  },

  /** Problem code → 문구. 분기는 code 로만 한다. 없는 code 는 일반 문구 + code 표시. */
  problem: {
    FORBIDDEN: '이 센터 권한이 없습니다.',
    VALIDATION_FAILED: '입력값을 확인해 주세요.',
    NOT_FOUND: '찾지 못했어요.',
    INVALID_STATE: '지금 상태에서는 할 수 없는 요청이에요. 새로 불러온 뒤 확인해 주세요.',
    VERSION_CONFLICT: '다른 사람이 먼저 바꿨어요. 새로 고침한 뒤 다시 해 주세요.',
    IDEMPOTENCY_CONFLICT: '같은 요청 번호로 다른 내용이 이미 처리됐어요. 새로 시작해 주세요.',
    RATE_LIMITED: '요청이 많아요. 잠시 후 다시 해 주세요.',
    INTERNAL_ERROR: '서버에서 처리하지 못했어요(서버 오류). 아래 문의 번호를 백엔드에 알려 주세요.',
    TOKEN_INVALID: '세션이 끝났어요. 다시 로그인해 주세요.',
    TOKEN_REUSED: '세션이 끝났어요. 다시 로그인해 주세요.',
    DEPENDENCY_UNAVAILABLE: '다른 서비스 응답을 받지 못해 처리하지 않았어요. 잠시 후 다시 해 주세요.',
    LOCATION_CODE_DUPLICATE: '이 센터에 같은 칸 코드가 이미 있어요.',
    LOCATION_CODE_INVALID: '칸 코드 형식이 맞지 않아요. 아래 형식을 확인해 주세요.',
  } as Readonly<Record<string, string>>,

  /** 검증 사유 code → 문구(없는 code 는 code 그대로) */
  reason: {
    REQUIRED: '필요한 값이 없어요',
    INVALID_FORMAT: '형식이 맞지 않아요',
    NOT_ALLOWED: '넣을 수 없는 값이에요',
  } as Readonly<Record<string, string>>,
} as const;
