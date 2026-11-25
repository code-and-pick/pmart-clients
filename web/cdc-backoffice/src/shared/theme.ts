// 사본: web/hr-backoffice/src/shared/theme.ts (2026-11-20 사용자 — MFC 에도 어두운 화면) — 이 앱에서 따로 고친다. 고른 테마(보는 사람 한 명의 편의)만 이 브라우저에 — 토큰·개인정보는 두지 않는다.
// 밝은/어두운 테마(2026-11-18). 고른 값은 이 브라우저에만(보는 사람 한 명의 편의) — 못 쓰는 환경이면 어두운(관제실) 테마(2026-11-21 기본 바꿈).
// 시작할 때(main.tsx) 그리기 전에 한 번 붙여 깜빡임을 막는다.
import { useState } from 'react';

export type Theme = 'pmart' | 'pmart-dark';
const KEY = 'pmart.cdc-backoffice.theme';

export function readTheme(): Theme {
  try {
    // 2026-11-21 관제실 겉모습: 기본은 어두운(관제실) 화면 — 밝은 화면을 고른 사람만 밝게
    return window.localStorage.getItem(KEY) === 'pmart' ? 'pmart' : 'pmart-dark';
  } catch {
    return 'pmart-dark';
  }
}

export function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t);
}

export function useTheme(): readonly [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const toggle = () => {
    const next: Theme = theme === 'pmart' ? 'pmart-dark' : 'pmart';
    applyTheme(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* 기억만 못 할 뿐 바꾸기는 된다 */
    }
    setTheme(next);
  };
  return [theme, toggle];
}
