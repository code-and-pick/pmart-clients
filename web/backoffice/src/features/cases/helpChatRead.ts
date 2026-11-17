// 도움요청 대화 "새 메시지" 판단(bff 0.6.0 — 백엔드 요청 backoffice/2026-11-17-request-inbox-help-chat).
// 백엔드에는 읽음 기록이 없다 — 직원별로 이 탭(sessionStorage)에 "마지막으로 본 라이더 메시지 시각"을 기억한다(편의 기능, 없거나 못 읽으면 새 메시지로 본다).
// localStorage 는 저장소 규칙(BR-03 — no-restricted-globals)으로 쓰지 않는다. 탭을 닫으면 읽음이 지워져 다시 점이 보일 수 있다.
// 대화 내용은 저장하지 않는다(요청 ID → 시각만).
const KEY = (subject: string) => `pmart.backoffice.helpChatRead.${subject}`;

function load(subject: string): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(KEY(subject));
    const v: unknown = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** 이 직원이 이 도움요청에서 마지막으로 본 라이더 메시지 시각 */
export function lastReadAt(subject: string, requestId: string): string | undefined {
  return subject ? load(subject)[requestId] : undefined;
}

/** 대화를 열어 본 라이더 메시지 시각까지 읽음으로(뒤로 가지 않는다) */
export function markRead(subject: string, requestId: string, riderAt: string): void {
  if (!subject || !riderAt) return;
  try {
    const all = load(subject);
    const prev = all[requestId];
    if (prev && Date.parse(prev) >= Date.parse(riderAt)) return;
    all[requestId] = riderAt;
    sessionStorage.setItem(KEY(subject), JSON.stringify(all));
  } catch {
    // 저장이 막힌 브라우저 — 새 메시지 점이 계속 보일 뿐
  }
}

/** 라이더가 지원센터 답 뒤에 썼고(또는 답이 없고), 이 직원이 아직 그 시각까지 안 봤으면 새 메시지 */
export function hasNewRiderMessage(lastRider: string | null | undefined, lastSupport: string | null | undefined, readAt: string | undefined): boolean {
  if (!lastRider) return false;
  const rider = Date.parse(lastRider);
  if (lastSupport && Date.parse(lastSupport) >= rider) return false;
  return !(readAt && Date.parse(readAt) >= rider);
}
