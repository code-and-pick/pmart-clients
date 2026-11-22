// 짧은 화면 번호(ADR-0085, 2026-11-22) — 라이더 R4785, 배송 D74939255·D74939255-2 찾기 글자.
import { describe, expect, it } from 'vitest';

import { parseDeliveryNumber, RIDER_NUMBER, riderNumberInput } from './displayNumbers';

describe('화면 번호 찾기 글자(ADR-0085)', () => {
  it('라이더 번호는 R 이 있어도 없어도, 4~5자리', () => {
    for (const ok of ['R4785', 'r4785', '4785', 'R48251']) expect(RIDER_NUMBER.test(ok)).toBe(true);
    for (const no of ['482913', 'R478', 'RD-7', 'D74939255']) expect(RIDER_NUMBER.test(no)).toBe(false);
  });

  it('입력 칸은 앞 R(대문자)과 숫자 5자리까지만 남긴다', () => {
    expect(riderNumberInput('r48-25x')).toBe('R4825');
    expect(riderNumberInput('4785')).toBe('4785');
    expect(riderNumberInput('R482519')).toBe('R48251');
  });

  it('배송 번호는 D 와 -순번을 떼어 주문번호 8자리·순번(없으면 1)으로', () => {
    expect(parseDeliveryNumber('D74939255')).toEqual({ orderNumber: '74939255', seq: 1 });
    expect(parseDeliveryNumber('d74939255-2')).toEqual({ orderNumber: '74939255', seq: 2 });
    expect(parseDeliveryNumber('74939255')).toEqual({ orderNumber: '74939255', seq: 1 });
    expect(parseDeliveryNumber('DLV-1')).toBeNull();
  });
});
