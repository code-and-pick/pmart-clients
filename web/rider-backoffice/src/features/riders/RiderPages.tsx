// 라이더 찾기·상세·가입 승인·제한 검토(2026-11-17, PC 5 — ADR-0068 로 기본 백오피스에서 옮겨 오는 화면).
// - 찾기: rider `GET /riders`(ID·전화 완전 일치, 제한·운행 거르기, 가입·상태 바뀐 순 — 이름·전화 가림). 가입 승인 = 같은 목록 최근 가입 순 + 승인 상태(지금은 늘 자동 승인).
// - 상세: rider 상세(정산계좌 등록 여부·은행 이름, 지금 동의한 버전 — rider 0.10.0)·원문 열람(사유 → audit 기록)·계정 제한 바꾸기·이력,
//   execution 직원용 수행료·운행시간, dispatch 배정 이력(`GET /rider-assignments` — dispatch 0.8.0), 이 라이더 배송 찾기로 가기.
// - 제한 검토: rider `GET /riders/restriction-reviews`·`POST …/decisions`.
// 꾸밈(2026-11-18): 배민 관리자 구성 — 목록은 검색 조건 상자 → 결과 줄 → 표, 상세는 머리 → 구역 탭 → 구역 상자(DeliveryPages 와 같은 틀).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/rider';
import { useApi } from '../../app/ApiContext';
import { ChipGroup, CursorPager, DataTable, DetailHeader, FieldList, Notice, PageHeader, ResultBar, SearchPanel, SearchRow, Section, SectionTabs, StatusBadge, type Tone } from '../../shared/admin';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { label, none, when, won } from '../../shared/opsUi';
import { riderMessages as rm } from './riderMessages';

const r = ops.riders;
const n = messages.names;
type Restriction = components['schemas']['AccountRestriction'];
type OperatingStatus = components['schemas']['OperatingStatus'];
const RESTRICTIONS: readonly Restriction[] = ['NORMAL', 'DISPATCH_RESTRICTED', 'SUSPENDED', 'TERMINATED'];
const OPERATING: readonly OperatingStatus[] = ['ON_DUTY', 'OFF_DUTY'];
const PAGE_SIZE = 20;

const restrictionTone = (s: string | null | undefined): Tone =>
  s === 'NORMAL' ? 'success' : s === 'DISPATCH_RESTRICTED' ? 'warning' : s === 'SUSPENDED' ? 'error' : s === 'TERMINATED' ? 'neutral' : 'ghost';
const operatingTone = (s: string | null | undefined): Tone => (s === 'ON_DUTY' ? 'info' : 'ghost');
const signupTone = (s: string | null | undefined): Tone => (s === 'APPROVED' ? 'success' : s === 'PENDING' ? 'warning' : s === 'REJECTED' ? 'error' : 'ghost');
const outcomeTone = (s: string | null | undefined): Tone => (s === 'CURRENT' ? 'info' : s === 'DONE' ? 'success' : s === 'RELEASED' ? 'warning' : 'ghost');
const signupText = (status: string | null | undefined, decidedBy?: string | null) =>
  status === 'APPROVED' && (decidedBy === undefined || decidedBy === 'AUTO') ? r.signupAuto : label(n.signupStatus, status);

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
  const navigate = useNavigate();
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
  const reset = () => {
    setDraft({ riderId: '', phone: '' });
    setParams({});
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
  const open = (id: string | undefined) => void navigate(`/riders/${encodeURIComponent(id ?? '')}`);
  return (
    <section className="space-y-4">
      <PageHeader title={signups ? ops.signups.title : r.title} description={signups ? ops.signups.intro : r.intro} />
      {signups && <Notice>{ops.signups.autoNote}</Notice>}
      {!signups && (
        <SearchPanel onSubmit={submit} onReset={reset} submitLabel={r.search} resetLabel={r.reset}>
          <SearchRow label={rm.findByNumber}>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-base-content/60">{r.riderId}</span>
              <input className="input input-sm w-44" value={draft.riderId} maxLength={64} onChange={(e) => setDraft({ ...draft, riderId: e.target.value })} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-base-content/60">{r.phone}</span>
              <input className="input input-sm w-40" value={draft.phone} maxLength={20} inputMode="tel" onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            </label>
          </SearchRow>
          <SearchRow label={r.restriction}>
            <ChipGroup
              label={r.restriction}
              value={restriction ?? ''}
              options={[{ value: '', label: r.allRestrictions }, ...RESTRICTIONS.map((x) => ({ value: x, label: label(n.restriction, x) }))]}
              onChange={(v) => set({ restriction: v })}
            />
          </SearchRow>
          <SearchRow label={r.operating}>
            <ChipGroup
              label={r.operating}
              value={operatingStatus ?? ''}
              options={[{ value: '', label: r.allOperating }, ...OPERATING.map((x) => ({ value: x, label: label(n.operatingStatus, x) }))]}
              onChange={(v) => set({ operatingStatus: v })}
            />
          </SearchRow>
        </SearchPanel>
      )}
      <QueryState state={toUiState(query, (x) => (x.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={r.empty}>
        {(x) => {
          const items = x.items ?? [];
          return (
            <div className="space-y-3">
              <ResultBar count={items.length} more={!!x.hasNext} />
              <DataTable>
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
                  {items.map((row) => (
                    <tr key={row.riderId} data-testid="rider-row" className="cursor-pointer" onClick={() => open(row.riderId)}>
                      <td className="font-mono font-semibold">
                        <Link className="hover:underline" to={`/riders/${encodeURIComponent(row.riderId ?? '')}`} onClick={(e) => e.stopPropagation()}>
                          {row.riderId}
                        </Link>
                      </td>
                      <td>{row.nameMasked ?? none}</td>
                      <td className="font-mono">{row.phoneMasked ?? none}</td>
                      <td>{label(n.vehicle, row.vehicleType)}</td>
                      <td>
                        <StatusBadge tone={operatingTone(row.operatingStatus)}>{label(n.operatingStatus, row.operatingStatus)}</StatusBadge>
                      </td>
                      <td>
                        <StatusBadge tone={restrictionTone(row.restriction)}>{label(n.restriction, row.restriction)}</StatusBadge>
                      </td>
                      <td>
                        <StatusBadge tone={signupTone(row.signupStatus)}>{signupText(row.signupStatus)}</StatusBadge>
                      </td>
                      <td className="whitespace-nowrap">{when(row.joinedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
              <CursorPager
                hasPrev={page > 0}
                nextCursor={x.hasNext ? String(page + 1) : null}
                page={page + 1}
                onFirst={() => set({ page: '' })}
                onNext={(c) => set({ page: c })}
              />
            </div>
          );
        }}
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

// 상세(2026-11-18 — 배민 주문내역 상세 참고): 머리(ID·제한·운행·가입 표시 + 요약) → 구역 탭 → 구역 상자.
// rider·execution·dispatch 는 서로 다른 서비스 값이라 구역도 따로, 못 읽은 구역만 오류.
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
  const d = detail.data;
  const tabs = [
    { id: 'sec-info', label: rm.tabs.info },
    { id: 'sec-account', label: rm.tabs.account },
    { id: 'sec-time', label: rm.tabs.time },
    { id: 'sec-earnings', label: rm.tabs.earnings },
    { id: 'sec-assignments', label: rm.tabs.assignments },
    { id: 'sec-restriction', label: rm.tabs.restriction },
  ];
  return (
    <section className="max-w-6xl space-y-4">
      <DetailHeader
        back={{ to: '/riders', label: r.back }}
        title={r.detailTitle(riderId)}
        badges={
          d && (
            <>
              <StatusBadge tone={restrictionTone(d.restriction?.state)}>{label(n.restriction, d.restriction?.state)}</StatusBadge>
              <StatusBadge tone={operatingTone(d.operating?.status)}>{label(n.operatingStatus, d.operating?.status)}</StatusBadge>
              <StatusBadge tone={signupTone(d.signupStatus)}>{signupText(d.signupStatus, d.signupDecidedBy ?? null)}</StatusBadge>
            </>
          )
        }
        summary={d && [d.nameMasked, d.phoneMasked, d.vehicleType ? label(n.vehicle, d.vehicleType) : null, d.joinedAt ? `${r.col.joinedAt} ${when(d.joinedAt)}` : null].filter(Boolean).join(' · ')}
        actions={
          <Link className="btn btn-sm border-base-300 bg-base-100" to={`/deliveries?riderId=${encodeURIComponent(riderId)}`}>
            {r.deliveries}
          </Link>
        }
      />
      <SectionTabs items={tabs} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section id="sec-info" title={r.info}>
          <QueryState state={toUiState(detail)} onRetry={() => void detail.refetch()}>
            {(x) => (
              <div className="space-y-4">
                <FieldList
                  testId="rider-detail"
                  rows={[
                    [r.col.name, x.nameMasked ?? none],
                    [r.col.phone, <span className="font-mono">{x.phoneMasked ?? none}</span>],
                    [r.col.vehicle, label(n.vehicle, x.vehicleType)],
                    [r.col.operating, label(n.operatingStatus, x.operating?.status)],
                    [r.col.restriction, label(n.restriction, x.restriction?.state)],
                    [r.signupStatus, signupText(x.signupStatus, x.signupDecidedBy ?? null)],
                    [r.areas, (x.deliveryAreas ?? []).map((a) => a.mfcId).join(', ') || none],
                    [r.col.joinedAt, when(x.joinedAt)],
                  ]}
                />
                <RevealForm riderId={riderId} />
              </div>
            )}
          </QueryState>
        </Section>
        <Section id="sec-account" title={rm.bank.title}>
          <QueryState state={toUiState(detail)} onRetry={() => void detail.refetch()}>
            {(x) => <AccountAndConsents detail={x} />}
          </QueryState>
        </Section>
        <Section id="sec-time" title={r.operatingTime}>
          <QueryState state={toUiState(time)} onRetry={() => void time.refetch()}>
            {(t) => (
              <p className="text-sm" data-testid="operating-time">
                {r.operatingTotal(`${Math.floor(t.totalSeconds / 3600)}시간 ${Math.floor((t.totalSeconds % 3600) / 60)}분`)}
                <span className="ml-2 text-base-content/50">{`${week.from} ~ ${week.to}`}</span>
              </p>
            )}
          </QueryState>
        </Section>
        <Section id="sec-earnings" title={r.earnings}>
          <QueryState state={toUiState(earnings, (e) => (e.items ?? []).length === 0)} onRetry={() => void earnings.refetch()} emptyText={none}>
            {(e) => (
              <div className="space-y-3">
                <p className="text-sm text-base-content/70">{r.earningsTotals(won(e.totals?.estimated), won(e.totals?.confirmed), won(e.totals?.paid))}</p>
                <DataTable testId="rider-earnings">
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
                        <td className="whitespace-nowrap">{when(it.recordedAt)}</td>
                        <td className="tabular-nums">{it.calculable ? won(it.total) : <StatusBadge tone="warning">{r.notCalculable}</StatusBadge>}</td>
                        <td>{label(n.settlementState, it.settlementState)}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </div>
            )}
          </QueryState>
        </Section>
      </div>
      <Section id="sec-assignments" title={rm.assignments.title} aside={<span className="text-xs text-base-content/50">{rm.assignments.intro}</span>}>
        <AssignmentHistory riderId={riderId} />
      </Section>
      <Section id="sec-restriction" title={rm.tabs.restriction} aside={<span className="text-xs text-base-content/50">{rm.restrictionAside}</span>}>
        <RestrictionPanel riderId={riderId} />
      </Section>
    </section>
  );
}

/** 정산계좌 등록 여부·은행 이름(계좌번호는 오지 않는다) + 지금 동의한 버전(항목마다 마지막만) */
function AccountAndConsents({ detail }: { readonly detail: components['schemas']['StaffRiderDetail'] }) {
  const consents = detail.consents ?? [];
  const registered = detail.bankAccountRegistered;
  return (
    <div className="space-y-4">
      <FieldList
        testId="rider-bank"
        rows={[
          [
            rm.bank.registered,
            registered === undefined ? none : <StatusBadge tone={registered ? 'success' : 'warning'}>{registered ? rm.bank.yes : rm.bank.no}</StatusBadge>,
          ],
          [rm.bank.bankName, detail.bankName ?? none],
        ]}
      />
      <p className="text-xs text-base-content/50">{rm.bank.numberNote}</p>
      <div className="space-y-2">
        <p className="text-sm font-semibold">{rm.consents.title}</p>
        <p className="text-xs text-base-content/50">{rm.consents.note}</p>
        {detail.consents === undefined ? (
          <p className="text-sm text-base-content/50">{none}</p>
        ) : consents.length === 0 ? (
          <p className="text-sm text-base-content/50">{rm.consents.empty}</p>
        ) : (
          <DataTable testId="rider-consents">
            <thead>
              <tr>
                <th>{rm.consents.col.type}</th>
                <th>{rm.consents.col.version}</th>
                <th>{rm.consents.col.agreedAt}</th>
              </tr>
            </thead>
            <tbody>
              {consents.map((c) => (
                <tr key={c.consentType}>
                  <td className="font-mono">{c.consentType}</td>
                  <td className="font-mono">{c.version}</td>
                  <td className="whitespace-nowrap">{when(c.agreedAt)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </div>
    </div>
  );
}

/** 배정 이력 — dispatch `GET /rider-assignments`(배정 최신순, cursor). 결과(outcome)·취소 기록은 서버 값 그대로 */
function AssignmentHistory({ riderId }: { readonly riderId: string }) {
  const api = useApi();
  const [cursor, setCursor] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const a = rm.assignments;
  const query = useQuery({
    queryKey: ['rider-assignments', riderId, cursor],
    queryFn: () =>
      request('GET', api.dispatch.GET('/rider-assignments', { params: { query: { riderId, size: PAGE_SIZE, ...(cursor ? { cursor } : {}) } } })),
  });
  return (
    <QueryState state={toUiState(query, (x) => (x.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={a.empty}>
      {(x) => {
        const items = x.items ?? [];
        const nextCursor = x.page?.nextCursor ?? null;
        return (
          <div className="space-y-3">
            <ResultBar count={items.length} more={!!nextCursor} />
            <DataTable testId="rider-assignments">
              <thead>
                <tr>
                  <th>{a.col.assignedAt}</th>
                  <th>{a.col.delivery}</th>
                  <th>{a.col.order}</th>
                  <th>{a.col.kind}</th>
                  <th>{a.col.source}</th>
                  <th>{a.col.fee}</th>
                  <th>{a.col.deliveryState}</th>
                  <th>{a.col.outcome}</th>
                  <th>{a.col.cancellation}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.offerId ?? `${it.deliveryId}-${i}`} data-testid="assignment-row">
                    <td className="whitespace-nowrap">{when(it.assignedAt)}</td>
                    <td className="font-mono font-semibold">
                      <Link className="hover:underline" to={`/deliveries/${encodeURIComponent(it.deliveryId)}`}>
                        {it.deliveryId}
                      </Link>
                    </td>
                    <td className="font-mono">{it.orderId ?? none}</td>
                    <td>{[it.type ? label(n.deliveryType, it.type) : null, it.purpose && it.purpose !== 'DELIVERY' ? label(n.purpose, it.purpose) : null].filter(Boolean).join(' · ') || none}</td>
                    <td>{label(a.source, it.source)}</td>
                    <td className="tabular-nums">{won(it.fee)}</td>
                    <td>{label(n.dispatchState, it.deliveryState)}</td>
                    <td>
                      <StatusBadge tone={outcomeTone(it.outcome)}>{label(a.outcome, it.outcome)}</StatusBadge>
                    </td>
                    <td className="text-xs">
                      {it.cancellation ? (
                        <span className="flex flex-col">
                          <span>{`${label(a.requestedBy, it.cancellation.requestedBy)} · ${label(a.cancelReason, it.cancellation.reason)}`}</span>
                          {it.cancellation.reasonDetail && <span className="text-base-content/60">{it.cancellation.reasonDetail}</span>}
                          <span className="text-base-content/50">{when(it.cancellation.at)}</span>
                        </span>
                      ) : (
                        none
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <CursorPager
              hasPrev={!!cursor}
              nextCursor={nextCursor}
              page={pageNo}
              onFirst={() => {
                setCursor('');
                setPageNo(1);
              }}
              onNext={(c) => {
                setCursor(c);
                setPageNo((p) => p + 1);
              }}
            />
          </div>
        );
      }}
    </QueryState>
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
      className="space-y-2 rounded-box border border-base-300 bg-base-200/40 p-4 text-sm"
      aria-label={r.reveal}
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim().length >= 2) void reveal.run({ reason: reason.trim() });
      }}
    >
      <h3 className="font-semibold">{r.reveal}</h3>
      <p className="text-xs text-base-content/60">{r.revealIntro}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-60 flex-1 flex-col gap-1">
          {r.revealReason}
          <input className="input input-sm w-full" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-sm border-base-300 bg-base-100" disabled={reason.trim().length < 2 || reveal.busy}>
          {r.revealDo}
        </button>
      </div>
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
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="space-y-3 text-sm"
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
        <p className="text-xs text-base-content/60">{r.restrictIntro}</p>
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
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{r.restrictionHistory}</h3>
        <QueryState state={toUiState(history, (h) => (h.items ?? []).length === 0)} onRetry={() => void history.refetch()} emptyText={none}>
          {(h) => (
            <ol className="relative space-y-3 border-l-2 border-base-300 pl-4 text-sm" data-testid="restriction-history">
              {(h.items ?? []).map((it, i) => (
                <li key={`${it.changedAt ?? ''}-${i}`} className="relative">
                  <span className="absolute -left-[1.4rem] top-1 size-2.5 rounded-full bg-accent" aria-hidden />
                  <span className="font-medium">{`${label(n.restriction, it.previous)} → ${label(n.restriction, it.restriction)}`}</span>
                  <span className="ml-2 text-base-content/55">{`${when(it.changedAt)} · ${it.reason ?? ''}`}</span>
                </li>
              ))}
            </ol>
          )}
        </QueryState>
      </div>
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
      <PageHeader title={v.title} description={v.intro} />
      <QueryState state={toUiState(reviews, (x) => (x.items ?? []).length === 0)} onRetry={() => void reviews.refetch()} emptyText={v.empty}>
        {(x) => {
          const items = x.items ?? [];
          return (
            <div className="space-y-3">
              <ResultBar count={items.length} />
              <DataTable>
                <thead>
                  <tr>
                    <th>{v.col.rider}</th>
                    <th>{v.col.kind}</th>
                    <th>{v.col.count}</th>
                    <th>{v.col.openedAt}</th>
                    <th>{v.decide}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.reviewId} data-testid="review-row">
                      <td className="font-mono font-semibold">
                        <Link className="hover:underline" to={`/riders/${encodeURIComponent(it.riderId ?? '')}`}>
                          {it.riderId}
                        </Link>
                      </td>
                      <td>
                        <StatusBadge tone="warning">{label(n.complaintType, it.complaintType)}</StatusBadge>
                      </td>
                      <td className="tabular-nums">{rm.reviewsCount((it.complaints ?? []).length)}</td>
                      <td className="whitespace-nowrap">{when(it.openedAt)}</td>
                      <td>
                        <ReviewDecision reviewId={it.reviewId ?? ''} onDone={() => void queryClient.invalidateQueries({ queryKey: ['restriction-reviews'] })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
          );
        }}
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
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-base-content/60">{v.note}</span>
        <input className="input input-sm w-56" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {(['RESTRICTED', 'DISMISSED'] as const).map((d) => (
        <button
          key={d}
          type="button"
          className={`btn btn-sm ${d === 'RESTRICTED' ? 'btn-warning' : 'border-base-300 bg-base-100'}`}
          disabled={decide.busy}
          onClick={() => void decide.run({ decision: d, ...(note.trim() ? { note: note.trim() } : {}) })}
        >
          {d === 'RESTRICTED' ? v.restricted : v.dismissed}
        </button>
      ))}
      <CommandFeedback command={decide}>{() => <span className="text-success">{v.done}</span>}</CommandFeedback>
    </div>
  );
}
