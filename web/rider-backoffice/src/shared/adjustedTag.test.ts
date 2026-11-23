// 조정한 수행료 알아보기(2026-11-24) — adjustmentRef·ADJUSTED·서버 조정 메모 머리.
import { describe, expect, it } from 'vitest';

import { isAdjustedEarning } from './adjustedTag';

describe('isAdjustedEarning', () => {
  it('서버가 adjustmentRef 를 아직 안 채워도 조정 메모 머리로 알아본다', () => {
    expect(isAdjustedEarning({ settlementState: 'CONFIRMED', note: '지원센터 조정 — 지급(매장 귀책)' })).toBe(true);
    expect(isAdjustedEarning({ settlementState: 'ADJUSTED', note: '지원센터 조정 — 미지급(라이더 귀책)' })).toBe(true);
    expect(isAdjustedEarning({ settlementState: 'CONFIRMED', adjustmentRef: 'ADJ-1' })).toBe(true);
  });
  it('보통 수행료는 조정이 아니다', () => {
    expect(isAdjustedEarning({ settlementState: 'CONFIRMED' })).toBe(false);
    expect(isAdjustedEarning({ settlementState: 'CONFIRMED', note: '추가 배달료 승인' })).toBe(false);
  });
});
