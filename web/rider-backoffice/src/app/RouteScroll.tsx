// 화면을 옮기면 맨 위부터(2026-11-24 사용자 "전체상세를 보러 간 거면 윗부분이 뜨게 해") — 전에는 앞 화면에서 내려온 만큼 그대로라
// 새 화면 가운데쯤이 먼저 보였다. 주소에 #구역(예 /riders/R1#sec-restriction)이 있으면 그 구역으로 — 구역은 조회가 끝난 뒤 그려지므로
// 잠깐(최대 3초) 기다렸다 찾는다. 같은 화면에서 거르기(?쿼리)만 바뀔 때는 움직이지 않는다.
import { useEffect } from 'react';
import { useLocation } from 'react-router';

const WAIT_MS = 3000;
const STEP_MS = 100;

export function RouteScroll() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    const id = hash ? decodeURIComponent(hash.slice(1)) : '';
    if (!id) {
      window.scrollTo?.({ top: 0 });
      return;
    }
    let waited = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryScroll = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView?.({ block: 'start' });
        return;
      }
      waited += STEP_MS;
      if (waited < WAIT_MS) timer = setTimeout(tryScroll, STEP_MS);
      else window.scrollTo?.({ top: 0 });
    };
    tryScroll();
    return () => clearTimeout(timer);
  }, [pathname, hash]);
  return null;
}
