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
import { label, text, when } from '../../shared/ops';

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
      className="space-y-2 rounded-box border border-base-300 bg-base-100 shadow-sm p-3 text-sm"
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
      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOpen(true)}>
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
              {k}
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

/** 접수 건 상세의 "행위 요청" 칸. canAct = 그 건을 맡을 수 있는 사람(처리 끝난 건 아님) */
export function ActionRequests({ c, canAct }: { readonly c: Case; readonly canAct: boolean }) {
  const items = c.actionRequests ?? [];
  const caseId = c.caseId ?? '';
  if (items.length === 0 && !canAct) return null;
  return (
    <section className="space-y-2" aria-label={m.title}>
      <h2 className="font-bold">{m.title}</h2>
      <p className="text-xs text-base-content/60">{m.intro}</p>
      {items.length === 0 ? (
        <p className="text-sm text-base-content/60">{m.empty}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((ar) => (
            <li key={ar.actionRequestId} className="flex flex-wrap items-center gap-2 rounded-box border border-base-300 bg-base-100 shadow-sm p-2" data-testid="action-request" data-state={ar.state}>
              <span className="badge badge-sm">{label(m.stateName, ar.state)}</span>
              <span className="font-medium">{label(m.typeName, ar.actionType)}</span>
              <span className="font-mono text-xs">{`${ar.targetService} · ${ar.command}${ar.targetRef ? ` · ${ar.targetRef}` : ''}`}</span>
              {ar.approvalRef && <span className="text-xs">{`${m.approvalRef} ${ar.approvalRef}`}</span>}
              {ar.resultRef && <span className="font-mono text-xs" data-testid="action-request-result">{`${m.resultLine} ${ar.resultRef.system} · ${ar.resultRef.ref}${ar.resultRef.kind ? ` (${ar.resultRef.kind})` : ''}`}</span>}
              {ar.resultNote && <span className="text-xs opacity-80">{ar.resultNote}</span>}
              <span className="text-xs opacity-60">{`${text(ar.requestedBy)} · ${when(ar.requestedAt)}`}</span>
              {canAct && !FINAL.includes(ar.state ?? '') && <ResultForm caseId={caseId} ar={ar} />}
            </li>
          ))}
        </ul>
      )}
      {canAct && <NewActionRequest c={c} />}
    </section>
  );
}
