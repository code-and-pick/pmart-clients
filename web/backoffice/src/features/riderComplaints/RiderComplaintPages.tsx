// 라이더 컴플레인(고객센터 기록 · 고객센터·라이더 운영 조회) — case-service 0.3.0 `/rider-complaints`(2026-11-15 LAN 배포).
// 기록: 배송 번호·종류(+주문·문의·메모). 라이더는 서버가 배송의 배정 라이더로 채운다(없으면 422 RIDER_NOT_ASSIGNED).
// 같은 종류 7일 안 서로 다른 배송 3건이면 라이더가 제한 검토 대상에 오른다(자동 제재 없음 — 서버). 메모는 내부용이고 상세에만, 로그 금지.
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState, uiStateFromError, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback } from '../../shared/Feedback';
import { messages as m } from '../../shared/messages';
import { Facts, isSeoulDate, label, seoulDayEnd, seoulDayStart, text, when } from '../../shared/ops';
import { DataTable, PageHeader, SearchPanel, SearchRow } from '../../shared/admin';

type ComplaintType = components['schemas']['RiderComplaintType'];
type Summary = components['schemas']['RiderComplaintSummary'];

const TYPES = Object.keys(m.complaints.typeName) as ComplaintType[];
const isType = (v: string | null): v is ComplaintType => v !== null && (TYPES as readonly string[]).includes(v);
const MAX_NOTE = 1000;

interface NewComplaint {
  readonly deliveryId: string;
  readonly complaintType: ComplaintType;
  readonly orderId?: string;
  readonly inquiryId?: string;
  readonly note?: string;
}

/** 다른 화면(라이더 상세·배송)에서 쓰는 목록 — riderId·deliveryId 로 거른 컴플레인. */
export function RiderComplaintTable({ riderId, deliveryId, complaintType, from, to }: {
  readonly riderId?: string | undefined;
  readonly deliveryId?: string | undefined;
  readonly complaintType?: ComplaintType | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}) {
  const api = useApi();
  const filter = { riderId, deliveryId, complaintType, from, to };
  const query = useInfiniteQuery({
    queryKey: ['rider-complaints', 'list', filter],
    queryFn: ({ pageParam }) =>
      request(
        'GET',
        api.cases.GET('/rider-complaints', {
          params: {
            query: {
              ...(riderId ? { riderId } : {}),
              ...(deliveryId ? { deliveryId } : {}),
              ...(complaintType ? { complaintType } : {}),
              ...(from ? { from: seoulDayStart(from) } : {}),
              ...(to ? { to: seoulDayEnd(to) } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });
  const items: Summary[] = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];

  if (query.isPending) return <QueryState state={{ kind: 'loading' }}>{() => null}</QueryState>;
  if (query.isError && items.length === 0) {
    return (
      <QueryState state={uiStateFromError(query.error)} onRetry={() => void query.refetch()}>
        {() => null}
      </QueryState>
    );
  }
  if (items.length === 0) return <p className="text-sm text-base-content/60">{m.complaints.empty}</p>;
  return (
    <>
      <DataTable>
        <thead>
          <tr>
            <th>ID</th>
            <th>{m.complaints.type}</th>
            <th>{m.complaints.riderId}</th>
            <th>{m.complaints.deliveryId}</th>
            <th>{m.complaints.orderId}</th>
            <th>{m.complaints.recordedAt}</th>
            <th>{m.complaints.recordedBy}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.complaintId} data-testid="complaint-row">
              <td>
                <Link className="link" to={`/rider-complaints/${encodeURIComponent(c.complaintId)}`}>
                  {c.complaintId}
                </Link>
              </td>
              <td>{label(m.complaints.typeName, c.complaintType)}</td>
              <td>
                <Link className="link" to={`/riders/${encodeURIComponent(c.riderId)}`}>
                  {c.riderId}
                </Link>
              </td>
              <td>
                <Link className="link" to={`/deliveries/${encodeURIComponent(c.deliveryId)}`}>
                  {c.deliveryId}
                </Link>
              </td>
              <td>{c.orderId ? <Link className="link" to={`/orders/${encodeURIComponent(c.orderId)}`}>{c.orderId}</Link> : m.none}</td>
              <td>{when(c.recordedAt)}</td>
              <td>{c.recordedBy}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      {query.isFetchNextPageError && <p className="text-sm text-error">{m.complaints.moreFailed}</p>}
      {query.hasNextPage && (
        <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {m.complaints.more}
        </button>
      )}
    </>
  );
}

export function RiderComplaintListPage() {
  const [search, setSearch] = useSearchParams();
  const get = (k: string) => search.get(k) ?? '';
  const type = search.get('complaintType');
  const [draft, setDraft] = useState({ riderId: get('riderId'), deliveryId: get('deliveryId'), complaintType: type ?? '', from: get('from'), to: get('to') });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(draft)) if (v.trim()) next.set(k, v.trim());
    setSearch(next);
  };
  const field = (k: keyof typeof draft) => ({ value: draft[k], onChange: (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value })) });
  const from = get('from');
  const to = get('to');

  return (
    <section className="space-y-4">
      <PageHeader
        title={m.complaints.title}
        description={m.complaints.intro}
        actions={
          <Link className="btn btn-primary btn-sm" to="/rider-complaints/new">
            {m.complaints.record}
          </Link>
        }
      />
      {/* 관리자 형식(2026-11-18): 검색 조건 상자 — 줄마다 왼쪽 항목명 */}
      <SearchPanel
        onSubmit={submit}
        onReset={() => setDraft({ riderId: '', deliveryId: '', complaintType: '', from: '', to: '' })}
        submitLabel={m.complaints.filter}
        resetLabel={m.complaints.reset}
        label={m.complaints.title}
      >
        <SearchRow label={m.complaints.ids}>
          <input aria-label={m.complaints.riderId} placeholder={m.complaints.riderId} className="input input-sm w-48" {...field('riderId')} />
          <input aria-label={m.complaints.deliveryId} placeholder={m.complaints.deliveryId} className="input input-sm w-48" {...field('deliveryId')} />
        </SearchRow>
        <SearchRow label={m.complaints.type}>
          <select aria-label={m.complaints.type} className="select select-sm w-36" {...field('complaintType')}>
            <option value="">{m.complaints.any}</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {m.complaints.typeName[t]}
              </option>
            ))}
          </select>
        </SearchRow>
        <SearchRow label={m.complaints.period}>
          <input type="date" aria-label={m.complaints.from} className="input input-sm w-40" {...field('from')} />
          <span className="text-base-content/50">~</span>
          <input type="date" aria-label={m.complaints.to} className="input input-sm w-40" {...field('to')} />
        </SearchRow>
      </SearchPanel>
      <RiderComplaintTable
        riderId={get('riderId') || undefined}
        deliveryId={get('deliveryId') || undefined}
        complaintType={isType(type) ? type : undefined}
        from={isSeoulDate(from) ? from : undefined}
        to={isSeoulDate(to) ? to : undefined}
      />
    </section>
  );
}

/** 컴플레인 기록. 문의·배송·주문 화면에서 오면 쿼리(deliveryId·orderId·inquiryId)로 미리 채운다. */
export function NewRiderComplaintPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [search] = useSearchParams();
  const [form, setForm] = useState({
    deliveryId: search.get('deliveryId') ?? '',
    complaintType: '' as ComplaintType | '',
    orderId: search.get('orderId') ?? '',
    inquiryId: search.get('inquiryId') ?? '',
    note: '',
  });

  const record = useCommand(async (body: NewComplaint, key) => {
    const saved = await request('POST', api.cases.POST('/rider-complaints', { ...commandParams(key), body }));
    void queryClient.invalidateQueries({ queryKey: ['rider-complaints'] });
    return saved;
  });

  const locked = record.busy || record.phase.kind === 'done';
  const ready = form.deliveryId.trim() !== '' && form.complaintType !== '';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || locked || form.complaintType === '') return;
    void record.run({
      deliveryId: form.deliveryId.trim(),
      complaintType: form.complaintType,
      ...(form.orderId.trim() ? { orderId: form.orderId.trim() } : {}),
      ...(form.inquiryId.trim() ? { inquiryId: form.inquiryId.trim() } : {}),
      ...(form.note.trim() ? { note: form.note.trim() } : {}),
    });
  };
  const field = (k: 'deliveryId' | 'orderId' | 'inquiryId') => ({
    value: form[k],
    disabled: locked,
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value })),
  });

  return (
    <section className="max-w-2xl space-y-4">
      <PageHeader title={m.complaints.newTitle} description={m.complaints.newIntro} />
      <form className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4" onSubmit={submit} aria-label={m.complaints.newTitle}>
        <label className="block text-sm">
          {m.complaints.deliveryId}
          <input className="input input-sm mt-1 w-full" required maxLength={64} {...field('deliveryId')} />
        </label>
        <fieldset className="text-sm" disabled={locked}>
          <legend>{m.complaints.type}</legend>
          <div className="mt-1 flex gap-4">
            {TYPES.map((t) => (
              <label key={t} className="flex items-center gap-1">
                <input type="radio" className="radio radio-sm" name="complaintType" value={t} checked={form.complaintType === t} onChange={() => setForm((f) => ({ ...f, complaintType: t }))} />
                {m.complaints.typeName[t]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm">
          {m.complaints.orderId}
          <input className="input input-sm mt-1 w-full" maxLength={64} {...field('orderId')} />
        </label>
        <label className="block text-sm">
          {m.complaints.inquiryId}
          <input className="input input-sm mt-1 w-full" maxLength={64} {...field('inquiryId')} />
        </label>
        <label className="block text-sm">
          {m.complaints.note}
          <textarea className="textarea mt-1 w-full" rows={3} maxLength={MAX_NOTE} value={form.note} disabled={locked} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </label>
        <p className="text-xs opacity-60">{`${m.complaints.noteHint} ${form.note.length} / ${MAX_NOTE}`}</p>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!ready || locked}>
          {m.complaints.submit}
        </button>
        <CommandFeedback command={record} unknown={{ body: m.complaints.unknown }}>
          {(c) => (
            <p role="status" className="text-sm text-success">
              {`${m.complaints.recorded} `}
              <Link className="link" to={`/rider-complaints/${encodeURIComponent(c.complaintId)}`}>
                {m.complaints.openDetail}
              </Link>
            </p>
          )}
        </CommandFeedback>
      </form>
      <Link className="link text-sm" to="/rider-complaints">
        {m.complaints.back}
      </Link>
    </section>
  );
}

export function RiderComplaintDetailPage() {
  const { complaintId = '' } = useParams();
  const api = useApi();
  const query = useQuery({
    queryKey: ['rider-complaints', 'detail', complaintId],
    queryFn: () => request('GET', api.cases.GET('/rider-complaints/{complaintId}', { params: { path: { complaintId } } })),
  });
  return (
    <section className="max-w-3xl space-y-4">
      <PageHeader title={`${m.complaints.detailTitle} ${complaintId}`} />
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(c) => (
          <Facts
            testId="complaint-detail"
            rows={[
              [m.complaints.type, label(m.complaints.typeName, c.complaintType)],
              [m.complaints.riderId, <Link key="r" className="link" to={`/riders/${encodeURIComponent(c.riderId)}`}>{c.riderId}</Link>],
              [m.complaints.deliveryId, <Link key="d" className="link" to={`/deliveries/${encodeURIComponent(c.deliveryId)}`}>{c.deliveryId}</Link>],
              [m.complaints.orderId, c.orderId ? <Link key="o" className="link" to={`/orders/${encodeURIComponent(c.orderId)}`}>{c.orderId}</Link> : m.none],
              [m.complaints.inquiryId, c.inquiryId ? <Link key="i" className="link" to={`/inquiries/${encodeURIComponent(c.inquiryId)}`}>{c.inquiryId}</Link> : m.none],
              [m.complaints.caseId, text(c.caseId)],
              [m.complaints.recordedAt, when(c.recordedAt)],
              [m.complaints.recordedBy, c.recordedBy],
              [m.complaints.source, c.source],
              [m.complaints.note, <p key="n" className="whitespace-pre-wrap" data-testid="complaint-note">{text(c.note)}</p>],
            ]}
          />
        )}
      </QueryState>
      <Link className="link text-sm" to="/rider-complaints">
        {m.complaints.back}
      </Link>
    </section>
  );
}
