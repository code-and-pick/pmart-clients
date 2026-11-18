// 사본: web/backoffice (2026-11-18 인사팀 백오피스에 같은 화면 규칙 적용) — 이 앱에서 따로 고친다.
// 입력 중 떠날 때 경고(2026-11-18 사용자 "UI 보충 — 추천 다").
// - 앱 안 이동(메뉴·링크·뒤로): React Router useBlocker → 화면 안 확인 상자(브라우저 confirm 창을 쓰지 않는다)
// - 새로고침·탭 닫기: beforeunload → 브라우저 기본 경고(문구는 브라우저가 정한다)
// 같은 주소 안에서 쿼리만 바뀌는 것(탭 바꾸기 등)은 막지 않는다. 저장·제출 버튼을 눌러 떠나는 이동은 부르는 쪽이 when=false 로 푼다.
import { useEffect } from 'react';
import { useBlocker } from 'react-router';

import { messages as m } from './messages';

export function LeaveGuard({ when }: { readonly when: boolean }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => when && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!when) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [when]);

  if (blocker.state !== 'blocked') return null;
  return (
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="leave-guard-title" data-testid="leave-guard">
      <div className="modal-box max-w-sm">
        <h3 id="leave-guard-title" className="text-base font-bold">
          {m.leaveGuard.title}
        </h3>
        <p className="py-3 text-sm text-base-content/70">{m.leaveGuard.body}</p>
        <div className="modal-action mt-2">
          <button type="button" className="btn btn-sm btn-primary" autoFocus onClick={() => blocker.reset()}>
            {m.leaveGuard.stay}
          </button>
          <button type="button" className="btn btn-sm btn-ghost text-error" onClick={() => blocker.proceed()}>
            {m.leaveGuard.leave}
          </button>
        </div>
      </div>
    </div>
  );
}
