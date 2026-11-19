// 로그인 화면 틀(2026-11-20 — "흰 바탕 가운데 작은 카드라 밋밋하다"): 넓은 화면은 둘로 나눠 왼쪽 짙은 남색(neutral, 메뉴와 같은 색)에
// 로고·앱 이름, 오른쪽에 로그인 카드. 좁은 화면은 카드 위에 로고 줄만. 색은 테마 변수만 — 어두운 테마도 그대로 따라온다.
// 겉모양만이다: 로그인·세션·토큰 동작은 LoginPage 가 그대로 한다. (사본: web/hr-backoffice/src/features/session/LoginShell.tsx — 이 앱에서 따로 고친다)
import type { ReactNode } from 'react';

import { messages as m } from '../../shared/messages';

function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-lg bg-accent font-bold text-accent-content ${size === 'lg' ? 'h-11 w-11 text-xl' : 'h-8 w-8 text-sm'}`}
      aria-hidden="true"
    >
      P
    </span>
  );
}

export function LoginShell({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-base-100 lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-neutral p-12 text-neutral-content lg:flex lg:flex-col lg:justify-between" data-testid="login-brand">
        {/* 장식 원(테마 색을 옅게) — 읽기 도구에는 숨긴다 */}
        <span className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary/25 blur-2xl" aria-hidden="true" />
        <span className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-accent/15 blur-3xl" aria-hidden="true" />
        <span aria-hidden="true" />
        <div className="relative space-y-4">
          <Logo size="lg" />
          <p className="text-4xl font-extrabold leading-tight tracking-tight">{m.appTitle}</p>
          <p className="max-w-sm text-base text-neutral-content/70">{m.login.brandLead}</p>
        </div>
        <p className="relative text-xs text-neutral-content/50">{m.login.brandFoot}</p>
      </aside>
      {/* 오른쪽 절반 전체가 로그인 자리(카드 상자 없이) — 2026-11-20 사용자 "조그만 사각형 안에 박스를 작게 하면 없어 보인다" */}
      <div className="flex items-center px-6 py-12 sm:px-12 lg:px-20 xl:px-28">
        <div className="w-full max-w-xl space-y-10">
          <div className="flex items-center gap-2 lg:hidden">
            <Logo />
            <span className="text-base font-bold">{m.appTitle}</span>
          </div>
          <header className="space-y-3">
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
            {lead && <p className="text-base text-base-content/60">{lead}</p>}
          </header>
          <section className="space-y-6">{children}</section>
        </div>
      </div>
    </div>
  );
}
