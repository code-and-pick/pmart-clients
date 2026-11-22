// 라이더 화면에서 새로 쓰는 문구(2026-11-18, PC 5 — 배민 관리자 꾸밈 + 백엔드 회신 rider 0.10.0·dispatch 0.8.0).
// 공통 문구(opsMessages·messages)는 다른 화면과 함께 쓰므로 여기에는 이 화면만의 말만 둔다.
export const riderMessages = {
  findByNumber: '번호로 찾기',
  riderNumber: '라이더 번호',
  noNumber: '번호 없음',
  systemRiderId: '라이더 시스템 ID',
  bank: {
    title: '정산계좌·동의',
    registered: '정산계좌',
    yes: '등록',
    no: '미등록',
    bankName: '은행',
    numberNote: '계좌번호·예금주는 이 화면에 오지 않아요(등록 여부와 은행 이름만).',
  },
  consents: {
    title: '지금 동의한 버전',
    note: '항목마다 마지막 동의만 남아요 — 과거 동의 이력은 서버가 저장하지 않아요.',
    empty: '동의한 항목이 없어요.',
    col: { type: '항목', version: '버전', agreedAt: '동의시점' },
  },
  assignments: {
    title: '배정 이력',
    intro: '이 라이더에게 배정된 배송이에요(배정 최신순, delivery-dispatch).',
    empty: '배정 이력이 없어요.',
    col: { assignedAt: '배정', delivery: '배송', order: '주문', kind: '종류·목적', source: '배정 경로', fee: '수행료(수락 당시)', deliveryState: '배차 상태', outcome: '결과', cancellation: '배차 취소' },
    outcome: { CURRENT: '진행 중', DONE: '이 라이더가 완료', RELEASED: '배정 풀림', CANCELLED: '픽업 전 취소' } as Readonly<Record<string, string>>,
    source: { AI_RECOMMENDED: '제안 수락', DELIVERY_LIST: '목록에서 수락', FAILED_RETURN: '전달 실패 반납 배정' } as Readonly<Record<string, string>>,
    requestedBy: { RIDER: '라이더', STORE_STAFF: '매장', OPERATOR: '운영자', ORCHESTRATION: '주문 처리' } as Readonly<Record<string, string>>,
    cancelReason: { RIDER_UNABLE: '라이더 사정', STORE_REQUEST: '매장 요청', ORDER_CANCELLED: '주문 취소', NO_SHOW: '라이더 미도착', OPERATOR: '운영 판단' } as Readonly<Record<string, string>>,
  },
  tabs: { info: '기본 정보', account: '정산계좌·동의', time: '운행시간', earnings: '수행료', assignments: '배정 이력', restriction: '계정 제한', reviews: '제한 검토', complaints: '컴플레인', helps: '도움요청', inquiries: '문의', performance: '성과' },
  restrictionAside: '바꾸면 이력이 남아요',
  reviewsCount: (n: number) => `${n}건`,
  // 기본 백오피스에서 옮겨 온 것(2026-11-18, ADR-0068 — PC 2 요청): 수단 거르기·정렬, 제한 검토 상태 탭, 상세의 열린 검토·컴플레인
  search: {
    vehicle: '수단',
    allVehicles: '모두',
    sort: '정렬',
    sortName: { JOINED_DESC: '가입 최근 순', STATE_CHANGED_DESC: '상태 바뀐 최근 순' } as const,
  },
  reviews: {
    state: { OPEN: '검토 중', RESTRICTED: '제한함', DISMISSED: '제한 안 함' } as const,
    closedCol: '처리',
    closed: (at: string, by: string, note?: string) => [at, by, note].filter(Boolean).join(' · '),
    resultNow: (state: string) => `닫았어요 — ${state}`,
    goRestrict: '계정 제한 걸러 가기',
    complaints: '쌓인 컴플레인',
  },
  detailReviews: {
    intro: '이 라이더의 열린 검토예요. 제한하려면 아래 "계정 제한"에서 먼저 건 뒤 "제한함"으로 닫아요.',
    empty: '열린 검토가 없어요.',
  },
  complaints: {
    intro: '상담원이 기록한 이 라이더 컴플레인이에요(최근 기록 순, case-service).',
    empty: '컴플레인 기록이 없어요.',
    col: { id: '컴플레인', type: '종류', delivery: '배송', order: '주문', recordedAt: '기록시점', recordedBy: '기록한 직원' },
    more: '더 보기',
    moreFailed: '다음 기록을 불러오지 못했어요 — 더 보기를 다시 눌러 주세요.',
  },
  // 2026-11-21 사용자 "응" — 이 라이더가 배송 중에 낸 도움요청(execution 0.35.0 state=ALL·sort=NEWEST). 문의는 case R-11 뒤에
  helps: {
    intro: '이 라이더가 배송 중에 보낸 도움요청이에요(최근 접수 순, 모든 상태). 줄을 누르면 지원센터 대화로 가요.',
    empty: '도움요청 기록이 없어요.',
    col: { category: '종류', delivery: '배송', stage: '보낸 단계', state: '상태', createdAt: '접수시점', resolvedAt: '완료시점' },
    open: (n: number) => `열림 ${n}`,
  },
  // 성과(2026-11-23 — execution 0.38.0 GET /delivery-metrics?riderId=, 최근 30일)
  performance: {
    intro: '최근 30일 이 라이더가 배정받은 고객 배송 기준이에요. 지연은 약속 시각 뒤 전달(고객 수령 확인·자동 완료는 빼요).',
    empty: '최근 30일 배정된 배송이 없어요.',
    deliveries: '배송',
    completion: '완료율',
    late: '지연율',
    failed: '실패',
    delivery: '평균 배송 소요',
    pickupWait: '평균 픽업 대기',
    summary: (n: number, c: string) => `${n}건 · 완료율 ${c}`,
    all: '운영 통계에서 비교',
  },
  // 라이더 문의(case 0.32.0 R-11 — 2026-11-21 사용자 "응", 2026-11-23 배포)
  inquiries: {
    intro: '이 라이더가 앱에서 남긴 문의예요(최근 접수 순, 모든 상태). 제목을 누르면 문의 대화로 가요.',
    empty: '문의 기록이 없어요.',
    col: { title: '제목', category: '종류', status: '상태', createdAt: '접수시점', answeredAt: '답변시점' },
    waiting: (n: number) => `답 기다림 ${n}`,
  },
} as const;
