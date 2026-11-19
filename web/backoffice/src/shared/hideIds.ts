// 서버가 보낸 문장 안의 시스템 ID 를 화면에서 걷어낸다(ADR-0070 — 목록·제목·요약에 시스템 ID 를 보이지 않는다).
// 2026-11-20 사용자 "PD-b2c0…·OP-b54f…·productDraft:PD-… 이런 건 상세에만 있고, 들어가자마자 보는 건 직관적인 공통 규칙값으로".
// 걷어내는 모양: ① 낙타 표기 접두 + 콜론 붙은 참조(productDraft:PD-…, contentImportBatch:cib-1) ② 접두-UUID(PD-…, OP-…, AP-…).
// 원문(ID 포함)은 상세의 접힌 "시스템 번호" 칸·마우스를 올렸을 때(title)에만 둔다.
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const PATTERNS: readonly RegExp[] = [
  /\b[a-z]+(?:[A-Z][a-z]*)+:[A-Za-z0-9_-]+/g,
  new RegExp(`\\b[A-Z]{1,6}-${UUID}\\b`, 'g'),
  new RegExp(`\\b${UUID}\\b`, 'g'),
];

/** 문장에 시스템 ID 모양이 있으면 걷어내고 빈 괄호·겹친 구분자를 정리한다. ID 뿐이던 문장이면 빈 문자열 */
export function hideIds(text: string | null | undefined): string {
  if (!text) return '';
  let s = text;
  for (const p of PATTERNS) s = s.replace(p, '');
  return s
    .replace(/\(\s*[,·:]?\s*\)/g, '')
    .replace(/\s*[·,:]\s*(?=[·,:]|$)/g, '')
    .replace(/^\s*[·,:]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** 검증 문제 칸(skus[0].weightG·product.primaryCategoryId) → 사람이 읽는 위치("SKU 1"), 상품 칸이면 빈 문자열 */
export function fieldWhere(field: string | null | undefined): string {
  const sku = field ? /^skus\[(\d+)\]/.exec(field) : null;
  return sku ? `SKU ${Number(sku[1]) + 1}` : '';
}

/** 문자열 전체가 시스템 ID 모양인가(항목 키 칸 등 — 그럴 땐 칸에 쓰지 않는다) */
export function isSystemId(text: string | null | undefined): boolean {
  return Boolean(text) && hideIds(text) === '';
}
