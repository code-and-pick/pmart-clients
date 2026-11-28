// 마크다운을 React 요소로 그린다(2026-11-28 — 운영자 RAG 문서 미리 보기·상담 도우미 본인 확인 표, ADR-0092·0093).
// 서버 본문은 신뢰할 수 없는 텍스트다: HTML 로 해석하지 않고(dangerouslySetInnerHTML 없음) 글자로만 넣는다. 링크·그림도 만들지 않는다.
// 문서 작성 규칙(docs/rag/rag-docs/backoffice/README.md)이 쓰는 것만: 제목(#~####), 문단, 목록(-·*·1.), 표, 인용(>), 코드 울타리(```), 가로줄, 굵게(**)·코드(`).
import type { ReactNode } from 'react';

export type Block =
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly start: number; readonly items: readonly string[] }
  | { readonly kind: 'table'; readonly head: readonly string[]; readonly rows: ReadonlyArray<readonly string[]> }
  | { readonly kind: 'quote'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'rule' };

const isTableLine = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableSeparator = (l: string) => /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const listItem = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/;

/** 마크다운 글 → 블록 목록(모르는 모양은 문단 글자 그대로). */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? '')) body.push(lines[i++] ?? '');
      i++; // 닫는 울타리(없으면 끝까지)
      out.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ kind: 'heading', level: h[1]!.length, text: h[2]!.trim() });
      i++;
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push({ kind: 'rule' });
      i++;
      continue;
    }
    if (isTableLine(line) && isTableSeparator(lines[i + 1] ?? '')) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableLine(lines[i] ?? '')) rows.push(cells(lines[i++] ?? ''));
      out.push({ kind: 'table', head, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? '')) body.push((lines[i++] ?? '').replace(/^\s*>\s?/, ''));
      out.push({ kind: 'quote', text: body.join('\n') });
      continue;
    }
    const li = listItem.exec(line);
    if (li) {
      const ordered = li[2] !== undefined;
      const start = ordered ? Number(li[2]) : 1;
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i] ?? '';
        const m = listItem.exec(cur);
        if (m && (m[2] !== undefined) === ordered) {
          items.push(m[3] ?? '');
          i++;
        } else if (cur.trim() !== '' && /^\s{2,}/.test(cur) && items.length > 0) {
          items[items.length - 1] += ` ${cur.trim()}`; // 들여 쓴 이어지는 줄
          i++;
        } else break;
      }
      out.push({ kind: 'list', ordered, start, items });
      continue;
    }
    const body: string[] = [];
    while (i < lines.length) {
      const cur = lines[i] ?? '';
      if (cur.trim() === '' || /^(#{1,6})\s/.test(cur) || /^\s*```/.test(cur) || /^\s*>/.test(cur) || listItem.test(cur) || (isTableLine(cur) && isTableSeparator(lines[i + 1] ?? ''))) break;
      body.push(cur.trim());
      i++;
    }
    out.push({ kind: 'paragraph', text: body.join(' ') });
  }
  return out;
}

/** 굵게(**…**)·코드(`…`)만 — 나머지는 글자 그대로 */
export function Inline({ text }: { readonly text: string }) {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let k = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    parts.push(t.startsWith('**') ? <strong key={k++}>{t.slice(2, -2)}</strong> : <code key={k++} className="rounded bg-base-200 px-1 text-[0.9em]">{t.slice(1, -1)}</code>);
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

const HEADING = ['text-xl font-bold', 'text-lg font-bold', 'text-base font-semibold', 'text-sm font-semibold', 'text-sm font-semibold', 'text-sm font-semibold'];

export interface TableMark {
  /** 강조할 줄(머리줄 빼고 0부터) */
  readonly row?: (cells: readonly string[], index: number) => boolean;
  /** 강조할 열(0부터, 머리 글자로 고른다) */
  readonly column?: (head: string, index: number) => boolean;
}

export function Markdown({ source, mark, className = '' }: { readonly source: string; readonly mark?: TableMark; readonly className?: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className={`space-y-3 break-words text-sm leading-relaxed ${className}`} data-testid="markdown">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading':
            return (
              <p key={i} role="heading" aria-level={b.level} className={HEADING[b.level - 1]}>
                <Inline text={b.text} />
              </p>
            );
          case 'paragraph':
            return (
              <p key={i}>
                <Inline text={b.text} />
              </p>
            );
          case 'list': {
            const L = b.ordered ? 'ol' : 'ul';
            return (
              <L key={i} {...(b.ordered && b.start !== 1 ? { start: b.start } : {})} className={`${b.ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-5`}>
                {b.items.map((x, j) => (
                  <li key={j}>
                    <Inline text={x} />
                  </li>
                ))}
              </L>
            );
          }
          case 'table': {
            const cols = b.head.map((h, j) => mark?.column?.(h, j) === true);
            return (
              <div key={i} className="overflow-x-auto rounded-box border border-base-300">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      {b.head.map((h, j) => (
                        <th key={j} className={cols[j] ? 'bg-primary/10 text-base-content' : ''}>
                          <Inline text={h} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => {
                      const on = mark?.row?.(r, j) === true;
                      return (
                        <tr key={j} className={on ? 'bg-primary/5 font-medium' : ''} data-marked={on || undefined}>
                          {r.map((c, k) => (
                            <td key={k} className={on && cols[k] ? 'bg-primary/15' : cols[k] ? 'bg-primary/5' : ''}>
                              <Inline text={c} />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          }
          case 'quote':
            return (
              <blockquote key={i} className="whitespace-pre-wrap border-l-4 border-base-300 pl-3 text-base-content/70">
                {b.text}
              </blockquote>
            );
          case 'code':
            return (
              <pre key={i} className="overflow-x-auto rounded-box bg-base-200 p-3 text-xs">
                {b.text}
              </pre>
            );
          case 'rule':
            return <hr key={i} className="border-base-300" />;
        }
      })}
    </div>
  );
}
