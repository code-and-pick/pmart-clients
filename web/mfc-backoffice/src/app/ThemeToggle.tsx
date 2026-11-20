// 사본: web/hr-backoffice/src/app/ThemeToggle.tsx (2026-11-20 MFC 어두운 화면) — 이 앱에서 따로 고친다.
// 머리줄 밝은/어두운 테마 단추(2026-11-18). 지금 테마의 반대 이름을 단추 이름으로(누르면 무엇이 되는지).
import { messages as m } from '../shared/messages';
import { useTheme } from '../shared/theme';

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const dark = theme === 'pmart-dark';
  const name = dark ? m.theme.toLight : m.theme.toDark;
  return (
    <button type="button" className="btn btn-ghost btn-xs h-8 w-8 p-0" onClick={toggle} aria-label={name} title={name} data-testid="theme-toggle">
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {dark ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : (
          <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />
        )}
      </svg>
    </button>
  );
}
