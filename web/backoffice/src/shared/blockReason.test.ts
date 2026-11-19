import { describe, expect, it } from 'vitest';

import { blockReasonLabel } from './blockReason';

describe('막힌 사유 이름표(백엔드 회신 2026-11-19 C2)', () => {
  it('문장 앞부분으로 이름표, 모르는 문장은 그대로', () => {
    expect(blockReasonLabel('예약 보류(격리·실사 손실 — 재확보 못 함): OL-1 2개')).toBe('재고 보류');
    expect(blockReasonLabel('결품 보고: OL-1 1개 DAMAGED')).toBe('결품');
    expect(blockReasonLabel('새 사유')).toBe('새 사유');
  });
});
