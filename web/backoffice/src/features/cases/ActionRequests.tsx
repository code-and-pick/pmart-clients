// 접수 건 "행위 요청" 기록(case 0.17.0 — 백엔드 요청 backoffice/2026-11-17-request-action-requests, 사용자 "기록만 먼저").
// 다른 서비스에 한 요청(원결과 다시 조회·미전달 재전송·승인된 보상 실행·검토 요청)과 결과 ID 를 이 건에 남긴다. **case 가 대신 실행하지 않는다**
// — 실제 명령은 처리 대기·각 메뉴에서. 남길 수 있는 사람 = 그 건을 맡을 수 있는 사람(배송 건 지원센터·관리자, 주문 건 관리자), 처리 끝난 건은 새 요청 없음.
// 보상 실행은 승인 번호 필수(422 APPROVAL_REQUIRED). 결과 APPLIED·REJECTED 뒤에는 더 못 남김(409 — 새 요청), UNKNOWN_RESULT 는 다시 확인 뒤 다시 남긴다.
// 결과 ID 는 보유 서비스·ID 를 같이(하나만이면 400 — 화면에서도 막음). 길이: 대상 ID·승인 번호 100자(0.17.1 #92). 메모·요약은 직원이 쓴 글 — 화면에만, 개인정보 금지.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '@pmart/web-core';
import { CommandFeedback, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { CodeLabel } from '../../shared/admin';
import { text, when } from '../../shared/ops';

const m = messages.actionRequests;
type Case = components['schemas']['Case'];
type ActionRequest = components['schemas']['ActionRequest'];
type ActionType = components['schemas']['ActionRequestBody']['actionType'];
type ResultBody = NonNullable<components['schemas']['ActionRequest']['state']>;
type ResultState = Exclude<ResultBody, 'REQUESTED'>;
type ResultKind = NonNullable<components['schemas']['EvidenceReference']['kind']>;

const ACTION_TYPES = Object.keys(m.typeName) as ActionType[];
const RESULT_STATES: readonly ResultState[] = ['SENT', 'ACCEPTED', 'APPLIED', 'REJECTED', 'UNKNOWN_RESULT'];
const RESULT_KINDS: readonly ResultKind[] = ['COMMIT', 'TRANSACTION', 'EVENT', 'DOCUMENT', 'PHOTO', 'LOG'];
const FINAL: readonly string[] = ['APPLIED', 'REJECTED'];

function useRefreshCase(caseId: string) {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ['cases', 'detail', caseId] });
}

function NewActionRequest({ c }: { readonly c: Case }) {
  const api = useApi();
  const caseId = c.caseId ?? '';
  const refresh = useRefreshCase(caseId);
  const [actionType, setActionType] = useState<ActionType>('REQUERY_RESULT');
  const [targetService, setTargetService] = useState('');
  const [command, setCommand] = useState('');
  const [targetRef, setTargetRef] = useState('');
  const [approvalRef, setApprovalRef] = useState('');
  const needsApproval = actionType === 'EXECUTE_APPROVED_COMPENSATION';
  const ok = targetService.trim() !== '' && command.trim() !== '' && (!needsApproval || approvalRef.trim() !== '');
  const create = useCommand(async (_v: null, key) => {
    const r = await request(
      'POST',
      api.cases.POST('/cases/{caseId}/action-requests', {
        ...commandParams(key, { path: { caseId } }),
        body: {
          actionType,
          targetService: targetService.trim(),
          command: command.trim(),
          ...(targetRef.trim() ? { targetRef: targetRef.trim() } : {}),
          ...(needsApproval ? { approvalRef: approvalRef.trim() } : {}),
        },
      }),
    );
    refresh();
    return r;
  });
  return (
    <form
      className="space-y-2 text-sm"
      aria-label={m.newTitle}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        if (create.phase.kind === 'rejected' || create.phase.kind === 'done') create.reset();
        void create.run(null);
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          {m.type}
          <select className="select select-sm" value={actionType} onChange={(e) => setActionType(ACTION_TYPES.find((t) => t === e.target.value) ?? 'REQUERY_RESULT')}>
            {ACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {m.typeName[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {m.targetService}
          <input className="input input-sm w-52 font-mono" placeholder="order-orchestration-service" maxLength={100} value={targetService} onChange={(e) => setTargetService(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {m.command}
          <input className="input input-sm w-52 font-mono" maxLength={100} value={command} onChange={(e) => setCommand(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {m.targetRef}
          <input className="input input-sm w-52 font-mono" maxLength={100} value={targetRef} onChange={(e) => setTargetRef(e.target.value)} />
        </label>
        {needsApproval && (
          <label className="flex flex-col gap-1">
            {m.approvalRef}
            <input className="input input-sm w-52 font-mono" maxLength={100} value={approvalRef} onChange={(e) => setApprovalRef(e.target.value)} />
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-sm" disabled={!ok || create.busy}>
          {m.record}
        </button>
        <span className="text-xs text-base-content/60">{m.recordOnly}</span>
      </div>
      <CommandFeedback command={create}>{() => <span className="text-xs text-success">{m.recorded}</span>}</CommandFeedback>
    </form>
  );
}

function ResultForm({ caseId, ar }: { readonly caseId: string; readonly ar: ActionRequest }) {
  const api = useApi();
  const refresh = useRefreshCase(caseId);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ResultState>('APPLIED');
  const [system, setSystem] = useState('');
  const [ref, setRef] = useState('');
  const [kind, setKind] = useState<ResultKind | ''>('');
  const [note, setNote] = useState('');
  // 결과 ID 는 보유 서비스와 ID 를 같이(하나만이면 서버 400)
  const pairOk = (system.trim() === '') === (ref.trim() === '');
  const save = useCommand(async (_v: null, key) => {
    const r = await request(
      'POST',
      api.cases.POST('/cases/{caseId}/action-requests/{actionRequestId}/results', {
        ...commandParams(key, { path: { caseId, actionRequestId: ar.actionRequestId ?? '' } }),
        body: {
          state,
          ...(system.trim() ? { resultSystem: system.trim(), resultRef: ref.trim() } : {}),
          ...(kind && system.trim() ? { resultKind: kind } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      }),
    );
    setOpen(false);
    refresh();
    return r;
  });
  if (!open)
    return (
      <button type="button" className="btn btn-outline btn-xs" onClick={() => setOpen(true)}>
        {m.recordResult}
      </button>
    );
  return (
    <form
      className="flex w-full flex-wrap items-end gap-2 pt-1"
      aria-label={m.recordResult}
      onSubmit={(e) => {
        e.preventDefault();
        if (!pairOk) return;
        if (save.phase.kind === 'rejected' || save.phase.kind === 'done') save.reset();
        void save.run(null);
      }}
    >
      <label className="flex flex-col gap-1 text-xs">
        {m.resultState}
        <select className="select select-xs" value={state} onChange={(e) => setState(RESULT_STATES.find((s) => s === e.target.value) ?? 'APPLIED')}>
          {RESULT_STATES.map((s) => (
            <option key={s} value={s}>
              {m.stateName[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        {m.resultSystem}
        <input className="input input-xs w-44 font-mono" value={system} onChange={(e) => setSystem(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        {m.resultRef}
        <input className="input input-xs w-44 font-mono" value={ref} onChange={(e) => setRef(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        {m.resultKind}
        <select className="select select-xs" value={kind} onChange={(e) => setKind(RESULT_KINDS.find((k) => k === e.target.value) ?? '')}>
          <option value="">{messages.none}</option>
          {RESULT_KINDS.map((k) => (
            <option key={k} value={k}>
              {m.resultKindName[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        {m.note}
        <input className="input input-xs w-56" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-xs btn-primary" disabled={!pairOk || save.busy}>
        {m.saveResult}
      </button>
      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOpen(false)}>
        {m.cancel}
      </button>
      {!pairOk && <span className="text-xs text-error">{m.pairNeeded}</span>}
      <CommandFeedback command={save} />
    </form>
  );
}

/** 상태 동그라미 — 반영(체크)·거절(엑스)·모름(물음표)·그 밖(시계) */
const STATE_MARK: Readonly<Record<string, { readonly cls: string; readonly d: string }>> = {
  APPLIED: { cls: 'bg-success/15 text-success', d: 'M5 12l5 5L20 7' },
  REJECTED: { cls: 'bg-error/15 text-error', d: 'M6 6l12 12M18 6 6 18' },
  UNKNOWN_RESULT: { cls: 'bg-warning/15 text-warning', d: 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14m0 3h.01' },
};
const PENDING_MARK = { cls: 'bg-info/10 text-info', d: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z' };

/** 접수 건 상세의 "행위 요청" 칸. canAct = 그 건을 맡을 수 있는 사람(처리 끝난 건 아님) */
export function ActionRequests({ c, canAct }: { readonly c: Case; readonly canAct: boolean }) {
  const items = c.actionRequests ?? [];
  const caseId = c.caseId ?? '';
  if (items.length === 0 && !canAct) return null;
  return (
    // 할 일 목록처럼(2026-11-18): 상태 동그라미 + 종류 굵게 + 대상 한 줄, 맨 아래 새 요청 기록
    <section className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm" aria-label={m.title}>
      <div className="space-y-0.5 border-b border-base-300 px-5 py-3">
        <h2 className="flex items-center gap-2 font-semibold">
          {m.title}
          {items.length > 0 && <span className="badge badge-ghost badge-sm">{items.length}</span>}
        </h2>
        {/* 기록만 한다는 안내는 기록 버튼 옆 한 줄로(2026-11-18 도움말 줄이기) — 보기만 하는 사람에게는 위 한 줄 */}
        {!canAct && <p className="text-xs text-base-content/60">{m.intro}</p>}
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-base-content/60">{m.empty}</p>
      ) : (
        <ul className="divide-y divide-base-300/70 text-sm">
          {items.map((ar) => {
            const mark = STATE_MARK[ar.state ?? ''] ?? PENDING_MARK;
            return (
              <li key={ar.actionRequestId} className="flex gap-3 px-5 py-3" data-testid="action-request" data-state={ar.state}>
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${mark.cls}`} aria-hidden="true">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d={mark.d} />
                  </svg>
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{ar.actionType ? <CodeLabel code={ar.actionType} names={m.typeName} /> : messages.none}</span>
                    <span className="badge badge-sm badge-soft">{ar.state ? <CodeLabel code={ar.state} names={m.stateName} /> : messages.none}</span>
                  </div>
                  <p className="break-all text-xs text-base-content/70">
                    <CodeLabel code={ar.targetService} names={messages.systemName} />
                    <span className="font-mono">{` · ${ar.command}${ar.targetRef ? ` · ${ar.targetRef}` : ''}`}</span>
                  </p>
                  {ar.approvalRef && <p className="text-xs">{`${m.approvalRef} ${ar.approvalRef}`}</p>}
                  {ar.resultRef && (
                    <p className="break-all text-xs text-success" data-testid="action-request-result">
                      {`${m.resultLine} `}
                      <CodeLabel code={ar.resultRef.system} names={messages.systemName} />
                      <span className="font-mono">{` · ${ar.resultRef.ref}`}</span>
                      {ar.resultRef.kind && (
                        <>
                          {' ('}
                          <CodeLabel code={ar.resultRef.kind} names={m.resultKindName} />
                          {')'}
                        </>
                      )}
                    </p>
                  )}
                  {ar.resultNote && <p className="text-xs opacity-80">{ar.resultNote}</p>}
                  <p className="text-xs text-base-content/50">{`${text(ar.requestedBy)} · ${when(ar.requestedAt)}`}</p>
                  {canAct && !FINAL.includes(ar.state ?? '') && <ResultForm caseId={caseId} ar={ar} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canAct && (
        <div className="border-t border-base-300 bg-base-200/30 px-5 py-4">
          <NewActionRequest c={c} />
        </div>
      )}
    </section>
  );
}
