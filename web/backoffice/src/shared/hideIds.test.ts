import { describe, expect, it } from 'vitest';

import { hideIds, isSystemId } from './hideIds';

describe('hideIds — 문장 안의 시스템 ID 걷어내기(ADR-0070)', () => {
  it('접두 + 콜론 참조, 접두-UUID, UUID 를 걷어내고 빈 괄호·구분자를 정리', () => {
    expect(hideIds('상품 등록 1건: 사과 (productDraft:PD-b2c02864-8fb3-471c-8443-e614257b0dbc)')).toBe('상품 등록 1건: 사과');
    expect(hideIds('직원 권한 요청 OP-b54f42b4-e0a3-4043-855c-88fcd89e981a · 상품팀')).toBe('직원 권한 요청 · 상품팀');
    expect(hideIds('콘텐츠 일괄 contentImportBatch:cib-1')).toBe('콘텐츠 일괄');
    expect(hideIds('직원 권한 요청 관리자 본인 (hr-service GR-seed-2)')).toBe('직원 권한 요청 관리자 본인');
  });

  it('ID 가 없는 문장은 그대로 — 화면 번호(74939002·C-1119-0001)·금액·사번은 건드리지 않는다', () => {
    expect(hideIds('기본가 변경 1건')).toBe('기본가 변경 1건');
    expect(hideIds('주문 74939002 · C-1119-0001 · P2026-00014 · 3,900원')).toBe('주문 74939002 · C-1119-0001 · P2026-00014 · 3,900원');
  });

  it('ID 뿐이면 빈 문자열·isSystemId', () => {
    expect(hideIds('productDraft:PD-b2c02864-8fb3-471c-8443-e614257b0dbc')).toBe('');
    expect(isSystemId('PD-b2c02864-8fb3-471c-8443-e614257b0dbc')).toBe(true);
    expect(isSystemId('E-00000001')).toBe(false);
  });
});
