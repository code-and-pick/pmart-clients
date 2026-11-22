// 머리줄 내 정보 메뉴(2026-11-23) — 공용 @pmart/web-ui/console AccountMenu 에 이 앱 세션·이름을 넘긴다.
// 이름·사번은 hr employee-labels(목록과 같은 조회). 운영자 ID(OP-…)는 글자로 보이지 않는다(ADR-0070 덧붙임).
import { useNavigate } from 'react-router';

import { AccountMenu } from '@pmart/web-ui/console';
import { useSession } from './SessionContext';
import { useEmployeeLabel } from '../shared/employeeLabels';
import { messages as m } from '../shared/messages';

/** subject: 이름을 읽을 운영자 ID — 세션 복원 중이면 null(부르는 쪽이 정한다) */
export function UserMenu({ subject }: { readonly subject: string | null }) {
  const { session, logout } = useSession();
  const label = useEmployeeLabel(subject);
  const navigate = useNavigate();
  if (!session) return null;
  return (
    <AccountMenu
      name={label.data?.name ?? null}
      employeeNo={label.data?.employeeNo}
      roles={session.roles.map((r) => m.shell.roleName[r] ?? r)}
      profileTo="/session"
      onLogout={() =>
        void logout().then((result) => {
          if (result !== 'redirecting') void navigate('/login', { replace: true });
        })
      }
    />
  );
}
