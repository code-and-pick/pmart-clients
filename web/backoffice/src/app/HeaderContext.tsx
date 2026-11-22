// 머리줄 맥락 꼬리표(2026-11-19 사용자 "관제 화면 형식으로" — 위 줄에 지금 환경·내 역할·시계).
// 역할은 토큰의 역할 이름을 한글로(모르는 코드는 그대로). 시계는 서울 시각 — 표시 전용, 판정에 쓰지 않는다.
import { RoleText } from '@pmart/web-ui/console';
import { useEffect, useState } from 'react';

import { messages } from '../shared/messages';

const m = messages.shell;
const seoul = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/** 위치 줄 역할 — 공용 RoleText(테두리·바탕 없는 글자, 2026-11-23) */
export function RoleChips({ roles }: { readonly roles: readonly string[] }) {
  return <RoleText roles={roles.map((r) => m.roleName[r] ?? r)} />;
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
