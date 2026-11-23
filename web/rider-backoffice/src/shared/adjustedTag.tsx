// 조정한 수행료 표시(2026-11-24 사용자 "조정한 수행료와 일반정상 수행료 구분이 안돼. 조정한 수행료라고 작게 기입을 해주던가").
// 계약 Earning.adjustmentRef(조정 기록 참조)가 있거나 상태가 ADJUSTED(라이더 귀책 미지급)면 조정한 것.
// 지급으로 조정한 건은 서버가 아직 adjustmentRef 를 채우지 않는다(백엔드 요청 docs/handoff/rider-backoffice/2026-11-24-backend-earning-adjustment-ref.md).
// 그동안 LAN 에서 꼬리표가 안 보였다(사용자 2026-11-24 "조정한 수행료인지 정상지급 수행료인지 안 고쳤네?") — 서버가 조정 때 남기는
// 메모 머리("지원센터 조정 — 지급(…)"·"… 미지급(…)", execution EarningAdjustments)로도 알아본다. 표시용으로만 쓰고(금액·상태 판단에는 안 씀),
// adjustmentRef 가 채워지면 그것이 먼저다.
export const adjustedText = '조정';
/** 라이더 귀책으로 미지급 조정(ADJUSTED) — 금액 대신 */
export const unpaidText = '미지급';

const ADJUSTED_NOTE_HEAD = '지원센터 조정';

export function isAdjustedEarning(it: { readonly adjustmentRef?: string | null; readonly settlementState?: string | null; readonly note?: string | null }): boolean {
  return !!it.adjustmentRef || it.settlementState === 'ADJUSTED' || (it.note ?? '').trim().startsWith(ADJUSTED_NOTE_HEAD);
}

export function AdjustedTag() {
  return (
    <span className="ml-1.5 rounded border border-warning/50 px-1 py-px align-middle text-[11px] font-semibold text-warning" data-testid="adjusted-tag" title="지원센터가 조정한 수행료">
      {adjustedText}
    </span>
  );
}
