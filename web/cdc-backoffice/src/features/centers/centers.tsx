// 센터 고르기(handoff §1·§2-1): 고를 수 있는 센터는 세션 응답(`GET /employee-auth/sessions/current`, 0.6.0)의 `centers` 다(토큰을 풀지 않는다 — 백엔드 요청 2026-11-15 session-roles-centers).
// 이름은 같은 응답의 `centerDetails`(0.9.0, 백엔드 알림 web-common/2026-11-16-notice-session-center-names) — 서버가 이름을 못 읽은 센터는 코드로 보이고 안내한다.
// 이름은 표시용이다. 주소·API 호출은 코드(centers)로.
import { useNavigate } from 'react-router';

import { centerDisplayName } from '@pmart/web-core';
import { useSession } from '../../app/SessionContext';
import { messages as m } from '../../shared/messages';

/** 센터가 둘 이상이면 센터 이름이 드롭다운 — 바꾸면 같은 메뉴의 다른 센터로 간다. 하나면 이름만. */
export function CenterSwitcher({ centers, current, segment }: { readonly centers: readonly string[]; readonly current: string; readonly segment: string }) {
  const { session } = useSession();
  const navigate = useNavigate();
  const missingNames = centers.some((c) => !session?.centerNames?.has(c));
  if (centers.length < 2) {
    return (
      <div className="min-w-0 text-sm">
        {/* 좁은 화면(2026-11-21): "센터" 글자는 빼고 이름은 한 줄로 줄인다 */}
        <span className="hidden opacity-70 sm:inline">{m.center.label} </span>
        <strong className="inline-block max-w-[6rem] truncate align-bottom sm:max-w-none" title={centerDisplayName(session, current)}>
          {centerDisplayName(session, current)}
        </strong>
        {missingNames && <p className="text-warning text-xs">{m.center.namesFailed}</p>}
      </div>
    );
  }
  // 여러 센터 — 센터 이름 자체가 드롭다운(2026-11-24 사용자 "센터 명 클릭하면 다른 지점 웹 볼 수 있는 드롭다운"). 고르면 같은 메뉴의 그 센터로 간다.
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-sm">
      <label className="flex min-w-0 items-center gap-1">
        <span className="hidden opacity-70 sm:inline">{m.center.label}</span>
        <select
          aria-label={m.center.choose}
          title={m.center.switchHint(centers.length)}
          className="select select-sm select-ghost w-auto max-w-[8rem] cursor-pointer pr-7 font-bold sm:max-w-none"
          value={current}
          onChange={(e) => void navigate(`/c/${encodeURIComponent(e.target.value)}/${segment}`)}
          data-testid="center-switcher"
        >
          {centers.map((c) => (
            <option key={c} value={c}>
              {centerDisplayName(session, c)}
            </option>
          ))}
        </select>
      </label>
      {missingNames && <span className="text-warning text-xs">{m.center.namesFailed}</span>}
    </div>
  );
}
