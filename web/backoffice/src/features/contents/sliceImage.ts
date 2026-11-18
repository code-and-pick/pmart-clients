// 긴 상세 이미지를 조각으로 자르기(2026-11-18 사용자 "카드 이미지로 잘라서 등록" — (나) 긴 이미지 한 장 → 상세설명 조각 여러 장).
// 계약: 상세설명(DESCRIPTION)은 "롱이미지 조각"을 sortOrder 순서로 여러 장 올린다(product-content ImageRole). 새 API 없이 브라우저에서 자른다.
// - 폭은 그대로, 위에서부터 조각 높이만큼. 마지막 조각이 아주 짧으면(조각 높이의 20% 미만) 앞 조각에 붙인다(빈약한 띠가 생기지 않게).
// - 형식은 원본과 같게(JPEG·PNG·WebP — 계약 허용 형식). JPEG·WebP 는 품질 0.92.
// - 원본이 조각 높이 이하면 자르지 않고 그대로 한 장.

export const SLICE_HEIGHTS = [1000, 1500, 2000] as const;
export const DEFAULT_SLICE_HEIGHT = 1500;
const MIN_LAST = 0.2;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** 자를 자리(위 y, 높이 h) — 화면 그리기 없이 시험할 수 있게 따로 둔다 */
export function slicePlan(totalHeight: number, pieceHeight: number): Array<{ readonly y: number; readonly h: number }> {
  if (totalHeight <= 0 || pieceHeight <= 0) return [];
  if (totalHeight <= pieceHeight) return [{ y: 0, h: totalHeight }];
  const out: Array<{ y: number; h: number }> = [];
  for (let y = 0; y < totalHeight; y += pieceHeight) out.push({ y, h: Math.min(pieceHeight, totalHeight - y) });
  const last = out.at(-1)!;
  if (out.length > 1 && last.h < pieceHeight * MIN_LAST) {
    out.pop();
    const prev = out.at(-1)!;
    prev.h += last.h;
  }
  return out;
}

/** 조각 파일 이름: 원본이름_01.jpg … */
export function pieceName(original: string, index: number, type: string): string {
  const dot = original.lastIndexOf('.');
  const base = dot > 0 ? original.slice(0, dot) : original;
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return `${base}_${String(index + 1).padStart(2, '0')}.${ext}`;
}

export interface SliceResult {
  readonly pieces: readonly File[];
  readonly width: number;
  readonly height: number;
}

/** 실제 자르기(브라우저 canvas). 이미지를 못 읽으면 throw — 부르는 쪽이 안내한다 */
export async function sliceImage(file: File, pieceHeight: number): Promise<SliceResult> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = bitmap;
    const plan = slicePlan(height, pieceHeight);
    if (plan.length <= 1) return { pieces: [file], width, height };
    const type = ALLOWED.has(file.type) ? file.type : 'image/jpeg';
    const pieces: File[] = [];
    for (const [i, part] of plan.entries()) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = part.h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.drawImage(bitmap, 0, part.y, width, part.h, 0, 0, width, part.h);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, type === 'image/png' ? undefined : 0.92));
      if (!blob) throw new Error('toBlob');
      pieces.push(new File([blob], pieceName(file.name, i, type), { type }));
    }
    return { pieces, width, height };
  } finally {
    bitmap.close();
  }
}
