// 이 탭에서 물은 질문 기억(2026-11-19 사용자 "내 질문 목록에서 전에 한 질문이 뭔지 안 보여" → "탭 안에서만 + 백엔드 요청").
// 서버는 질문 원문을 기본 저장하지 않는다(ADR-0036 store-question=false, 저장 여부는 백엔드 "결정 필요") —
// 그래서 브라우저에 오래 남기지 않고 sessionStorage(이 탭, 새로 고침은 유지, 탭을 닫으면 사라짐)에만, 계정별로 둔다.
// 서버가 question 을 주면 서버 값이 먼저다. 요청 문서: docs/handoff/backoffice/2026-11-19-backend-assistant-store-question.md
const PREFIX = 'pmart.backoffice.assistant.asked.';
const MAX = 100;

type Store = Record<string, string>;

function read(owner: string | null): Store {
  if (!owner) return {};
  try {
    const raw = window.sessionStorage.getItem(PREFIX + owner);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
    }
  } catch {
    /* 저장이 막혔거나 깨진 값 — 기억 없이 */
  }
  return {};
}

/** 답변 ID 로 이 탭에서 물은 질문. 없으면 null. */
export function askedQuestion(owner: string | null, answerId: string): string | null {
  return read(owner)[answerId] ?? null;
}

export function rememberQuestion(owner: string | null, answerId: string, question: string): void {
  if (!owner) return;
  const store = read(owner);
  delete store[answerId];
  store[answerId] = question;
  const keys = Object.keys(store);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) delete store[k];
  try {
    window.sessionStorage.setItem(PREFIX + owner, JSON.stringify(store));
  } catch {
    /* 기억만 못 할 뿐 */
  }
}
