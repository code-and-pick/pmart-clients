// 왼쪽 메뉴 접기(2026-11-19 사용자 "순서대로" — 좁은 화면(노트북·태블릿)에서 본문이 답답하다).
// 고른 값은 이 브라우저에만(보는 사람 한 명의 편의). 고른 적이 없으면 화면 폭으로: 1280px 보다 좁으면 접어서 시작.
// 2026-11-23 점검(사용자 "고쳐"): 휴대폰 폭(640px 미만)에서는 넓은 화면에서 "펴기"를 골라 뒀어도 접어서 시작한다 — 펼친 메뉴 220px 에
// 본문이 155px 만 남아 모든 화면이 넘쳤다. 좁은 화면에서 펴고 접는 것은 그때만(넓은 화면에서 고른 값은 바꾸지 않음), 폭이 좁아지면 다시 접는다.
import { useEffect, useState } from 'react';

const KEY = 'pmart.backoffice.menu';
const NARROW = '(max-width: 639px)';

const isNarrow = () => typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches;

export function readMenuCollapsed(): boolean {
  if (isNarrow()) return true;
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === 'collapsed') return true;
    if (v === 'open') return false;
  } catch {
    /* 저장이 막힌 브라우저 — 폭으로 */
  }
  return typeof window.innerWidth === 'number' && window.innerWidth < 1280;
}

export function useMenuCollapsed(): readonly [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(readMenuCollapsed);
  // 폭이 좁아지면 접고, 넓어지면 넓은 화면에서 고른 값으로
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(NARROW);
    const onChange = () => setCollapsed(readMenuCollapsed());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const toggle = () => {
    const next = !collapsed;
    if (!isNarrow()) {
      try {
        window.localStorage.setItem(KEY, next ? 'collapsed' : 'open');
      } catch {
        /* 기억만 못 할 뿐 접기·펴기는 된다 */
      }
    }
    setCollapsed(next);
  };
  return [collapsed, toggle];
}
