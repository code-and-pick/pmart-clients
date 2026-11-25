// 실사 — cdc-inventory 0.8.0 `/cdcs/{cdcId}/count-sessions`(MFC 실사와 같게 — 사용자 "MFC 실사와 같게").
// - 시작 `POST`(칸 1~200, 사유) → 201 COUNTING. 칸이 잠기고(새 할당 후보에서 빠짐) 계수표에는 장부 수량이 없다.
// - 계수·재계수는 현장 PDA 일이라 이 화면에 없다. 상태가 PENDING_APPROVAL 이면 결정 `POST …/decisions`(APPROVE·REJECT·사유, 승인 번호는 본사 기준 이상일 때).
//   시작·계수한 사람은 결정할 수 없다(서버 422 SELF_APPROVAL). 결정 전에는 장부 수량을 보이지 않는다(서버가 주지 않음).
// - 실사 목록 조회는 계약에 없다 — 시작하면 그 실사로 가고, 번호로 연다(백엔드에 요청).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { FieldList } from '@pmart/web-ui/standard';
import { commandParams } from '../../api/command';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';

const c = messages.countSession;

function CountStateBadge({ state }: { readonly state: string | undefined }) {
  if (!state) return <>{messages.none}</>;
  const tone = state === 'PENDING_APPROVAL' ? 'badge-warning' : state === 'RECOUNT_REQUIRED' ? 'badge-warning' : state === 'COUNTING' ? 'badge-info' : state === 'REJECTED' ? 'badge-ghost' : 'badge-success';
  return <span className={`badge badge-sm ${tone}`}>{c.states[state] ?? state}</span>;
}

export function CountTab({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const sessionId = params.get('session') ?? '';
  const [codes, setCodes] = useState('');
  const [reason, setReason] = useState('');
  const [openId, setOpenId] = useState('');
  const go = (id: string) => {
    const q = new URLSearchParams(params);
    if (id) q.set('session', id);
    else q.delete('session');
    setParams(q, { replace: true });
  };
  const start = useCommand(async (body: { locationCodes: string[]; reason?: string }, key) =>
    request('POST', api.inventory.POST('/cdcs/{cdcId}/count-sessions', { ...commandParams(key, { path: { cdcId } }), body })),
  );
  const list = codes
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (list.length === 0 || list.length > 200) return;
    void start.run({ locationCodes: [...new Set(list)], ...(reason.trim() ? { reason: reason.trim() } : {}) }).then((phase) => {
      if (phase.kind === 'done' && phase.result.sessionId) {
        setCodes('');
        setReason('');
        go(phase.result.sessionId);
      }
    });
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-base-content/60">{c.lead}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <form className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4" onSubmit={submit} data-testid="count-start">
          <h2 className="text-base font-semibold">{c.start}</h2>
          <label className="flex flex-col gap-1 text-sm">
            {c.codes}
            <textarea className="textarea textarea-sm h-24 font-mono" value={codes} onChange={(e) => setCodes(e.target.value)} data-testid="count-codes" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {c.reason}
            <input className="input input-sm" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-sm btn-primary" disabled={list.length === 0 || list.length > 200 || start.busy} data-testid="count-start-go">
            {c.start}
          </button>
          <CommandFeedback command={start} />
        </form>
        <form
          className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (openId.trim()) go(openId.trim());
          }}
        >
          <h2 className="text-base font-semibold">{c.openById}</h2>
          <div className="flex gap-2">
            <input className="input input-sm w-56" value={openId} placeholder={c.idPlaceholder} onChange={(e) => setOpenId(e.target.value)} aria-label={c.openById} />
            <button type="submit" className="btn btn-sm" disabled={!openId.trim()}>
              {c.open}
            </button>
          </div>
          <p className="text-xs text-base-content/55">{c.listMissing}</p>
        </form>
      </div>
      {sessionId && <CountSessionView cdcId={cdcId} sessionId={sessionId} />}
    </div>
  );
}

function CountSessionView({ cdcId, sessionId }: { readonly cdcId: string; readonly sessionId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'count-session', sessionId],
    queryFn: () => request('GET', api.inventory.GET('/cdcs/{cdcId}/count-sessions/{sessionId}', { params: { path: { cdcId, sessionId } } })),
    // 현장 계수를 기다리는 동안 15초마다 다시 읽는다
    refetchInterval: (q) => (q.state.data?.state === 'COUNTING' || q.state.data?.state === 'RECOUNT_REQUIRED' ? 15_000 : false),
  });
  const [reason, setReason] = useState('');
  const [approvalRef, setApprovalRef] = useState('');
  const decide = useCommand(async (body: { decision: 'APPROVE' | 'REJECT'; reason: string; approvalRef?: string }, key) =>
    request('POST', api.inventory.POST('/cdcs/{cdcId}/count-sessions/{sessionId}/decisions', { ...commandParams(key, { path: { cdcId, sessionId } }), body })),
  );
  const send = (decision: 'APPROVE' | 'REJECT') => {
    if (!reason.trim()) return;
    void decide.run({ decision, reason: reason.trim(), ...(approvalRef.trim() ? { approvalRef: approvalRef.trim() } : {}) }).then((phase) => {
      if (phase.kind === 'done') void queryClient.invalidateQueries({ queryKey: ['cdc', cdcId, 'count-session', sessionId] });
    });
  };
  return (
    <section className="space-y-3" data-testid="count-session">
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(s) => (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold">{c.session(s.sessionId ?? sessionId)}</h2>
              <CountStateBadge state={s.state} />
            </div>
            <div className="rounded-box border border-base-300 bg-base-100 p-4">
              <FieldList
                rows={[
                  [c.locations, (s.locationCodes ?? []).join(', ') || messages.none],
                  [c.startedBy, s.startedBy ?? messages.none],
                  [c.firstCounter, s.firstCounterId ?? messages.none],
                  [c.recounter, s.recounterId ?? messages.none],
                  [c.decidedBy, s.decidedBy ?? messages.none],
                  [c.createdAt, s.createdAt ? formatSeoul(s.createdAt) : messages.none],
                  [c.decidedAt, s.decidedAt ? formatSeoul(s.decidedAt) : messages.none],
                  [c.reason, s.reason ?? messages.none],
                ]}
              />
            </div>
            {(s.state === 'COUNTING' || s.state === 'RECOUNT_REQUIRED') && <p className="text-sm text-base-content/60">{c.waitCount}</p>}
            {s.lines && s.lines.length > 0 ? (
              <>
                <h3 className="text-sm font-semibold">{c.lines}</h3>
                <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
                  <table className="table table-sm" data-testid="count-lines">
                    <thead>
                      <tr>
                        <th>{messages.locStock.location}</th>
                        <th>{messages.inventory.sku}</th>
                        <th>{messages.inventory.lot}</th>
                        <th className="text-right">{c.book}</th>
                        <th className="text-right">{c.first}</th>
                        <th className="text-right">{c.final}</th>
                        <th className="text-right">{c.delta}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.lines.map((l) => (
                        <tr key={`${l.locationCode}-${l.sku}-${l.lot}`}>
                          <td className="font-mono text-xs">{l.locationCode}</td>
                          <td className="font-mono text-xs">{l.sku}</td>
                          <td className="font-mono text-xs">{l.lot}</td>
                          <td className="text-right tabular-nums">{messages.qty(l.bookQty ?? 0)}</td>
                          <td className="text-right tabular-nums">{messages.qty(l.firstQty ?? 0)}</td>
                          <td className="text-right tabular-nums">{messages.qty(l.finalQty ?? 0)}</td>
                          <td className={`text-right tabular-nums font-semibold ${(l.deltaQty ?? 0) < 0 ? 'text-error' : (l.deltaQty ?? 0) > 0 ? 'text-success' : ''}`}>{l.deltaQty ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold">{c.sheet}</h3>
                <ul className="flex flex-wrap gap-2 text-xs" data-testid="count-sheet">
                  {(s.sheet ?? []).map((x) => (
                    <li key={`${x.locationCode}-${x.sku}-${x.lot}`} className="badge badge-outline font-mono">{`${x.locationCode} · ${x.sku} · ${x.lot}`}</li>
                  ))}
                </ul>
              </>
            )}
            {s.state === 'PENDING_APPROVAL' && (
              <div className="space-y-3 rounded-box border border-warning/40 bg-base-100 p-4" data-testid="count-decide">
                <h3 className="text-sm font-semibold">{c.decide}</h3>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    {c.decisionReason}
                    <input className="input input-sm w-72" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="count-decision-reason" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    {c.approvalRef}
                    <input className="input input-sm w-56" value={approvalRef} maxLength={128} onChange={(e) => setApprovalRef(e.target.value)} />
                  </label>
                  <button type="button" className="btn btn-sm btn-primary" disabled={!reason.trim() || decide.busy} onClick={() => send('APPROVE')} data-testid="count-approve">
                    {c.approve}
                  </button>
                  <button type="button" className="btn btn-sm" disabled={!reason.trim() || decide.busy} onClick={() => send('REJECT')} data-testid="count-reject">
                    {c.reject}
                  </button>
                </div>
              </div>
            )}
            <CommandFeedback command={decide}>{() => <p role="status" className="alert alert-success text-sm">{c.decided}</p>}</CommandFeedback>
          </>
        )}
      </QueryState>
    </section>
  );
}
