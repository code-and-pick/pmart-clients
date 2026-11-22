// 머리줄 내 정보(2026-11-23 사용자 "내 세션: 이름-식별값 … 마이페이지처럼") — 동그란 머리글자 + 이름만, 누르면 이름·사번·역할과 "내 정보"·"로그아웃".
// 이름·사번은 hr employee-labels(목록과 같은 조회). 읽는 중·못 읽음·모르는 직원이면 "내 정보"만 — 운영자 ID(OP-…)는 글자로 보이지 않는다(ADR-0070 덧붙임).
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { useSession } from './SessionContext';
import { useEmployeeLabel } from '../shared/employeeLabels';
import { messages as m } from '../shared/messages';

const t = m.myPage;

/** 이름 첫 글자 — "[목] 관리자" 같은 목 표시는 건너뛴다 */
export const initialOf = (name: string | null | undefined) => (name ?? '').replace(/^\[[^\]]*\]\s*/, '').trim().slice(0, 1) || '?';

export function Avatar({ name, size = 'sm' }: { readonly name: string | null | undefined; readonly size?: 'sm' | 'lg' }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-primary/15 font-semibold text-primary ${size === 'lg' ? 'h-16 w-16 text-2xl' : 'h-6 w-6 text-xs'}`}
      aria-hidden="true"
    >
      {initialOf(name)}
    </span>
  );
}

/** subject: 이름을 읽을 운영자 ID — 세션 복원 중이면 null(부르는 쪽이 정한다) */
export function UserMenu({ subject }: { readonly subject: string | null }) {
  const { session, logout } = useSession();
  const label = useEmployeeLabel(subject);
  const name = label.data?.name ?? null;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // 다른 곳을 누르거나 Esc·화면 이동이면 닫는다
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

  if (!session) return null;
  const roles = session.roles.map((r) => m.shell.roleName[r] ?? r);
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
        <Avatar name={name} />
        <span className="max-w-[9rem] truncate">{name ?? t.title}</span>
        <svg viewBox="0 0 24 24" className="h-3 w-3 fill-none stroke-current opacity-60" strokeWidth={2} aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-box border border-base-300 bg-base-100 p-3 text-sm shadow-lg" role="menu" aria-label={t.title} data-testid="user-menu">
          <div className="flex items-center gap-3">
            <Avatar name={name} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{name ?? t.title}</p>
              {label.data?.employeeNo && <p className="font-mono text-xs text-base-content/60">{label.data.employeeNo}</p>}
            </div>
          </div>
          {roles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {roles.map((r) => (
                <span key={r} className="badge badge-ghost badge-sm">
                  {r}
                </span>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-col border-t border-base-300 pt-2">
            <Link to="/session" role="menuitem" className="rounded px-2 py-1.5 hover:bg-base-200">
              {t.title}
            </Link>
            <button
              type="button"
              role="menuitem"
              className="rounded px-2 py-1.5 text-left text-error hover:bg-base-200"
              onClick={() =>
                void logout().then((result) => {
                  if (result !== 'redirecting') void navigate('/login', { replace: true });
                })
              }
            >
              {m.session.signOut}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
