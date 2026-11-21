import { describe, expect, it } from 'vitest';

import { blockReasonLabel, caseSummaryText, stopErrorName, stopErrorText } from './blockReason';

describe('막힌 사유 이름표(백엔드 회신 2026-11-19 C2)', () => {
  it('문장 앞부분으로 이름표, 모르는 문장은 그대로', () => {
    expect(blockReasonLabel('예약 보류(격리·실사 손실 — 재확보 못 함): OL-1 2개')).toBe('재고 보류');
    expect(blockReasonLabel('결품 보고: OL-1 1개 DAMAGED')).toBe('결품');
    expect(blockReasonLabel('새 사유')).toBe('새 사유');
  });
});

// 2026-11-21 화면 점검 — 작업 중지 실패 lastError(C1 "코드: 상세")·접수 건 요약 끝 코드
describe('작업 중지 실패 사유', () => {
  it('계약 코드는 이름표로, …_NOT_FOUND 는 NOT_FOUND 로, 모르는 코드는 그대로', () => {
    expect(stopErrorName('RECORD_MISMATCH')).toBe('집품·포장 기록 안 맞음');
    expect(stopErrorName('VALIDATION_FAILED')).toBe('요청 값 오류');
    expect(stopErrorName('RESERVATION_NOT_FOUND')).toBe('예약·위치 없음');
    expect(stopErrorName('NEW_REJECT_CODE')).toBe('NEW_REJECT_CODE');
  });

  it('"코드: 상세" 는 "이름 — 상세", 코드 꼴이 아니면 문장 그대로', () => {
    expect(stopErrorText('INVALID_STATE: 이미 인계됨')).toBe('지금 상태로는 안 됨 — 이미 인계됨');
    expect(stopErrorText('VERSION_CONFLICT')).toBe('그사이 바뀜');
    expect(stopErrorText('재고 서비스 응답: 알 수 없음')).toBe('재고 서비스 응답: 알 수 없음');
  });
});

describe('접수 건 요약 끝 코드', () => {
  it('아는 앞말 + 아는 코드만 한국어로, 나머지는 그대로', () => {
    expect(caseSummaryText('보상 해제 실패 — INVENTORY_RESERVATION')).toBe('보상 해제 실패 — 재고 예약');
    expect(caseSummaryText('보상 해제 결과 불명 — SLOT_HOLD')).toBe('보상 해제 결과 불명 — 도착 시간대 확보');
    expect(caseSummaryText('대사 필요 — AMOUNT')).toBe('대사 필요 — 금액');
    expect(caseSummaryText('결제 승인 불일치 — ORDER_REF')).toBe('결제 승인 불일치 — 주문 번호');
    expect(caseSummaryText('보상 해제 실패 — NEW_RESOURCE')).toBe('보상 해제 실패 — NEW_RESOURCE');
    expect(caseSummaryText('라이더 도움요청 — 건물 출입 불가')).toBe('라이더 도움요청 — 건물 출입 불가');
  });
});
