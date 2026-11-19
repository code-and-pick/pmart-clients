// 목 모드 시험 계정 고르기(2026-11-20 사용자 — "탭도 길어지는 건 마찬가지. 운영 탭을 누르면 안으로 들어가 운영 관리자가
// 주루룩 뜨고 자기 번호를 검색하면 찾아지게"). 두 단계:
//   ① 역할 목록(세로, 역할마다 인원) + 위에 이름·사번 바로 찾기(전체에서)
//   ② 역할을 누르면 그 안으로 — "← 역할 목록" + 이름·사번 검색 + 그 역할 계정 한 줄 목록(길면 목록 안에서만 스크롤)
// 실서버 로그인은 "직원 계정으로 로그인" 단추 하나라 이 화면은 목 모드에만 나온다.
// 계정 단추 이름(읽기 도구·시험이 찾는 이름)은 예전 그대로 "이름 · 역할" — aria-label.
import { useState } from 'react';

import { MOCK_EMPLOYEE_LABELS } from '../../mocks/hrLabelHandlers';
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
const employeeNo = (a: MockAccount) => MOCK_EMPLOYEE_LABELS[a.operatorId]?.employeeNo ?? '';

function matches(a: MockAccount, needle: string) {
  if (needle === '') return true;
  const hay = [a.label, MOCK_EMPLOYEE_LABELS[a.operatorId]?.name ?? '', employeeNo(a), roleText(a), ...a.roles, ...a.centers].join(' ').toLowerCase();
  return hay.includes(needle);
}

const Chevron = ({ dir = 'right' }: { dir?: 'right' | 'left' }) => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current opacity-50" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={dir === 'right' ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} />
  </svg>
);

function SearchBox({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label className="input h-12 w-full">
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current opacity-50" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      {/* 역할 안으로 들어가면 바로 사번을 치게 autoFocus */}
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={m.login.searchPlaceholder} aria-label={m.login.searchLabel} className="grow" autoFocus={autoFocus} />
    </label>
  );
}

function AccountList({ accounts, disabled, onPick, showRole }: { accounts: readonly MockAccount[]; disabled: boolean; onPick: (id: string) => void; showRole: boolean }) {
  if (accounts.length === 0) {
    return <p className="border-y border-base-300 py-8 text-center text-sm text-base-content/60">{m.login.noMatch}</p>;
  }
  return (
    <ul className="max-h-[26rem] divide-y divide-base-300 overflow-y-auto border-y border-base-300">
      {accounts.map((a) => (
        <li key={a.operatorId}>
          <button
            type="button"
            aria-label={`${a.label} · ${a.roles.join(', ') || a.centers.join(', ')}`}
            className="flex w-full items-center gap-4 px-2 py-4 text-left transition-colors hover:bg-primary/5 focus-visible:bg-primary/10 focus-visible:outline-none disabled:opacity-50"
            disabled={disabled}
            onClick={() => onPick(a.operatorId)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-semibold">{a.label}</span>
              {showRole && <span className="block truncate text-sm text-base-content/60">{roleText(a)}</span>}
            </span>
            <span className="shrink-0 font-mono text-sm text-base-content/60">{employeeNo(a)}</span>
            <Chevron />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function MockAccountPicker({ disabled, onPick }: { disabled: boolean; onPick: (operatorId: string) => void }) {
  const [group, setGroup] = useState<GroupId | null>(null);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();

  // ② 역할 안
  if (group) {
    const inGroup = mockAccounts.filter((a) => groupOf(a) === group);
    return (
      <div className="space-y-4">
        <button
          type="button"
          className="btn btn-ghost btn-sm -ml-2 gap-1 px-2"
          onClick={() => {
            setGroup(null);
            setQ('');
          }}
        >
          <Chevron dir="left" />
          {m.login.backToGroups}
        </button>
        <h2 className="text-xl font-bold">
          {m.login.groups[group]}
          <span className="ml-2 text-sm font-normal text-base-content/60">{m.login.count(inGroup.length)}</span>
        </h2>
        <SearchBox value={q} onChange={setQ} autoFocus />
        <AccountList accounts={inGroup.filter((a) => matches(a, needle))} disabled={disabled} onPick={onPick} showRole={false} />
      </div>
    );
  }

  // ① 역할 목록(검색하면 전체에서 바로)
  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold">{m.login.mockAccounts}</p>
      <SearchBox value={q} onChange={setQ} />
      {needle !== '' ? (
        <AccountList accounts={mockAccounts.filter((a) => matches(a, needle))} disabled={disabled} onPick={onPick} showRole />
      ) : (
        <ul className="divide-y divide-base-300 border-y border-base-300" aria-label={m.login.groupsLabel}>
          {GROUPS.map((g) => {
            const n = mockAccounts.filter((a) => groupOf(a) === g).length;
            if (n === 0) return null;
            return (
              <li key={g}>
                <button type="button" className="flex w-full items-center gap-4 px-2 py-5 text-left transition-colors hover:bg-primary/5 focus-visible:bg-primary/10 focus-visible:outline-none" onClick={() => setGroup(g)}>
                  <span className="flex-1 text-base font-semibold">{m.login.groups[g]}</span>
                  <span className="text-sm text-base-content/60">{m.login.count(n)}</span>
                  <Chevron />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
