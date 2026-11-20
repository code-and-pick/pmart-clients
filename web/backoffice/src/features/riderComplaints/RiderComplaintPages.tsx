// 라이더 컴플레인(고객센터 기록 · 고객센터·라이더 운영 조회) — case-service 0.3.0 `/rider-complaints`(2026-11-15 LAN 배포).
// 기록: 배송 번호·종류(+주문·문의·메모). 라이더는 서버가 배송의 배정 라이더로 채운다(없으면 422 RIDER_NOT_ASSIGNED).
// 같은 종류 7일 안 서로 다른 배송 3건이면 라이더가 제한 검토 대상에 오른다(자동 제재 없음 — 서버). 메모는 내부용이고 상세에만, 로그 금지.
import { SavedViews } from '../../shared/SavedViews';
import type { components as BffC } from '../../api/generated/backoffice-bff';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState, uiStateFromError, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { CommandFeedback } from '../../shared/Feedback';
import { LeaveGuard } from '../../shared/LeaveGuard';
import { DisplayNumber, RIDER_SOURCE, RiderLabel, SystemNumbers } from '../../shared/displayNumber';
import { useDeliveryNumbers, useOrderNumbers, useRiderLabels } from '../../shared/numberLookups';
import { messages as m } from '../../shared/messages';
import { isSeoulDate, label, seoulDayEnd, seoulDayStart, text, when } from '../../shared/ops';
import { useResolvedRef } from '../../shared/numberLookups';
import { RefStatus } from '../../shared/RefField';
import { DeliveryPicker } from '../../shared/DeliveryPicker';
import { PreviewDrawer, PreviewFacts, usePreview } from '../../shared/Preview';
import { CodeLabel, DataTable, DetailHeader, FieldList, NextAction, PageHeader, PropertyFilter, Section, StatCard, StatStrip, type Tone } from '../../shared/admin';
import { isDeliveryNumber, isRiderNumber } from '../../shared/numberLookups';
import { EmptyBox, Icon, KindChip, ListFoot, Person, SideFields, StaffName, When, type IconName } from '../lookup/parts';

type ComplaintType = components['schemas']['RiderComplaintType'];
type ListItem = BffC['schemas']['RiderComplaintListItem'];

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
export function RiderComplaintTable({ riderId, deliveryId, complaintType, from, to, preview = false }: {
  /** 오른쪽 미리보기(2026-11-19 관제 형식) — 컴플레인 목록 화면에서만 */
  readonly preview?: boolean;
  readonly riderId?: string | undefined;
  readonly deliveryId?: string | undefined;
  readonly complaintType?: ComplaintType | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}) {
  const api = useApi();
  const pv = usePreview((id) => `/rider-complaints/${encodeURIComponent(id)}`);
  const filter = { riderId, deliveryId, complaintType, from, to };
  const query = useInfiniteQuery({
    queryKey: ['rider-complaints', 'list', filter],
    queryFn: ({ pageParam }) =>
      request(
        'GET',
        // bff `views/rider-complaints`(2026-11-19 백엔드 회신 — 웹 요청 display-numbers-in-responses): 배송·주문 번호·라이더·기록자를 한 번에(줄마다 부르지 않는다)
        api.bff.GET('/views/rider-complaints', {
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
  const items = (query.data?.pages.flatMap((p) => p.items ?? []) ?? []).filter((c): c is ListItem & { complaintId: string; riderId: string; deliveryId: string } => Boolean(c.complaintId && c.riderId && c.deliveryId));
  // 화면 번호 — bff 응답 값. 원천을 못 읽었으면 그 칸만 null + unavailableSources → "번호 확인 불가"(없음과 구분)
  const missing = new Set((query.data?.pages ?? []).flatMap((p) => p.unavailableSources ?? []));
  const of = (key: 'riderId' | 'deliveryId' | 'orderId', id: string | null | undefined) => (id ? items.find((c) => c[key] === id) : undefined);
  const riders = { get: (id: string | null | undefined) => of('riderId', id)?.rider ?? undefined, failed: missing.has(RIDER_SOURCE) };
  const deliveries = { get: (id: string | null | undefined) => of('deliveryId', id)?.deliveryNumber, failed: (id: string | null | undefined) => missing.has('delivery-execution-service') && !of('deliveryId', id)?.deliveryNumber };
  const orders = { get: (id: string | null | undefined) => of('orderId', id)?.orderNumber, failed: (id: string | null | undefined) => missing.has('order-service') && !of('orderId', id)?.orderNumber };

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
      <DataTable settingsKey="rider-complaints">
        <thead>
          <tr>
            <th>{m.complaints.detailTitle}</th>
            <th>{m.complaints.colRider}</th>
            <th>{m.complaints.colDelivery}</th>
            <th>{m.complaints.colOrder}</th>
            <th>{m.complaints.recordedBy}</th>
            <th className="text-right">{m.complaints.recordedAt}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.complaintId} data-testid="complaint-row" {...(preview ? pv.row(c.complaintId) : {})}>
              <td>
                {/* 컴플레인은 번호 없이 종류 · 시각(ADR-0070 덧붙임) — 종류 꼬리표가 상세 링크, 시각은 옆 칸 */}
                <span className="block" data-testid="complaint-link">
                  <ComplaintType type={c.complaintType} />
                </span>
              </td>
              <td data-testid="complaint-rider">
                <Link className="text-sm hover:text-primary hover:underline" to={`/riders/${encodeURIComponent(c.riderId)}`}>
                  <RiderLabel rider={riders.get(c.riderId)} riderId={c.riderId} failed={riders.failed} />
                </Link>
              </td>
              <td data-testid="complaint-delivery">
                <Link className="text-sm hover:text-primary hover:underline" to={`/deliveries/${encodeURIComponent(c.deliveryId)}`}>
                  <DisplayNumber number={deliveries.get(c.deliveryId)} systemId={c.deliveryId} failed={deliveries.failed(c.deliveryId)} />
                </Link>
              </td>
              <td>
                {c.orderId ? (
                  <Link className="text-sm hover:text-primary hover:underline" to={`/orders/${encodeURIComponent(c.orderId)}`}>
                    <DisplayNumber number={orders.get(c.orderId)} systemId={c.orderId} failed={orders.failed(c.orderId)} />
                  </Link>
                ) : (
                  <span className="text-base-content/40">{m.none}</span>
                )}
              </td>
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
      {preview &&
        pv.id &&
        (() => {
          const c = items.find((x) => x.complaintId === pv.id);
          return (
            <PreviewDrawer id={pv.id} ids={items.map((x) => x.complaintId)} onMove={pv.open} onClose={pv.close} title={(() => { const x = items.find((y) => y.complaintId === pv.id); return x ? `${label(m.complaints.typeName, x.complaintType)} · ${when(x.recordedAt)}` : m.complaints.detailTitle; })()} detailTo={`/rider-complaints/${encodeURIComponent(pv.id)}`}>
              {c ? (
                <div className="space-y-4" data-testid="complaint-preview">
                  <ComplaintType type={c.complaintType} />
                  <PreviewFacts
                    rows={[
                      [m.complaints.colRider, <RiderLabel key="r" rider={riders.get(c.riderId)} riderId={c.riderId} failed={riders.failed} />],
                      [m.complaints.colDelivery, <DisplayNumber key="d" number={deliveries.get(c.deliveryId)} systemId={c.deliveryId} failed={deliveries.failed(c.deliveryId)} />],
                      [m.complaints.colOrder, c.orderId ? <DisplayNumber key="o" number={orders.get(c.orderId)} systemId={c.orderId} failed={orders.failed(c.orderId)} /> : m.none],
                      [m.complaints.recordedBy, <Person key="p" id={c.recordedBy} />],
                      [m.complaints.recordedAt, when(c.recordedAt)],
                    ]}
                  />
                </div>
              ) : null}
            </PreviewDrawer>
          );
        })()}
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
  // 2026-11-20 AWS 개편: 검색 조건 상자 → 속성 필터(고르면 바로 주소에), 기간은 오른쪽 날짜 둘
  const setCriteria = (patch: Readonly<Record<string, string | null>>) => {
    const next = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || !v.trim()) next.delete(k);
      else next.set(k, v.trim());
    }
    setSearch(next);
  };
  const from = get('from');
  const to = get('to');
  // 번호로도 거른다(2026-11-19) — 주소에는 넣은 값 그대로, 조회에는 찾은 ID
  const rider = useResolvedRef('rider', get('riderId'));
  const delivery = useResolvedRef('delivery', get('deliveryId'));
  const unresolved = [rider, delivery].some((r) => r.state === 'notFound' || r.state === 'failed' || r.state === 'loading');

  return (
    <section className="space-y-4">
      <PageHeader
        title={m.complaints.title}
        actions={
          <Link className="btn btn-primary btn-sm" to="/rider-complaints/new">
            {m.complaints.record}
          </Link>
        }
      />
      {/* 종류별 숫자 띠(case 0.26.0 counts, 2026-11-19) — 지금 거르기(라이더·배송·기간) 그대로, 종류만 빼고 센다. 누르면 그 종류로 */}
      {!unresolved && (
        <ComplaintCounts
          riderId={rider.id ?? undefined}
          deliveryId={delivery.id ?? undefined}
          from={isSeoulDate(from) ? from : undefined}
          to={isSeoulDate(to) ? to : undefined}
          active={isType(type) ? type : undefined}
        />
      )}
      {/* 관리자 형식(2026-11-18): 검색 조건 상자 — 줄마다 왼쪽 항목명 */}
      <div className="rounded-box border border-base-300 bg-base-100 px-5 py-3" data-list-part="top">
        <PropertyFilter
          props={[
            { key: 'riderId', label: m.complaints.riderId, text: { hint: m.refField.riderHint, maxLength: 64, show: (v) => (isRiderNumber(v) ? v : m.searchChip.oneRider) } },
            { key: 'deliveryId', label: m.complaints.deliveryId, text: { hint: m.refField.deliveryHint, maxLength: 64, show: (v) => (isDeliveryNumber(v) ? v : m.searchChip.oneDelivery) } },
            { key: 'complaintType', label: m.complaints.type, options: TYPES.map((t) => ({ value: t, label: m.complaints.typeName[t] ?? t })) },
          ]}
          value={{ riderId: get('riderId'), deliveryId: get('deliveryId'), complaintType: type ?? '' }}
          onChange={setCriteria}
          testId="complaint-filter"
          lead={<SavedViews listKey="rider-complaints" />}
          aside={
            <span className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-base-content/80">{m.complaints.period}</span>
              <input type="date" aria-label={m.complaints.from} className="input input-sm w-40" value={from} onChange={(e) => setCriteria({ from: e.target.value })} />
              <span className="text-base-content/50">~</span>
              <input type="date" aria-label={m.complaints.to} className="input input-sm w-40" value={to} onChange={(e) => setCriteria({ to: e.target.value })} />
            </span>
          }
        />
        <div className="mt-1 flex flex-wrap gap-3 empty:hidden">
          <RefStatus r={rider} kind="rider" />
          <RefStatus r={delivery} kind="delivery" />
        </div>
      </div>
      {/* 번호를 아직 못 찾았으면 표를 그리지 않는다(잘못된 값으로 거른 빈 목록을 "없음"으로 보이지 않게) */}
      {!unresolved && <RiderComplaintTable
        riderId={rider.id ?? undefined}
        deliveryId={delivery.id ?? undefined}
        complaintType={isType(type) ? type : undefined}
        from={isSeoulDate(from) ? from : undefined}
        to={isSeoulDate(to) ? to : undefined}
        preview
      />}
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
  // 배송 번호(74939255-1)로도 — 찾은 배송 ID 로 보낸다(2026-11-19)
  const delivery = useResolvedRef('delivery', form.deliveryId);
  const order = useResolvedRef('order', form.orderId);
  // 주문은 고르지 않아도 되지만, 넣었는데 못 찾았으면 보내지 않는다(다른 값으로 바꾸지 않음)
  const orderOk = order.state === 'empty' || order.id !== null;
  const ready = delivery.id !== null && orderOk && form.complaintType !== '';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || locked || form.complaintType === '') return;
    setBaseline(JSON.stringify(form));
    void record.run({
      deliveryId: delivery.id ?? '',
      complaintType: form.complaintType,
      ...(order.id ? { orderId: order.id } : {}),
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
    <section className="space-y-4">
      {/* 설명은 오른쪽 "기록 전에" 카드에 있다 — 머리말에 되풀이하지 않는다(2026-11-18) */}
      <PageHeader title={m.complaints.newTitle} back={{ to: '/rider-complaints', label: m.complaints.back }} />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <form className="space-y-5 rounded-box border border-base-300 bg-base-100 p-5 shadow-sm lg:col-span-2" onSubmit={submit} aria-label={m.complaints.newTitle}>
          <LeaveGuard when={dirty} />
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{m.complaints.deliveryId}</span>
            <input className="input input-sm w-full font-mono" required maxLength={64} placeholder={m.refField.deliveryHint} {...field('deliveryId')} />
            <RefStatus r={delivery} kind="delivery" />
          </label>
          {!locked && <DeliveryPicker onPick={(v) => setForm((f) => ({ ...f, deliveryId: v }))} />}
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
              <input className="input input-sm w-full font-mono" maxLength={64} placeholder={m.refField.orderHint} {...field('orderId')} />
              <RefStatus r={order} kind="order" />
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
  const detailRiders = useRiderLabels([query.data?.riderId]);
  const detailDeliveries = useDeliveryNumbers([query.data?.deliveryId]);
  const detailOrders = useOrderNumbers([query.data?.orderId]);
  const riderText = (id: string) => {
    const r = detailRiders.get(id);
    if (r?.riderNumber) return `${r.nameMasked ?? ''} · ${r.riderNumber}`;
    // 못 읽음 ≠ 읽는 중 ≠ 번호 없음
    return detailRiders.failed ? m.complaints.riderFailed : r ? m.displayNumber.missing : m.complaints.riderUnknown;
  };
  // 상세(2026-11-18): 상세 머리(번호·종류·기록 시각) → 두 칸(왼쪽 내부 메모·연결된 것, 오른쪽 기록 정보)
  return (
    <section className="space-y-4">
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(c) => (
          <>
            <DetailHeader
              back={{ to: '/rider-complaints', label: m.complaints.back }}
              // 제목(2026-11-18 사용자 "직관적이지 않다"): 종류·라이더를 앞에, 컴플레인 번호는 옆에 작게
              title={
                <>
                  {m.complaints.titleOf(label(m.complaints.typeName, c.complaintType), riderText(c.riderId))}
                </>
              }
              badges={<ComplaintType type={c.complaintType} />}
              summary={
                <>
                  {when(c.recordedAt)} · <StaffName id={c.recordedBy} />
                </>
              }
            />
            {/* 시스템 번호(ADR-0070 덧붙임) — 상세에서만 */}
            <SystemNumbers ids={[{ label: m.complaints.detailTitle, id: complaintId }]} />
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
                      [m.complaints.riderId, <Link key="r" className="text-primary hover:underline" to={`/riders/${encodeURIComponent(c.riderId)}`}><RiderLabel rider={detailRiders.get(c.riderId)} riderId={c.riderId} failed={detailRiders.failed} /></Link>],
                      [m.complaints.deliveryId, <Link key="d" className="text-primary hover:underline" to={`/deliveries/${encodeURIComponent(c.deliveryId)}`}><DisplayNumber number={detailDeliveries.get(c.deliveryId)} systemId={c.deliveryId} failed={detailDeliveries.failed(c.deliveryId)} /></Link>],
                      [m.complaints.orderId, c.orderId ? <Link key="o" className="text-primary hover:underline" to={`/orders/${encodeURIComponent(c.orderId)}`}><DisplayNumber number={detailOrders.get(c.orderId)} systemId={c.orderId} failed={detailOrders.failed(c.orderId)} /></Link> : m.none],
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

/**
 * 컴플레인 종류별 수(case 0.26.0 `GET /rider-complaints/counts` — 웹 요청 backend-list-status-counts 회신, 정확한 수).
 * 모든 종류를 0 까지 서버가 준다. 못 읽으면(배포 전 404·403·503 포함) 칸마다 "?" — 0 으로 보이지 않는다.
 */
function ComplaintCounts({ riderId, deliveryId, from, to, active }: { readonly riderId?: string | undefined; readonly deliveryId?: string | undefined; readonly from?: string | undefined; readonly to?: string | undefined; readonly active?: ComplaintType | undefined }) {
  const api = useApi();
  const [search] = useSearchParams();
  const q = useQuery({
    queryKey: ['rider-complaints', 'counts', { riderId, deliveryId, from, to }],
    queryFn: () =>
      request(
        'GET',
        api.cases.GET('/rider-complaints/counts', {
          params: { query: { ...(riderId ? { riderId } : {}), ...(deliveryId ? { deliveryId } : {}), ...(from ? { from: seoulDayStart(from) } : {}), ...(to ? { to: seoulDayEnd(to) } : {}) } },
        }),
      ),
  });
  const byKey = new Map((q.data?.counts ?? []).map((c) => [c.key, c]));
  const keys = q.data ? q.data.counts.map((c) => c.key) : TYPES;
  const hrefOf = (key: string) => {
    const next = new URLSearchParams(search);
    next.set('complaintType', key);
    return `/rider-complaints?${next.toString()}`;
  };
  return (
    <StatStrip label={m.complaints.countsLabel} testId="complaint-counts">
      {keys.map((key) => {
        const c = byKey.get(key);
        const value = c ? `${c.count}${c.capped ? '+' : ''}` : q.isError ? '?' : '…';
        return (
          <StatCard
            key={key}
            label={label(m.complaints.typeName, key)}
            value={value}
            tone={c && c.count > 0 ? 'info' : undefined}
            to={hrefOf(key)}
            active={active === key}
            testId={`complaint-count-${key}`}
            {...(q.isError ? { hint: m.complaints.countsFailed } : {})}
          />
        );
      })}
    </StatStrip>
  );
}
