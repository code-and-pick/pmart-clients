// 마크다운 그리기(HTML 해석 없음)·줄 비교(2026-11-28, ADR-0092·0093)
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { foldDiff, lineDiff } from './lineDiff';
import { Markdown, parseMarkdown } from './Markdown';

describe('Markdown', () => {
  it('제목·목록·표를 블록으로 나눈다', () => {
    const b = parseMarkdown('# 제목\n\n## 제1조 (가)\n1. 하나\n2. 둘\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- 점');
    expect(b.map((x) => x.kind)).toEqual(['heading', 'heading', 'list', 'table', 'list']);
  });

  it('HTML 은 글자 그대로(요소로 만들지 않는다)', () => {
    const { container } = render(<Markdown source={'# 안녕\n<img src=x onerror=alert(1)> **굵게** `code`'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
    expect(container.querySelector('strong')).toHaveTextContent('굵게');
  });
});

describe('lineDiff', () => {
  it('더한 줄·지운 줄·같은 줄', () => {
    const d = lineDiff('a\nb\nc', 'a\nB\nc\nd');
    expect(d.map((x) => `${x.kind}:${x.text}`)).toEqual(['same:a', 'add:B', 'del:b', 'same:c', 'add:d']);
  });

  it('같은 줄 묶음은 접는다', () => {
    const before = Array.from({ length: 20 }, (_, i) => `줄${i}`).join('\n');
    const after = before.replace('줄10', '바뀐 줄');
    const rows = foldDiff(lineDiff(before, after), 2);
    expect(rows[0]).toEqual({ kind: 'gap', count: 8 });
    expect(rows.at(-1)).toEqual({ kind: 'gap', count: 7 });
  });
});

describe('번호 목록 시작 번호', () => {
  it('"10." 으로 시작하면 10부터', () => {
    const { container } = render(<Markdown source={'1. 하나\n\n| a |\n|---|\n| b |\n\n10. 열'} />);
    expect(container.querySelectorAll('ol')[1]).toHaveAttribute('start', '10');
  });
});
