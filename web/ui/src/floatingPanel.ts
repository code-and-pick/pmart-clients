// 펼친 목록을 화면 고정 자리(position: fixed)에 띄우는 자리 셈(2026-11-19 사용자 캡처 "이따구로 보임" —
// 카드(overflow-hidden) 안의 드롭다운 목록이 카드 가장자리에서 잘렸다). 칸 바로 아래, 아래 자리가 모자라면 위로.
// 스크롤·창 크기가 바뀌면 다시 셈. 붙일 style 만 돌려준다. fixed 는 overflow-hidden 조상에 잘리지 않고, 다른 곳(body)으로 옮기지 않아 모달 안에서도 모달 위에 보인다.
import { type CSSProperties, type RefObject, useLayoutEffect, useState } from 'react';

const GAP = 4;
const MAX_H = 288;

export function useFloatingPanel(anchor: RefObject<HTMLElement | null>, open: boolean): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - GAP;
      const above = r.top - GAP;
      const up = below < Math.min(MAX_H, 200) && above > below;
      const room = Math.max(120, Math.min(MAX_H, up ? above : below) - 8);
      setStyle({
        position: 'fixed',
        left: r.left,
        width: r.width,
        maxHeight: room,
        zIndex: 60,
        ...(up ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor, open]);
  // 닫혀 있으면 자리 없음(지난번 자리는 버린다 — 다시 열면 새로 센다)
  return open ? style : null;
}
