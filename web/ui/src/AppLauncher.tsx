// 직원 웹 앱 바꾸기 메뉴(⋮⋮⋮) — 백엔드 요청 all/2026-11-17-request-app-launcher(사용자 2026-11-17).
// - 직원용 백오피스 5개를 모두에게 똑같이 보인다(역할로 거르지 않는다 — 메뉴는 편의, 권한은 각 앱·서버가 막는다). 세션을 읽지 않는다.
// - 같은 탭으로 연다: 보통 <a href>(휠클릭·Ctrl+클릭으로 새 탭은 브라우저에 맡긴다). 지금 앱은 강조만.
// - 주소 = 지금 페이지의 프로토콜·호스트 이름 + 앱 포트. https(LAN)는 443·8444·8445·8446·8447(443 은 포트 없음), 그 밖(개발·목 http)은 5173~5177.
//   코드에 IP 를 적지 않는다 — 192.168.0.40 으로 열었든 d603-16 으로 열었든 같은 호스트로 간다.
// - 모양(2026-11-18 사용자 — Google 앱 런처처럼): 머리줄 오른쪽 격자 단추 → 앱마다 둥근 회색 칸 안 선 아이콘 + 아래 이름, 격자로.
import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';

import { uiMessages as m } from './messages';

export type StaffApp = 'backoffice' | 'hr-backoffice' | 'mfc-backoffice' | 'rider-backoffice' | 'cdc-backoffice';

/** 앱 목록 — 이 컴포넌트 한 곳에만 둔다(순서 = 화면 순서) */
export const STAFF_APPS: ReadonlyArray<{ readonly app: StaffApp; readonly name: string; readonly lanPort: number; readonly devPort: number }> = [
  { app: 'backoffice', name: m.appNames.backoffice, lanPort: 443, devPort: 5173 },
  { app: 'hr-backoffice', name: m.appNames['hr-backoffice'], lanPort: 8444, devPort: 5174 },
  { app: 'mfc-backoffice', name: m.appNames['mfc-backoffice'], lanPort: 8445, devPort: 5175 },
  { app: 'rider-backoffice', name: m.appNames['rider-backoffice'], lanPort: 8446, devPort: 5176 },
  // DC 백오피스(2026-11-25 백엔드 요청 clients/all/2026-11-25-request-cdc-backoffice §2-3)
  { app: 'cdc-backoffice', name: m.appNames['cdc-backoffice'], lanPort: 8447, devPort: 5177 },
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

/** 격자 단추(3×3 작은 칸) */
function GridIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth={1.6}>
      {[3.5, 10, 16.5].flatMap((y) => [3.5, 10, 16.5].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width={4} height={4} rx={1} />))}
    </svg>
  );
}

/** 앱마다 선 아이콘(24 격자, 굵기 1.6) — 본사 백오피스 = 상자, 인사팀 = 사람들, MFC 센터 = 창고, 라이더 운영 = 배송 트럭, DC = 팔레트 위 상자 */
const APP_ICON: Readonly<Record<StaffApp, string>> = {
  backoffice: 'M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Zm0 0v0M4 7.5l8 4.5 8-4.5M12 12v9',
  'hr-backoffice': 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5c1.8.8 3 2.7 3 5.5',
  'mfc-backoffice': 'M3 9.5 12 4l9 5.5V20H3V9.5ZM7 20v-7h10v7M7 16h10',
  'rider-backoffice': 'M2.5 6.5h11v10h-11zM13.5 10h4l3 3.5v3h-7M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  'cdc-backoffice': 'M3 17.5h18M3 20.5h18M5 17.5v3M12 17.5v3M19 17.5v3M5 9.5h6v8H5zM13 5.5h6v12h-6zM8 9.5v2M16 5.5v2',
};

function AppIcon({ app }: { readonly app: StaffApp }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d={APP_ICON[app]} />
    </svg>
  );
}

/**
 * 이 앱 안 메뉴 칸(선택 — 2026-11-18 사용자 "메뉴도 런처에, 왼쪽 메뉴처럼 알림이 보이게"). 앱이 역할로 거른 것만 넘긴다.
 * onSelect 가 있으면 같은 앱 안 이동(새로 읽지 않음). badge 는 아이콘 칸 오른쪽 위(할 일 개수 — 앱이 그린다).
 */
export interface LauncherMenu {
  readonly title: string;
  readonly items: ReadonlyArray<{ readonly id: string; readonly label: string; readonly icon: ReactNode; readonly href: string; readonly onSelect?: (href: string) => void; readonly badge?: ReactNode; readonly active?: boolean }>;
}

export function AppLauncher({ current, className = '', menu }: { readonly current: StaffApp; readonly className?: string; readonly menu?: LauncherMenu | undefined }) {
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
        <GridIcon />
      </button>
      {open && (
        <nav id={panelId} aria-label={m.appLauncher} className={`absolute right-0 top-full z-50 mt-2 rounded-box border border-base-300 bg-base-100 p-4 text-base-content shadow-xl ${menu ? 'w-80' : 'w-72'}`}>
          {/* 앱이 4개라 2칸 격자(3칸이면 한 칸이 혼자 남는다). 늘면 3칸 */}
          <ul className={`grid gap-2 ${STAFF_APPS.length > 4 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {STAFF_APPS.map((a) => {
              const tile = (here: boolean) => (
                <>
                  <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${here ? 'bg-primary/15 text-primary' : 'bg-base-200 text-base-content/80'}`}>
                    <AppIcon app={a.app} />
                  </span>
                  <span className={`text-sm ${here ? 'font-semibold text-primary' : ''}`} {...(here ? { 'aria-current': 'page' as const } : {})}>
                    {a.name}
                  </span>
                </>
              );
              const cls = 'flex flex-col items-center gap-2 rounded-box px-2 py-3';
              return (
                <li key={a.app}>
                  {a.app === current ? (
                    // 지금 앱은 강조만(눌러도 이동하지 않는다)
                    <span className={`${cls} bg-base-200/60`} data-app={a.app}>
                      {tile(true)}
                    </span>
                  ) : (
                    <a href={staffAppUrl(a.app, here)} className={`${cls} hover:bg-base-200`} data-app={a.app}>
                      {tile(false)}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
          {menu && menu.items.length > 0 && (
            <div className="mt-3 border-t border-base-300 pt-3" data-testid="app-launcher-menu">
              <p className="px-1 pb-2 text-xs font-semibold text-base-content/50">{menu.title}</p>
              <div className="grid grid-cols-3 gap-1">
                {menu.items.map((i) => (
                  <a
                    key={i.id}
                    href={i.href}
                    className={`flex flex-col items-center gap-1.5 rounded-box px-1 py-2 text-center hover:bg-base-200 ${i.active ? 'bg-primary/10 text-primary' : ''}`}
                    {...(i.active ? { 'aria-current': 'page' as const } : {})}
                    data-menu={i.id}
                    onClick={(e: ReactMouseEvent<HTMLAnchorElement>) => {
                      // Ctrl·휠 클릭은 브라우저에 맡긴다(새 탭)
                      if (!i.onSelect || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      setOpen(false);
                      i.onSelect(i.href);
                    }}
                  >
                    <span className={`relative flex h-10 w-10 items-center justify-center rounded-xl ${i.active ? 'bg-primary/15 text-primary' : 'bg-base-200 text-base-content/80'}`}>
                      {i.icon}
                      {i.badge && <span className="absolute -right-2 -top-1.5">{i.badge}</span>}
                    </span>
                    <span className={`text-xs leading-tight ${i.active ? 'font-semibold' : ''}`}>{i.label}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </nav>
      )}
    </div>
  );
}
