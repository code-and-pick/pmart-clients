// 머리줄 직원 바로 찾기(2026-11-19 사용자 "백오피스 화면이랑 같게" — 백오피스 번호로 바로 찾기와 같은 자리·모양·Ctrl+K).
// 인사 앱은 찾을 것이 직원 하나라, 넣은 말(이름·메일 ID·사번 앞부분)로 직원 목록을 찾는다(목록과 같은 GET /hr/employees?q=). 판정은 서버.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { messages as m } from '../shared/messages';

export function QuickFind() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    setValue('');
    input.current?.blur();
    void navigate(`/employees?${new URLSearchParams({ q }).toString()}`);
  };
  return (
    <form className="relative hidden md:block" role="search" onSubmit={submit} data-testid="quick-find">
      <label className="input input-sm w-72 gap-2 bg-base-200/60">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current opacity-50" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input ref={input} aria-label={m.quickFind.label} placeholder={m.quickFind.placeholder} value={value} maxLength={60} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (setValue(''), e.currentTarget.blur())} />
        <kbd className="kbd kbd-xs">Ctrl K</kbd>
      </label>
    </form>
  );
}
