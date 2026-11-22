// 공용 @pmart/web-ui/console — 머리줄 "내 정보" 메뉴와 내 정보 화면 틀(2026-11-23 — 통합 백오피스 #394·#399 에서 올림, 사용자 "인사·MFC·라이더 백오피스에 모두 적용").
// 화면 모양만 — 세션·로그아웃·이름 조회는 앱이 넘긴다(앱마다 SessionContext·조회 API 가 다르다). 로그인·토큰 코드는 여기 없다.
// - 머리줄: 동그란 머리글자 + 이름. 누르면 이름·사번·역할(글자)과 "내 정보"·"로그아웃". 바깥 누름·Esc·화면 이동이면 닫힘.
// - 화면: 프로필(머리글자·이름·사번 · 역할) → 업무·로그인 두 칸 → 앱별 칸(extra) → 계정·보안(안내·로그아웃) → 접힌 시스템 번호.
// - 역할은 단추·꼬리표 모양 없이 글자로(사용자 "권한 버튼처럼 나오는 거 별론데"). 운영자 ID·세션 ID 는 접힌 시스템 번호에만.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';

import { CopyButton } from './CopyButton';
import { messages } from './messages';

const t = messages.account;

/** 이름 첫 글자 — "[목] 관리자" 같은 목 표시는 건너뛴다 */
export const initialOf = (name: string | null | undefined) => (name ?? '').replace(/^\[[^\]]*\]\s*/, '').trim().slice(0, 1) || '?';

export function AccountAvatar({ name, size = 'sm' }: { readonly name: string | null | undefined; readonly size?: 'sm' | 'lg' }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-primary/15 font-semibold text-primary ${size === 'lg' ? 'h-16 w-16 text-2xl' : 'h-6 w-6 text-xs'}`} aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}

export interface AccountMenuProps {
  /** 이름(못 읽었거나 모르면 null — "내 정보"만 보인다) */
  readonly name: string | null;
  readonly employeeNo?: string | null | undefined;
  /** 보이는 역할 이름(한글) */
  readonly roles: readonly string[];
  /** 내 정보 화면 주소 */
  readonly profileTo: string;
  readonly onLogout: () => void;
}

/** 머리줄 내 정보 메뉴 */
export function AccountMenu({ name, employeeNo, roles, profileTo, onLogout }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
  }
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        className="btn btn-ghost btn-xs h-8 gap-1.5 px-1.5 font-normal"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={name ? t.menuOf(name) : t.title}
        onClick={() => setOpen((v) => !v)}
        data-testid="operator"
      >
        <AccountAvatar name={name} />
        <span className="max-w-[9rem] truncate">{name ?? t.title}</span>
        <svg viewBox="0 0 24 24" className="h-3 w-3 fill-none stroke-current opacity-60" strokeWidth={2} aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-box border border-base-300 bg-base-100 p-3 text-sm shadow-lg" role="menu" aria-label={t.title} data-testid="user-menu">
          <div className="flex items-center gap-3">
            <AccountAvatar name={name} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{name ?? t.title}</p>
              {employeeNo && <p className="font-mono text-xs text-base-content/60">{employeeNo}</p>}
              {roles.length > 0 && <p className="mt-0.5 text-xs text-base-content/60">{roles.join(', ')}</p>}
            </div>
          </div>
          <div className="mt-3 flex flex-col border-t border-base-300 pt-2">
            <Link to={profileTo} role="menuitem" className="rounded px-2 py-1.5 hover:bg-base-200">
              {t.title}
            </Link>
            <button type="button" role="menuitem" className="rounded px-2 py-1.5 text-left text-error hover:bg-base-200" onClick={onLogout}>
              {t.signOut}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 역할 표시(위치 줄) — 단추처럼 보이지 않게 테두리·바탕 없이 글자로 */
export function RoleText({ roles }: { readonly roles: readonly string[] }) {
  if (roles.length === 0) return null;
  const [first, ...rest] = roles;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-base-content/55" title={roles.join(', ')} data-testid="header-roles">
      <svg viewBox="0 0 24 24" className="h-3 w-3 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3 4 6v6c0 4.5 3.4 8.4 8 9 4.6-.6 8-4.5 8-9V6l-8-3Z" />
      </svg>
      {first}
      {rest.length > 0 && <span className="text-base-content/45">{`+${rest.length}`}</span>}
    </span>
  );
}

/** 내 정보 화면의 칸 하나 */
export function InfoCard({ title, children, testId }: { readonly title: string; readonly children: ReactNode; readonly testId?: string }) {
  return (
    <section className="rounded-box border border-base-300 bg-base-100 p-5" {...(testId ? { 'data-testid': testId } : {})}>
      <h2 className="mb-3 text-sm font-semibold text-base-content/70">{title}</h2>
      {children}
    </section>
  );
}

/** 칸 안 한 줄 "이름 — 값" */
export function InfoRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 border-b border-base-200 py-2 text-sm last:border-b-0">
      <dt className="w-28 shrink-0 font-normal text-base-content/60">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

export interface MyInfoViewProps {
  readonly name: string | null;
  /** 이름이 없을 때 보일 말("…"·"이름 없음"·"이름 확인 불가") */
  readonly nameFallback: string;
  readonly employeeNo?: string | null | undefined;
  /** 보이는 역할 이름(한글) */
  readonly roles: readonly string[];
  /** 역할이 없을 때 안내(권한 승인 대기 등) */
  readonly noRolesNote?: ReactNode;
  /** 업무 칸의 줄들(역할 줄은 이 틀이 넣는다) */
  readonly work?: ReadonlyArray<readonly [string, ReactNode]>;
  /** 로그인 칸 안 — 앱이 서버 세션 조회 결과(QueryState 등)를 그린다 */
  readonly login: ReactNode;
  /** 앱별 칸(인사 정보·센터 연락처 등) — 업무·로그인 아래, 계정·보안 위 */
  readonly extra?: ReactNode;
  /** 계정·보안 안내 글 */
  readonly notes: readonly string[];
  readonly onLogout: () => void;
  /** 접힌 시스템 번호 칸(운영자 ID·세션 ID 등) */
  readonly systemIds?: ReadonlyArray<{ readonly label: string; readonly id: string | null | undefined }>;
}

/** 내 정보 화면 — 통합 백오피스 #394 모양(사용자 "2번이 나아") */
export function MyInfoView({ name, nameFallback, employeeNo, roles, noRolesNote, work = [], login, extra, notes, onLogout, systemIds = [] }: MyInfoViewProps) {
  const ids = systemIds.filter((x): x is { readonly label: string; readonly id: string } => typeof x.id === 'string' && x.id !== '');
  return (
    <section className="max-w-3xl space-y-4">
      <h1 className="text-xl font-bold">{t.title}</h1>
      <div className="flex flex-wrap items-center gap-5 rounded-box border border-base-300 bg-base-100 p-5" data-testid="my-profile">
        <AccountAvatar name={name} size="lg" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-lg font-semibold">{name ?? nameFallback}</p>
          <p className="text-sm text-base-content/60">{[employeeNo, roles.join(', ')].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      {noRolesNote}
      <div className="grid gap-4 md:grid-cols-2">
        <InfoCard title={t.work}>
          <dl>
            <InfoRow label={t.roles}>{roles.join(', ') || t.none}</InfoRow>
            {work.map(([k, v]) => (
              <InfoRow key={k} label={k}>
                {v}
              </InfoRow>
            ))}
          </dl>
        </InfoCard>
        <InfoCard title={t.login}>{login}</InfoCard>
      </div>
      {extra}
      <InfoCard title={t.security}>
        <div className="space-y-1 text-sm text-base-content/75">
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
        <button type="button" className="btn btn-sm btn-outline btn-error mt-4" onClick={onLogout}>
          {t.signOut}
        </button>
      </InfoCard>
      {ids.length > 0 && (
        <details className="text-xs" data-testid="system-numbers">
          <summary className="cursor-pointer text-base-content/60">{t.systemNumbers}</summary>
          <dl className="mt-1 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-0.5">
            {ids.map((x) => (
              <div key={`${x.label}:${x.id}`} className="contents">
                <dt className="text-base-content/60">{x.label}</dt>
                <dd className="flex items-center gap-1 break-all font-mono">
                  {x.id}
                  <CopyButton value={x.id} label={`${x.label} ${x.id}`} />
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}

/** 로그인 칸 줄들 — 서버 세션(GET /employee-auth/sessions/current) 값 그대로 */
export function LoginRows({ app, issuedAt, expiresAt }: { readonly app: string; readonly issuedAt: string; readonly expiresAt: string }) {
  return (
    <dl>
      <InfoRow label={t.app}>{t.appName[app] ?? app}</InfoRow>
      <InfoRow label={t.issuedAt}>{issuedAt}</InfoRow>
      <InfoRow label={t.expiresAt}>{expiresAt}</InfoRow>
    </dl>
  );
}
