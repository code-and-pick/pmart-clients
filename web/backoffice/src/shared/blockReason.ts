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

// 작업 중지 실패 `lastError`(C1, mfc-fulfillment 계약 "사유 값" 2026-11-19) = "코드: 상세". 코드는 이름표로(…_NOT_FOUND 는 NOT_FOUND),
// 목록 밖 코드는 그대로(계약: 재고 서비스가 새 거절 코드를 더하면 그대로 온다). 2026-11-21 화면 점검 — 처리 대기·통합 조회에 코드가 영문 그대로 보였다.
export function stopErrorName(code: string): string {
  const names = messages.pending.errorName;
  return names[code] ?? (code.endsWith('_NOT_FOUND') ? names['NOT_FOUND'] : undefined) ?? code;
}

export function stopErrorText(lastError: string): string {
  const i = lastError.indexOf(':');
  const code = (i >= 0 ? lastError.slice(0, i) : lastError).trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(code)) return lastError;
  const detail = i >= 0 ? lastError.slice(i + 1).trim() : '';
  const name = stopErrorName(code);
  return detail ? `${name} — ${detail}` : name;
}

// 접수 건 요약(case-service 가 만드는 한 줄) 끝의 코드 — 서버가 "대사 필요 — AMOUNT", "보상 해제 실패 — INVENTORY_RESERVATION" 처럼
// 이벤트 값(mismatchType·resourceType, contracts/events)을 그대로 붙인다. 아는 앞말 + 아는 코드만 한국어로, 나머지 문장은 그대로(2026-11-21 화면 점검).
const SUMMARY_CODES: ReadonlyArray<readonly [RegExp, Readonly<Record<string, string>>]> = [
  [/^대사 필요 — /, messages.caseSummaryCode.reconciliation],
  [/^결제 승인 불일치 — /, messages.caseSummaryCode.paymentMismatch],
  [/^보상 해제 (실패|결과 불명) — /, messages.caseSummaryCode.compensation],
];

export function caseSummaryText(summary: string | null | undefined): string {
  const t = (summary ?? '').trim();
  for (const [lead, names] of SUMMARY_CODES) {
    const m = lead.exec(t);
    if (!m) continue;
    const code = t.slice(m[0].length).trim();
    return names[code] ? `${m[0]}${names[code]}` : t;
  }
  return t;
}
