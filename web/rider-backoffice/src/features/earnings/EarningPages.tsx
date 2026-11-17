// 수행료(2026-11-17, PC 5): 산정 불가 조정(execution 0.13.0 — 귀책으로 지급/미지급, 바로 확정), 엘리베이터 고장 추가 배달료(0.19.0 — 승인·반려).
// 지급 처리(지급 중·완료·실패)는 외부 회계 — 화면에 없다(사용자 2026-11-17 "외부 회계를 기다려").
// 2026-11-18: 관리자 화면 모양 — 머리말, (추가 배달료) 검색 조건 상자, 결과 줄, 건마다 카드(머리 줄 + 항목 + 회색 처리 줄).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import { useApi } from '../../app/ApiContext';
import { ChipGroup, CursorPager, FieldList, PageHeader, ResultBar, SearchPanel, SearchRow, StatusBadge, type Tone } from '../../shared/admin';
import { ops } from '../../shared/opsMessages';
import { AuthedPhotos } from '../../shared/AuthedPhotos';
import { useEvidenceLoader } from '../../shared/evidenceLoader';
import { when, won } from '../../shared/opsUi';

const e = ops.earnings;
type Fault = 'RIDER' | 'CUSTOMER' | 'STORE' | 'PMART';

/** 건 카드 — 머리 줄(꼬리표·번호, 오른쪽 시각) + 내용 + 아래 회색 처리 줄 */
function ItemCard({ head, at, children, action, testId }: { readonly head: ReactNode; readonly at: ReactNode; readonly children?: ReactNode; readonly action: ReactNode; readonly testId: string }) {
  return (
    <li className="overflow-hidden rounded-box border border-base-300 bg-base-100 text-sm" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-200 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">{head}</div>
        <span className="text-xs text-base-content/55">{at}</span>
      </div>
      {children && <div className="space-y-3 px-5 py-3">{children}</div>}
      <div className="border-t border-base-200 bg-base-200/50 px-5 py-3">{action}</div>
    </li>
  );
}

const idLink = (to: string, text: string | undefined) => (
  <Link className="font-mono font-semibold hover:underline" to={to}>
    {text}
  </Link>
);

export function AdjustmentsMenu() {
  const api = useApi();
  const queryClient = useQueryClient();
  const queue = useQuery({
    queryKey: ['adjustment-queue'],
    queryFn: () => request('GET', api.execution.GET('/rider-earnings/adjustment-queue', { params: { query: { size: 50 } } })),
  });
  return (
    <section className="max-w-6xl space-y-4">
      <PageHeader title={e.adjustTitle} description={e.adjustIntro} />
      <QueryState state={toUiState(queue, (x) => (x.items ?? []).length === 0)} onRetry={() => void queue.refetch()} emptyText={e.empty}>
        {(x) => (
          <div className="space-y-3">
            <ResultBar count={(x.items ?? []).length} more={!!x.page?.nextCursor} />
            <ul className="space-y-3">
              {(x.items ?? []).map((it) => (
                <ItemCard
                  key={it.earningId}
                  testId="adjustment-row"
                  head={
                    <>
                      <StatusBadge tone="warning">산정 불가</StatusBadge>
                      <span className="font-mono text-base-content/70">{it.earningId}</span>
                    </>
                  }
                  at={when(it.recordedAt)}
                  action={<AdjustForm earningId={it.earningId ?? ''} onDone={() => void queryClient.invalidateQueries({ queryKey: ['adjustment-queue'] })} />}
                >
                  <FieldList
                    rows={[
                      [e.col.delivery, idLink(`/deliveries/${encodeURIComponent(it.deliveryId ?? '')}`, it.deliveryId)],
                      [e.col.rider, idLink(`/riders/${encodeURIComponent(it.riderId ?? '')}`, it.riderId)],
                      it.note ? [e.col.note, it.note] : null,
                    ]}
                  />
                </ItemCard>
              ))}
            </ul>
          </div>
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
      className="space-y-2"
      aria-label={`${e.adjust} ${earningId}`}
      onSubmit={(ev) => {
        ev.preventDefault();
        if (ok) void adjust.run({ fault, reason: reason.trim() });
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="text-base-content/60">{e.fault}</span>
          <select className="select select-sm w-32" value={fault} onChange={(ev) => setFault(ev.target.value as Fault | '')}>
            <option value="">—</option>
            {(Object.keys(e.faultName) as Fault[]).map((f) => (
              <option key={f} value={f}>
                {e.faultName[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-64 flex-1 items-center gap-2">
          <span className="whitespace-nowrap text-base-content/60">{e.reason}</span>
          <input className="input input-sm w-full" maxLength={300} value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </label>
        <button type="submit" className="btn btn-sm btn-primary w-20" disabled={!ok || adjust.busy || adjust.phase.kind === 'done'}>
          {e.adjust}
        </button>
      </div>
      <CommandFeedback command={adjust}>{() => <p className="text-success">{e.adjusted}</p>}</CommandFeedback>
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
  decidedLine: (state: string, at: string, by: string) => `${state} · ${at} · ${by}`,
  photo: '추가 배달료 사진',
} as const;
const surchargeTone = (s: string): Tone => (s === 'REQUESTED' ? 'warning' : s === 'APPROVED' ? 'success' : 'ghost');

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
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    patch({ riderId: riderInput.trim() });
  };
  const reset = () => {
    setRiderInput('');
    setParams({});
  };
  return (
    <section className="max-w-6xl space-y-4">
      <PageHeader title={e.surchargeTitle} description={e.surchargeIntro} />
      <SearchPanel onSubmit={submit} onReset={reset} submitLabel={f.search} resetLabel={f.reset}>
        <SearchRow label={f.state}>
          <ChipGroup
            label={f.state}
            value={state}
            options={[...SURCHARGE_STATES, 'ALL' as const].map((s) => ({ value: s, label: s === 'ALL' ? f.all : (f.stateName[s] ?? s) }))}
            onChange={(s) => patch({ state: s === 'REQUESTED' ? '' : s })}
          />
        </SearchRow>
        <SearchRow label="라이더">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-base-content/60">{f.riderId}</span>
            <input className="input input-sm w-44" maxLength={64} value={riderInput} onChange={(ev) => setRiderInput(ev.target.value)} />
          </label>
        </SearchRow>
      </SearchPanel>
      <QueryState state={toUiState(list, (x) => (x.items ?? []).length === 0)} onRetry={() => void list.refetch()} emptyText={e.surchargeEmpty}>
        {(x) => {
          const nextCursor = x.page?.nextCursor ?? null;
          return (
            <div className="space-y-3">
              <ResultBar count={(x.items ?? []).length} more={!!nextCursor} />
              <ul className="space-y-3">
                {(x.items ?? []).map((it) => (
                  <ItemCard
                    key={it.requestId}
                    testId="surcharge-row"
                    head={
                      <>
                        <StatusBadge tone={surchargeTone(it.state)}>{f.stateName[it.state] ?? it.state}</StatusBadge>
                        <span className="font-mono text-base-content/70">{it.requestId}</span>
                      </>
                    }
                    at={`${e.scol.requestedAt} ${when(it.requestedAt)}`}
                    action={
                      it.state === 'REQUESTED' ? (
                        <SurchargeDecision requestId={it.requestId} onDone={() => void queryClient.invalidateQueries({ queryKey: ['surcharge-requests'] })} />
                      ) : (
                        <div className="text-sm" data-testid="surcharge-decided">
                          <p className="text-base-content/70">
                            <span className="mr-2 font-medium text-base-content">처리</span>
                            {f.decidedLine(f.stateName[it.state] ?? it.state, when(it.decidedAt), it.decidedBy ?? '—')}
                          </p>
                          {it.decisionNote && <p className="mt-1 whitespace-pre-wrap">{it.decisionNote}</p>}
                        </div>
                      )
                    }
                  >
                    <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                      <FieldList
                        rows={[
                          [e.scol.delivery, idLink(`/deliveries/${encodeURIComponent(it.deliveryId)}`, it.deliveryId)],
                          [e.scol.rider, idLink(`/riders/${encodeURIComponent(it.riderId)}`, it.riderId)],
                          [e.scol.floor, `${it.floor}층`],
                          [e.scol.amount, <span className="font-semibold">{won(it.amount)}</span>],
                        ]}
                      />
                      <SurchargePhotos deliveryId={it.deliveryId} refs={it.evidenceRefs ?? []} />
                    </div>
                  </ItemCard>
                ))}
              </ul>
              <CursorPager hasPrev={!!cursor} nextCursor={nextCursor} onFirst={() => patch({ cursor: '' })} onNext={(c) => patch({ cursor: c })} />
            </div>
          );
        }}
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
  const locked = decide.busy || decide.phase.kind === 'done';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-sm btn-primary w-20" disabled={locked} onClick={() => void decide.run({ decision: 'APPROVE' })}>
          {e.approve}
        </button>
        <span className="h-5 border-l border-base-300" aria-hidden />
        <label className="flex min-w-64 flex-1 items-center gap-2">
          <span className="whitespace-nowrap text-base-content/60">{e.rejectNote}</span>
          <input className="input input-sm w-full" maxLength={300} value={note} onChange={(ev) => setNote(ev.target.value)} />
        </label>
        <button type="button" className="btn btn-sm w-20 border-base-300 bg-base-100" disabled={note.trim().length < 2 || locked} onClick={() => void decide.run({ decision: 'REJECT', note: note.trim() })}>
          {e.reject}
        </button>
      </div>
      <CommandFeedback command={decide}>{() => <p className="text-success">{e.decided}</p>}</CommandFeedback>
    </div>
  );
}
