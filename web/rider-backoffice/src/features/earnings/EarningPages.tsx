// 수행료(2026-11-17, PC 5): 산정 불가 조정(execution 0.13.0 — 귀책으로 지급/미지급, 바로 확정), 엘리베이터 고장 추가 배달료(0.19.0 — 승인·반려).
// 지급 처리(지급 중·완료·실패)는 외부 회계 — 화면에 없다(사용자 2026-11-17 "외부 회계를 기다려").
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import { useApi } from '../../app/ApiContext';
import { ops } from '../../shared/opsMessages';
import { AuthedPhotos } from '../../shared/AuthedPhotos';
import { useEvidenceLoader } from '../../shared/evidenceLoader';
import { when, won } from '../../shared/opsUi';

const e = ops.earnings;
type Fault = 'RIDER' | 'CUSTOMER' | 'STORE' | 'PMART';

export function AdjustmentsMenu() {
  const api = useApi();
  const queryClient = useQueryClient();
  const queue = useQuery({
    queryKey: ['adjustment-queue'],
    queryFn: () => request('GET', api.execution.GET('/rider-earnings/adjustment-queue', { params: { query: { size: 50 } } })),
  });
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{e.adjustTitle}</h1>
      <p className="text-sm opacity-70">{e.adjustIntro}</p>
      <QueryState state={toUiState(queue, (x) => (x.items ?? []).length === 0)} onRetry={() => void queue.refetch()} emptyText={e.empty}>
        {(x) => (
          <ul className="space-y-3">
            {(x.items ?? []).map((it) => (
              <li key={it.earningId} className="rounded-box bg-base-100 p-4 text-sm" data-testid="adjustment-row">
                <p>
                  <span className="font-mono">{it.earningId}</span>
                  {' · '}
                  <Link className="link font-mono" to={`/deliveries/${encodeURIComponent(it.deliveryId ?? '')}`}>
                    {it.deliveryId}
                  </Link>
                  {' · '}
                  <Link className="link font-mono" to={`/riders/${encodeURIComponent(it.riderId ?? '')}`}>
                    {it.riderId}
                  </Link>
                  {` · ${when(it.recordedAt)}`}
                </p>
                {it.note && <p className="text-xs opacity-70">{it.note}</p>}
                <AdjustForm earningId={it.earningId ?? ''} onDone={() => void queryClient.invalidateQueries({ queryKey: ['adjustment-queue'] })} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </section>
  );
}

function AdjustForm({ earningId, onDone }: { readonly earningId: string; readonly onDone: () => void }) {
  const api = useApi();
  const [fault, setFault] = useState<Fault | ''>('');
  const [reason, setReason] = useState('');
  const adjust = useCommand(async (body: { fault: Fault; reason: string }, key) => {
    try {
      return await request('POST', api.execution.POST('/rider-earnings/{earningId}/adjustments', { ...commandParams(key, { path: { earningId } }), body }));
    } finally {
      onDone();
    }
  });
  const ok = fault !== '' && reason.trim().length >= 2;
  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2"
      aria-label={`${e.adjust} ${earningId}`}
      onSubmit={(ev) => {
        ev.preventDefault();
        if (ok) void adjust.run({ fault, reason: reason.trim() });
      }}
    >
      <label className="flex flex-col gap-1">
        {e.fault}
        <select className="select select-sm" value={fault} onChange={(ev) => setFault(ev.target.value as Fault | '')}>
          <option value="">—</option>
          {(Object.keys(e.faultName) as Fault[]).map((f) => (
            <option key={f} value={f}>
              {e.faultName[f]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        {e.reason}
        <input className="input input-sm w-64" maxLength={300} value={reason} onChange={(ev) => setReason(ev.target.value)} />
      </label>
      <button type="submit" className="btn btn-sm btn-primary" disabled={!ok || adjust.busy || adjust.phase.kind === 'done'}>
        {e.adjust}
      </button>
      <CommandFeedback command={adjust}>{() => <span className="text-success">{e.adjusted}</span>}</CommandFeedback>
    </form>
  );
}

type SurchargeState = 'REQUESTED' | 'APPROVED' | 'REJECTED';
const SURCHARGE_STATES: readonly SurchargeState[] = ['REQUESTED', 'APPROVED', 'REJECTED'];
const surchargeFilter = {
  state: '상태',
  all: '전체',
  stateName: { REQUESTED: '신청', APPROVED: '승인', REJECTED: '반려' } as Readonly<Record<string, string>>,
  riderId: '라이더 ID(완전 일치)',
  search: '찾기',
  reset: '지우기',
  next: '다음',
  first: '처음으로',
  decidedLine: (state: string, at: string, by: string) => `${state} · ${at} · ${by}`,
  photo: '추가 배달료 사진',
} as const;

/** 추가 배달료 신청(execution 0.19.0 `GET /surcharge-requests?state=&riderId=`) — 거르기·쪽은 주소 쿼리, 기본은 신청(오래된 것 먼저). */
export function SurchargesMenu() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const raw = params.get('state');
  const state: SurchargeState | 'ALL' = raw === 'ALL' ? 'ALL' : SURCHARGE_STATES.find((s) => s === raw) ?? 'REQUESTED';
  const riderId = params.get('riderId') ?? '';
  const cursor = params.get('cursor') ?? '';
  const [riderInput, setRiderInput] = useState(riderId);
  const patch = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (!('cursor' in next)) p.delete('cursor');
    setParams(p);
  };
  const list = useQuery({
    queryKey: ['surcharge-requests', state, riderId, cursor],
    queryFn: () =>
      request(
        'GET',
        api.execution.GET('/surcharge-requests', {
          params: { query: { size: 50, ...(state === 'ALL' ? {} : { state }), ...(riderId ? { riderId } : {}), ...(cursor ? { cursor } : {}) } },
        }),
      ),
  });
  const f = surchargeFilter;
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{e.surchargeTitle}</h1>
      <p className="text-sm opacity-70">{e.surchargeIntro}</p>
      <div className="flex flex-wrap items-end gap-3 rounded-box bg-base-100 p-3">
        <div role="tablist" aria-label={f.state} className="tabs tabs-box w-fit">
          {[...SURCHARGE_STATES, 'ALL' as const].map((s) => (
            <button key={s} type="button" role="tab" aria-selected={s === state} className={`tab ${s === state ? 'tab-active' : ''}`} onClick={() => patch({ state: s === 'REQUESTED' ? '' : s })}>
              {s === 'ALL' ? f.all : (f.stateName[s] ?? s)}
            </button>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            patch({ riderId: riderInput.trim() });
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            {f.riderId}
            <input className="input input-sm w-40" value={riderInput} onChange={(ev) => setRiderInput(ev.target.value)} />
          </label>
          <button type="submit" className="btn btn-sm">
            {f.search}
          </button>
          {riderId && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setRiderInput('');
                patch({ riderId: '' });
              }}
            >
              {f.reset}
            </button>
          )}
        </form>
      </div>
      <QueryState state={toUiState(list, (x) => (x.items ?? []).length === 0)} onRetry={() => void list.refetch()} emptyText={e.surchargeEmpty}>
        {(x) => (
          <div className="space-y-3">
            <ul className="space-y-3">
              {(x.items ?? []).map((it) => (
                <li key={it.requestId} className="space-y-2 rounded-box bg-base-100 p-4 text-sm" data-testid="surcharge-row">
                  <p>
                    <span className={`badge badge-sm mr-2 ${it.state === 'REQUESTED' ? 'badge-warning' : it.state === 'APPROVED' ? 'badge-success' : 'badge-ghost'}`}>{f.stateName[it.state] ?? it.state}</span>
                    <Link className="link font-mono" to={`/deliveries/${encodeURIComponent(it.deliveryId)}`}>
                      {it.deliveryId}
                    </Link>
                    {' · '}
                    <Link className="link font-mono" to={`/riders/${encodeURIComponent(it.riderId)}`}>
                      {it.riderId}
                    </Link>
                    {` · ${it.floor}층 · ${won(it.amount)} · ${when(it.requestedAt)}`}
                  </p>
                  <SurchargePhotos deliveryId={it.deliveryId} refs={it.evidenceRefs ?? []} />
                  {it.state === 'REQUESTED' ? (
                    <SurchargeDecision requestId={it.requestId} onDone={() => void queryClient.invalidateQueries({ queryKey: ['surcharge-requests'] })} />
                  ) : (
                    <p className="text-xs opacity-80" data-testid="surcharge-decided">
                      {f.decidedLine(f.stateName[it.state] ?? it.state, when(it.decidedAt), it.decidedBy ?? '—')}
                      {it.decisionNote && <span className="block whitespace-pre-wrap">{it.decisionNote}</span>}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              {cursor && (
                <button type="button" className="btn btn-sm" onClick={() => patch({ cursor: '' })}>
                  {f.first}
                </button>
              )}
              {x.page?.nextCursor && (
                <button type="button" className="btn btn-sm" onClick={() => patch({ cursor: x.page?.nextCursor ?? '' })}>
                  {f.next}
                </button>
              )}
            </div>
          </div>
        )}
      </QueryState>
    </section>
  );
}

/** 추가 배달료 사진 — 공통 AuthedPhotos(토큰 붙여 받기·떠나면 해제·못 받으면 "불러오지 못함"). 예전 "새 창으로 열기"는 object URL 을 풀지 않아 바꿈. */
function SurchargePhotos({ deliveryId, refs }: { readonly deliveryId: string; readonly refs: readonly string[] }) {
  const load = useEvidenceLoader(deliveryId);
  return <AuthedPhotos refs={refs} load={load} label={surchargeFilter.photo} heading={false} />;
}
function SurchargeDecision({ requestId, onDone }: { readonly requestId: string; readonly onDone: () => void }) {
  const api = useApi();
  const [note, setNote] = useState('');
  const decide = useCommand(async (body: { decision: 'APPROVE' | 'REJECT'; note?: string }, key) => {
    try {
      return await request('POST', api.execution.POST('/surcharge-requests/{requestId}/decisions', { ...commandParams(key, { path: { requestId } }), body }));
    } finally {
      onDone();
    }
  });
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <button type="button" className="btn btn-sm btn-primary" disabled={decide.busy || decide.phase.kind === 'done'} onClick={() => void decide.run({ decision: 'APPROVE' })}>
        {e.approve}
      </button>
      <label className="flex flex-col gap-1">
        {e.rejectNote}
        <input className="input input-sm w-56" maxLength={300} value={note} onChange={(ev) => setNote(ev.target.value)} />
      </label>
      <button
        type="button"
        className="btn btn-sm"
        disabled={note.trim().length < 2 || decide.busy || decide.phase.kind === 'done'}
        onClick={() => void decide.run({ decision: 'REJECT', note: note.trim() })}
      >
        {e.reject}
      </button>
      <CommandFeedback command={decide}>{() => <span className="text-success">{e.decided}</span>}</CommandFeedback>
    </div>
  );
}
