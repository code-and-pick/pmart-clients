// 화면 문구(1차 한국어). 컴포넌트에 문구를 흩어 쓰지 않는다. 공통 문구는 @pmart/web-ui.
// DC 백오피스(2026-11-25 백엔드 요청 clients/all/2026-11-25-request-cdc-backoffice) — 겉모양은 MFC 백오피스와 같게(사용자 2026-11-25).
import { employeeLoginMessages, uiMessages } from '@pmart/web-ui';

export const messages = {
  appTitle: 'PMart DC',
  goHome: 'PMart DC 백오피스 홈으로',
  mockBadge: '목 데이터',
  theme: { toDark: '어두운 화면으로', toLight: '밝은 화면으로' },
  ...uiMessages,

  nav: {
    session: '내 정보',
    login: '로그인',
    me: '내 정보',
    menu: '메뉴',
    collapse: '메뉴 접기',
    expand: '메뉴 펴기',
  },
  /** 역할 이름 — 모르는 코드는 그대로 */
  roleName: {
    CDC_SUPERVISOR: 'DC 관리자',
    CDC_WORKER: 'DC 작업자',
    OPERATOR_ADMIN: '운영 관리자',
    MFC_SUPERVISOR: '센터 관리자',
    MFC_WORKER: '센터 작업자',
    RIDER_OPS: '라이더 운영',
    CS_AGENT: '상담원',
    HR_ADMIN: '인사팀',
  } as Readonly<Record<string, string>>,

  chrome: {
    offline: '인터넷 연결이 끊겼어요.',
    offlineHint: '끊기기 전 값이에요. 다시 이어지면 새로 읽어요.',
    onlineAgain: '다시 연결됐어요 — 화면을 새로 읽는 중이에요.',
  },
  shortcuts: {
    open: '단축키 보기',
    title: '단축키',
    close: '닫기',
    items: [
      { what: '이 화면의 검색 조건 첫 칸으로', keys: ['/'] },
      { what: '이 안내 열기·닫기', keys: ['?'] },
    ],
  },

  /** 메뉴 묶음(백엔드 계획 docs/cdc/cdc-backoffice-plan.md §2 — 설비·센서·자산은 빼기, 사용자 2026-11-25) */
  groups: {
    overview: '실시간 관제',
    outbound: '출고 운영',
    stock: '입고·재고',
    people: '인력·시스템',
  },
  menus: {
    dashboard: '대시보드·관제',
    trfWave: 'TRF·Wave',
    tasks: '통합 작업관리',
    picking: '피킹·분배',
    shipping: '출고관리',
    transport: '출하·운송',
    master: '기준정보',
    inbound: '입고관리',
    inventory: '재고관리',
    replenishment: '보충관리',
    returns: '반품·회수',
    workers: '작업자·인력',
    reports: '리포트·KPI',
    system: '시스템관리',
  },

  center: {
    label: 'DC',
    choose: 'DC 고르기',
    switchHint: (n: number) => `눌러서 다른 DC 로(맡은 DC ${n}곳)`,
    none: '맡은 DC 가 없어요.',
    notMine: '이 DC 권한이 없습니다. 맡은 DC 를 골라 주세요.',
    namesFailed: 'DC 이름을 불러오지 못해 DC 코드로만 보여요.',
  },
  /** CDC_WORKER 만 있는 계정(현장은 PDA) */
  workerOnly: '현장 작업은 PDA 에서 해 주세요.',
  /** CDC_SUPERVISOR·OPERATOR_ADMIN 이 아닌 역할 — 막지 않고 안내만(판정은 서버) */
  noSupervisor: 'DC 관리자 권한이 없어요.',

  preparing: {
    title: '화면 준비 중',
    body: '이 메뉴의 화면은 아직 만들지 않았어요.',
    apiMissing: '서버 API 가 아직 없는 기능',
    apiReady: '서버 API 가 있는 기능(다음 차례에 화면을 만들어요)',
  },

  login: {
    title: 'DC 백오피스 로그인',
    lead: '회사 직원 계정으로 로그인해 주세요',
    mockAccounts: '목 계정으로 로그인(목 모드에는 Keycloak 이 없어요)',
    brandLead: 'DC 의 TRF·Wave·작업·재고 운영을 한곳에서 처리해요',
    brandFoot: 'DC 관리자 전용 화면이에요',
  },
  employeeLogin: employeeLoginMessages,

  session: {
    ssoNote: '다른 백오피스도 함께 로그아웃돼요.',
  },

  /** Problem code → 문구. 분기는 code 로만 한다. 없는 code 는 일반 문구 + code 표시. */
  problem: {
    FORBIDDEN: '이 DC 권한이 없습니다.',
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
  } as Readonly<Record<string, string>>,

  /** 검증 사유 code → 문구(없는 code 는 code 그대로) */
  reason: {
    REQUIRED: '필요한 값이 없어요',
    INVALID_FORMAT: '형식이 맞지 않아요',
    NOT_ALLOWED: '넣을 수 없는 값이에요',
  } as Readonly<Record<string, string>>,
} as const;
