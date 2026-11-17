// 도움요청 대화 "새 메시지" 판단(case 0.20.0·bff 0.10.0 — 백엔드 요청 backoffice/2026-11-17-request-last-seen-and-badges §1, 사용자 "가가가나").
// 직원별 읽음은 서버에 둔다: 접수 건을 열면 `POST /cases/{caseId}/views`, 목록·상세에 내 `myLastSeenAt`(본 적 없으면 null).
// 전에는 이 탭 sessionStorage 에 기억했다(탭을 닫으면 지워짐) — 이제 쓰지 않는다.

/** 새 메시지 = 라이더 마지막 메시지가 있고, 내가 이 건을 본 적 없거나 그보다 먼저 봤으면 */
export function hasNewRiderMessage(lastRider: string | null | undefined, mySeenAt: string | null | undefined): boolean {
  if (!lastRider) return false;
  return !mySeenAt || Date.parse(mySeenAt) < Date.parse(lastRider);
}
