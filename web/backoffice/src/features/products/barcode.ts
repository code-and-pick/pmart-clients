// 바코드 GS1 검사 숫자 미리 보기(product-service 0.3.0 BARCODE_CHECK_DIGIT_INVALID 와 같은 규칙). 서버가 정본 — 화면 검사는 편의.
// 숫자만 8·12·13·14자리일 때만 본다. 문자가 섞이거나 다른 길이면 서버도 검사하지 않는다.

/** 맞으면 null, 틀리면 맞는 끝자리(한 글자). */
export function gs1CheckDigitProblem(code: string): string | null {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return null;
  const body = code.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    const d = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  const expected = String((10 - (sum % 10)) % 10);
  return code.endsWith(expected) ? null : expected;
}
