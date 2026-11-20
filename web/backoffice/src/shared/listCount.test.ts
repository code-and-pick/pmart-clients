// 목록 제목줄 개수(2026-11-20 제목줄 통일) — 서버가 준 줄만, 다음 쪽이 있으면 "+", 못 읽었으면 없음(0 아님)
import { describe, expect, it } from 'vitest';

import { listCount } from './admin';

describe('listCount', () => {
  it('한 쪽: 줄 수, 다음 쪽(hasNext·nextCursor)이 있으면 +', () => {
    expect(listCount({ data: { items: [1, 2], page: { hasNext: false } } })).toBe('2');
    expect(listCount({ data: { items: [1, 2], page: { hasNext: true } } })).toBe('2+');
    expect(listCount({ data: { items: [1], page: { nextCursor: 'C2' } } })).toBe('1+');
  });
  it('이어 붙이는 쪽: 받은 쪽들의 합, 더 있으면 +', () => {
    expect(listCount({ data: { pages: [{ items: [1, 2] }, { items: [3] }] }, hasNextPage: true })).toBe('3+');
  });
  it('못 읽었거나 읽는 중이면 개수 없음 — 0 으로 보이지 않는다', () => {
    expect(listCount({ data: undefined })).toBeUndefined();
    expect(listCount({ data: { unexpected: true } })).toBeUndefined();
  });
});
