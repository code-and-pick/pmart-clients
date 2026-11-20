// 품질 — mfc-quality-service 0.2.0(요청서 mfc-backoffice/2026-11-15 §2·§2-1 "격리·해제(다른 관리자 승인), 폐기, 회수품 검수").
// 탭(URL 쿼리 `tab`): 격리·해제(기본) · 폐기 · 회수품 검수 · 품질 사고(0.6.0 — `IncidentPages.tsx`).
// 품질 사고 상세의 "격리 요청"은 이 탭에 `incidentId`·LOT 을 채워 온다 — 판정 본문 `incidentId` 로 사고에 잇는다(백엔드 회신 2026-11-19 R4).
// - 판정 `POST /quality-decisions`(202 CommandResponse): QUARANTINE 은 바로 반영(APPLIED·REJECTED·UNKNOWN_RESULT), RELEASE 는 요청만(ACCEPTED → 판정 REQUESTED).
//   해제 승인·반려 `POST /quality-decisions/{id}/approvals`(요청자 본인 불가 — 422 SELF_APPROVAL). 조회 `GET /quality-decisions/{id}`.
// - 폐기 `POST /disposal-approvals` {action REQUEST|APPROVE|REJECT}(APPROVE 의 approvalRef 는 선택 — 없으면 422 APPROVAL_REQUIRED 흐름, AP-1), 실행 `POST …/{id}/executions`(남은 승인량 이하).
// - 회수품 검수 `POST /return-inspections` — 반입(inbound `GET /return-receipts/{id}`)을 불러와 줄마다 재판매/폐기. 재판매는 상온·미개봉·신선 아님만(서버도 422).
// 목록(MB-1, quality 0.5.0): 판정·폐기·검수 `GET …?mfcId=&state=` — 탭 위 목록에서 열기(기본 = 해제 승인 대기·폐기 승인 대기). 검수 탭에는 회수품 반입 목록(inbound, 검수 상태)도. 접수(ACCEPTED)를 완료로 보이지 않고 다시 읽은 상태를 보인다.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { CommandRejectedFailure, request, UnknownResultFailure, type CommandResponse } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/mfc-quality';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { ApprovalAwareFeedback, ApprovalRefInput } from '../../shared/approval';
import { DecisionList, DisposalList, InspectionList, ReturnReceiptList } from '../lists/CenterLists';
import { IncidentsTab } from './IncidentPages';
import { LotLabel } from '../../shared/LotLabel';
import { SystemNumbers } from '../../shared/displayNumber';
import { GuideBox } from '../../shared/listParts';
import { messages } from '../../shared/messages';
import { Who } from '../../shared/OperatorLabel';

const m = messages.quality;

type Qual = components['schemas'];
type QualityLine = Qual['QualityLine'];
type Decision = Qual['QualityDecision'];
type Disposal = Qual['DisposalApproval'];
type DecisionReason = Qual['QualityDecisionRequest']['reason'];
type InspectionLine = Qual['ReturnInspectionRequest']['lines'][number];

type Tab = 'decisions' | 'disposals' | 'inspections' | 'incidents';
const TABS: readonly Tab[] = ['decisions', 'disposals', 'inspections', 'incidents'];
const REASONS: readonly DecisionReason[] = ['TEMPERATURE', 'DAMAGE', 'EXPIRY', 'RECALL', 'INSPECTION_FAIL', 'INSPECTION_PASS', 'OTHER'];

/** CommandResponse 를 확정으로: REJECTED 는 거절, UNKNOWN_RESULT 는 결과 불명(같은 키) */
function checkCommand(r: CommandResponse): CommandResponse {
  if (r.status === 'REJECTED') throw new CommandRejectedFailure(r.nextAction, r.requestId);
  if (r.status === 'UNKNOWN_RESULT') throw new UnknownResultFailure(r.status, r.requestId);
  return r;
}

function useParam(key: string): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams();
  return [
    params.get(key) ?? '',
    (v) => {
      const next = new URLSearchParams(params);
      if (v) next.set(key, v);
      else next.delete(key);
      setParams(next, { replace: true });
    },
  ];
}

/** `/c/:mfcId/quality/*` */
export function QualityMenu({ mfcId }: { readonly mfcId: string }) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'decisions';
  return (
    <section className="space-y-4">
      <h1>{messages.menus.quality}</h1>
      <GuideBox title={messages.listParts.guideOf(messages.menus.quality)} storeKey="quality" items={[m.intro]} />
      <div role="tablist" className="tabs tabs-box w-fit">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`tab ${tab === t ? 'tab-active' : ''}`}
            onClick={() => setParams(t === 'decisions' ? {} : { tab: t }, { replace: true })}
          >
            {m.tabs[t]}
          </button>
        ))}
      </div>
      {tab === 'decisions' && <DecisionList mfcId={mfcId} />}
      {tab === 'disposals' && <DisposalList mfcId={mfcId} />}
      {tab === 'inspections' && (
        <>
          <ReturnReceiptList mfcId={mfcId} title={messages.lists.pendingReceipts} />
          <InspectionList mfcId={mfcId} />
        </>
      )}
      {tab === 'decisions' && <DecisionsTab mfcId={mfcId} />}
      {tab === 'disposals' && <DisposalsTab mfcId={mfcId} />}
      {tab === 'inspections' && <InspectionsTab mfcId={mfcId} />}
      {tab === 'incidents' && <IncidentsTab mfcId={mfcId} />}
    </section>
  );
}

function LookupForm({ label, value, onSubmit }: { readonly label: string; readonly value: string; readonly onSubmit: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v.trim());
      }}
    >
      <label className="flex flex-col gap-1">
        {label}
        <input className="input input-sm w-48 font-mono" value={v} onChange={(e) => setV(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-sm" disabled={!v.trim()}>
        {m.open}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------- 대상 줄 입력

interface LineInput {
  readonly sku: string;
  readonly lotId: string;
  readonly locationCode: string;
  readonly qty: string;
  readonly workState: 'STORED' | 'UNSTOWED';
}
const emptyLine: LineInput = { sku: '', lotId: '', locationCode: '', qty: '', workState: 'STORED' };
const linesValid = (lines: readonly LineInput[]) =>
  lines.length > 0 && lines.every((l) => !!l.sku.trim() && !!l.lotId.trim() && !!l.locationCode.trim() && Number.isInteger(Number(l.qty)) && Number(l.qty) >= 1);
const toLines = (lines: readonly LineInput[], withWork: boolean): QualityLine[] =>
  lines.map((l) => ({ sku: l.sku.trim(), lotId: l.lotId.trim(), locationCode: l.locationCode.trim(), qty: Number(l.qty), ...(withWork ? { workState: l.workState } : {}) }));

function LinesEditor({ value, onChange, withWork }: { readonly value: readonly LineInput[]; readonly onChange: (v: LineInput[]) => void; readonly withWork: boolean }) {
  const set = (i: number, patch: Partial<LineInput>) => onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">{m.lines}</h3>
      {value.map((l, i) => (
        <fieldset key={i} className="flex flex-wrap items-end gap-2" aria-label={`${m.lines} ${i + 1}`}>
          <label className="flex flex-col gap-1">
            {m.line.sku}
            <input className="input input-sm w-32 font-mono" value={l.sku} onChange={(e) => set(i, { sku: e.target.value.toUpperCase() })} />
          </label>
          <label className="flex flex-col gap-1">
            {m.line.lotId}
            <input className="input input-sm w-32 font-mono" value={l.lotId} onChange={(e) => set(i, { lotId: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            {m.line.location}
            <input className="input input-sm w-32 font-mono" value={l.locationCode} onChange={(e) => set(i, { locationCode: e.target.value.toUpperCase() })} />
          </label>
          <label className="flex flex-col gap-1">
            {m.line.qty}
            <input className="input input-sm w-20" type="number" min={1} step={1} value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />
          </label>
          {withWork && (
            <label className="flex flex-col gap-1">
              {m.line.workState}
              <select className="select select-sm w-24" value={l.workState} onChange={(e) => set(i, { workState: e.target.value as LineInput['workState'] })}>
                <option value="STORED">{m.work.STORED}</option>
                <option value="UNSTOWED">{m.work.UNSTOWED}</option>
              </select>
            </label>
          )}
          {value.length > 1 && (
            <button type="button" className="btn btn-xs" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              {m.removeLine}
            </button>
          )}
        </fieldset>
      ))}
      <button type="button" className="btn btn-xs" onClick={() => onChange([...value, emptyLine])}>
        {m.addLine}
      </button>
    </div>
  );
}

function LinesTable({ lines }: { readonly lines: readonly QualityLine[] }) {
  return (
    <div className="overflow-x-auto">
    <table className="table table-xs">
      <thead>
        <tr>
          <th>{m.line.sku}</th>
          <th>{m.line.lotId}</th>
          <th>{m.line.location}</th>
          <th>{m.line.qty}</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={`${l.lotId}-${l.locationCode}-${i}`}>
            <td className="font-mono">{l.sku}</td>
            <td>
                    <LotLabel lotId={l.lotId} />
                  </td>
            <td className="font-mono">{l.locationCode}</td>
            <td>{l.qty}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

// ---------------------------------------------------------------- 격리·해제

function DecisionsTab({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const [openId, setOpenId] = useParam('decisionId');
  const [params] = useSearchParams();
  const [incidentId, setIncidentId] = useParam('incidentId');
  const [decisionType, setType] = useState<'QUARANTINE' | 'RELEASE'>('QUARANTINE');
  const [reason, setReason] = useState<DecisionReason>('DAMAGE');
  const [note, setNote] = useState('');
  // 품질 사고에서 왔으면 그 LOT 을 채운다(칸·수량은 확인해 넣는다)
  const [lines, setLines] = useState<LineInput[]>(() =>
    incidentId && params.get('lotId') ? [{ ...emptyLine, lotId: params.get('lotId') ?? '', sku: params.get('sku') ?? '', qty: params.get('qty') ?? '' }] : [emptyLine],
  );
  const create = useCommand(async (_: null, key) => {
    const r = checkCommand(
      await request(
        'POST',
        api.quality.POST('/quality-decisions', {
          ...commandParams(key),
          body: { mfcId, decisionType, reason, ...(note.trim() ? { note: note.trim() } : {}), ...(incidentId ? { incidentId } : {}), lines: toLines(lines, true) },
        }),
      ),
    );
    // 접수(해제 = 승인 대기)·반영 모두 판정을 다시 읽어 상태로 보인다
    if (r.resultId) setOpenId(r.resultId);
    setLines([emptyLine]);
    setNote('');
    return r;
  });
  return (
    <div className="max-w-4xl space-y-3 text-sm">
      <form
        className="space-y-2 rounded-box bg-base-100 p-4"
        aria-label={m.submitDecision}
        onSubmit={(e) => {
          e.preventDefault();
          if (!linesValid(lines)) return;
          if (create.phase.kind === 'rejected' || create.phase.kind === 'done') create.reset();
          void create.run(null);
        }}
      >
        <p className="text-xs opacity-70">{m.decisionHint}</p>
        {incidentId && (
          <p role="note" className="flex flex-wrap items-center gap-2 text-info" data-testid="decision-incident">
            {m.incidents.linkedFromIncident(incidentId)}
            <button type="button" className="btn btn-xs" onClick={() => setIncidentId('')}>
              {m.incidents.unlink}
            </button>
          </p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            {m.decisionType}
            <select className="select select-sm w-28" value={decisionType} onChange={(e) => setType(e.target.value as typeof decisionType)}>
              <option value="QUARANTINE">{m.type.QUARANTINE}</option>
              <option value="RELEASE">{m.type.RELEASE}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            {m.reasonLabel}
            <select className="select select-sm w-36" value={reason} onChange={(e) => setReason(e.target.value as DecisionReason)}>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {m.reason[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            {m.note}
            <input className="input input-sm w-64" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <LinesEditor value={lines} onChange={setLines} withWork />
        <button type="submit" className="btn btn-sm btn-primary" disabled={!linesValid(lines) || create.busy}>
          {m.submitDecision}
        </button>
        <CommandFeedback command={create} />
      </form>
      <LookupForm key={openId} label={m.decisionId} value={openId} onSubmit={setOpenId} />
      {openId && <DecisionView id={openId} />}
    </div>
  );
}

function DecisionView({ id }: { readonly id: string }) {
  const api = useApi();
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['quality-decision', id],
    queryFn: () => request('GET', api.quality.GET('/quality-decisions/{qualityDecisionId}', { params: { path: { qualityDecisionId: id } } })),
  });
  return (
    <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
      {(d) => (
        <div className="space-y-2 rounded-box bg-base-100 p-4" data-testid="decision">
          <p className="flex flex-wrap items-center gap-2">
            <span>{m.type[d.decisionType] ?? d.decisionType}</span>
            <span className="badge badge-sm">{m.decisionState[d.state ?? ''] ?? d.state}</span>
            <span className="opacity-70">{m.reason[d.reason] ?? d.reason}</span>
          </p>
          <SystemNumbers ids={[{ label: m.sys.decision, id: d.qualityDecisionId }]} />
          {notice && (
            <p role="status" className="text-success">
              {notice}
            </p>
          )}
          {d.rejectReason && <p className="text-error">{d.rejectReason}</p>}
          <p className="opacity-70">
            {`${m.decidedBy} `}
            <Who id={d.decidedBy} />
            {` · ${m.approver} `}
            <Who id={d.approverId} />
            {` · ${m.appliedQty} ${d.appliedQty ?? 0}`}
            {d.decidedAt ? ` · ${formatSeoul(d.decidedAt)}` : ''}
          </p>
          {(d.affectedOrderIds ?? []).length > 0 && <p>{`${m.affectedOrders}: ${d.affectedOrderIds!.join(', ')}`}</p>}
          <LinesTable lines={d.lines} />
          {d.state === 'REQUESTED' && d.decisionType === 'RELEASE' && <DecideRelease key={d.version} decision={d} onDone={setNotice} />}
        </div>
      )}
    </QueryState>
  );
}

function DecideRelease({ decision, onDone }: { readonly decision: Decision; readonly onDone: (t: string | null) => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const id = decision.qualityDecisionId ?? '';
  const [note, setNote] = useState('');
  const [approvalRef, setApprovalRef] = useState('');
  const decide = useCommand(async (action: 'APPROVE' | 'REJECT', key) => {
    onDone(null);
    const d = await request(
      'POST',
      api.quality.POST('/quality-decisions/{qualityDecisionId}/approvals', {
        ...commandParams(key, { path: { qualityDecisionId: id } }),
        // 본사 승인 번호(quality 0.3.0 새 칸) — APPROVE 때만, 비우면 보내지 않는다
        body: { action, ...(action === 'APPROVE' && approvalRef.trim() ? { approvalRef: approvalRef.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) },
      }),
    );
    // 반영 결과는 서버 상태로만: APPLIED = 해제 반영, DECLINED = 반려, 그 밖(UNKNOWN_RESULT 등)은 상태만 보인다
    onDone(d.state === 'APPLIED' ? m.released : d.state === 'DECLINED' ? m.declined : null);
    queryClient.setQueryData(['quality-decision', id], d);
    return d;
  });
  const run = (a: 'APPROVE' | 'REJECT') => {
    if (decide.phase.kind === 'rejected') decide.reset();
    void decide.run(a);
  };
  return (
    <div className="space-y-2 border-t border-base-200 pt-3">
      <p className="text-xs opacity-70">{m.approveHint}</p>
      <ApprovalRefInput value={approvalRef} onChange={setApprovalRef} />
      <label className="flex flex-col gap-1">
        {m.note}
        <input className="input input-sm w-64" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button type="button" className="btn btn-sm btn-primary" disabled={decide.busy} onClick={() => run('APPROVE')}>
          {m.approveRelease}
        </button>
        <button type="button" className="btn btn-sm" disabled={decide.busy} onClick={() => run('REJECT')}>
          {m.rejectRelease}
        </button>
      </div>
      <ApprovalAwareFeedback command={decide} onApprovalId={setApprovalRef} />
    </div>
  );
}

// ---------------------------------------------------------------- 폐기

function DisposalsTab({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useParam('disposalId');
  const [lines, setLines] = useState<LineInput[]>([emptyLine]);
  const [reason, setReason] = useState('');
  const [sourceRef, setSourceRef] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const requestDisposal = useCommand(async (_: null, key) => {
    setNotice(null);
    const r = checkCommand(
      await request(
        'POST',
        api.quality.POST('/disposal-approvals', {
          ...commandParams(key),
          body: {
            action: 'REQUEST',
            mfcId,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
            ...(sourceRef.trim() ? { sourceRef: sourceRef.trim() } : {}),
            lines: toLines(lines, false),
          },
        }),
      ),
    );
    if (r.resultId) {
      await queryClient.invalidateQueries({ queryKey: ['disposal', r.resultId] });
      setOpenId(r.resultId);
      setNotice(m.disposalRequested);
    }
    setLines([emptyLine]);
    return r;
  });
  return (
    <div className="max-w-4xl space-y-3 text-sm">
      <form
        className="space-y-2 rounded-box bg-base-100 p-4"
        aria-label={m.requestDisposal}
        onSubmit={(e) => {
          e.preventDefault();
          if (!linesValid(lines)) return;
          if (requestDisposal.phase.kind === 'rejected' || requestDisposal.phase.kind === 'done') requestDisposal.reset();
          void requestDisposal.run(null);
        }}
      >
        <p className="text-xs opacity-70">{m.disposalHint}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            {m.reasonLabel}
            <input className="input input-sm w-64" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            {m.sourceRef}
            <input className="input input-sm w-48 font-mono" value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} />
          </label>
        </div>
        <LinesEditor value={lines} onChange={setLines} withWork={false} />
        <button type="submit" className="btn btn-sm btn-primary" disabled={!linesValid(lines) || requestDisposal.busy}>
          {m.requestDisposal}
        </button>
        <CommandFeedback command={requestDisposal} />
      </form>
      {notice && (
        <p role="status" className="text-success">
          {notice}
        </p>
      )}
      <LookupForm key={openId} label={m.disposalId} value={openId} onSubmit={setOpenId} />
      {openId && <DisposalView mfcId={mfcId} id={openId} />}
    </div>
  );
}

function DisposalView({ mfcId, id }: { readonly mfcId: string; readonly id: string }) {
  const api = useApi();
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['disposal', id],
    queryFn: () => request('GET', api.quality.GET('/disposal-approvals/{disposalApprovalId}', { params: { path: { disposalApprovalId: id } } })),
  });
  const dl = m.dLine;
  return (
    <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
      {(d) => (
        <div className="space-y-2 rounded-box bg-base-100 p-4" data-testid="disposal">
          <p className="flex flex-wrap items-center gap-2">
            <span className="badge badge-sm">{m.disposalState[d.state ?? ''] ?? d.state}</span>
            {d.reason && <span className="opacity-70">{d.reason}</span>}
          </p>
          <SystemNumbers ids={[{ label: m.sys.disposal, id: d.disposalApprovalId }]} />
          {notice && (
            <p role="status" className="text-success">
              {notice}
            </p>
          )}
          <p className="opacity-70">
        {`${m.requester} `}
        <Who id={d.requesterId} />
        {` · ${m.approver} `}
        <Who id={d.approverId} />
        {` · ${messages.approval.ref} ${d.approvalRef ?? messages.none}`}
      </p>
          <div className="overflow-x-auto">
          <table className="table table-xs">
            <thead>
              <tr>
                <th>{m.line.sku}</th>
                <th>{m.line.lotId}</th>
                <th>{m.line.location}</th>
                <th>{dl.requested}</th>
                <th>{dl.approved}</th>
                <th>{dl.executed}</th>
                <th>{dl.remaining}</th>
              </tr>
            </thead>
            <tbody>
              {(d.lines ?? []).map((l, i) => (
                <tr key={`${l.lotId ?? ''}-${l.locationCode ?? ''}-${i}`} data-testid="disposal-line">
                  <td className="font-mono">{l.sku}</td>
                  <td>
                    <LotLabel lotId={l.lotId} />
                  </td>
                  <td className="font-mono">{l.locationCode}</td>
                  <td>{l.requestedQty}</td>
                  <td>{l.approvedQty}</td>
                  <td>{l.executedQty}</td>
                  <td>{l.remainingQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {(d.executions ?? []).length > 0 && (
            <div>
              <h3 className="font-semibold">{m.executions}</h3>
              <ul className="list-disc pl-5">
                {d.executions!.map((x) => (
                  <li key={x.executionId}>{`${x.executionId ?? ''} · ${x.state ?? ''} · ${x.qty ?? 0} ${x.executedAt ? formatSeoul(x.executedAt) : ''}`}</li>
                ))}
              </ul>
            </div>
          )}
          {d.state === 'REQUESTED' && <DecideDisposal key={`d-${d.version}`} mfcId={mfcId} disposal={d} onDone={setNotice} />}
          {(d.state === 'APPROVED' || d.state === 'PARTIALLY_EXECUTED') && <ExecuteDisposal key={`x-${d.version}`} disposal={d} onDone={setNotice} />}
        </div>
      )}
    </QueryState>
  );
}

function DecideDisposal({ mfcId, disposal, onDone }: { readonly mfcId: string; readonly disposal: Disposal; readonly onDone: (t: string | null) => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const id = disposal.disposalApprovalId ?? '';
  const [approvalRef, setApprovalRef] = useState('');
  const decide = useCommand(async (action: 'APPROVE' | 'REJECT', key) => {
    onDone(null);
    const r = checkCommand(
      await request(
        'POST',
        api.quality.POST('/disposal-approvals', {
          ...commandParams(key, { version: disposal.version }),
          body: { action, mfcId, disposalApprovalId: id, ...(action === 'APPROVE' && approvalRef.trim() ? { approvalRef: approvalRef.trim() } : {}) },
        }),
      ),
    );
    await queryClient.invalidateQueries({ queryKey: ['disposal', id] });
    if (r.status === 'APPLIED') onDone(action === 'APPROVE' ? m.disposalApproved : m.disposalRejected);
    return r;
  });
  const run = (a: 'APPROVE' | 'REJECT') => {
    if (decide.phase.kind === 'rejected') decide.reset();
    void decide.run(a);
  };
  return (
    <div className="space-y-2 border-t border-base-200 pt-3">
      <ApprovalRefInput value={approvalRef} onChange={setApprovalRef} />
      <div className="flex gap-2">
        <button type="button" className="btn btn-sm btn-primary" disabled={decide.busy} onClick={() => run('APPROVE')}>
          {m.approveDisposal}
        </button>
        <button type="button" className="btn btn-sm" disabled={decide.busy} onClick={() => run('REJECT')}>
          {m.rejectDisposal}
        </button>
      </div>
      <ApprovalAwareFeedback command={decide} onApprovalId={setApprovalRef} />
    </div>
  );
}

function ExecuteDisposal({ disposal, onDone }: { readonly disposal: Disposal; readonly onDone: (t: string | null) => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const id = disposal.disposalApprovalId ?? '';
  const open = (disposal.lines ?? []).filter((l) => (l.remainingQty ?? 0) > 0);
  const [qty, setQty] = useState<string[]>(() => open.map((l) => String(l.remainingQty ?? 0)));
  const valid = open.some((_, i) => Number(qty[i]) > 0) && open.every((l, i) => Number(qty[i] || 0) >= 0 && Number(qty[i] || 0) <= (l.remainingQty ?? 0));
  const execute = useCommand(async (_: null, key) => {
    onDone(null);
    const x = await request(
      'POST',
      api.quality.POST('/disposal-approvals/{disposalApprovalId}/executions', {
        ...commandParams(key, { path: { disposalApprovalId: id } }),
        body: {
          lines: open
            .map((l, i) => ({ sku: l.sku ?? '', lotId: l.lotId ?? '', locationCode: l.locationCode ?? '', qty: Number(qty[i] || 0) }))
            .filter((l) => l.qty > 0),
        },
      }),
    );
    if (x.state === 'UNKNOWN_RESULT') throw new UnknownResultFailure(x.state, x.executionId);
    onDone(x.state === 'APPLIED' ? m.executed : x.state === 'REJECTED' ? m.executionRejected(x.rejectReason ?? '') : null);
    await queryClient.invalidateQueries({ queryKey: ['disposal', id] });
    return x;
  });
  return (
    <form
      className="space-y-2 border-t border-base-200 pt-3"
      aria-label={m.execute}
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        if (execute.phase.kind === 'rejected' || execute.phase.kind === 'done') execute.reset();
        void execute.run(null);
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        {open.map((l, i) => (
          <label key={`${l.lotId ?? ''}-${l.locationCode ?? ''}`} className="flex flex-col gap-1">
            {m.executeQty(l.locationCode ?? '', l.lotId ?? '')}
            <input
              className="input input-sm w-24"
              type="number"
              min={0}
              max={l.remainingQty}
              step={1}
              value={qty[i] ?? ''}
              onChange={(e) => setQty((prev) => prev.map((q, j) => (j === i ? e.target.value : q)))}
            />
          </label>
        ))}
        <button type="submit" className="btn btn-sm btn-error" disabled={!valid || execute.busy}>
          {m.execute}
        </button>
      </div>
      <CommandFeedback command={execute} />
    </form>
  );
}

// ---------------------------------------------------------------- 회수품 검수

interface VerdictInput {
  readonly verdict: 'RESALE' | 'DISPOSE';
  readonly temperatureZone: 'AMBIENT' | 'CHILLED' | 'FROZEN';
  readonly opened: boolean;
  readonly fresh: boolean;
  readonly disposeReason: NonNullable<InspectionLine['disposeReason']>;
}
const defaultVerdict: VerdictInput = { verdict: 'DISPOSE', temperatureZone: 'AMBIENT', opened: false, fresh: false, disposeReason: 'OTHER' };
const resaleBlocked = (v: VerdictInput) => v.verdict === 'RESALE' && (v.temperatureZone !== 'AMBIENT' || v.opened || v.fresh);

function InspectionsTab({ mfcId }: { readonly mfcId: string }) {
  const [receiptId, setReceiptId] = useParam('returnReceiptId');
  const [inspectionId, setInspectionId] = useParam('inspectionId');
  return (
    <div className="max-w-4xl space-y-3 text-sm">
      <p className="text-xs opacity-70">{m.inspectionHint}</p>
      <LookupForm key={`r-${receiptId}`} label={m.receiptId} value={receiptId} onSubmit={setReceiptId} />
      {receiptId && <InspectReceipt key={receiptId} mfcId={mfcId} receiptId={receiptId} onInspected={setInspectionId} />}
      <LookupForm key={`i-${inspectionId}`} label={m.inspectionId} value={inspectionId} onSubmit={setInspectionId} />
      {inspectionId && <InspectionView id={inspectionId} />}
    </div>
  );
}

function InspectReceipt({ mfcId, receiptId, onInspected }: { readonly mfcId: string; readonly receiptId: string; readonly onInspected: (id: string) => void }) {
  const api = useApi();
  const { session } = useSession();
  const query = useQuery({
    queryKey: ['return-receipt', receiptId],
    queryFn: () => request('GET', api.inbound.GET('/return-receipts/{returnReceiptId}', { params: { path: { returnReceiptId: receiptId } } })),
  });
  const [verdicts, setVerdicts] = useState<Record<number, VerdictInput>>({});
  const inspect = useCommand(async (_: null, key) => {
    const rr = query.data!;
    const r = checkCommand(
      await request(
        'POST',
        api.quality.POST('/return-inspections', {
          ...commandParams(key),
          body: {
            mfcId,
            claimId: rr.claimId ?? '',
            returnReceiptId: receiptId,
            inspectedBy: session?.subject ?? '',
            lines: (rr.lines ?? []).map((l, i) => {
              const v = verdicts[i] ?? defaultVerdict;
              return {
                ...(l.orderLineId ? { orderLineId: l.orderLineId } : {}),
                sku: l.sku ?? '',
                ...(l.lotId ? { lotId: l.lotId } : {}),
                qty: l.qty ?? 0,
                verdict: v.verdict,
                temperatureZone: v.temperatureZone,
                opened: v.opened,
                fresh: v.fresh,
                ...(v.verdict === 'DISPOSE' ? { disposeReason: v.disposeReason } : {}),
              };
            }),
          },
        }),
      ),
    );
    if (r.resultId) onInspected(r.resultId);
    await query.refetch();
    return r;
  });
  return (
    <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
      {(rr) => {
        const lines = rr.lines ?? [];
        const blocked = lines.some((_, i) => resaleBlocked(verdicts[i] ?? defaultVerdict));
        const set = (i: number, patch: Partial<VerdictInput>) => setVerdicts((prev) => ({ ...prev, [i]: { ...(prev[i] ?? defaultVerdict), ...patch } }));
        if (rr.inspectionState !== 'PENDING' || rr.inventoryApplyStatus !== 'APPLIED') return <p className="opacity-70">{m.notPending}</p>;
        return (
          <form
            className="space-y-2 rounded-box bg-base-100 p-4"
            aria-label={m.submitInspection}
            onSubmit={(e) => {
              e.preventDefault();
              if (blocked) return;
              if (inspect.phase.kind === 'rejected' || inspect.phase.kind === 'done') inspect.reset();
              void inspect.run(null);
            }}
          >
            <p className="opacity-70">
              {`${rr.claimId ?? ''} · ${rr.toLocationCode ?? ''} · `}
              <Who id={rr.receivedBy} />
            </p>
            {lines.map((l, i) => {
              const v = verdicts[i] ?? defaultVerdict;
              return (
                <fieldset key={`${l.sku ?? ''}-${i}`} className="flex flex-wrap items-end gap-2 border-b border-base-200 pb-2" aria-label={`${l.sku ?? ''} × ${l.qty ?? 0}`}>
                  <span className="w-40 font-mono">{`${l.sku ?? ''} × ${l.qty ?? 0}`}</span>
                  <label className="flex flex-col gap-1">
                    {m.verdictLabel}
                    <select className="select select-sm w-24" value={v.verdict} onChange={(e) => set(i, { verdict: e.target.value as VerdictInput['verdict'] })}>
                      <option value="RESALE">{m.verdict.RESALE}</option>
                      <option value="DISPOSE">{m.verdict.DISPOSE}</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    {m.temperatureZone}
                    <select className="select select-sm w-24" value={v.temperatureZone} onChange={(e) => set(i, { temperatureZone: e.target.value as VerdictInput['temperatureZone'] })}>
                      {(['AMBIENT', 'CHILLED', 'FROZEN'] as const).map((t) => (
                        <option key={t} value={t}>
                          {m.temperature[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" className="checkbox checkbox-xs" checked={v.opened} onChange={(e) => set(i, { opened: e.target.checked })} />
                    {m.opened}
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" className="checkbox checkbox-xs" checked={v.fresh} onChange={(e) => set(i, { fresh: e.target.checked })} />
                    {m.fresh}
                  </label>
                  {v.verdict === 'DISPOSE' && (
                    <label className="flex flex-col gap-1">
                      {m.disposeReason}
                      <select className="select select-sm w-28" value={v.disposeReason} onChange={(e) => set(i, { disposeReason: e.target.value as VerdictInput['disposeReason'] })}>
                        {(Object.keys(m.disposeReasons) as Array<VerdictInput['disposeReason']>).map((r) => (
                          <option key={r} value={r}>
                            {m.disposeReasons[r]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {resaleBlocked(v) && <span className="text-error text-xs">{m.resaleBlocked}</span>}
                </fieldset>
              );
            })}
            <button type="submit" className="btn btn-sm btn-primary" disabled={blocked || inspect.busy}>
              {m.submitInspection}
            </button>
            <CommandFeedback command={inspect} />
          </form>
        );
      }}
    </QueryState>
  );
}

function InspectionView({ id }: { readonly id: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['return-inspection', id],
    queryFn: () => request('GET', api.quality.GET('/return-inspections/{returnInspectionId}', { params: { path: { returnInspectionId: id } } })),
  });
  return (
    <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
      {(r) => (
        <div className="space-y-1 rounded-box bg-base-100 p-4" data-testid="inspection">
          <p className="flex flex-wrap items-center gap-2">
            <span className="badge badge-sm">{r.inventoryApplyStatus}</span>
          </p>
          <SystemNumbers ids={[{ label: m.sys.inspection, id: r.returnInspectionId }]} />
          <p>{`${m.resaleQty} ${r.resaleQty ?? 0} · ${m.disposeQty} ${r.disposeQty ?? 0}`}</p>
          {r.disposalApprovalId && <p>{`${m.disposalLink}: ${r.disposalApprovalId}`}</p>}
          <p className="opacity-70">{r.inspectedAt ? formatSeoul(r.inspectedAt) : ''}</p>
        </div>
      )}
    </QueryState>
  );
}
