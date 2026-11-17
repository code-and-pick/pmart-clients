// 라이더 찾기·상세·가입 승인·제한 검토(2026-11-17, PC 5 — ADR-0068 로 기본 백오피스에서 옮겨 오는 화면).
// - 찾기: rider `GET /riders`(ID·전화 완전 일치, 제한·운행 거르기, 가입·상태 바뀐 순 — 이름·전화 가림). 가입 승인 = 같은 목록 최근 가입 순 + 승인 상태(지금은 늘 자동 승인).
// - 상세: rider 상세·원문 열람(사유 → audit 기록)·계정 제한 바꾸기·이력, execution 직원용 수행료·운행시간, 이 라이더 배송 찾기로 가기.
// - 제한 검토: rider `GET /riders/restriction-reviews`·`POST …/decisions`.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/rider';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { Facts, label, none, when, won } from '../../shared/opsUi';

const r = ops.riders;
const n = messages.names;
type Restriction = components['schemas']['AccountRestriction'];
type OperatingStatus = components['schemas']['OperatingStatus'];
const RESTRICTIONS: readonly Restriction[] = ['NORMAL', 'DISPATCH_RESTRICTED', 'SUSPENDED', 'TERMINATED'];
const OPERATING: readonly OperatingStatus[] = ['ON_DUTY', 'OFF_DUTY'];
const PAGE_SIZE = 20;

export function RidersMenu() {
  return (
    <Routes>
      <Route index element={<RiderSearchPage />} />
      <Route path=":riderId" element={<RiderDetailPage />} />
    </Routes>
  );
}

export function SignupsMenu() {
  return <RiderSearchPage signups />;
}

function RiderSearchPage({ signups = false }: { readonly signups?: boolean }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const riderId = params.get('riderId') ?? '';
  const phone = params.get('phone') ?? '';
  const rawR = params.get('restriction') ?? '';
  const restriction = (RESTRICTIONS as readonly string[]).includes(rawR) ? (rawR as Restriction) : undefined;
  const rawO = params.get('operatingStatus') ?? '';
  const operatingStatus = (OPERATING as readonly string[]).includes(rawO) ? (rawO as OperatingStatus) : undefined;
  const page = Number(params.get('page') ?? '0') || 0;
  const [draft, setDraft] = useState({ riderId, phone });

  const set = (next: Partial<Record<'riderId' | 'phone' | 'restriction' | 'operatingStatus' | 'page', string>>) => {
    const v = { riderId, phone, restriction: restriction ?? '', operatingStatus: operatingStatus ?? '', page: '', ...next };
    setParams(Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x !== '0')));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    set({ riderId: draft.riderId.trim(), phone: draft.phone.trim() });
  };
  const query = useQuery({
    queryKey: ['riders', riderId, phone, restriction, operatingStatus, page],
    queryFn: () =>
      request(
        'GET',
        api.riders.GET('/riders', {
          params: {
            query: {
              size: PAGE_SIZE,
              page,
              sort: 'JOINED_DESC',
              ...(riderId ? { riderId } : {}),
              ...(phone ? { phone } : {}),
              ...(restriction ? { restriction } : {}),
              ...(operatingStatus ? { operatingStatus } : {}),
            },
          },
        }),
      ),
  });
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{signups ? ops.signups.title : r.title}</h1>
      <p className="text-sm opacity-70">{signups ? ops.signups.intro : r.intro}</p>
      {signups && (
        <p role="note" className="alert alert-info text-sm">
          {ops.signups.autoNote}
        </p>
      )}
      {!signups && (
        <form className="flex flex-wrap items-end gap-3 rounded-box bg-base-100 p-3 text-sm" onSubmit={submit}>
          <label className="flex flex-col gap-1">
            {r.riderId}
            <input className="input input-sm w-44" value={draft.riderId} maxLength={64} onChange={(e) => setDraft({ ...draft, riderId: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            {r.phone}
            <input className="input input-sm w-40" value={draft.phone} maxLength={20} inputMode="tel" onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          </label>
          <button type="submit" className="btn btn-sm btn-primary">
            {r.search}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setDraft({ riderId: '', phone: '' });
              setParams({});
            }}
          >
            {r.reset}
          </button>
          <label className="flex flex-col gap-1">
            {r.restriction}
            <select className="select select-sm w-36" value={restriction ?? ''} onChange={(e) => set({ restriction: e.target.value })}>
              <option value="">{r.allRestrictions}</option>
              {RESTRICTIONS.map((x) => (
                <option key={x} value={x}>
                  {label(n.restriction, x)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            {r.operating}
            <select className="select select-sm w-28" value={operatingStatus ?? ''} onChange={(e) => set({ operatingStatus: e.target.value })}>
              <option value="">{r.allOperating}</option>
              {OPERATING.map((x) => (
                <option key={x} value={x}>
                  {label(n.operatingStatus, x)}
                </option>
              ))}
            </select>
          </label>
        </form>
      )}
      <QueryState state={toUiState(query, (x) => (x.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={r.empty}>
        {(x) => (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="table table-sm rounded-box bg-base-100">
                <thead>
                  <tr>
                    <th>{r.col.rider}</th>
                    <th>{r.col.name}</th>
                    <th>{r.col.phone}</th>
                    <th>{r.col.vehicle}</th>
                    <th>{r.col.operating}</th>
                    <th>{r.col.restriction}</th>
                    <th>{r.col.signup}</th>
                    <th>{r.col.joinedAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {(x.items ?? []).map((row) => (
                    <tr key={row.riderId} data-testid="rider-row">
                      <td className="font-mono">
                        <Link className="link" to={`/riders/${encodeURIComponent(row.riderId ?? '')}`}>
                          {row.riderId}
                        </Link>
                      </td>
                      <td>{row.nameMasked ?? none}</td>
                      <td className="font-mono">{row.phoneMasked ?? none}</td>
                      <td>{label(n.vehicle, row.vehicleType)}</td>
                      <td>{label(n.operatingStatus, row.operatingStatus)}</td>
                      <td>{label(n.restriction, row.restriction)}</td>
                      <td>{row.signupStatus === 'APPROVED' ? r.signupAuto : label(n.signupStatus, row.signupStatus)}</td>
                      <td>{when(row.joinedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(page > 0 || x.hasNext) && (
              <div className="flex gap-2">
                {page > 0 && (
                  <button type="button" className="btn btn-sm" onClick={() => set({ page: String(page - 1) })}>
                    ←
                  </button>
                )}
                {x.hasNext && (
                  <button type="button" className="btn btn-sm" onClick={() => set({ page: String(page + 1) })}>
                    {r.more}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </QueryState>
    </section>
  );
}

function thisWeek(): { from: string; to: string } {
  const now = new Date(Date.now() + 9 * 3600_000); // Asia/Seoul 날짜
  const day = (now.getUTCDay() + 6) % 7; // 월요일 0
  const from = new Date(now.getTime() - day * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(now) };
}

function RiderDetailPage() {
  const api = useApi();
  const { riderId = '' } = useParams();
  const detail = useQuery({
    queryKey: ['rider', riderId],
    queryFn: () => request('GET', api.riders.GET('/riders/{riderId}', { params: { path: { riderId } } })),
  });
  const week = thisWeek();
  const earnings = useQuery({
    queryKey: ['rider-earnings', riderId],
    queryFn: () => request('GET', api.execution.GET('/rider-earnings', { params: { query: { riderId, size: 20 } } })),
  });
  const time = useQuery({
    queryKey: ['rider-operating-time', riderId, week.from],
    queryFn: () => request('GET', api.execution.GET('/rider-operating-time', { params: { query: { riderId, from: week.from, to: week.to } } })),
  });
  return (
    <section className="max-w-5xl space-y-4">
      <Link className="link text-sm" to="/riders">
        {r.back}
      </Link>
      <h1 className="text-xl font-bold">{r.detailTitle(riderId)}</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="font-bold">{r.info}</h2>
          <QueryState state={toUiState(detail)} onRetry={() => void detail.refetch()}>
            {(d) => (
              <div className="space-y-3">
                <Facts
                  testId="rider-detail"
                  rows={[
                    [r.col.name, d.nameMasked ?? none],
                    [r.col.phone, d.phoneMasked ?? none],
                    [r.col.vehicle, label(n.vehicle, d.vehicleType)],
                    [r.col.operating, label(n.operatingStatus, d.operating?.status)],
                    [r.col.restriction, label(n.restriction, d.restriction?.state)],
                    [r.signupStatus, d.signupStatus === 'APPROVED' && d.signupDecidedBy === 'AUTO' ? r.signupAuto : label(n.signupStatus, d.signupStatus)],
                    [r.areas, (d.deliveryAreas ?? []).map((a) => a.mfcId).join(', ') || none],
                    [r.col.joinedAt, when(d.joinedAt)],
                  ]}
                />
                <Link className="btn btn-sm" to={`/deliveries?riderId=${encodeURIComponent(riderId)}`}>
                  {r.deliveries}
                </Link>
                <RevealForm riderId={riderId} />
              </div>
            )}
          </QueryState>
          <RestrictionPanel riderId={riderId} />
        </div>
        <div className="space-y-3">
          <h2 className="font-bold">{r.operatingTime}</h2>
          <QueryState state={toUiState(time)} onRetry={() => void time.refetch()}>
            {(t) => (
              <p className="text-sm" data-testid="operating-time">
                {r.operatingTotal(`${Math.floor(t.totalSeconds / 3600)}시간 ${Math.floor((t.totalSeconds % 3600) / 60)}분`)}
              </p>
            )}
          </QueryState>
          <h2 className="font-bold">{r.earnings}</h2>
          <QueryState state={toUiState(earnings, (e) => (e.items ?? []).length === 0)} onRetry={() => void earnings.refetch()} emptyText={none}>
            {(e) => (
              <div className="space-y-2">
                <p className="text-sm">{r.earningsTotals(won(e.totals?.estimated), won(e.totals?.confirmed), won(e.totals?.paid))}</p>
                <table className="table table-sm rounded-box bg-base-100" data-testid="rider-earnings">
                  <thead>
                    <tr>
                      <th>{r.col2.delivery}</th>
                      <th>{r.col2.performedOn}</th>
                      <th>{r.col2.total}</th>
                      <th>{r.col2.state}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(e.items ?? []).map((it) => (
                      <tr key={it.earningId}>
                        <td className="font-mono text-xs">
                          <Link className="link" to={`/deliveries/${encodeURIComponent(it.deliveryId ?? '')}`}>
                            {it.deliveryId}
                          </Link>
                        </td>
                        <td>{when(it.recordedAt)}</td>
                        <td>{it.calculable ? won(it.total) : r.notCalculable}</td>
                        <td>{label(n.settlementState, it.settlementState)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </QueryState>
        </div>
      </div>
    </section>
  );
}

function RevealForm({ riderId }: { readonly riderId: string }) {
  const api = useApi();
  const [reason, setReason] = useState('');
  const reveal = useCommand(async (body: { reason: string }, key) =>
    request('POST', api.riders.POST('/riders/{riderId}/pii-reveals', { ...commandParams(key, { path: { riderId } }), body })),
  );
  return (
    <form
      className="space-y-2 rounded-box bg-base-100 p-4 text-sm"
      aria-label={r.reveal}
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim().length >= 2) void reveal.run({ reason: reason.trim() });
      }}
    >
      <h3 className="font-semibold">{r.reveal}</h3>
      <p className="text-xs opacity-60">{r.revealIntro}</p>
      <label className="block">
        {r.revealReason}
        <input className="input input-sm mt-1 w-full" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-sm" disabled={reason.trim().length < 2 || reveal.busy}>
        {r.revealDo}
      </button>
      <CommandFeedback command={reveal}>
        {(x) => (
          <p role="status" className="text-success" data-testid="pii-revealed">
            {r.revealed(x.name ?? none, x.phone ?? none)}
          </p>
        )}
      </CommandFeedback>
    </form>
  );
}

function RestrictionPanel({ riderId }: { readonly riderId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const history = useQuery({
    queryKey: ['rider-restrictions', riderId],
    queryFn: () => request('GET', api.riders.GET('/riders/{riderId}/restrictions', { params: { path: { riderId } } })),
  });
  const [to, setTo] = useState<Restriction | ''>('');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const change = useCommand(async (body: components['schemas']['RiderRestrictionChange'], key) => {
    try {
      return await request(
        'POST',
        api.riders.POST('/riders/{riderId}/restrictions', {
          ...commandParams(key, { path: { riderId }, ...(history.data?.version !== undefined ? { version: history.data.version } : {}) }),
          body,
        }),
      );
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['rider-restrictions', riderId] });
      void queryClient.invalidateQueries({ queryKey: ['rider', riderId] });
    }
  });
  return (
    <div className="space-y-2">
      <form
        className="space-y-2 rounded-box bg-base-100 p-4 text-sm"
        aria-label={r.restrict}
        onSubmit={(e) => {
          e.preventDefault();
          if (!to || !reason.trim()) return;
          void change.run({
            restriction: to,
            reason: reason.trim(),
            ...(until && to !== 'NORMAL' ? { until: new Date(`${until}T23:59:59+09:00`).toISOString() } : {}),
          });
        }}
      >
        <h3 className="font-semibold">{r.restrict}</h3>
        <p className="text-xs opacity-60">{r.restrictIntro}</p>
        <label className="block">
          {r.restrictTo}
          <select className="select select-sm mt-1 block" value={to} onChange={(e) => setTo(e.target.value as Restriction | '')}>
            <option value="">—</option>
            {RESTRICTIONS.map((x) => (
              <option key={x} value={x}>
                {label(n.restriction, x)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          {r.reason}
          <input className="input input-sm mt-1 w-full" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {to && to !== 'NORMAL' && (
          <label className="block">
            {r.until}
            <input type="date" className="input input-sm mt-1" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
        )}
        <button type="submit" className="btn btn-sm btn-warning" disabled={!to || !reason.trim() || change.busy}>
          {r.restrictDo}
        </button>
        <CommandFeedback command={change}>
          {() => (
            <p role="status" className="text-success">
              {r.restrictDone}
            </p>
          )}
        </CommandFeedback>
      </form>
      <h3 className="font-semibold">{r.restrictionHistory}</h3>
      <QueryState state={toUiState(history, (h) => (h.items ?? []).length === 0)} onRetry={() => void history.refetch()} emptyText={none}>
        {(h) => (
          <ol className="space-y-1 text-sm" data-testid="restriction-history">
            {(h.items ?? []).map((it, i) => (
              <li key={`${it.changedAt ?? ''}-${i}`}>{`${when(it.changedAt)} · ${label(n.restriction, it.previous)} → ${label(n.restriction, it.restriction)} · ${it.reason ?? ''}`}</li>
            ))}
          </ol>
        )}
      </QueryState>
    </div>
  );
}

export function RestrictionReviewsMenu() {
  const api = useApi();
  const queryClient = useQueryClient();
  const reviews = useQuery({
    queryKey: ['restriction-reviews'],
    queryFn: () => request('GET', api.riders.GET('/riders/restriction-reviews', { params: { query: { state: 'OPEN' } } })),
  });
  const v = ops.reviews;
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{v.title}</h1>
      <p className="text-sm opacity-70">{v.intro}</p>
      <QueryState state={toUiState(reviews, (x) => (x.items ?? []).length === 0)} onRetry={() => void reviews.refetch()} emptyText={v.empty}>
        {(x) => (
          <ul className="space-y-3">
            {(x.items ?? []).map((it) => (
              <li key={it.reviewId} className="rounded-box bg-base-100 p-4 text-sm" data-testid="review-row">
                <p>
                  <Link className="link font-mono" to={`/riders/${encodeURIComponent(it.riderId ?? '')}`}>
                    {it.riderId}
                  </Link>
                  {` · ${label(n.complaintType, it.complaintType)} · ${(it.complaints ?? []).length}건 · ${when(it.openedAt)}`}
                </p>
                <ReviewDecision reviewId={it.reviewId ?? ''} onDone={() => void queryClient.invalidateQueries({ queryKey: ['restriction-reviews'] })} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </section>
  );
}

function ReviewDecision({ reviewId, onDone }: { readonly reviewId: string; readonly onDone: () => void }) {
  const api = useApi();
  const [note, setNote] = useState('');
  const v = ops.reviews;
  const decide = useCommand(async (body: { decision: 'RESTRICTED' | 'DISMISSED'; note?: string }, key) => {
    try {
      return await request('POST', api.riders.POST('/riders/restriction-reviews/{reviewId}/decisions', { ...commandParams(key, { path: { reviewId } }), body }));
    } finally {
      onDone();
    }
  });
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        {v.note}
        <input className="input input-sm w-64" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {(['RESTRICTED', 'DISMISSED'] as const).map((d) => (
        <button key={d} type="button" className="btn btn-sm" disabled={decide.busy} onClick={() => void decide.run({ decision: d, ...(note.trim() ? { note: note.trim() } : {}) })}>
          {d === 'RESTRICTED' ? v.restricted : v.dismissed}
        </button>
      ))}
      <CommandFeedback command={decide}>{() => <span className="text-success">{v.done}</span>}</CommandFeedback>
    </div>
  );
}
