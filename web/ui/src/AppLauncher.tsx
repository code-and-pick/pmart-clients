// 직원 웹 앱 바꾸기 메뉴(⋮⋮⋮) — 백엔드 요청 all/2026-11-17-request-app-launcher(사용자 2026-11-17).
// - 직원용 백오피스 4개를 모두에게 똑같이 보인다(역할로 거르지 않는다 — 메뉴는 편의, 권한은 각 앱·서버가 막는다). 세션을 읽지 않는다.
// - 같은 탭으로 연다: 보통 <a href>(휠클릭·Ctrl+클릭으로 새 탭은 브라우저에 맡긴다). 지금 앱은 강조만.
// - 주소 = 지금 페이지의 프로토콜·호스트 이름 + 앱 포트. https(LAN)는 443·8444·8445·8446(443 은 포트 없음), 그 밖(개발·목 http)은 5173~5176.
//   코드에 IP 를 적지 않는다 — 192.168.0.40 으로 열었든 d603-16 으로 열었든 같은 호스트로 간다.
import { useEffect, useId, useRef, useState } from 'react';

import { uiMessages as m } from './messages';

export type StaffApp = 'backoffice' | 'hr-backoffice' | 'mfc-backoffice' | 'rider-backoffice';

/** 앱 목록 — 이 컴포넌트 한 곳에만 둔다(순서 = 화면 순서) */
export const STAFF_APPS: ReadonlyArray<{ readonly app: StaffApp; readonly name: string; readonly lanPort: number; readonly devPort: number }> = [
  { app: 'backoffice', name: m.appNames.backoffice, lanPort: 443, devPort: 5173 },
  { app: 'hr-backoffice', name: m.appNames['hr-backoffice'], lanPort: 8444, devPort: 5174 },
  { app: 'mfc-backoffice', name: m.appNames['mfc-backoffice'], lanPort: 8445, devPort: 5175 },
  { app: 'rider-backoffice', name: m.appNames['rider-backoffice'], lanPort: 8446, devPort: 5176 },
];

/** 앱 첫 화면 주소 — 지금 페이지(protocol·hostname) 기준 */
export function staffAppUrl(app: StaffApp, here: { readonly protocol: string; readonly hostname: string }): string {
  const entry = STAFF_APPS.find((a) => a.app === app);
  if (!entry) throw new Error(`unknown app ${app}`);
  const https = here.protocol === 'https:';
  const port = https ? entry.lanPort : entry.devPort;
  const host = here.hostname.includes(':') ? `[${here.hostname}]` : here.hostname;
  return `${https ? 'https' : 'http'}://${host}${https && port === 443 ? '' : `:${port}`}/`;
}

function DotsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current">
      {[5, 12, 19].flatMap((y) => [5, 12, 19].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={2} />))}
    </svg>
  );
}

export function AppLauncher({ current, className = '' }: { readonly current: StaffApp; readonly className?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const here = globalThis.location;
  return (
    <div ref={root} className={`relative inline-block ${className}`} data-testid="app-launcher">
      <button
        ref={button}
        type="button"
        className="btn btn-ghost btn-sm btn-square"
        aria-label={m.appLauncher}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <DotsIcon />
      </button>
      {open && (
        <nav id={panelId} aria-label={m.appLauncher} className="absolute right-0 top-full z-50 mt-1 w-44 rounded-box bg-base-100 p-2 shadow-lg">
          <ul className="menu menu-sm w-full p-0">
            {STAFF_APPS.map((a) => (
              <li key={a.app}>
                {a.app === current ? (
                  // 지금 앱은 강조만(눌러도 이동하지 않는다)
                  <span className="menu-active" aria-current="page" data-app={a.app}>
                    {a.name}
                  </span>
                ) : (
                  <a href={staffAppUrl(a.app, here)} data-app={a.app}>
                    {a.name}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
