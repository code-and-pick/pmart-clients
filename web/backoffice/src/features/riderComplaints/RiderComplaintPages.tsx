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
import { CopyButton } from '../../shared/CopyButton';
import { LeaveGuard } from '../../shared/LeaveGuard';
import { messages as m } from '../../shared/messages';
import { isSeoulDate, label, seoulDayEnd, seoulDayStart, text, when } from '../../shared/ops';
import { ChipGroup, CodeLabel, DataTable, DetailHeader, FieldList, NextAction, PageHeader, SearchPanel, SearchRow, Section, type Tone } from '../../shared/admin';
import { EmptyBox, Icon, IdLink, KindChip, ListFoot, Person, SideFields, When, type IconName } from '../lookup/parts';

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
  if (items.length === 0)
    return (
      <EmptyBox icon="flag" listPart>
        {m.complaints.empty}
      </EmptyBox>
    );
  // 목록(2026-11-18 Shopify·Medusa 목록처럼): 첫 칸 종류(색 꼬리표) + 컴플레인 ID 작게, 라이더·기록자 머리글자, "N일 전"
  return (
    <>
      <DataTable>
        <thead>
          <tr>
            <th>{m.complaints.detailTitle}</th>
            <th>{m.complaints.riderId}</th>
            <th>{m.complaints.deliveryId}</th>
            <th>{m.complaints.orderId}</th>
            <th>{m.complaints.recordedBy}</th>
            <th className="text-right">{m.complaints.recordedAt}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.complaintId} data-testid="complaint-row">
              <td>
                <span className="block">
                  <ComplaintType type={c.complaintType} />
                </span>
                <span className="mt-1 block font-normal">
                  <IdLink id={c.complaintId} to={`/rider-complaints/${encodeURIComponent(c.complaintId)}`} />
                </span>
              </td>
              <td>
                <Person id={c.riderId} to={`/riders/${encodeURIComponent(c.riderId)}`} />
              </td>
              <td>
                <IdLink id={c.deliveryId} to={`/deliveries/${encodeURIComponent(c.deliveryId)}`} />
              </td>
              <td>{c.orderId ? <IdLink id={c.orderId} to={`/orders/${encodeURIComponent(c.orderId)}`} /> : <span className="text-base-content/40">{m.none}</span>}</td>
              <td>
                <Person id={c.recordedBy} />
              </td>
              <td>
                <When iso={c.recordedAt} align="right" />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <ListFoot>
        <span className="text-base-content/55">{m.approvals.shown(items.length, !!query.hasNextPage)}</span>
        {query.isFetchNextPageError && <span className="text-error">{m.complaints.moreFailed}</span>}
        {query.hasNextPage && (
          <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {m.complaints.more}
          </button>
        )}
      </ListFoot>
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
          <ChipGroup
            label={m.complaints.type}
            value={draft.complaintType}
            options={[{ value: '', label: m.complaints.any }, ...TYPES.map((t) => ({ value: t, label: m.complaints.typeName[t] ?? t }))]}
            onChange={(v) => setDraft((d) => ({ ...d, complaintType: v }))}
          />
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
  // 떠날 때 경고(2026-11-18): 연 값과 다르면 "작성 중" — 기록을 누르면 그 값이 새 기준(기록 뒤 폼은 잠긴다)
  const [baseline, setBaseline] = useState(() => JSON.stringify(form));
  const dirty = JSON.stringify(form) !== baseline;

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
    setBaseline(JSON.stringify(form));
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

  // 화면(2026-11-18): 두 칸 — 왼쪽 기록 카드(배송 → 종류 큰 선택 칸 → 연결 번호 → 메모), 오른쪽 안내 카드(서버가 정하는 것)
  return (
    <section className="max-w-6xl space-y-4">
      {/* 설명은 오른쪽 "기록 전에" 카드에 있다 — 머리말에 되풀이하지 않는다(2026-11-18) */}
      <PageHeader title={m.complaints.newTitle} back={{ to: '/rider-complaints', label: m.complaints.back }} />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <form className="space-y-5 rounded-box border border-base-300 bg-base-100 p-5 shadow-sm lg:col-span-2" onSubmit={submit} aria-label={m.complaints.newTitle}>
          <LeaveGuard when={dirty} />
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{m.complaints.deliveryId}</span>
            <input className="input input-sm w-full font-mono" required maxLength={64} {...field('deliveryId')} />
          </label>
          <fieldset className="space-y-2 text-sm" disabled={locked}>
            <legend className="mb-2 font-medium">{m.complaints.type}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {TYPES.map((t) => (
                <label
                  key={t}
                  className={`flex cursor-pointer items-center gap-2 rounded-box border px-3 py-3 transition-colors ${form.complaintType === t ? 'border-primary bg-primary/5' : 'border-base-300 hover:border-base-content/30'}`}
                >
                  <input type="radio" className="radio radio-sm radio-primary" name="complaintType" value={t} checked={form.complaintType === t} onChange={() => setForm((f) => ({ ...f, complaintType: t }))} />
                  <Icon name={TYPE_ICON[t] ?? 'flag'} className="h-4 w-4 text-base-content/60" />
                  {m.complaints.typeName[t]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{m.complaints.orderId}</span>
              <input className="input input-sm w-full font-mono" maxLength={64} {...field('orderId')} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{m.complaints.inquiryId}</span>
              <input className="input input-sm w-full font-mono" maxLength={64} {...field('inquiryId')} />
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{m.complaints.note}</span>
            <textarea className="textarea w-full" rows={4} maxLength={MAX_NOTE} value={form.note} disabled={locked} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          </label>
          <p className="flex justify-between gap-2 text-xs text-base-content/55">
            <span>{m.complaints.noteHint}</span>
            <span className="tabular-nums">{`${form.note.length} / ${MAX_NOTE}`}</span>
          </p>
          <div className="flex items-center justify-end gap-2 border-t border-base-300 pt-4">
            <button type="submit" className="btn btn-primary btn-sm" disabled={!ready || locked}>
              {m.complaints.submit}
            </button>
          </div>
          <CommandFeedback command={record} unknown={{ body: m.complaints.unknown }}>
            {(c) => (
              <p role="status" className="alert alert-success alert-soft text-sm">
                {`${m.complaints.recorded} `}
                <Link className="link" to={`/rider-complaints/${encodeURIComponent(c.complaintId)}`}>
                  {m.complaints.openDetail}
                </Link>
              </p>
            )}
          </CommandFeedback>
        </form>
        <aside className="space-y-3 rounded-box border border-base-300 bg-base-100 p-5 text-sm shadow-sm">
          <h2 className="flex items-center gap-2 font-semibold">
            <Icon name="doc" className="h-4 w-4 text-primary" />
            {m.complaints.guideTitle}
          </h2>
          <ul className="space-y-2 text-base-content/70">
            <li>{m.complaints.newIntro}</li>
            <li>{m.complaints.intro}</li>
          </ul>
        </aside>
      </div>
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
  // 상세(2026-11-18): 상세 머리(번호·종류·기록 시각) → 두 칸(왼쪽 내부 메모·연결된 것, 오른쪽 기록 정보)
  return (
    <section className="max-w-6xl space-y-4">
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(c) => (
          <>
            <DetailHeader
              back={{ to: '/rider-complaints', label: m.complaints.back }}
              // 제목(2026-11-18 사용자 "직관적이지 않다"): 종류·라이더를 앞에, 컴플레인 번호는 옆에 작게
              title={
                <>
                  {m.complaints.titleOf(label(m.complaints.typeName, c.complaintType), c.riderId)}
                  <span className="ml-2 font-mono text-sm font-normal text-base-content/50">{complaintId}</span>
                  <CopyButton value={complaintId} />
                </>
              }
              badges={<ComplaintType type={c.complaintType} />}
              summary={`${when(c.recordedAt)} · ${c.recordedBy}`}
            />
            {/* 다음 할 일 — 서버가 준 접수 건이 있으면 거기서 이어서, 없으면 할 일 없음(제한 검토는 서버) */}
            {c.caseId ? (
              <NextAction tone="info" title={m.complaints.nextStep.caseTitle}>
                <Link className="btn btn-sm" to={`/cases/${encodeURIComponent(c.caseId)}`}>
                  {m.complaints.nextStep.caseGo}
                </Link>
              </NextAction>
            ) : (
              <NextAction tone="success" title={m.complaints.nextStep.noneTitle} body={m.complaints.nextStep.noneBody} />
            )}
            <div className="grid items-start gap-4 lg:grid-cols-3" data-testid="complaint-detail">
              <div className="min-w-0 space-y-4 lg:col-span-2">
                <Section title={m.complaints.note}>
                  <p className="whitespace-pre-wrap text-sm" data-testid="complaint-note">
                    {text(c.note)}
                  </p>
                </Section>
                <Section title={m.complaints.linked}>
                  <FieldList
                    rows={[
                      [m.complaints.riderId, <Person key="r" id={c.riderId} to={`/riders/${encodeURIComponent(c.riderId)}`} />],
                      [m.complaints.deliveryId, <Link key="d" className="font-mono text-primary hover:underline" to={`/deliveries/${encodeURIComponent(c.deliveryId)}`}>{c.deliveryId}</Link>],
                      [m.complaints.orderId, c.orderId ? <Link key="o" className="font-mono text-primary hover:underline" to={`/orders/${encodeURIComponent(c.orderId)}`}>{c.orderId}</Link> : m.none],
                      [m.complaints.inquiryId, c.inquiryId ? <Link key="i" className="font-mono text-primary hover:underline" to={`/inquiries/${encodeURIComponent(c.inquiryId)}`}>{c.inquiryId}</Link> : m.none],
                      [m.complaints.caseId, text(c.caseId)],
                    ]}
                  />
                </Section>
              </div>
              <aside className="min-w-0">
                <Section title={m.complaints.recordInfo}>
                  <SideFields
                    rows={[
                      [m.complaints.type, c.complaintType ? <CodeLabel key="k" code={c.complaintType} names={m.complaints.typeName} /> : m.none],
                      [m.complaints.recordedAt, <When key="t" iso={c.recordedAt} />],
                      [m.complaints.recordedBy, <Person key="b" id={c.recordedBy} />],
                      [m.complaints.source, c.source ? <CodeLabel key="s" code={c.source} names={m.complaints.sourceName} /> : m.none],
                    ]}
                  />
                </Section>
              </aside>
            </div>
          </>
        )}
      </QueryState>
    </section>
  );
}

const TYPE_TONE: Readonly<Record<string, Tone>> = { REPORT: 'warning', MISDELIVERY: 'info', DAMAGE: 'error' };
const TYPE_ICON: Readonly<Record<string, IconName>> = { REPORT: 'flag', MISDELIVERY: 'truck', DAMAGE: 'box' };

/** 컴플레인 종류 꼬리표(색 + 그림) */
function ComplaintType({ type }: { readonly type: string | null | undefined }) {
  if (!type) return <span className="text-base-content/40">{m.none}</span>;
  return (
    <KindChip tone={TYPE_TONE[type] ?? 'ghost'} icon={TYPE_ICON[type] ?? 'flag'}>
      {label(m.complaints.typeName, type)}
    </KindChip>
  );
}
