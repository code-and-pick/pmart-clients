// 라이더 화면에서 새로 쓰는 문구(2026-11-18, PC 5 — 배민 관리자 꾸밈 + 백엔드 회신 rider 0.10.0·dispatch 0.8.0).
// 공통 문구(opsMessages·messages)는 다른 화면과 함께 쓰므로 여기에는 이 화면만의 말만 둔다.
export const riderMessages = {
  findByNumber: '번호로 찾기',
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
    col: { type: '항목', version: '버전', agreedAt: '동의한 때' },
  },
  assignments: {
    title: '배정 이력',
    intro: '이 라이더에게 배정된 배송이에요(배정 최신순, delivery-dispatch).',
    empty: '배정 이력이 없어요.',
    col: { assignedAt: '배정', delivery: '배송', order: '주문', kind: '종류·목적', source: '배정 경로', fee: '수행료(수락 당시)', deliveryState: '배차 상태', outcome: '결과', cancellation: '배차 취소' },
    outcome: { CURRENT: '진행 중', DONE: '이 라이더로 끝남', RELEASED: '배정 풀림', CANCELLED: '픽업 전 취소' } as Readonly<Record<string, string>>,
    source: { AI_RECOMMENDED: '제안 수락', DELIVERY_LIST: '목록에서 수락', FAILED_RETURN: '전달 실패 반납 배정' } as Readonly<Record<string, string>>,
    requestedBy: { RIDER: '라이더', STORE_STAFF: '매장', OPERATOR: '운영자', ORCHESTRATION: '주문 처리' } as Readonly<Record<string, string>>,
    cancelReason: { RIDER_UNABLE: '라이더 사정', STORE_REQUEST: '매장 요청', ORDER_CANCELLED: '주문 취소', NO_SHOW: '라이더 미도착', OPERATOR: '운영 판단' } as Readonly<Record<string, string>>,
  },
  tabs: { info: '기본 정보', account: '정산계좌·동의', time: '운행시간', earnings: '수행료', assignments: '배정 이력', restriction: '계정 제한' },
  restrictionAside: '바꾸면 이력이 남아요',
  reviewsCount: (n: number) => `${n}건`,
} as const;
