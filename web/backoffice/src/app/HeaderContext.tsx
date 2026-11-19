// 머리줄 맥락 꼬리표(2026-11-19 사용자 "관제 화면 형식으로" — 위 줄에 지금 환경·내 역할·시계).
// 역할은 토큰의 역할 이름을 한글로(모르는 코드는 그대로). 시계는 서울 시각 — 표시 전용, 판정에 쓰지 않는다.
import { useEffect, useState } from 'react';

import { messages } from '../shared/messages';

const m = messages.shell;
const seoul = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export function RoleChips({ roles }: { readonly roles: readonly string[] }) {
  if (roles.length === 0) return null;
  const names = roles.map((r) => m.roleName[r] ?? r);
  const [first, ...rest] = names;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-base-300 bg-base-200/60 px-2 py-0.5 text-xs text-base-content/70" title={names.join(', ')} data-testid="header-roles">
      <svg viewBox="0 0 24 24" className="h-3 w-3 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3 4 6v6c0 4.5 3.4 8.4 8 9 4.6-.6 8-4.5 8-9V6l-8-3Z" />
      </svg>
      {first}
      {rest.length > 0 && <span className="text-base-content/45">{`+${rest.length}`}</span>}
    </span>
  );
}

export function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="hidden items-center gap-1.5 font-mono text-sm font-semibold tabular-nums text-base-content/80 lg:inline-flex" title={m.clockTitle} data-testid="header-clock">
      <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
      {seoul.format(now)}
    </span>
  );
}
