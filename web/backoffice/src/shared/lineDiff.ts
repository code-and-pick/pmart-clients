// 줄 단위 비교(2026-11-28 — 승인함 RAG_DOCUMENT 상세: 지금 판 ↔ 초안, ADR-0092).
// 앞뒤 같은 줄을 먼저 떼고 가운데만 최장 공통 부분열(LCS)로 맞춘다. 가운데가 너무 크면(줄 수 곱 4백만 넘음) 통째로 지움+더함.
export type DiffLine = { readonly kind: 'same' | 'add' | 'del'; readonly text: string; readonly oldNo: number | null; readonly newNo: number | null };

const MAX_CELLS = 4_000_000;

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n?/g, '\n').split('\n');
  const b = after.replace(/\r\n?/g, '\n').split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  const out: DiffLine[] = [];
  for (let i = 0; i < head; i++) out.push({ kind: 'same', text: a[i]!, oldNo: i + 1, newNo: i + 1 });

  const n = midA.length;
  const m = midB.length;
  if (n * m > MAX_CELLS) {
    midA.forEach((t, i) => out.push({ kind: 'del', text: t, oldNo: head + i + 1, newNo: null }));
    midB.forEach((t, j) => out.push({ kind: 'add', text: t, oldNo: null, newNo: head + j + 1 }));
  } else {
    // dp[i][j] = midA[i..], midB[j..] 의 LCS 길이
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) dp[i * w + j] = midA[i] === midB[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        out.push({ kind: 'same', text: midA[i]!, oldNo: head + i + 1, newNo: head + j + 1 });
        i++;
        j++;
      } else if (j < m && (i >= n || dp[i * w + j + 1]! >= dp[(i + 1) * w + j]!)) {
        out.push({ kind: 'add', text: midB[j]!, oldNo: null, newNo: head + j + 1 });
        j++;
      } else {
        out.push({ kind: 'del', text: midA[i]!, oldNo: head + i + 1, newNo: null });
        i++;
      }
    }
  }
  for (let k = 0; k < tail; k++) {
    const oi = a.length - tail + k;
    const ni = b.length - tail + k;
    out.push({ kind: 'same', text: a[oi]!, oldNo: oi + 1, newNo: ni + 1 });
  }
  return out;
}

/** 바뀐 줄 둘레만 남기고 같은 줄 묶음은 접는다(context 줄씩 남김). 접힌 곳은 { kind: 'gap', count } */
export type DiffRow = DiffLine | { readonly kind: 'gap'; readonly count: number };

export function foldDiff(lines: readonly DiffLine[], context = 3): DiffRow[] {
  const keep = lines.map(() => false);
  lines.forEach((l, i) => {
    if (l.kind === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: DiffRow[] = [];
  let gap = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (gap > 0) out.push({ kind: 'gap', count: gap });
      gap = 0;
      out.push(l);
    } else gap++;
  });
  if (gap > 0) out.push({ kind: 'gap', count: gap });
  return out;
}
