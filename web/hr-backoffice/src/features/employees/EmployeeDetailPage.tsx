// 직원 상세(GET /hr/employees/{operatorId}): 기본 정보, 계정 발급 단계, 요청 권한 상태, 인사 처리(소속 변경·정지·복귀·퇴사).
// - 계정 발급이 진행 중이면 몇 초마다 다시 조회한다(handoff 2026-11-13 §2). 단계는 서버 값만 보인다.
// - 상태 변경은 X-Expected-Version(직원 version)과 사유를 보낸다. 응답(Employee)이 온 것만 반영한다.
// - 요청 권한은 상태만 보인다(승인 버튼 없음 — 인사와 권한 분리).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import { request, requestNoContent, type IdempotencyKey } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { CommandFeedback } from '../../shared/Feedback';
import { commandParams } from '../../api/command';
import { PROVISIONING_IN_PROGRESS, PROVISIONING_RETRYABLE, type Employee } from '../../api/models';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { messages as m } from '../../shared/messages';
import { AffiliationFields, toAffiliation, type AffiliationDraft } from './AffiliationFields';
import { useCenters } from './centers';
import { affiliationText, periodText } from './labels';
import { MailboxPassword } from './MailboxPassword';
import { DataTable, PageHeader } from '../../shared/admin';

/** 발급 진행 중 다시 조회 간격. 테스트가 줄여 쓴다 */
export const provisioningPoll = { intervalMs: 3000 };

const detailKey = (operatorId: string) => ['hr', 'employee', operatorId] as const;

type Action = 'affiliation' | 'suspend' | 'reinstate' | 'depart';

/** 사유를 받아 보내는 인사 처리 한 건. 열려 있는 동안만 입력을 갖고, 끝나면 닫는다 */
function ReasonAction({
  title,
  note,
  warning,
  doneText,
  canSubmit = true,
  children,
  send,
  onDone,
  onClose,
}: {
  readonly title: string;
  readonly note?: string;
  readonly warning?: string;
  readonly doneText: string;
  readonly canSubmit?: boolean;
  /** 사유 말고 더 받는 입력 */
  readonly children?: ReactNode;
  readonly send: (reason: string, key: IdempotencyKey) => Promise<Employee>;
  readonly onDone: (employee: Employee) => void;
  readonly onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const cmd = useCommand(async (r: string, key) => {
    const employee = await send(r, key);
    onDone(employee);
    return employee;
  });
  const done = cmd.phase.kind === 'done';

  return (
    <form
      role="dialog"
      aria-label={title}
      className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim() || !canSubmit || done) return;
        if (cmd.phase.kind === 'rejected') cmd.reset();
        void cmd.run(reason.trim());
      }}
    >
      <h3 className="font-bold">{title}</h3>
      {warning && (
        <p role="note" className="alert alert-warning text-sm">
          {warning}
        </p>
      )}
      {note && <p className="text-sm text-base-content/60">{note}</p>}
      {!done && (
        <>
          {children}
          <label className="flex flex-col gap-1 text-sm">
            {m.reasonLabel}
            <textarea className="textarea w-full" rows={2} maxLength={500} placeholder={m.reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </>
      )}
      <CommandFeedback command={cmd}>
        {() => (
          <p role="status" className="text-success text-sm">
            {doneText}
          </p>
        )}
      </CommandFeedback>
      <div className="flex gap-2">
        {!done && (
          <button type="submit" className="btn btn-sm btn-primary" disabled={!reason.trim() || !canSubmit || cmd.busy}>
            {m.detail.confirm}
          </button>
        )}
        {/* 결과 불명인 동안에는 닫지 않는다(같은 요청으로 결과 확인을 먼저) */}
        <button type="button" className="btn btn-sm" disabled={cmd.busy} onClick={onClose}>
          {done ? m.close : m.cancel}
        </button>
      </div>
    </form>
  );
}

/**
 * 인사 처리 — 본인이면 버튼 대신 안내(hr-service 2026-11-17 "자기 자신은 안 됨": 소속 변경·정지·정지 해제·퇴사는 본인에게 403, 판정은 서버).
 * 백엔드 알림 clients/hr-backoffice/2026-11-17-notice-self-action-rules §1.
 */
function Actions({ employee, onChanged, self }: { readonly employee: Employee; readonly onChanged: (e: Employee) => void; readonly self: boolean }) {
  const api = useApi();
  const centers = useCenters();
  const [open, setOpen] = useState<Action | null>(null);
  const [affiliation, setAffiliation] = useState<AffiliationDraft>(employee.affiliation);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const path = { operatorId: employee.operatorId };
  const version = employee.version;
  const close = () => setOpen(null);
  const nextAffiliation = toAffiliation(affiliation);

  const buttons: ReadonlyArray<readonly [Action, string, boolean]> = [
    ['affiliation', m.detail.changeAffiliation, employee.status !== 'LEFT'],
    ['suspend', m.detail.suspend, employee.status === 'ACTIVE'],
    ['reinstate', m.detail.reinstate, employee.status !== 'ACTIVE'],
    ['depart', m.detail.depart, employee.status !== 'LEFT'],
  ];

  return (
    <div className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4">
      <h2 className="font-bold">{m.detail.actions}</h2>
      {self && (
        <p role="note" className="text-sm text-base-content/60" data-testid="self-action-note">
          {m.detail.selfNote}
        </p>
      )}
      <div className="flex flex-wrap gap-2" hidden={self}>
        {buttons
          .filter(([, , show]) => show)
          .map(([action, label]) => (
            <button key={action} type="button" className="btn btn-sm" disabled={open !== null} onClick={() => setOpen(action)}>
              {label}
            </button>
          ))}
      </div>
      {open === 'affiliation' && (
        <ReasonAction
          title={m.detail.changeAffiliation}
          note={m.detail.affiliationNote}
          doneText={m.detail.affiliationChanged}
          canSubmit={nextAffiliation !== null}
          send={(reason, key) =>
            request(
              'POST',
              api.hr.POST('/hr/employees/{operatorId}/affiliation-changes', {
                ...commandParams(key, { path, version }),
                // canSubmit 이 거짓이면 보내지 않는다
                body: { affiliation: nextAffiliation ?? employee.affiliation, reason },
              }),
            )
          }
          onDone={onChanged}
          onClose={close}
        >
          <AffiliationFields name="change-affiliation" centers={centers} value={affiliation} onChange={setAffiliation} />
        </ReasonAction>
      )}
      {open === 'suspend' && (
        <ReasonAction
          title={m.detail.suspend}
          warning={m.detail.suspendWarning}
          doneText={m.detail.suspended}
          send={(reason, key) =>
            request('POST', api.hr.POST('/hr/employees/{operatorId}/suspensions', { ...commandParams(key, { path, version }), body: { reason } }))
          }
          onDone={onChanged}
          onClose={close}
        />
      )}
      {open === 'reinstate' && (
        <ReasonAction
          title={m.detail.reinstate}
          note={m.detail.reinstateNote}
          doneText={m.detail.reinstated}
          send={(reason, key) =>
            request(
              'POST',
              api.hr.POST('/hr/employees/{operatorId}/reinstatements', {
                ...commandParams(key, { path, version }),
                body: { reason, ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) },
              }),
            )
          }
          onDone={onChanged}
          onClose={close}
        >
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1 text-sm">
              {m.fields.startDate}
              <input type="date" className="input input-sm" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {m.fields.endDate}
              <input type="date" className="input input-sm" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </div>
        </ReasonAction>
      )}
      {open === 'depart' && (
        <ReasonAction
          title={m.detail.depart}
          warning={m.detail.departWarning}
          doneText={m.detail.departed}
          send={(reason, key) =>
            request('POST', api.hr.POST('/hr/employees/{operatorId}/departures', { ...commandParams(key, { path, version }), body: { reason } }))
          }
          onDone={onChanged}
          onClose={close}
        />
      )}
    </div>
  );
}

function ProvisioningCard({ employee, onChanged }: { readonly employee: Employee; readonly onChanged: (e: Employee) => void }) {
  const api = useApi();
  const p = employee.provisioning;
  const path = { operatorId: employee.operatorId };
  const inProgress = PROVISIONING_IN_PROGRESS.includes(p.step);
  const retry = useCommand(async (_: null, key) => {
    const next = await request('POST', api.hr.POST('/hr/employees/{operatorId}/provisioning-retries', commandParams(key, { path })));
    onChanged(next);
    return next;
  });
  const invite = useCommand(async (_: null, key) => {
    await requestNoContent('POST', api.hr.POST('/hr/employees/{operatorId}/invite-resends', commandParams(key, { path })));
    return true;
  });

  return (
    <div className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4">
      <h2 className="font-bold">{m.detail.provisioning}</h2>
      <dl className="grid grid-cols-[8rem_1fr] gap-1 text-sm">
        <dt>{m.detail.step}</dt>
        <dd data-step={p.step}>{`${m.provisioningStep[p.step]} (${m.provisioningDetail[p.step]})`}</dd>
        <dt>{m.detail.attempts}</dt>
        <dd>{p.attempts}</dd>
        {p.lastErrorCode && (
          <>
            <dt>{m.detail.lastError}</dt>
            {/* 오류 코드는 서버 값 그대로 작게 */}
            <dd className="text-xs">{p.lastErrorCode}</dd>
          </>
        )}
        {p.nextAttemptAt && (
          <>
            <dt>{m.detail.nextAttempt}</dt>
            <dd>{formatSeoul(p.nextAttemptAt)}</dd>
          </>
        )}
      </dl>
      {inProgress && (
        <p role="status" className="flex items-center gap-2 text-sm">
          <span className="loading loading-spinner loading-xs" />
          {m.detail.inProgress}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {PROVISIONING_RETRYABLE.includes(p.step) && (
          <button type="button" className="btn btn-sm btn-primary" disabled={retry.busy} onClick={() => void retry.run(null)}>
            {m.detail.retry}
          </button>
        )}
        {/* 안내 메일은 로그인 계정이 생긴 뒤에만 보낼 수 있다(그 전에는 서버가 거절) — 버튼은 두고 서버 판정을 보인다 */}
        <button type="button" className="btn btn-sm" disabled={invite.busy} onClick={() => void invite.run(null)}>
          {m.detail.resendInvite}
        </button>
      </div>
      <CommandFeedback command={retry}>
        {() => (
          <p role="status" className="text-success text-sm">
            {m.detail.retried}
          </p>
        )}
      </CommandFeedback>
      <CommandFeedback command={invite}>
        {() => (
          <p role="status" className="text-success text-sm">
            {m.detail.inviteSent}
          </p>
        )}
      </CommandFeedback>
      <MailboxPassword operatorId={employee.operatorId} />
    </div>
  );
}

export function EmployeeDetailPage() {
  const { session } = useSession();
  const api = useApi();
  const queryClient = useQueryClient();
  const { operatorId = '' } = useParams();
  const query = useQuery({
    queryKey: detailKey(operatorId),
    queryFn: () => request('GET', api.hr.GET('/hr/employees/{operatorId}', { params: { path: { operatorId } } })),
    // 발급이 진행 중이면 몇 초마다, 승인 대기(SUBMITTED) 권한이 있으면 더 느리게 다시 조회한다(자동 승인은 몇 초 뒤에 온다).
    // 그 밖(끝남·실패)에는 멈춘다. 화면이 열려 있는 동안만 돈다.
    refetchInterval: (q) => {
      const e = q.state.data;
      if (!e) return false;
      if (PROVISIONING_IN_PROGRESS.includes(e.provisioning.step)) return provisioningPoll.intervalMs;
      return (e.requestedGrants ?? []).some((g) => g.submission === 'SUBMITTED') ? provisioningPoll.intervalMs * 5 : false;
    },
  });

  const onChanged = (next: Employee) => {
    queryClient.setQueryData(detailKey(operatorId), next);
    void queryClient.invalidateQueries({ queryKey: ['hr', 'employees'] });
  };

  return (
    <section className="max-w-3xl space-y-4">
      <Link to="/employees" className="link text-sm">
        {m.detail.back}
      </Link>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(e) => (
          <>
            <PageHeader title={`${e.name} (${e.employeeNo})`} />
            <div className="rounded-box border border-base-300 bg-base-100 p-4">
              <h2 className="mb-2 font-bold">{m.detail.info}</h2>
              <dl className="grid grid-cols-[8rem_1fr] gap-1 text-sm">
                <dt>{m.fields.status}</dt>
                <dd data-status={e.status}>{m.employmentStatus[e.status]}</dd>
                <dt>{m.fields.mailAddress}</dt>
                <dd>{e.mailAddress}</dd>
                <dt>{m.fields.employmentType}</dt>
                <dd>{m.employmentType[e.employmentType]}</dd>
                <dt>{m.fields.affiliation}</dt>
                <dd>{affiliationText(e.affiliation)}</dd>
                <dt>{m.fields.startDate}</dt>
                <dd>{e.startDate}</dd>
                <dt>{m.fields.endDate}</dt>
                <dd>{e.endDate ?? m.none}</dd>
                <dt>{m.fields.operatorId}</dt>
                <dd className="text-xs select-all">{e.operatorId}</dd>
                <dt>{m.fields.createdAt}</dt>
                <dd>{formatSeoul(e.createdAt)}</dd>
                <dt>{m.fields.updatedAt}</dt>
                <dd>{formatSeoul(e.updatedAt)}</dd>
              </dl>
            </div>

            <ProvisioningCard employee={e} onChanged={onChanged} />

            <div className="space-y-2 rounded-box border border-base-300 bg-base-100 p-4">
              <h2 className="font-bold">{m.detail.grants}</h2>
              <p className="text-xs text-base-content/60">{m.detail.grantsNote}</p>
              {(e.requestedGrants ?? []).length === 0 ? (
                <p className="text-sm text-base-content/60">{m.detail.grantsEmpty}</p>
              ) : (
                <DataTable>
                  <thead>
                    <tr>
                      <th>{m.register.grantRole}</th>
                      <th>{m.register.grantCenters}</th>
                      <th>{m.detail.grantPeriod}</th>
                      <th>{m.detail.grantReason}</th>
                      <th>{m.detail.grantState}</th>
                      <th>{m.detail.grantApproval}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(e.requestedGrants ?? []).map((g, i) => (
                      <tr key={`${g.role}-${i}`}>
                        <td>{g.role}</td>
                        <td>{g.centers.join(', ') || m.none}</td>
                        <td>{periodText(g.validFrom, g.validTo)}</td>
                        <td>{g.reason ?? m.none}</td>
                        <td data-submission={g.submission}>{m.grantSubmission[g.submission]}</td>
                        <td className="text-xs">{g.approvalRef ?? m.none}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              )}
            </div>

            {/* version 이 바뀌면 열린 입력을 버린다(예전 version 으로 보내지 않게) */}
            <Actions key={e.version} employee={e} onChanged={onChanged} self={session?.subject === e.operatorId} />
          </>
        )}
      </QueryState>
    </section>
  );
}
