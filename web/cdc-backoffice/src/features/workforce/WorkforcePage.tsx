// 작업자·인력 — cdc-outbound 0.29.0 WF-2(백엔드 회신 2026-11-26-reply-kpi-workforce, 사용자 "시뮬레이션에서 정한 대로").
// - 근무조 `GET /cdcs/{cdcId}/shifts`(근무조·시각·휴게·근거), 현황 `GET /cdcs/{cdcId}/staffing?date=`(근무조 × 층 × 직무: 계획·배치·지금 출근).
// - 배치 목록 `GET …/shift-assignments?date=`, 배치 `POST …/shift-assignments`(CDC_SUPERVISOR, 멱등키), 출근·퇴근 `…/{id}/check-ins·check-outs`.
// 계획 인원은 시뮬레이터 값(참고) — 넘치거나 모자라도 막지 않고 색으로만 보인다. 작업자 이름은 서버에 없어 직원 정보(Who)로 찾는다.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/cdc-outbound';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { Who } from '../../shared/OperatorLabel';
import { AssignmentDetail } from './AssignmentDetail';

const t = messages.workforce;
type S = components['schemas'];
type Role = S['WorkRole'];
type Cell = S['StaffingCell'];
type Assignment = S['ShiftAssignment'];
/** 현황 표에서 고른 칸(근무조 · 층 · 직무) — 아래 배치 목록 거르기 */
interface CellKey {
  readonly shiftCode: string;
  readonly floor: string;
  readonly role: string;
}
const ROLES: readonly Role[] = ['FC', 'SORT', 'JOCKEY', 'REPLENISH', 'DPS', 'INSPECTOR', 'NIGHT_JOCKEY', 'LOADER'];
const FLOORS = ['5', '6', '7', 'ALL'] as const;
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const key = (cdcId: string) => ['cdc', cdcId, 'workforce'] as const;

/** `/c/:cdcId/workers` */
export function WorkforceMenu({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const [today] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()));
  const date = isDate(params.get('date')) ? params.get('date')! : today;
  const shifts = useQuery({ queryKey: [...key(cdcId), 'shifts'], queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/shifts', { params: { path: { cdcId } } })) });
  const staffing = useQuery({
    queryKey: [...key(cdcId), 'staffing', date],
    refetchInterval: 30_000,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/staffing', { params: { path: { cdcId }, query: { date } } })),
  });
  const [assigning, setAssigning] = useState(false);
  const [cell, setCell] = useState<CellKey | null>(null);
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1>{messages.menus.workers}</h1>
          <p className="max-w-4xl text-sm text-base-content/60">{t.lead}</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            {t.date}
            <input
              type="date"
              className="input input-sm w-40"
              value={date}
              onChange={(e) => {
                const q = new URLSearchParams(params);
                q.set('date', e.target.value);
                setParams(q, { replace: true });
              }}
              data-testid="workforce-date"
            />
          </label>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setAssigning(!assigning)} data-testid="assign-open">
            {t.newAssign}
          </button>
          <Link className="btn btn-sm btn-ghost" to={`${centerPath(cdcId, 'reports')}?v=workers&from=${date}&to=${date}`}>
            {t.throughputLink}
          </Link>
        </div>
      </div>
      {assigning && <AssignForm cdcId={cdcId} date={date} shiftCodes={(shifts.data?.shifts ?? []).map((s) => ({ code: s.shiftCode ?? '', name: s.name ?? '' }))} onClose={() => setAssigning(false)} />}
      <QueryState state={toUiState(shifts, () => false)} onRetry={() => void shifts.refetch()}>
        {(sd) => (
          <QueryState state={toUiState(staffing, () => false)} onRetry={() => void staffing.refetch()}>
            {(st) => (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-3" data-testid="shift-cards">
                {sd.shifts.map((s) => (
                  <ShiftCard key={s.shiftCode} shift={s} cells={st.cells.filter((c) => c.shiftCode === s.shiftCode)} picked={cell} onPick={setCell} />
                ))}
              </div>
            )}
          </QueryState>
        )}
      </QueryState>
      {shifts.data?.shifts[0]?.source && <p className="text-xs text-base-content/55">{t.source(shifts.data.shifts[0].source)}</p>}
      <Assignments cdcId={cdcId} date={date} cell={cell} onClear={() => setCell(null)} shiftNames={Object.fromEntries((shifts.data?.shifts ?? []).map((s) => [s.shiftCode ?? '', s.name ?? '']))} />
    </section>
  );
}

function ShiftCard({ shift, cells, picked, onPick }: { readonly shift: { shiftCode?: string; name?: string; startTime?: string; endTime?: string; breaks?: string[] }; readonly cells: readonly Cell[]; readonly picked: CellKey | null; readonly onPick: (c: CellKey | null) => void }) {
  const sum = (k: 'planned' | 'assigned' | 'checkedIn') => cells.reduce((a, c) => a + (c[k] ?? 0), 0);
  const floors = FLOORS.filter((f) => cells.some((c) => c.floor === f));
  return (
    <article className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3" data-testid="shift-card">
      <header>
        <h2 className="text-base font-semibold">
          {shift.name} <span className="text-sm font-normal text-base-content/60">{t.hours(shift.startTime ?? '', shift.endTime ?? '')}</span>
        </h2>
        <p className="text-xs text-base-content/55">{t.breaks(shift.breaks ?? [])}</p>
        <p className="text-sm" data-testid="shift-totals">
          {t.totals(sum('planned'), sum('assigned'), sum('checkedIn'))}
        </p>
      </header>
      <table className="table table-xs">
        <thead>
          <tr>
            <th>{t.floor}</th>
            <th>{t.role}</th>
            <th className="text-right">{t.planned}</th>
            <th className="text-right">{t.assigned}</th>
            <th className="text-right">{t.checkedIn}</th>
          </tr>
        </thead>
        <tbody>
          {floors.flatMap((f) =>
            cells
              .filter((c) => c.floor === f)
              .sort((a, b) => ROLES.indexOf(a.role ?? 'FC') - ROLES.indexOf(b.role ?? 'FC'))
              .map((c, i) => {
                const planned = c.planned ?? 0;
                const assigned = c.assigned ?? 0;
                const tone = assigned > planned ? 'text-warning' : assigned < planned ? 'text-base-content/50' : 'text-success';
                return (
                  <tr key={`${f}-${c.role}`} data-testid="staffing-row" className={`cursor-pointer hover ${picked && picked.shiftCode === c.shiftCode && picked.floor === c.floor && picked.role === c.role ? 'bg-primary/10' : ''}`} onClick={() => onPick(picked && picked.shiftCode === c.shiftCode && picked.floor === c.floor && picked.role === c.role ? null : { shiftCode: c.shiftCode ?? '', floor: c.floor ?? '', role: c.role ?? '' })}>
                    <td className="whitespace-nowrap">{i === 0 ? t.floorLabel(f) : ''}</td>
                    <td className="whitespace-nowrap">{t.roles[c.role ?? ''] ?? c.role}</td>
                    <td className="text-right tabular-nums">{planned}</td>
                    <td className={`text-right tabular-nums ${tone}`} title={assigned > planned ? t.over : assigned < planned ? t.under : ''}>
                      {assigned}
                    </td>
                    <td className="text-right tabular-nums">{c.checkedIn ?? 0}</td>
                  </tr>
                );
              }),
          )}
        </tbody>
      </table>
    </article>
  );
}

function Assignments({ cdcId, date, shiftNames, cell, onClear }: { readonly cdcId: string; readonly date: string; readonly shiftNames: Readonly<Record<string, string>>; readonly cell: CellKey | null; readonly onClear: () => void }) {
  const api = useApi();
  const query = useQuery({
    queryKey: [...key(cdcId), 'assignments', date],
    refetchInterval: 30_000,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/shift-assignments', { params: { path: { cdcId }, query: { date } } })),
  });
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{t.assignments}</h2>
        {cell && (
          <span className="badge badge-primary badge-outline gap-1" data-testid="assignment-filter">
            {t.filtered(`${shiftNames[cell.shiftCode ?? ''] ?? cell.shiftCode} · ${t.floorLabel(cell.floor ?? '')} · ${t.roles[cell.role ?? ''] ?? cell.role}`)}
            <button type="button" className="btn btn-ghost btn-xs" onClick={onClear}>
              {t.clearFilter}
            </button>
          </span>
        )}
      </div>
      <p className="text-xs text-base-content/60">{t.rowHint}</p>
      <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={t.noAssignments}>
        {(data) => (
          <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
            <table className="table table-sm" data-testid="assignment-table">
              <thead>
                <tr>
                  <th>{t.shift}</th>
                  <th>{t.worker}</th>
                  <th>{t.floor}</th>
                  <th>{t.role}</th>
                  <th>{t.in}</th>
                  <th>{t.out}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.filter((a) => !cell || (a.shiftCode === cell.shiftCode && a.floor === cell.floor && a.role === cell.role)).map((a) => (
                  <AssignmentRow key={a.assignmentId} cdcId={cdcId} a={a} shiftName={shiftNames[a.shiftCode ?? ''] ?? a.shiftCode ?? ''} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </section>
  );
}

function AssignmentRow({ cdcId, a, shiftName }: { readonly cdcId: string; readonly a: Assignment; readonly shiftName: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const cmd = useCommand(async (op: 'in' | 'out', k) => {
    const p = commandParams(k, { path: { cdcId, assignmentId: a.assignmentId ?? '' } });
    return op === 'in'
      ? request('POST', api.outbound.POST('/cdcs/{cdcId}/shift-assignments/{assignmentId}/check-ins', p))
      : request('POST', api.outbound.POST('/cdcs/{cdcId}/shift-assignments/{assignmentId}/check-outs', p));
  });
  const run = (op: 'in' | 'out') =>
    void cmd.run(op).then((p) => {
      if (p.kind === 'done') void qc.invalidateQueries({ queryKey: key(cdcId) });
    });
  const [open, setOpen] = useState(false);
  return (
    <>
    <tr data-testid="assignment-row" className="cursor-pointer hover" onClick={() => setOpen(!open)} aria-expanded={open}>
      <td className="whitespace-nowrap">
        <span aria-hidden className="mr-1 inline-block w-3 text-base-content/50">
          {open ? '▾' : '▸'}
        </span>
        {shiftName}
      </td>
      <td>
        <Who id={a.workerId} />
      </td>
      <td className="whitespace-nowrap">{t.floorLabel(a.floor ?? '')}</td>
      <td className="whitespace-nowrap">{t.roles[a.role ?? ''] ?? a.role}</td>
      <td className="whitespace-nowrap">{a.checkInAt ? formatSeoul(a.checkInAt) : messages.none}</td>
      <td className="whitespace-nowrap">{a.checkOutAt ? formatSeoul(a.checkOutAt) : messages.none}</td>
      <td className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
        {!a.checkInAt && (
          <button type="button" className="btn btn-xs btn-primary" disabled={cmd.busy} onClick={() => run('in')} data-testid="check-in">
            {t.checkIn}
          </button>
        )}
        {a.checkInAt && !a.checkOutAt && (
          <button type="button" className="btn btn-xs" disabled={cmd.busy} onClick={() => run('out')} data-testid="check-out">
            {t.checkOut}
          </button>
        )}
        <CommandFeedback command={cmd}>{() => null}</CommandFeedback>
      </td>
    </tr>
    {open && (
      <tr>
        <td colSpan={7} className="pm-detail bg-base-200/50">
          <AssignmentDetail cdcId={cdcId} a={a} />
        </td>
      </tr>
    )}
    </>
  );
}

function AssignForm({ cdcId, date, shiftCodes, onClose }: { readonly cdcId: string; readonly date: string; readonly shiftCodes: readonly { code: string; name: string }[]; readonly onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [f, setF] = useState({ shiftCode: '', workerId: '', floor: '5' as (typeof FLOORS)[number], role: 'FC' as Role });
  const shiftCode = f.shiftCode || shiftCodes[0]?.code || '';
  // 작업자 후보: 지금 위치가 잡힌 작업자(workers) — 없는 ID 도 직접 넣을 수 있다
  const workers = useQuery({ queryKey: ['cdc', cdcId, 'workers', 'all'], queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/workers', { params: { path: { cdcId } } })) });
  const cmd = useCommand(async (body: { workDate: string; shiftCode: string; workerId: string; floor: (typeof FLOORS)[number]; role: Role }, k) =>
    request('POST', api.outbound.POST('/cdcs/{cdcId}/shift-assignments', { ...commandParams(k, { path: { cdcId } }), body })),
  );
  const valid = shiftCode && f.workerId.trim();
  return (
    <form
      className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3"
      data-testid="assign-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void cmd.run({ workDate: date, shiftCode, workerId: f.workerId.trim(), floor: f.floor, role: f.role }).then((p) => {
          if (p.kind === 'done') void qc.invalidateQueries({ queryKey: key(cdcId) });
        });
      }}
    >
      <p className="text-xs text-base-content/60">{t.assignHint}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          {t.shift}
          <select className="select select-sm w-32" value={shiftCode} onChange={(e) => setF({ ...f, shiftCode: e.target.value })} data-testid="assign-shift">
            {shiftCodes.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.worker}
          <input className="input input-sm w-48 font-mono" list="workforce-worker-ids" value={f.workerId} onChange={(e) => setF({ ...f, workerId: e.target.value })} data-testid="assign-worker" />
          <datalist id="workforce-worker-ids">
            {(workers.data?.workers ?? []).map((w) => (
              <option key={w.workerId} value={w.workerId} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.floor}
          <select className="select select-sm w-28" value={f.floor} onChange={(e) => setF({ ...f, floor: e.target.value as (typeof FLOORS)[number] })} data-testid="assign-floor">
            {FLOORS.map((x) => (
              <option key={x} value={x}>
                {t.floorLabel(x)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.role}
          <select className="select select-sm w-36" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })} data-testid="assign-role">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t.roles[r]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!valid || cmd.busy} data-testid="assign-go">
          {t.go}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
          {t.close}
        </button>
      </div>
      <CommandFeedback command={cmd}>
        {() => (
          <p role="status" className="alert alert-info py-1 text-sm">
            {t.done}
          </p>
        )}
      </CommandFeedback>
    </form>
  );
}
