// 권한 관리(BO-01, 백엔드 요청 all/2026-11-15-request-permission-and-pending-menus §1) — HR_ADMIN.
// - 직원 찾기: `GET /hr/employees?q=&size=`(직원 목록과 같은 API).
// - 지금 권한: `GET /employee-auth/employees/{operatorId}`(0.7.0 부터 HR_ADMIN 도). effectiveRoles·effectiveCenters 를 보인다(토큰과 같은 계산).
//   404 EMPLOYEE_NOT_FOUND = 계정 발급 전 → "계정 발급 중". 역할 이름은 `GET /employee-auth/roles`.
// - 추가·변경 요청: `POST /hr/employees/{operatorId}/grant-requests`(hr 0.3.0) — 승인을 거친다. 409 GRANT_REQUEST_PENDING = 한 번에 하나.
// - 회수: `POST /employee-auth/employees/{operatorId}/grant-revocations`(0.8.0) — 승인 없이 바로, 사유 필수, 그 직원 세션이 끊긴다(확인을 한 번 더 받는다).
//   회수 버튼은 회수되지 않았고 기한이 남은 줄에만. OPERATOR_ADMIN·HR_ADMIN 줄은 HR_ADMIN 에게 숨긴다(서버도 403 — 운영 관리자만). 자기 자신 줄도 숨긴다.
// 판정은 서버다. 화면은 버튼을 숨기거나 안내만 한다.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { ProblemFailure, request, type EmployeeAccount, type EmployeeGrant, type EmployeeRole } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, formatSeoulDate, QueryState, toUiState, uiStateFromError, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { RequestedGrant } from '../../api/models';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { messages as m } from '../../shared/messages';
import { CenterMultiSelect, useCenters } from '../employees/centers';
import { activeGrants, lastDayOf, lineProblems, needsCenter, overlappingGrants, parseConflict, problemDetail } from '../employees/grantRules';
import { roleLabel, useEmployeeRoles } from '../employees/roles';
import { DataTable, PageHeader } from '../../shared/admin';

const ADMIN_ROLES = ['OPERATOR_ADMIN', 'HR_ADMIN'];

export function PermissionsPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  const list = useQuery({
    queryKey: ['hr', 'employees', 'permissions', q],
    enabled: q !== '',
    queryFn: () => request('GET', api.hr.GET('/hr/employees', { params: { query: { q, size: 50 } } })),
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setParams(draft.trim() ? { q: draft.trim() } : {});
  };
  return (
    <section className="max-w-4xl space-y-4">
      <PageHeader title={m.permissions.title} description={m.permissions.intro} />
      <form className="flex flex-wrap items-end gap-2" onSubmit={onSubmit}>
        <label className="flex flex-col gap-1 text-sm">
          {m.list.q}
          <input className="input input-sm w-64" placeholder={m.list.qHint} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-sm">
          {m.permissions.search}
        </button>
      </form>
      {q !== '' && (
        <QueryState state={toUiState(list, (p) => p.items.length === 0)} onRetry={() => void list.refetch()} emptyText={m.permissions.noResult}>
          {(page) => (
            <DataTable>
              <thead>
                <tr>
                  <th>{m.fields.employeeNo}</th>
                  <th>{m.fields.name}</th>
                  <th>{m.fields.mailAddress}</th>
                  <th>{m.fields.status}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {page.items.map((e) => (
                  <tr key={e.operatorId} data-testid="permission-candidate">
                    <td>{e.employeeNo}</td>
                    <td>{e.name}</td>
                    <td>{e.mailAddress}</td>
                    <td>{m.employmentStatus[e.status]}</td>
                    <td>
                      <Link className="link" to={`/permissions/${encodeURIComponent(e.operatorId)}`}>
                        {m.permissions.pick}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </QueryState>
      )}
    </section>
  );
}

const roleName = (roles: readonly EmployeeRole[] | undefined, code: string) => {
  const r = roles?.find((x) => x.code === code);
  return r ? roleLabel(r) : code;
};

const grantStatus = (g: EmployeeGrant, now: number): 'revoked' | 'ended' | 'live' =>
  g.revokedAt ? 'revoked' : g.validUntil && Date.parse(g.validUntil) <= now ? 'ended' : 'live';

function RevokeRow({ operatorId, grant, onDone }: { readonly operatorId: string; readonly grant: EmployeeGrant; readonly onDone: (a: EmployeeAccount) => void }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const revoke = useCommand(async (v: { reason: string }, key) => {
    const a = await request(
      'POST',
      api.employeeAuth.POST('/employee-auth/employees/{operatorId}/grant-revocations', {
        ...commandParams(key, { path: { operatorId } }),
        body: { grantId: grant.grantId, reason: v.reason },
      }),
    );
    onDone(a);
    return a;
  });
  if (!open) {
    return (
      <button type="button" className="btn btn-xs btn-outline btn-error" onClick={() => setOpen(true)}>
        {m.permissions.revoke}
      </button>
    );
  }
  return (
    <form
      className="space-y-1"
      aria-label={`${m.permissions.revoke} ${grant.role}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim()) return;
        if (revoke.phase.kind === 'rejected') revoke.reset();
        void revoke.run({ reason: reason.trim() });
      }}
    >
      <p role="alert" className="text-xs text-warning">
        {m.permissions.revokeWarn}
      </p>
      <label className="flex flex-col gap-1 text-xs">
        {m.permissions.revokeReason}
        <input className="input input-xs w-56" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="flex gap-1">
        <button type="submit" className="btn btn-xs btn-error" disabled={!reason.trim() || revoke.busy}>
          {m.permissions.revokeConfirm}
        </button>
        <button type="button" className="btn btn-xs" disabled={revoke.busy} onClick={() => setOpen(false)}>
          {m.permissions.cancel}
        </button>
      </div>
      <CommandFeedback command={revoke}>{() => <span className="text-xs text-success">{m.permissions.revokedDone}</span>}</CommandFeedback>
    </form>
  );
}

function AccountView({ operatorId, account, roles, self, canRevokeAdmin }: {
  readonly operatorId: string;
  readonly account: EmployeeAccount;
  readonly roles: readonly EmployeeRole[] | undefined;
  readonly self: boolean;
  readonly canRevokeAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  // 기한 판정 기준 시각 — 화면을 연 때 한 번(렌더마다 바뀌지 않게). 판정은 서버가 한다(지난 줄 회수 409).
  const [now] = useState(() => Date.now());
  const grants = account.grants ?? [];
  const granted = new Set(grants.filter((g) => grantStatus(g, now) === 'live').map((g) => g.role));
  const direct = account.roles.filter((r) => !granted.has(r));
  const onRevoked = (a: EmployeeAccount) => queryClient.setQueryData(['employee-auth', 'employee', operatorId], a);
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[9rem_1fr] gap-1 rounded-box border border-base-300 bg-base-100 p-4 text-sm">
        <dt>{m.permissions.state}</dt>
        <dd data-testid="account-state">{m.permissions.stateName[account.state] ?? account.state}</dd>
        <dt>{m.permissions.effectiveRoles}</dt>
        <dd data-testid="effective-roles">{(account.effectiveRoles ?? []).map((r) => roleName(roles, r)).join(', ') || m.none}</dd>
        <dt>{m.permissions.effectiveCenters}</dt>
        <dd>{(account.effectiveCenters ?? []).join(', ') || m.none}</dd>
        <dt>{m.permissions.lastLogin}</dt>
        <dd>{account.lastLoginAt ? formatSeoul(account.lastLoginAt) : m.none}</dd>
      </dl>
      <h2 className="font-bold">{m.permissions.grants}</h2>
      {grants.length === 0 ? (
        <p className="text-sm text-base-content/60">{m.permissions.noGrants}</p>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>{m.permissions.role}</th>
              <th>{m.permissions.centers}</th>
              <th>{m.permissions.period}</th>
              <th>{m.permissions.approval}</th>
              <th>{m.permissions.status}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {grants.map((g) => {
              const st = grantStatus(g, now);
              const canRevoke = st === 'live' && !self && (canRevokeAdmin || !ADMIN_ROLES.includes(g.role));
              return (
                <tr key={g.grantId} data-testid="grant-row" data-role={g.role}>
                  <td>{roleName(roles, g.role)}</td>
                  <td>{g.centers.join(', ') || m.none}</td>
                  {/* validUntil = 이 시각부터 무효 → 마지막 날은 그 전날(HR-2 §3) */}
                  <td>{`${formatSeoulDate(g.validFrom)} ~ ${lastDayOf(g.validUntil) ?? m.permissions.untilEmployment}`}</td>
                  <td data-testid="grant-approver">{g.approverId.startsWith('RULE:') ? `${m.permissions.autoApproved} · ${g.approvalId}` : `${g.approvalId} · ${g.approverName ?? g.approverId}`}</td>
                  <td>
                    {st === 'revoked'
                      ? m.permissions.revoked(g.revokedByName ?? g.revokedBy ?? m.none, g.revokedAt ? formatSeoul(g.revokedAt) : m.none)
                      : st === 'ended'
                        ? m.permissions.ended
                        : m.permissions.live}
                    {st === 'revoked' && g.revokeReason && <p className="text-xs text-base-content/60">{g.revokeReason}</p>}
                  </td>
                  <td>{canRevoke && <RevokeRow operatorId={operatorId} grant={g} onDone={onRevoked} />}</td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
      {direct.length > 0 && (
        <p className="text-sm">
          <span className="opacity-70">{m.permissions.directRoles}: </span>
          {direct.map((r) => roleName(roles, r)).join(', ')}
        </p>
      )}
    </div>
  );
}

interface Draft {
  readonly role: string;
  readonly centers: readonly string[];
  readonly validFrom: string;
  readonly validTo: string;
}

/** 기간 표시 — 시작 ~ 마지막 날(validUntil 전날, 없으면 "기한 없음") */
const periodText = (g: EmployeeGrant) => `${formatSeoulDate(g.validFrom)} ~ ${lastDayOf(g.validUntil) ?? m.permissions.noEnd}`;

function GrantRequestForm({
  operatorId,
  version,
  roles,
  grants,
}: {
  readonly operatorId: string;
  readonly version: number;
  readonly roles: readonly EmployeeRole[];
  /** 이 직원의 승인된 권한(계정 발급 전이면 빈 목록) — 지금 가진·예정된 권한 표시와 겹침 경고(HR-2 §3) */
  readonly grants: readonly EmployeeGrant[];
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const centers = useCenters();
  const [draft, setDraft] = useState<Draft>({ role: '', centers: [], validFrom: '', validTo: '' });
  const [reason, setReason] = useState('');
  const submit = useCommand(async (v: { grant: RequestedGrant; reason: string; version: number }, key) => {
    const e = await request(
      'POST',
      api.hr.POST('/hr/employees/{operatorId}/grant-requests', { ...commandParams(key, { path: { operatorId }, version: v.version }), body: { grants: [v.grant], reason: v.reason } }),
    );
    await queryClient.invalidateQueries({ queryKey: ['hr', 'employee', operatorId] });
    return e;
  });
  const [now] = useState(() => Date.now());
  const scoped = needsCenter(roles, draft.role);
  const current = activeGrants(grants, now);
  const overlap = overlappingGrants(grants, draft, scoped, now);
  // HR-2: 센터 지정 역할은 센터 1개 이상, 그 밖 역할은 센터를 보내지 않는다
  const ready = draft.role !== '' && reason.trim() !== '' && (!scoped || draft.centers.length > 0);
  const rejected = submit.phase.kind === 'rejected' ? submit.phase.failure : null;
  const problems = lineProblems(rejected, 'grants');
  // 409 GRANT_ALREADY_ACTIVE — details[].reason 의 existingGrantId 로 그 줄을 강조, extension=true 면 연장이라 거절
  const conflicts = problems.filter((p) => p.part === 'line').map((p) => parseConflict(p.reason));
  const conflictIds = new Set(conflicts.flatMap((c) => (c.existingGrantId ? [c.existingGrantId] : [])));
  const extension = conflicts.some((c) => c.extension);
  return (
    <form
      className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4 text-sm"
      aria-label={m.permissions.newRequest}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        if (submit.phase.kind === 'rejected' || submit.phase.kind === 'done') submit.reset();
        void submit.run({
          grant: {
            role: draft.role,
            ...(draft.centers.length > 0 ? { centers: [...draft.centers] } : {}),
            ...(draft.validFrom ? { validFrom: draft.validFrom } : {}),
            ...(draft.validTo ? { validTo: draft.validTo } : {}),
          },
          reason: reason.trim(),
          version,
        });
      }}
    >
      <h2 className="font-bold">{m.permissions.newRequest}</h2>
      <p className="text-xs text-base-content/60">{m.permissions.requestNote}</p>
      <div className="space-y-1" data-testid="current-grants">
        <h3 className="text-xs font-bold">{m.permissions.current}</h3>
        {current.length === 0 ? (
          <p className="text-xs text-base-content/60">{m.permissions.noCurrent}</p>
        ) : (
          <ul className="space-y-0.5 text-xs">
            {current.map((g) => (
              <li
                key={g.grantId}
                data-testid="current-grant"
                data-conflict={conflictIds.has(g.grantId) || overlap.includes(g) ? 'true' : 'false'}
                className={conflictIds.has(g.grantId) ? 'font-bold text-error' : overlap.includes(g) ? 'text-warning' : ''}
              >
                {`${roleName(roles, g.role)} · ${g.centers.join(', ') || m.none} · ${periodText(g)}`}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          {m.register.grantRole}
          <select
            className="select select-sm w-full"
            value={draft.role}
            // 센터가 필요 없는 역할로 바꾸면 고른 센터를 비운다
            onChange={(e) => setDraft({ ...draft, role: e.target.value, ...(needsCenter(roles, e.target.value) ? {} : { centers: [] }) })}
          >
            <option value="">{m.register.chooseRole}</option>
            {roles.map((r) => (
              <option key={r.code} value={r.code}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1">
          {scoped ? (
            <>
              <CenterMultiSelect centers={centers} label={m.register.grantCenters} value={draft.centers} onChange={(next) => setDraft({ ...draft, centers: next })} />
              {draft.centers.length === 0 && <span className="text-xs text-warning">{m.register.roleNeedsCenter}</span>}
            </>
          ) : (
            <p className="mt-6 text-xs text-base-content/60" data-testid="grant-no-center">
              {draft.role ? m.register.noCenterNeeded : m.register.pickRoleFirst}
            </p>
          )}
        </div>
        <label className="flex flex-col gap-1">
          {m.register.grantFrom}
          <input type="date" className="input input-sm" value={draft.validFrom} onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          {m.register.grantTo}
          <input type="date" className="input input-sm" value={draft.validTo} onChange={(e) => setDraft({ ...draft, validTo: e.target.value })} />
        </label>
      </div>
      {overlap.length > 0 && (
        <p role="alert" className="text-xs text-warning" data-testid="grant-overlap">
          {m.permissions.overlapWarn(lastDayOf(overlap[0]?.validUntil) ?? m.permissions.noEnd)}
        </p>
      )}
      <label className="flex flex-col gap-1">
        {m.permissions.requestReason}
        <input className="input input-sm w-full" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-primary btn-sm" disabled={!ready || submit.busy}>
        {m.permissions.submit}
      </button>
      {problems
        .filter((p) => p.part === 'role' || p.part === 'centers' || p.part === 'list')
        .map((p, k) => (
          <p key={k} role="alert" className="text-xs text-error" data-testid="grant-line-problem">
            {m.register.lineProblem[p.part]}
          </p>
        ))}
      {/* 서버 문장(400·409 detail)은 그대로, 연장 거절이면 연장은 아직 없다는 안내(HR-2 §4 — 연장 버튼은 만들지 않는다) */}
      {problemDetail(rejected) && (
        <p className="text-xs text-error" data-testid="grant-problem-detail">
          {problemDetail(rejected)}
        </p>
      )}
      {extension && <p className="text-xs opacity-80">{m.permissions.noExtension}</p>}
      <CommandFeedback command={submit}>{() => <p className="text-xs text-success">{m.permissions.submitted}</p>}</CommandFeedback>
    </form>
  );
}

export function PermissionDetailPage() {
  const { operatorId = '' } = useParams();
  const api = useApi();
  const { session } = useSession();
  const roles = useEmployeeRoles();
  const employee = useQuery({
    queryKey: ['hr', 'employee', operatorId],
    queryFn: () => request('GET', api.hr.GET('/hr/employees/{operatorId}', { params: { path: { operatorId } } })),
  });
  const account = useQuery({
    queryKey: ['employee-auth', 'employee', operatorId],
    retry: false,
    queryFn: () => request('GET', api.employeeAuth.GET('/employee-auth/employees/{operatorId}', { params: { path: { operatorId } } })),
  });
  const self = session?.subject === operatorId;
  const canRevokeAdmin = session?.roles.includes('OPERATOR_ADMIN') ?? false;
  const accountPending = account.error instanceof ProblemFailure && account.error.problem.code === 'EMPLOYEE_NOT_FOUND';

  return (
    <section className="max-w-5xl space-y-4">
      <QueryState state={toUiState(employee)} onRetry={() => void employee.refetch()}>
        {(e) => {
          const pending = (e.requestedGrants ?? []).some((g) => g.submission === 'PENDING' || g.submission === 'SUBMITTED');
          return (
            <>
              <PageHeader title={`${m.permissions.title} — ${e.name} (${e.employeeNo})`} />
              <p className="text-sm text-base-content/60">{`${e.mailAddress} · ${m.employmentStatus[e.status]}`}</p>

              <h2 className="font-bold">{m.permissions.account}</h2>
              {accountPending ? (
                <p role="status" className="alert text-sm">
                  {m.permissions.accountPending}
                </p>
              ) : account.isError ? (
                <QueryState state={uiStateFromError(account.error)} onRetry={() => void account.refetch()}>
                  {() => null}
                </QueryState>
              ) : (
                <QueryState state={toUiState(account)} onRetry={() => void account.refetch()}>
                  {(a) => <AccountView operatorId={operatorId} account={a} roles={roles.data} self={self} canRevokeAdmin={canRevokeAdmin} />}
                </QueryState>
              )}

              <h2 className="font-bold">{m.permissions.requests}</h2>
              {(e.requestedGrants ?? []).length === 0 ? (
                <p className="text-sm text-base-content/60">{m.permissions.noRequests}</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {(e.requestedGrants ?? []).map((g, i) => (
                    <li key={`${g.role}-${i}`} className="rounded-box border border-base-300 bg-base-100 p-2" data-testid="grant-request">
                      {`${roleName(roles.data, g.role)} · ${g.centers.join(', ') || m.none} · `}
                      <span data-submission={g.submission}>{m.grantSubmission[g.submission]}</span>
                      {g.approvalRef ? ` · ${g.approvalRef}` : ''}
                    </li>
                  ))}
                </ul>
              )}

              {/* 본인 권한 요청은 서버가 403(hr-service) — 폼 대신 안내 */}
              {self && (
                <p role="note" className="text-sm text-base-content/60" data-testid="self-grant-note">
                  {m.permissions.selfNote}
                </p>
              )}
              {!self &&
                (pending ? (
                  <p className="text-sm text-base-content/60">{m.permissions.pendingNote}</p>
                ) : roles.isSuccess ? (
                  <GrantRequestForm operatorId={operatorId} version={e.version} roles={roles.data} grants={account.data?.grants ?? []} />
                ) : (
                  <QueryState state={toUiState(roles)} onRetry={() => void roles.refetch()}>
                    {() => null}
                  </QueryState>
                ))}
            </>
          );
        }}
      </QueryState>
      <Link className="link text-sm" to="/permissions">
        {m.permissions.back}
      </Link>
    </section>
  );
}
