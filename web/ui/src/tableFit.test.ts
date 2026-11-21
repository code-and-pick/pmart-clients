// 넓은 표 표시 — 칸보다 넓은 표의 감싸개에만 data-table-wide(그 표는 가로 스크롤 그대로, 들어맞는 표만 머리 고정)
import { describe, expect, it } from 'vitest';

import { markTableFit, TABLE_WIDE_ATTR } from './tableFit';

function wrapWith(tableWidth: number, wrapWidth: number) {
  const wrap = document.createElement('div');
  wrap.className = 'overflow-x-auto';
  const table = document.createElement('table');
  wrap.appendChild(table);
  Object.defineProperty(table, 'offsetWidth', { configurable: true, value: tableWidth });
  Object.defineProperty(wrap, 'clientWidth', { configurable: true, value: wrapWidth });
  return { wrap, table };
}

describe('markTableFit', () => {
  it('표가 감싸개보다 넓으면 표시를 달고, 들어맞게 되면 뗀다', () => {
    const { wrap, table } = wrapWith(954, 705);
    markTableFit(wrap);
    expect(wrap.hasAttribute(TABLE_WIDE_ATTR)).toBe(true);
    Object.defineProperty(table, 'offsetWidth', { configurable: true, value: 705 });
    markTableFit(wrap);
    expect(wrap.hasAttribute(TABLE_WIDE_ATTR)).toBe(false);
  });

  it('1px 차이(반올림)는 넓다고 보지 않는다, 표가 없으면 그대로', () => {
    const { wrap } = wrapWith(706, 705);
    markTableFit(wrap);
    expect(wrap.hasAttribute(TABLE_WIDE_ATTR)).toBe(false);
    const empty = document.createElement('div');
    markTableFit(empty);
    expect(empty.hasAttribute(TABLE_WIDE_ATTR)).toBe(false);
  });
});
