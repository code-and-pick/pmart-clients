// 조정한 수행료 표시(2026-11-24 사용자 "조정한 수행료와 일반정상 수행료 구분이 안돼. 조정한 수행료라고 작게 기입을 해주던가").
// 계약 Earning.adjustmentRef(조정 기록 참조)가 있거나 상태가 ADJUSTED(라이더 귀책 미지급)면 조정한 것.
// 지급으로 조정한 건은 서버가 아직 adjustmentRef 를 채우지 않아(백엔드 요청 docs/handoff/rider-backoffice/2026-11-24-backend-earning-adjustment-ref.md)
// 채워지기 전까지는 표시되지 않는다 — 메모(note) 글자로 가르지 않는다.
export const adjustedText = '조정';
/** 라이더 귀책으로 미지급 조정(ADJUSTED) — 금액 대신 */
export const unpaidText = '미지급';

export function isAdjustedEarning(it: { readonly adjustmentRef?: string | null; readonly settlementState?: string | null }): boolean {
  return !!it.adjustmentRef || it.settlementState === 'ADJUSTED';
}

export function AdjustedTag() {
  return (
    <span className="ml-1.5 rounded border border-warning/50 px-1 py-px align-middle text-[11px] font-semibold text-warning" data-testid="adjusted-tag" title="지원센터가 조정한 수행료">
      {adjustedText}
    </span>
  );
}
