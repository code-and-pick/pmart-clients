// 로그인 화면 틀(2026-11-20 — "흰 바탕 가운데 작은 카드라 밋밋하다"): 넓은 화면은 둘로 나눠 왼쪽 짙은 남색(neutral, 메뉴와 같은 색)에
// 로고·앱 이름, 오른쪽에 로그인 카드. 좁은 화면은 카드 위에 로고 줄만. 색은 테마 변수만 — 어두운 테마도 그대로 따라온다.
// 겉모양만이다: 로그인·세션·토큰 동작은 LoginPage 가 그대로 한다.
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
    <div className="grid min-h-screen bg-base-200 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
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
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-lg space-y-6">
          <div className="flex items-center gap-2 lg:hidden">
            <Logo />
            <span className="text-[15px] font-bold">{m.appTitle}</span>
          </div>
          <section className="space-y-5 rounded-box border border-base-300 bg-base-100 p-8 shadow-sm">
            <header className="space-y-1">
              <h1 className="text-2xl font-bold">{title}</h1>
              {lead && <p className="text-sm text-base-content/60">{lead}</p>}
            </header>
            {children}
          </section>
        </div>
      </div>
    </div>
  );
}
