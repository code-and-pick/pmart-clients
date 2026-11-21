// 목 서버의 직원 세션을 이 탭의 sessionStorage 에 이어 둔다(브라우저 목 전용 — 시험·실서버에는 쓰지 않는다).
// 까닭: 목 서버 상태(db)는 메모리라 주소창 이동·새로고침·HMR 전체 새로고침마다 비워진다. 앱은 보관한 refresh 로 세션을 되살리는데
// 목 쪽 세션이 사라져 401 TOKEN_INVALID → 로그인 화면으로 돌아가거나 "정보를 불러오지 못했어요"가 떴다(2026-11-21).
// 목 refresh token(rt-mock-N)은 가짜 값이라 sessionStorage 에 두어도 된다. 실서버 토큰 보관 방식(@pmart/web-core sessionPersistence)은 건드리지 않는다.
import { db, type MockSession } from './db';

const KEY = 'pmart.rider-backoffice.mock-sessions';

interface Saved {
  readonly seq: number;
  readonly sessions: ReadonlyArray<Omit<MockSession, 'used'> & { readonly used: readonly string[] }>;
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** 보관한 목 세션을 db 에 되살린다. 번호(seq)는 보관한 값보다 작아지지 않게 — 새 세션·토큰 번호가 되살린 것과 겹치지 않도록 */
export function restoreMockSessions(): void {
  const s = storage();
  if (!s) return;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Saved;
    for (const x of saved.sessions) db.sessions.set(x.sessionId, { ...x, used: new Set(x.used) });
    db.seq = Math.max(db.seq, saved.seq);
  } catch {
    s.removeItem(KEY);
  }
}

/** 지금 목 세션을 보관한다(로그인·갱신·로그아웃 응답 뒤) */
export function saveMockSessions(): void {
  const s = storage();
  if (!s) return;
  const saved: Saved = {
    seq: db.seq,
    sessions: [...db.sessions.values()].map((x) => ({ ...x, used: [...x.used] })),
  };
  try {
    s.setItem(KEY, JSON.stringify(saved));
  } catch {
    // 보관 실패는 개발 편의만 잃는다
  }
}
