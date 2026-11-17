// 본사 부서(hr 0.3.0, 백엔드 알림 hr-backoffice/2026-11-15-notice-role-list-and-departments §2).
// - 목록 `GET /hr/departments`(HR_ADMIN, 코드 오름차순, 퇴사 아닌 소속 직원 수). 직원 등록·소속 변경에서 처음 보는 코드는 서버가 목록에 더한다.
// - 이름 붙이기 `PUT /hr/departments/{code}` {name?}(60자, 비우면 지움, 없는 코드면 만듦) — Idempotency-Key·X-Source-System.
// 소속 입력은 목록에서 고르되 새 코드도 입력할 수 있다. 목록을 못 불러오면 빈 목록이 아니라 안내 + 직접 입력.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/hr';
import { CODE_PATTERN } from '../../api/models';
import { useApi } from '../../app/ApiContext';
import { messages as m } from '../../shared/messages';
import { DataTable, PageHeader } from '../../shared/admin';

export type Department = components['schemas']['Department'];

export function useDepartments() {
  const api = useApi();
  return useQuery({
    queryKey: ['hr', 'departments'],
    staleTime: 60_000,
    queryFn: async (): Promise<readonly Department[]> => (await request('GET', api.hr.GET('/hr/departments', {}))).items,
  });
}

/** "이름 (코드)" — 이름이 없으면 코드 */
export const departmentLabel = (d: Department) => (d.name ? `${d.name} (${d.code})` : d.code);

/** 소속 = 본사 부서일 때의 코드 입력: 목록(datalist)에서 고르거나 새 코드를 친다 */
export function DepartmentInput({ value, onChange }: { readonly value: string; readonly onChange: (code: string) => void }) {
  const departments = useDepartments();
  const known = departments.data?.find((d) => d.code === value);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label className="flex flex-col gap-1">
        {m.fields.departmentCode}
        <input
          className="input input-sm w-full max-w-xs"
          maxLength={64}
          list="hr-departments"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
        />
      </label>
      <datalist id="hr-departments">
        {(departments.data ?? []).map((d) => (
          <option key={d.code} value={d.code}>
            {departmentLabel(d)}
          </option>
        ))}
      </datalist>
      {departments.isError && <span className="text-warning text-xs">{m.departments.loadFailed}</span>}
      {known?.name && <span className="text-xs text-base-content/60" data-testid="department-name">{known.name}</span>}
      {departments.isSuccess && value !== '' && !known && CODE_PATTERN.test(value) && <span className="text-xs text-base-content/60">{m.departments.newCode}</span>}
    </div>
  );
}

function NameEditor({ department }: { readonly department: Department }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [name, setName] = useState(department.name ?? '');
  const save = useCommand(async (v: { name: string }, key) => {
    const r = await request('PUT', api.hr.PUT('/hr/departments/{code}', { ...commandParams(key, { path: { code: department.code } }), body: v.name ? { name: v.name } : {} }));
    await queryClient.invalidateQueries({ queryKey: ['hr', 'departments'] });
    return r;
  });
  const changed = name.trim() !== (department.name ?? '');
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!changed) return;
        if (save.phase.kind === 'rejected' || save.phase.kind === 'done') save.reset();
        void save.run({ name: name.trim() });
      }}
    >
      <input className="input input-xs w-48" maxLength={60} aria-label={m.departments.nameOf(department.code)} value={name} onChange={(e) => setName(e.target.value)} />
      <button type="submit" className="btn btn-xs" disabled={!changed || save.busy}>
        {m.departments.save}
      </button>
      <CommandFeedback command={save}>{() => <span className="text-xs text-success">{m.departments.saved}</span>}</CommandFeedback>
    </form>
  );
}

function AddDepartment() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const add = useCommand(async (v: { code: string; name: string }, key) => {
    const r = await request('PUT', api.hr.PUT('/hr/departments/{code}', { ...commandParams(key, { path: { code: v.code } }), body: v.name ? { name: v.name } : {} }));
    await queryClient.invalidateQueries({ queryKey: ['hr', 'departments'] });
    setCode('');
    setName('');
    return r;
  });
  const ok = CODE_PATTERN.test(code);
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-box border border-base-300 bg-base-100 p-3 text-sm"
      aria-label={m.departments.add}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        if (add.phase.kind === 'rejected' || add.phase.kind === 'done') add.reset();
        void add.run({ code, name: name.trim() });
      }}
    >
      <label className="flex flex-col gap-1">
        {m.departments.code}
        <input className="input input-sm w-36" maxLength={64} value={code} onChange={(e) => setCode(e.target.value.trim())} />
      </label>
      <label className="flex flex-col gap-1">
        {m.departments.name}
        <input className="input input-sm w-48" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-sm" disabled={!ok || add.busy}>
        {m.departments.add}
      </button>
      {code !== '' && !ok && <p className="text-error text-xs">{m.register.codeInvalid}</p>}
      <CommandFeedback command={add}>{() => <span className="text-xs text-success">{m.departments.saved}</span>}</CommandFeedback>
    </form>
  );
}

export function DepartmentsPage() {
  const departments = useDepartments();
  return (
    <section className="max-w-3xl space-y-4">
      <PageHeader title={m.departments.title} description={m.departments.intro} />
      <QueryState state={toUiState(departments, (d) => d.length === 0)} onRetry={() => void departments.refetch()} emptyText={m.departments.empty}>
        {(items) => (
          <DataTable>
            <thead>
              <tr>
                <th>{m.departments.code}</th>
                <th>{m.departments.name}</th>
                <th>{m.departments.count}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.code} data-testid="department-row">
                  <td>{d.code}</td>
                  <td>
                    <NameEditor key={`${d.code}:${d.name ?? ''}`} department={d} />
                  </td>
                  <td>{d.employeeCount ?? m.none}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </QueryState>
      <AddDepartment />
    </section>
  );
}
