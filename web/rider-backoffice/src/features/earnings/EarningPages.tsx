// 수행료(2026-11-17, PC 5): 산정 불가 조정(execution 0.13.0 — 귀책으로 지급/미지급, 바로 확정), 엘리베이터 고장 추가 배달료(0.19.0 — 승인·반려).
// 지급 처리(지급 중·완료·실패)는 외부 회계 — 화면에 없다(사용자 2026-11-17 "외부 회계를 기다려").
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import { useApi } from '../../app/ApiContext';
import { ops } from '../../shared/opsMessages';
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

export function SurchargesMenu() {
  const api = useApi();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['surcharge-requests'],
    queryFn: () => request('GET', api.execution.GET('/surcharge-requests', { params: { query: { state: 'REQUESTED', size: 50 } } })),
  });
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{e.surchargeTitle}</h1>
      <p className="text-sm opacity-70">{e.surchargeIntro}</p>
      <QueryState state={toUiState(list, (x) => (x.items ?? []).length === 0)} onRetry={() => void list.refetch()} emptyText={e.surchargeEmpty}>
        {(x) => (
          <ul className="space-y-3">
            {(x.items ?? []).map((it) => (
              <li key={it.requestId} className="rounded-box bg-base-100 p-4 text-sm" data-testid="surcharge-row">
                <p>
                  <Link className="link font-mono" to={`/deliveries/${encodeURIComponent(it.deliveryId)}`}>
                    {it.deliveryId}
                  </Link>
                  {' · '}
                  <Link className="link font-mono" to={`/riders/${encodeURIComponent(it.riderId)}`}>
                    {it.riderId}
                  </Link>
                  {` · ${it.floor}층 · ${won(it.amount)} · ${when(it.requestedAt)}`}
                </p>
                <p className="flex gap-2 text-xs">
                  {(it.evidenceRefs ?? []).map((ref, i) => (
                    <PhotoLink key={ref} deliveryId={it.deliveryId} photoRef={ref} index={i + 1} />
                  ))}
                </p>
                <SurchargeDecision requestId={it.requestId} onDone={() => void queryClient.invalidateQueries({ queryKey: ['surcharge-requests'] })} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </section>
  );
}

/** 증빙 사진 — 토큰이 필요한 원본이라 눌렀을 때 받아 새 창에 띄운다(저장하지 않음). */
function PhotoLink({ deliveryId, photoRef, index }: { readonly deliveryId: string; readonly photoRef: string; readonly index: number }) {
  const api = useApi();
  const open = async () => {
    const res = await api.execution.GET('/deliveries/{deliveryId}/evidence-photos/{photoRef}', {
      params: { path: { deliveryId, photoRef } },
      parseAs: 'blob',
    });
    if (res.data) window.open(URL.createObjectURL(res.data), '_blank', 'noopener');
  };
  return (
    <button type="button" className="link" onClick={() => void open()}>
      {e.photo(index)}
    </button>
  );
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
