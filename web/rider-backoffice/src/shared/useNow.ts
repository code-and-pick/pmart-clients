// 지금 시각(밀리초) — 화면 그리기 중에 Date.now() 를 부르지 않게(React 순수 규칙) 타이머로 갱신한다. 첫 값이 오기 전에는 null.
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 30_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}

/** 지난 시간(분) 글자와 급한 정도 — 10분 넘으면 주의, 30분 넘으면 경고 */
export function waited(fromIso: string | null | undefined, now: number | null): { readonly text: string; readonly tone: 'ghost' | 'warning' | 'error' } | null {
  if (!fromIso || now === null) return null;
  const min = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60_000));
  const text = min < 60 ? `${min}분째` : `${Math.floor(min / 60)}시간 ${min % 60}분째`;
  return { text, tone: min >= 30 ? 'error' : min >= 10 ? 'warning' : 'ghost' };
}
