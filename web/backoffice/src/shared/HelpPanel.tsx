// 도움말 패널(2026-11-20 AWS 개편 3단계, ADR-0004 · docs/apps/backoffice-ui-guide.md §2 "오른쪽 도움말").
// 화면이 useHelp 로 설명을 걸어 두면 제목 옆 "정보"·위치 줄 오른쪽 ⓘ 로 오른쪽 패널을 연다. 설명이 없는 화면은 둘 다 보이지 않는다(빈 패널을 만들지 않는다).
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

import { messages as m } from './messages';

type Help = { readonly title: string; readonly body: ReactNode };
type Ctx = { readonly help: Help | null; readonly setHelp: (h: Help | null) => void; readonly open: boolean; readonly setOpen: (o: boolean) => void };

const HelpContext = createContext<Ctx | null>(null);

export function HelpProvider({ children }: { readonly children: ReactNode }) {
  const [help, setHelp] = useState<Help | null>(null);
  const [open, setOpen] = useState(false);
  return <HelpContext.Provider value={{ help, setHelp, open, setOpen }}>{children}</HelpContext.Provider>;
}

/** 화면의 도움말을 건다(화면을 떠나면 내린다). id 가 바뀔 때만 다시 건다. 돌려준 open() 은 "정보" 단추가 부른다. */
export function useHelp(id: string, title: string, body: ReactNode): { readonly open: () => void } | null {
  const ctx = useContext(HelpContext);
  const setHelp = ctx?.setHelp;
  useEffect(() => {
    if (!setHelp) return;
    setHelp({ title, body });
    return () => setHelp(null);
    // 설명은 화면마다 고정 글이라 id 로만 다시 건다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, setHelp]);
  return ctx ? { open: () => ctx.setOpen(true) } : null;
}

/** 위치 줄 오른쪽 ⓘ — 설명이 걸린 화면에서만 */
export function HelpToggle() {
  const ctx = useContext(HelpContext);
  if (!ctx?.help) return null;
  return (
    <button type="button" className="btn btn-ghost btn-sm ml-auto h-7 w-7 p-0 text-base-content/70" aria-label={m.listUi.helpTitle} title={ctx.open ? m.listUi.helpClose : m.listUi.helpOpen} aria-expanded={ctx.open} onClick={() => ctx.setOpen(!ctx.open)} data-testid="help-toggle">
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
    </button>
  );
}

/** 오른쪽 패널 자리 — 열렸고 설명이 있을 때만 */
export function HelpPanelSlot() {
  const ctx = useContext(HelpContext);
  if (!ctx?.help || !ctx.open) return null;
  return (
    <aside aria-label={m.listUi.helpTitle} className="sticky top-0 h-screen w-[280px] shrink-0 self-start overflow-y-auto border-l border-base-300 bg-base-100" data-testid="help-panel">
      <div className="flex items-center justify-between border-b border-base-300 px-4 py-3">
        <h2 className="text-base font-bold">{ctx.help.title}</h2>
        <button type="button" className="btn btn-ghost btn-sm h-7 w-7 p-0" aria-label={m.listUi.helpClose} onClick={() => ctx.setOpen(false)}>
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div className="space-y-3 px-4 py-3 text-sm leading-6 text-base-content/85">{ctx.help.body}</div>
    </aside>
  );
}
