// 작업·출고 막힌 사유(mfc-fulfillment `blockReason`) 이름표 — 백엔드 회신 2026-11-19 reply-code-names-mfc C2.
// 코드가 아니라 한국어 문장이고 두 가지로 시작한다: "예약 보류(격리·실사 손실 — 재확보 못 함): …" → 재고 보류, "결품 보고: …" → 결품.
// 뒤 문장(<주문 줄> <수량>개 …)에는 시스템 ID(주문 줄)가 들어 있어 화면에 보이지 않는다(ADR-0070). 모르는 문장은 그대로.
import { messages } from './messages';

const PREFIXES: ReadonlyArray<readonly [string, keyof typeof messages.blockReason]> = [
  ['예약 보류', 'stockHold'],
  ['결품 보고', 'shortage'],
];

export function blockReasonLabel(reason: string): string {
  const t = reason.trim();
  const hit = PREFIXES.find(([p]) => t.startsWith(p));
  return hit ? messages.blockReason[hit[1]] : t;
}
