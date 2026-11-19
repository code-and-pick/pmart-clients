// 목 모드 시험 계정 고르기(2026-11-20 사용자 "한참 봐야 자기 버튼이 어딨는지 알 것 같다 — 운영자가 20명이면?").
// 카드 묶음 대신: 맨 위 검색(이름·역할) → 역할 탭 → 한 줄 목록(이름 왼쪽, 역할 오른쪽). 길어지면 목록 안에서만 스크롤.
// 실서버 로그인은 "직원 계정으로 로그인" 단추 하나라 이 화면은 목 모드에만 나온다.
// 단추 이름(읽기 도구·시험이 찾는 이름)은 예전 그대로 "이름 · 역할" — aria-label.
import { useMemo, useState } from 'react';

import { mockAccounts } from '../../mocks/operators';
import { messages as m } from '../../shared/messages';

type MockAccount = (typeof mockAccounts)[number];
type GroupId = 'admin' | 'product' | 'center' | 'support';
const GROUPS: GroupId[] = ['admin', 'product', 'center', 'support'];

/** 역할 묶음(첫 역할 기준, 역할 없이 센터만이면 센터) */
function groupOf(a: MockAccount): GroupId {
  const roles: readonly string[] = a.roles;
  if (roles.includes('OPERATOR_ADMIN')) return 'admin';
  if (roles.length === 0) return 'center';
  if (roles.some((r) => r === 'MD' || r.endsWith('_APPROVER'))) return 'product';
  return 'support';
}

const roleText = (a: MockAccount) => (a.roles.length > 0 ? a.roles.map((r) => m.shell.roleName[r] ?? r) : a.centers).join(', ');

export function MockAccountPicker({ disabled, onPick }: { disabled: boolean; onPick: (operatorId: string) => void }) {
  const [group, setGroup] = useState<GroupId | 'all'>('all');
  const [q, setQ] = useState('');
  const counts = useMemo(
    () => Object.fromEntries(GROUPS.map((g) => [g, mockAccounts.filter((a) => groupOf(a) === g).length])) as Record<GroupId, number>,
    [],
  );
  const needle = q.trim().toLowerCase();
  const shown = mockAccounts.filter(
    (a) =>
      (group === 'all' || groupOf(a) === group) &&
      (needle === '' || `${a.label} ${roleText(a)} ${a.roles.join(' ')} ${a.centers.join(' ')}`.toLowerCase().includes(needle)),
  );

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">{m.login.mockAccounts}</p>
      <label className="input input-sm w-full">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current opacity-50" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={m.login.searchPlaceholder} aria-label={m.login.searchLabel} className="grow" />
      </label>
      <div role="tablist" aria-label={m.login.groupsLabel} className="tabs tabs-box tabs-sm flex-wrap">
        {(['all', ...GROUPS] as const)
          .filter((g) => g === 'all' || counts[g] > 0)
          .map((g) => (
            <button key={g} type="button" role="tab" aria-selected={group === g} className={`tab ${group === g ? 'tab-active' : ''}`} onClick={() => setGroup(g)}>
              {g === 'all' ? m.login.groupAll : m.login.groups[g]}
              <span className="ml-1 text-xs opacity-60">{g === 'all' ? mockAccounts.length : counts[g]}</span>
            </button>
          ))}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-box border border-dashed border-base-300 p-4 text-center text-sm text-base-content/60">{m.login.noMatch}</p>
      ) : (
        <ul className="max-h-80 divide-y divide-base-300 overflow-y-auto rounded-box border border-base-300">
          {shown.map((a) => (
            <li key={a.operatorId}>
              <button
                type="button"
                aria-label={`${a.label} · ${a.roles.join(', ') || a.centers.join(', ')}`}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-primary/5 focus-visible:bg-primary/10 focus-visible:outline-none disabled:opacity-50"
                disabled={disabled}
                onClick={() => onPick(a.operatorId)}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{a.label}</span>
                <span className="min-w-0 truncate text-xs text-base-content/60">{roleText(a)}</span>
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current opacity-40" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
