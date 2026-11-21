// 직원 등록(POST /hr/employees) — 한 화면에서 기본 정보와 요청 권한을 받는다(handoff 2026-11-13 §2).
// 201 = 등록됨(계정 발급은 뒤에서 진행) → 상세 화면에서 발급 단계를 본다. 입력 검사는 입력 도움일 뿐, 판정은 서버(400·409).
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { CommandFeedback } from '../../shared/Feedback';
import { commandParams } from '../../api/command';
import {
  EMPLOYMENT_TYPES,
  MAIL_ID_PATTERN,
  type EmployeeRegistration,
  type EmploymentType,
  type RequestedGrant,
} from '../../api/models';
import { useApi } from '../../app/ApiContext';
import { LeaveGuard } from '../../shared/LeaveGuard';
import { TitleIcon } from '../../shared/TitleIcon';
import { messages as m } from '../../shared/messages';
import { AffiliationFields, toAffiliation, type AffiliationDraft } from './AffiliationFields';
import { CenterMultiSelect, useCenters } from './centers';
import { fieldRejected, lineProblems, needsCenter, problemDetail, prohibitedInName } from './grantRules';
import { roleLabel, useEmployeeRoles } from './roles';
import { PageHeader } from '../../shared/admin';

interface GrantDraft {
  readonly id: number;
  readonly role: string;
  readonly centers: readonly string[];
  readonly validFrom: string;
  readonly validTo: string;
  readonly reason: string;
}

/** 빈 값은 보내지 않는다(계약: 비운 기간 = 근무 기간) */
function toGrant(g: GrantDraft): RequestedGrant {
  return {
    role: g.role,
    ...(g.centers.length > 0 ? { centers: [...g.centers] } : {}),
    ...(g.validFrom ? { validFrom: g.validFrom } : {}),
    ...(g.validTo ? { validTo: g.validTo } : {}),
    ...(g.reason.trim() ? { reason: g.reason.trim() } : {}),
  };
}

export function EmployeeRegisterPage() {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const centers = useCenters();
  const roles = useEmployeeRoles();
  const [name, setName] = useState('');
  const [mailId, setMailId] = useState('');
  const [employmentType, setEmploymentType] = useState<EmploymentType>('REGULAR');
  const [affiliation, setAffiliation] = useState<AffiliationDraft>({ type: 'HQ_DEPARTMENT', code: '' });
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [grants, setGrants] = useState<readonly GrantDraft[]>([]);
  const [nextId, setNextId] = useState(1);

  const cmd = useCommand(async (body: EmployeeRegistration, key) => {
    const created = await request('POST', api.hr.POST('/hr/employees', { ...commandParams(key), body }));
    await queryClient.invalidateQueries({ queryKey: ['hr', 'employees'] });
    void navigate(`/employees/${encodeURIComponent(created.operatorId)}`);
    return created;
  });

  const regular = employmentType === 'REGULAR';
  const mailIdBad = mailId !== '' && !MAIL_ID_PATTERN.test(mailId);
  const aff = toAffiliation(affiliation);
  const roleList = roles.data ?? [];
  // HR-2: 센터 지정 역할은 센터 1개 이상(그 밖 역할은 센터를 보내지 않는다), 한 요청에 역할은 한 번
  // 기간 순서(2026-11-20): 종료일이 시작일보다 앞이면 보내지 않는다.
  // 권한 기간은 hr 0.9.1 처럼 비운 날짜를 근무 기간(근무 시작일·계약 종료일)으로 채운 값으로 본다(서버도 그렇게 400) — 2026-11-21 점검
  const badOrder = (from: string, to: string) => from !== '' && to !== '' && to < from;
  const workEnd = regular ? '' : endDate;
  const grantFrom = (g: GrantDraft) => g.validFrom || startDate;
  const grantTo = (g: GrantDraft) => g.validTo || workEnd;
  const badGrant = (g: GrantDraft) => badOrder(grantFrom(g), grantTo(g));
  const grantsOk = grants.every((g) => g.role !== '' && (!needsCenter(roleList, g.role) || g.centers.length > 0) && !badGrant(g));
  // hr 0.5.1: 이름에 쓸 수 없는 문자(대괄호 등) — 미리 알리고 등록을 막는다(판정은 서버 400 field name)
  const badChars = prohibitedInName(name);
  const badWork = !regular && badOrder(startDate, endDate);
  const ready = name.trim() !== '' && badChars.length === 0 && MAIL_ID_PATTERN.test(mailId) && aff !== null && startDate !== '' && (regular || endDate !== '') && !badWork && grantsOk;
  const rejected = cmd.phase.kind === 'rejected' ? cmd.phase.failure : null;
  const problems = lineProblems(rejected, 'requestedGrants');
  const nameRejected = fieldRejected(rejected, 'name');

  // 떠날 때 경고(2026-11-18 백오피스와 같음): 하나라도 넣었으면 묻는다 — 저장 중·저장 뒤(상세로 이동)는 묻지 않는다
  const dirty = name !== '' || mailId !== '' || affiliation.code !== '' || startDate !== '' || endDate !== '' || grants.length > 0;
  const leaving = cmd.phase.kind === 'running' || cmd.phase.kind === 'done';

  const patchGrant = (id: number, patch: Partial<GrantDraft>) => setGrants((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));

  return (
    <section className="max-w-3xl space-y-4">
      <PageHeader title={m.register.title} description={m.register.intro} />
      <LeaveGuard when={dirty && !leaving} />
      {/* 흐름 안내(2026-11-19 — 백오피스 상품 등록 단계 줄처럼): 이 화면은 1·2, 3 은 등록 뒤 서버가 자동으로 */}
      <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label={m.register.flowLabel} data-testid="register-flow">
        {m.register.flow.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            {i > 0 && <span className="text-base-content/30" aria-hidden="true">→</span>}
            <span className={`flex h-5 w-5 items-center justify-center rounded-full font-bold ${i === 0 ? 'bg-primary text-primary-content' : 'bg-base-300 text-base-content/60'}`}>{i + 1}</span>
            <span className={i === 0 ? 'font-semibold' : 'text-base-content/60'}>{label}</span>
          </li>
        ))}
      </ol>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready || !aff) return;
          if (cmd.phase.kind === 'rejected') cmd.reset();
          void cmd.run({
            name: name.trim(),
            mailId,
            employmentType,
            affiliation: aff,
            startDate,
            ...(!regular && endDate ? { endDate } : {}),
            ...(grants.length > 0 ? { requestedGrants: grants.map(toGrant) } : {}),
          });
        }}
      >
        <div className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4">
          <h2 className="flex items-center gap-2 font-bold"><TitleIcon name="user" />{m.register.basic}</h2>
          <div className="flex flex-col gap-1 text-sm">
            <label className="flex flex-col gap-1">
              {m.fields.name}
              <input
                className={`input input-sm w-full max-w-xs ${badChars.length > 0 || nameRejected ? 'input-error' : ''}`}
                maxLength={60}
                aria-invalid={badChars.length > 0 || nameRejected}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {badChars.length > 0 && (
              <span role="alert" className="text-xs text-error" data-testid="name-prohibited">
                {m.register.nameProhibited(badChars.join(' '))}
              </span>
            )}
            {/* 서버가 이름 칸을 거절하면(400 field name) 서버 문장을 칸 아래에 그대로 */}
            {nameRejected && badChars.length === 0 && (
              <span role="alert" className="text-xs text-error" data-testid="name-rejected">
                {problemDetail(rejected) ?? m.register.nameRejected}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <label className="flex flex-col gap-1">
              {m.fields.mailId}
              <span className="flex items-center gap-1">
                <input
                  className="input input-sm w-full max-w-xs"
                  maxLength={32}
                  autoCapitalize="none"
                  spellCheck={false}
                  value={mailId}
                  onChange={(e) => setMailId(e.target.value.trim())}
                />
                <span className="opacity-70">@pmart.com</span>
              </span>
            </label>
            <p className={mailIdBad ? 'text-error text-xs' : 'text-xs opacity-70'}>{mailIdBad ? m.register.mailIdInvalid : m.register.mailIdHint}</p>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            {m.fields.employmentType}
            <select
              className="select select-sm w-full max-w-xs"
              value={employmentType}
              onChange={(e) => {
                const next = EMPLOYMENT_TYPES.find((t) => t === e.target.value) ?? 'REGULAR';
                setEmploymentType(next);
                if (next === 'REGULAR') setEndDate(''); // 정규직은 계약 종료일을 비운다
              }}
            >
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {m.employmentType[t]}
                </option>
              ))}
            </select>
          </label>
          <AffiliationFields name="register-affiliation" centers={centers} value={affiliation} onChange={setAffiliation} />
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1 text-sm">
              {m.fields.startDate}
              <input type="date" className="input input-sm" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {m.fields.endDate}
              <input type="date" className="input input-sm" disabled={regular} value={endDate} aria-invalid={badWork} {...(startDate ? { min: startDate } : {})} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </div>
          {badWork && (
            <p role="alert" className="text-xs text-error" data-testid="work-period-order">
              {m.register.periodOrder}
            </p>
          )}
          <p className="text-xs text-base-content/60">{regular ? m.register.endDateRegular : m.register.endDateRequired}</p>
        </div>

        <div className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4">
          <h2 className="flex items-center gap-2 font-bold"><TitleIcon name="shield" />{m.register.grants}</h2>
          <p className="text-xs text-base-content/60">{m.register.grantsNote}</p>
          {/* 역할 목록을 못 받으면 고를 수 없다 — 빈 목록이 아니라 오류 + 다시 시도(권한 추가 버튼도 막는다) */}
          {!roles.isSuccess && (
            <QueryState state={toUiState(roles)} onRetry={() => void roles.refetch()}>
              {() => null}
            </QueryState>
          )}
          {roles.isSuccess && grants.map((g, i) => (
            <fieldset key={g.id} className="grid gap-3 rounded-box border border-base-300 p-3 sm:grid-cols-2">
              <legend className="px-1 text-sm">{`${m.register.grants} ${i + 1}`}</legend>
              <label className="flex flex-col gap-1 text-sm">
                {m.register.grantRole}
                <select
                  className="select select-sm w-full"
                  value={g.role}
                  // 센터가 필요 없는 역할로 바꾸면 고른 센터를 비운다(보내지 않는다)
                  onChange={(e) => patchGrant(g.id, { role: e.target.value, ...(needsCenter(roles.data, e.target.value) ? {} : { centers: [] }) })}
                >
                  <option value="">{m.register.chooseRole}</option>
                  {roles.data.map((r) => {
                    const taken = grants.some((o) => o.id !== g.id && o.role === r.code);
                    return (
                      <option key={r.code} value={r.code} disabled={taken}>
                        {taken ? m.register.roleTaken(roleLabel(r)) : roleLabel(r)}
                      </option>
                    );
                  })}
                </select>
                {needsCenter(roles.data, g.role) && g.centers.length === 0 && <span className="text-xs text-warning">{m.register.roleNeedsCenter}</span>}
              </label>
              {needsCenter(roles.data, g.role) ? (
                <CenterMultiSelect centers={centers} label={m.register.grantCenters} value={g.centers} onChange={(next) => patchGrant(g.id, { centers: next })} />
              ) : (
                <p className="self-end text-xs text-base-content/60" data-testid="grant-no-center">
                  {g.role ? m.register.noCenterNeeded : m.register.pickRoleFirst}
                </p>
              )}
              {problems
                .filter((p) => p.index === i)
                .map((p, k) => (
                  <p key={k} role="alert" className="text-xs text-error sm:col-span-2" data-testid="grant-line-problem">
                    {m.register.lineProblem[p.part]}
                  </p>
                ))}
              <label className="flex flex-col gap-1 text-sm">
                {m.register.grantFrom}
                <input type="date" className="input input-sm" value={g.validFrom} onChange={(e) => patchGrant(g.id, { validFrom: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {m.register.grantTo}
                <input type="date" className="input input-sm" value={g.validTo} aria-invalid={badGrant(g)} {...(g.validFrom ? { min: g.validFrom } : {})} onChange={(e) => patchGrant(g.id, { validTo: e.target.value })} />
              </label>
              {badGrant(g) && (
                <p role="alert" className="text-xs text-error sm:col-span-2" data-testid="grant-period-order">
                  {g.validFrom && g.validTo ? m.register.periodOrder : m.register.periodOrderFilled(grantFrom(g), grantTo(g))}
                </p>
              )}
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                {m.register.grantReason}
                <input className="input input-sm w-full" maxLength={500} value={g.reason} onChange={(e) => patchGrant(g.id, { reason: e.target.value })} />
              </label>
              <div className="flex items-center justify-between sm:col-span-2">
                <span className="text-xs text-base-content/60">{m.register.grantPeriodHint}</span>
                <button type="button" className="btn btn-xs" onClick={() => setGrants((gs) => gs.filter((x) => x.id !== g.id))}>
                  {m.register.removeGrant}
                </button>
              </div>
            </fieldset>
          ))}
          {problems.some((p) => p.index === -1) && (
            <p role="alert" className="text-xs text-error" data-testid="grant-list-problem">
              {m.register.lineProblem.list}
            </p>
          )}
          <button
            type="button"
            className="btn btn-sm"
            disabled={grants.length >= 20 || !roles.isSuccess} // 계약 maxItems, 역할 목록을 받은 뒤에만
            onClick={() => {
              setGrants((gs) => [...gs, { id: nextId, role: '', centers: [], validFrom: '', validTo: '', reason: '' }]);
              setNextId((n) => n + 1);
            }}
          >
            {m.register.addGrant}
          </button>
        </div>

        <p className="text-xs text-base-content/60">{m.register.after}</p>
        <button type="submit" className="btn btn-primary" disabled={!ready || cmd.busy}>
          {m.register.submit}
        </button>
        {/* 서버가 준 문장(400·409 detail)은 그대로 보인다 */}
        {problemDetail(rejected) && <p className="text-xs text-error">{problemDetail(rejected)}</p>}
        <CommandFeedback command={cmd} />
      </form>
    </section>
  );
}
