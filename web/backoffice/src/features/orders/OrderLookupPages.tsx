// 주문 조회(고객센터·라이더 운영) — order-service 0.3.0 `GET /orders/lookups`, `GET /orders/lookups/{orderId}`(2026-11-15 LAN 배포).
// 조건은 URL 쿼리에 둔다. orderId·customerId 가 없으면 기간 두 값이 필요하고 31일 이하(서버 400 — 화면은 보내기 전에 안내만).
// 연락처는 숫자만 완전 일치(부분 검색 없음). 목록 연락처·상세 배송지는 서버가 가린 값(0.4.0·0.5.0) — 원문은 사유를 적고 pii-reveals(열람 기록).
// 검색 조건·배송지·연락처를 로그에 남기지 않는다. 고객센터는 주문을 취소하지 않는다(ADR-0060) — 취소 버튼 없음.
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/order';
import { useApi } from '../../app/ApiContext';
import { ChipGroup, CodeLabel, DataTable, DetailHeader, NextAction, Notice, PageHeader, ResultBar, SearchPanel, SearchRow, Section, StatusBadge, type Tone } from '../../shared/admin';
import { messages as m } from '../../shared/messages';
import { addSeoulDays, isSeoulDate, label, seoulDayEnd, seoulDayStart, seoulToday, spanDays, text, when, won } from '../../shared/ops';
import { ClaimsOfOrder } from '../claims/ClaimPages';
import { OrderCancelAction, OrderCancelForm } from '../claims/OrderCancel';
import { ReturnIntakeLink } from '../claims/ReturnClaim';
import { DeliveriesOf } from '../deliveries/DeliveryPages';
import { EmptyBox, Icon, KindChip, ListFoot, SideFields, Timeline, When } from '../lookup/parts';

type OrderStatus = components['schemas']['OrderStatus'];
type Detail = components['schemas']['StaffOrderDetail'];
type PiiField = components['schemas']['StaffPiiField'];
type Reveal = components['schemas']['StaffPiiReveal'];

const STATUSES = Object.keys(m.orders.statusName) as OrderStatus[];
const MAX_DAYS = 31;
const isStatus = (v: string | null): v is OrderStatus => v !== null && (STATUSES as readonly string[]).includes(v);
const digits = (v: string) => v.replace(/\D/g, '');
/** 상태 꼬리표 색(표시만 — 판정은 서버 상태 값) */
export const statusTone = (s: string | undefined): Tone =>
  s === 'DELIVERED' || s === 'COMPLETED' ? 'success' : s === 'CANCELLED' || s === 'PAYMENT_FAILED' ? 'error' : s === 'PAYMENT_PENDING' || s === 'PAYMENT_UNKNOWN' ? 'warning' : 'info';

interface Criteria {
  readonly orderId: string;
  readonly customerId: string;
  readonly status: string;
  readonly mfcId: string;
  readonly receiverPhone: string;
  readonly from: string;
  readonly to: string;
}

function criteriaFrom(search: URLSearchParams): Criteria {
  const today = seoulToday();
  const get = (k: string) => search.get(k) ?? '';
  return {
    orderId: get('orderId'),
    customerId: get('customerId'),
    status: get('status'),
    mfcId: get('mfcId'),
    receiverPhone: get('receiverPhone'),
    // 기본 기간: 오늘까지 7일
    from: search.has('from') ? get('from') : addSeoulDays(today, -6),
    to: search.has('to') ? get('to') : today,
  };
}

/** 보내기 전 안내(서버가 최종 판정). 문제 없으면 null. */
function problemOf(c: Criteria): string | null {
  if (c.receiverPhone && !/^\d{9,11}$/.test(digits(c.receiverPhone))) return m.orders.phoneInvalid;
  if (c.orderId || c.customerId) return null;
  if (!isSeoulDate(c.from) || !isSeoulDate(c.to)) return m.orders.periodRequired;
  const days = spanDays(c.from, c.to);
  return days < 1 || days > MAX_DAYS ? m.orders.periodRequired : null;
}

function queryOf(c: Criteria, page: number) {
  const usePeriod = isSeoulDate(c.from) && isSeoulDate(c.to);
  return {
    ...(c.orderId ? { orderId: c.orderId.trim() } : {}),
    ...(c.customerId ? { customerId: c.customerId.trim() } : {}),
    ...(isStatus(c.status) ? { status: c.status } : {}),
    ...(c.mfcId ? { mfcId: c.mfcId.trim() } : {}),
    ...(c.receiverPhone ? { receiverPhone: digits(c.receiverPhone) } : {}),
    ...(usePeriod ? { createdFrom: seoulDayStart(c.from), createdTo: seoulDayEnd(c.to) } : {}),
    page,
    size: 20,
  };
}

export function OrderLookupPage() {
  const api = useApi();
  const [search, setSearch] = useSearchParams();
  const criteria = criteriaFrom(search);
  const page = Math.max(0, Number(search.get('page') ?? '0') || 0);
  const [draft, setDraft] = useState<Criteria>(criteria);
  const blocked = problemOf(criteria);

  const query = useQuery({
    queryKey: ['orders', 'lookups', criteria, page],
    queryFn: () => request('GET', api.orders.GET('/orders/lookups', { params: { query: queryOf(criteria, page) } })),
    enabled: blocked === null,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams();
    for (const k of Object.keys(draft) as (keyof Criteria)[]) if (draft[k]) next.set(k, draft[k]);
    if (!draft.from) next.set('from', '');
    if (!draft.to) next.set('to', '');
    setSearch(next);
  };
  const goPage = (p: number) => {
    const next = new URLSearchParams(search);
    next.set('page', String(p));
    setSearch(next);
  };
  const field = (k: keyof Criteria) => ({
    value: draft[k],
    onChange: (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value })),
  });

  const navigate = useNavigate();
  const reset = () => setDraft({ orderId: '', customerId: '', status: '', mfcId: '', receiverPhone: '', from: addSeoulDays(seoulToday(), -6), to: seoulToday() });
  const statusOptions = [{ value: '', label: m.orders.any }, ...STATUSES.map((st) => ({ value: st, label: m.orders.statusName[st] ?? st }))];

  // 관리자 형식(2026-11-18, PC 5 요청 — 모범 화면 rider-backoffice DeliveryPages): 머리말 → 검색 조건 상자 → 결과 줄 → 표 → 쪽
  return (
    <section className="space-y-5">
      <PageHeader title={m.orders.title} description={m.orders.intro} />
      <SearchPanel onSubmit={submit} onReset={reset} submitLabel={m.orders.search} resetLabel={m.orders.reset}>
        <SearchRow label={m.orders.ids}>
          <input className="input input-sm w-48" aria-label={m.orders.orderId} placeholder={m.orders.orderId} maxLength={64} {...field('orderId')} />
          <input className="input input-sm w-48" aria-label={m.orders.customerId} placeholder={m.orders.customerId} maxLength={64} {...field('customerId')} />
          <input className="input input-sm w-40" aria-label={m.orders.mfcId} placeholder={m.orders.mfcId} maxLength={40} {...field('mfcId')} />
        </SearchRow>
        <SearchRow label={m.orders.receiverPhone}>
          <input className="input input-sm w-56" aria-label={m.orders.receiverPhone} inputMode="numeric" maxLength={20} placeholder={m.orders.receiverPhoneHint} autoComplete="off" {...field('receiverPhone')} />
        </SearchRow>
        <SearchRow label={m.orders.status}>
          <ChipGroup label={m.orders.status} value={draft.status} options={statusOptions} onChange={(v) => setDraft((d) => ({ ...d, status: v }))} />
        </SearchRow>
        <SearchRow label={m.orders.period}>
          <input type="date" className="input input-sm w-40" aria-label={m.orders.from} {...field('from')} />
          <span className="text-base-content/40">~</span>
          <input type="date" className="input input-sm w-40" aria-label={m.orders.to} {...field('to')} />
        </SearchRow>
      </SearchPanel>

      {blocked ? (
        <Notice tone="warning">
          <span data-testid="order-search-blocked">{blocked}</span>
        </Notice>
      ) : (
        <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
          {(r) =>
            r.items.length === 0 ? (
              <EmptyBox icon="box" listPart>
                {m.orders.empty}
              </EmptyBox>
            ) : (
              <>
                {/* 전체 건수는 서버가 세지 않는다(page.hasNext) — 이 쪽 건수만 */}
                <ResultBar count={r.items.length} more={r.page.hasNext} />
                {/* 목록(2026-11-18 Shopify 주문 목록처럼): 첫 칸 주문 번호 굵게 + 고객 ID 작게, 상태 점 꼬리표, "N일 전", 금액 오른쪽 굵게 */}
                <DataTable>
                  <thead>
                    <tr>
                      <th>{m.orders.detailTitle}</th>
                      <th>{m.orders.status}</th>
                      <th>{m.orders.confirmedAt}</th>
                      <th>{m.orders.mfcId}</th>
                      <th>{m.orders.phone}</th>
                      <th className="text-right">{m.orders.items}</th>
                      <th className="text-right">{m.orders.total}</th>
                      <th>{m.orders.openIssues}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.items.map((o) => (
                      <tr key={o.orderId} data-testid="order-row" className="cursor-pointer" onClick={() => void navigate(`/orders/${encodeURIComponent(o.orderId)}`)}>
                        <td>
                          <Link className="font-mono font-semibold text-base-content hover:text-primary hover:underline" to={`/orders/${encodeURIComponent(o.orderId)}`} onClick={(e) => e.stopPropagation()}>
                            {o.orderId}
                          </Link>
                          <span className="mt-0.5 flex items-center gap-1 text-xs font-normal text-base-content/50" title={o.customerId}>
                            <Icon name="user" className="h-3 w-3" />
                            <span className="max-w-[12rem] truncate font-mono">{o.customerId}</span>
                          </span>
                        </td>
                        <td>
                          <StatusBadge tone={statusTone(o.status)}>{o.status ? <CodeLabel code={o.status} names={m.orders.statusName} /> : m.none}</StatusBadge>
                        </td>
                        <td>
                          <When iso={o.confirmedAt} />
                        </td>
                        <td>
                          <KindChip icon="store">{o.mfcId}</KindChip>
                        </td>
                        <td className="whitespace-nowrap text-sm">{text(o.receiverPhoneMasked)}</td>
                        <td className="text-right tabular-nums">{o.itemCount}</td>
                        <td className="whitespace-nowrap text-right font-semibold tabular-nums">{won(o.approvedAmount)}</td>
                        <td>
                          {o.openFulfillmentIssues > 0 ? (
                            <KindChip tone="warning" icon="alert">
                              {o.openFulfillmentIssues}
                            </KindChip>
                          ) : (
                            <span className="text-base-content/40">0</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
                <ListFoot>
                  <span className="text-base-content/55">{m.orders.pageLabel(r.page.page)}</span>
                  <nav aria-label="쪽" className="flex items-center gap-2">
                    <button type="button" className="btn btn-sm border-base-300 bg-base-100" disabled={page === 0} onClick={() => goPage(page - 1)}>
                      {m.orders.prev}
                    </button>
                    <button type="button" className="btn btn-sm border-base-300 bg-base-100" disabled={!r.page.hasNext} onClick={() => goPage(page + 1)}>
                      {m.orders.next}
                    </button>
                  </nav>
                </ListFoot>
              </>
            )
          }
        </QueryState>
      )}
    </section>
  );
}

const PII_FIELDS: readonly PiiField[] = ['NAME', 'PHONE', 'ADDRESS', 'ENTRANCE'];

/**
 * 배송지(order 0.4.0·0.5.0): 상세는 서버가 가린 값 그대로 보인다(이름 첫·끝 글자, 010-****-1234, 상세주소 ***, 출입 메모·핀·요청사항 없음).
 * 원문은 사유를 적고 `POST /orders/lookups/{orderId}/pii-reveals` — 서버가 열람 기록(audit)을 남긴 뒤 고른 항목만 준다.
 * 받은 원문은 이 컴포넌트 상태(메모리)에만 둔다. 저장·로그·주소에 넣지 않고, 화면을 떠나거나 "다시 가리기"를 누르면 사라진다.
 * 503(기록 못 남김)·결과 불명은 원문이 없다 — 같은 키로 다시 보내면 같은 기록으로 이어진다(useCommand 의 "같은 요청으로 결과 확인").
 */
function Address({ order }: { readonly order: Detail }) {
  const api = useApi();
  const [fields, setFields] = useState<readonly PiiField[]>(PII_FIELDS);
  const [reason, setReason] = useState('');
  const reveal = useCommand(async (v: { reason: string; fields: readonly PiiField[] }, key) =>
    request(
      'POST',
      api.orders.POST('/orders/lookups/{orderId}/pii-reveals', {
        ...commandParams(key, { path: { orderId: order.orderId } }),
        body: { reason: v.reason, fields: [...v.fields] },
      }),
    ),
  );
  const a = order.shippingAddress;
  if (!a) return <p className="text-sm opacity-70">{m.orders.noAddress}</p>;

  const opened: Reveal | null = reveal.phase.kind === 'done' ? reveal.phase.result : null;
  const isOpen = (f: PiiField) => opened?.fields.includes(f) ?? false;
  const raw = opened?.shippingAddress ?? null;
  const shown = (f: PiiField, masked: string | null | undefined, original: string | null | undefined, testId?: string) => (
    <span data-testid={testId} data-masked={!isOpen(f)}>
      {isOpen(f) ? text(original) : masked ? masked : m.orders.pii.maskedValue}
    </span>
  );
  const reasonOk = reason.trim().length >= 2 && reason.trim().length <= 200;

  return (
    <>
      {order.shippingAddressMasked && <p className="mb-3 text-xs text-base-content/60">{m.orders.pii.maskedNote}</p>}
      <SideFields
        testId="order-address"
        rows={[
          [m.orders.receiverName, shown('NAME', a.receiverName, raw?.receiverName, 'order-receiver-name')],
          [m.orders.phone, shown('PHONE', a.receiverPhone, raw?.receiverPhone, 'order-receiver-phone')],
          [m.orders.roadAddress, text(a.roadAddress)],
          [m.orders.detailAddress, shown('ADDRESS', a.detailAddress, raw?.detailAddress, 'order-detail-address')],
          [m.orders.postalCode, text(a.postalCode)],
          [m.orders.entrance, label(m.orders.entranceMethod, a.entranceMethod)],
          // 출입 비밀번호일 수 있다 — 서버가 가린다(null)
          [m.orders.entranceNote, shown('ENTRANCE', a.entranceNote, raw?.entranceNote, 'order-entrance-note')],
          [
            m.orders.deliveryNote,
            order.deliveryNoteMasked ? shown('ENTRANCE', null, opened?.deliveryNote, 'order-delivery-note') : text(order.deliveryNote),
          ],
        ]}
      />
      {opened ? (
        <div role="status" className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span>{m.orders.pii.opened(opened.piiAccessLogId, when(opened.recordedAt))}</span>
          <button type="button" className="btn btn-xs" onClick={() => reveal.reset()}>
            {m.orders.pii.hide}
          </button>
        </div>
      ) : (
        <form
          className="mt-4 space-y-2 rounded-box border border-base-300 bg-base-200/50 p-4 text-sm"
          aria-label={m.orders.pii.title}
          onSubmit={(e) => {
            e.preventDefault();
            if (!reasonOk || fields.length === 0) return;
            if (reveal.phase.kind === 'rejected') reveal.reset();
            void reveal.run({ reason: reason.trim(), fields });
          }}
        >
          <h3 className="font-semibold">{m.orders.pii.title}</h3>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="text-xs opacity-70">{m.orders.pii.fields}</legend>
            {PII_FIELDS.map((f) => (
              <label key={f} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={fields.includes(f)}
                  onChange={(e) => setFields((cur) => (e.target.checked ? PII_FIELDS.filter((x) => x === f || cur.includes(x)) : cur.filter((x) => x !== f)))}
                />
                {m.orders.pii.fieldName[f]}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1">
            {m.orders.pii.reason}
            <input className="input input-sm w-full max-w-md" maxLength={200} autoComplete="off" placeholder={m.orders.pii.reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {fields.length === 0 && <p className="text-xs text-warning">{m.orders.pii.noFields}</p>}
          <button type="submit" className="btn btn-sm" disabled={!reasonOk || fields.length === 0 || reveal.busy}>
            {m.orders.pii.open}
          </button>
          <CommandFeedback command={reveal} />
        </form>
      )}
    </>
  );
}


const ISSUE_TONE: Readonly<Record<string, Tone>> = { OPEN: 'warning', ACKNOWLEDGED: 'info', RESOLVED: 'success' };

/** 수량 한 줄(원/취소/인계/전달/반품) — 서버 값 그대로 작은 알약으로(계산 없음) */
function QtyPills({ line }: { readonly line: Detail['lines'][number] }) {
  const parts: ReadonlyArray<readonly [string, number | null | undefined]> = [
    [m.orders.qtyPart.original, line.originalQty],
    [m.orders.qtyPart.cancelled, line.cancelledBeforeShipQty],
    [m.orders.qtyPart.handedOver, line.handedOverQty],
    [m.orders.qtyPart.delivered, line.deliveredQty],
    [m.orders.qtyPart.returned, line.returnedQty],
  ];
  return (
    <span className="flex flex-wrap gap-1" title={m.orders.qty}>
      {parts.map(([k, v]) => (
        <span key={k} className="whitespace-nowrap rounded bg-base-200 px-1.5 py-0.5 text-xs text-base-content/70">
          {`${k} ${text(v)}`}
        </span>
      ))}
    </span>
  );
}

/** 금액 줄(왼쪽 이름, 오른쪽 값) — Shopify 결제 요약처럼. 값은 서버 금액 그대로 */
function AmountRow({ name, value, sub, strong = false }: { readonly name: string; readonly value: string; readonly sub?: ReactNode; readonly strong?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-4 py-1.5 ${strong ? 'font-semibold' : ''}`}>
      <div className="min-w-0">
        <p>{name}</p>
        {sub && <p className="text-xs font-normal text-base-content/50">{sub}</p>}
      </div>
      <p className="whitespace-nowrap tabular-nums">{value}</p>
    </div>
  );
}

export function OrderDetailPage() {
  const { orderId = '' } = useParams();
  const api = useApi();
  const query = useQuery({
    queryKey: ['orders', 'lookup', orderId],
    queryFn: () => request('GET', api.orders.GET('/orders/lookups/{orderId}', { params: { path: { orderId } } })),
  });
  // 고객센터 주문 취소(claim 0.4.0) — 상품준비 전만, 머리 오른쪽 버튼으로 연다
  const [cancelOpen, setCancelOpen] = useState(false);

  const back = { to: '/orders', label: m.orders.back };

  // 상세(2026-11-18 Shopify 주문 상세처럼): 머리(번호·상태·요약) → 넓은 화면 두 칸
  // 왼쪽(넓게) = 주문 상품·금액·이행 확인·배송·클레임, 오른쪽 = 주문 정보·배송지(가림·원문 열람)
  return (
    <section className="max-w-7xl space-y-4">
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(o) => {
          // 제목(2026-11-18 사용자 "직관적이지 않다"): 첫 상품 이름 + 외 N건을 앞에, 주문 번호는 옆에 작게. 상품 이름이 없으면 "주문"
          const firstName = o.lines.find((l) => l.productName)?.productName;
          const openIssues = o.fulfillmentIssues.filter((f) => f.state === 'OPEN').length;
          return (
          <>
            <DetailHeader
              back={back}
              title={
                <>
                  {firstName ? m.orders.titleOf(firstName, o.lines.length - 1) : m.orders.detailTitle}
                  <span className="ml-2 font-mono text-sm font-normal text-base-content/50">{orderId}</span>
                </>
              }
              badges={
                <>
                  <StatusBadge tone={statusTone(o.status)} testId="order-status">
                    {o.status ? <CodeLabel code={o.status} names={m.orders.statusName} /> : m.none}
                  </StatusBadge>
                  <KindChip icon="truck">{label(m.orders.mode, o.deliveryMode)}</KindChip>
                  {o.fulfillmentIssues.some((f) => f.state === 'OPEN') && (
                    <KindChip tone="warning" icon="alert">
                      {m.orders.issueState.OPEN}
                    </KindChip>
                  )}
                </>
              }
              summary={`${when(o.confirmedAt)} · ${o.mfcId} · ${won(o.amounts.approvedAmount)}`}
              actions={<OrderCancelAction order={o} open={cancelOpen} onOpen={() => setCancelOpen(true)} />}
            />
            {cancelOpen && o.status === 'CONFIRMED' && <OrderCancelForm order={o} onClose={() => setCancelOpen(false)} />}
            {/* 다음 할 일 — 서버 값만으로: 확인 필요(OPEN) 이행 기록이 있으면 그 기록으로, 결제 결과 불명이면 안내만 */}
            {openIssues > 0 ? (
              <NextAction tone="warning" title={m.orders.nextStep.issueTitle} body={m.orders.nextStep.issueBody(openIssues)}>
                <a className="btn btn-sm btn-warning" href="#order-issues">
                  {m.orders.nextStep.issueGo}
                </a>
              </NextAction>
            ) : o.status === 'PAYMENT_UNKNOWN' ? (
              <NextAction tone="info" title={m.orders.nextStep.paymentTitle} body={m.orders.nextStep.paymentBody} />
            ) : null}

            <div className="grid items-start gap-4 lg:grid-cols-3">
              <div className="min-w-0 space-y-4 lg:col-span-2">
                <Section id="order-lines" title={m.orders.lines} aside={<span className="text-base-content/55">{m.orders.lineCount(o.lines.length)}</span>}>
                  <ul className="-my-2 divide-y divide-base-300/70">
                    {o.lines.map((l, i) => (
                      <li key={l.orderLineId ?? `line-${i}`} data-testid="order-line" className="flex items-start gap-3 py-3">
                        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-base-200 text-base-content/40" aria-hidden="true">
                          <Icon name="box" className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="font-medium">
                            {text(l.productName)}
                            {l.optionLabel && <span className="ml-1 font-normal text-base-content/60">{l.optionLabel}</span>}
                          </p>
                          <p className="font-mono text-xs text-base-content/50">{`SKU ${text(l.sku)}`}</p>
                          <QtyPills line={l} />
                        </div>
                        <p className="whitespace-nowrap font-semibold tabular-nums">{won(l.lineAmount)}</p>
                      </li>
                    ))}
                  </ul>
                </Section>

                <Section id="order-amounts" title={m.orders.amounts}>
                  <div className="text-sm">
                    <AmountRow name={m.orders.itemAmount} value={won(o.amounts.itemAmount)} />
                    <AmountRow name={m.orders.deliveryTip} value={won(o.amounts.deliveryTip)} sub={
                        <>
                          {`${m.orders.deliveryTipBase} ${won(o.amounts.deliveryTipBase)} · `}
                          {o.amounts.deliveryTipReason ? <CodeLabel code={o.amounts.deliveryTipReason} names={m.orders.tipReasonName} /> : m.none}
                        </>
                      }
                    />
                    <AmountRow name={m.orders.bagFee} value={won(o.amounts.bagFee)} />
                    <AmountRow name={m.orders.firstPurchase} value={o.amounts.firstPurchaseApplied ? 'O' : 'X'} />
                    <div className="my-1.5 border-t border-base-300" />
                    <AmountRow name={m.orders.totalAmount} value={won(o.amounts.totalAmount)} strong />
                    <AmountRow name={m.orders.approvedAmount} value={won(o.amounts.approvedAmount)} strong />
                    <div className="mt-3 grid gap-2 rounded-box bg-base-200/60 px-3 py-2 text-xs sm:grid-cols-2">
                      <p>
                        <span className="text-base-content/50">{`${m.orders.paymentAttemptId} `}</span>
                        <span className="break-all font-mono">{o.payment.paymentAttemptId}</span>
                      </p>
                      <p>
                        <span className="text-base-content/50">{`${m.orders.pgTransactionId} `}</span>
                        <span className="break-all font-mono">{text(o.payment.pgTransactionId)}</span>
                      </p>
                    </div>
                  </div>
                </Section>

                <Section id="order-issues" title={m.orders.issues}>
                  {o.fulfillmentIssues.length === 0 ? (
                    <p className="flex items-center gap-2 text-sm text-base-content/60">
                      <Icon name="check" className="h-4 w-4 text-success" />
                      {m.orders.noIssues}
                    </p>
                  ) : (
                    <Timeline
                      items={o.fulfillmentIssues.map((f, i) => ({
                        key: f.issueId ?? `issue-${i}`,
                        tone: ISSUE_TONE[f.state ?? ''] ?? 'neutral',
                        title: (
                          <span data-testid="order-issue">
                            {`${label(m.orders.issueState, f.state)} · `}
                            {f.reason ? <CodeLabel code={f.reason} names={m.orders.issueReasonName} /> : m.none}
                            {` · ${text(f.sku)} × ${text(f.blockedQty)}`}
                          </span>
                        ),
                        meta: when(f.blockedAt),
                      }))}
                    />
                  )}
                </Section>

                <Section id="order-deliveries" title={m.deliveries.ofOrder}>
                  <DeliveriesOf orderId={o.orderId} />
                </Section>

                <Section
                  id="order-claims"
                  title={m.orders.claims}
                  aside={o.lines.some((l) => (l.handedOverQty ?? 0) > (l.returnedQty ?? 0)) ? <ReturnIntakeLink orderId={o.orderId} /> : undefined}
                >
                  <ClaimsOfOrder orderId={o.orderId} />
                </Section>
              </div>

              <aside className="min-w-0 space-y-4">
                <Section id="order-basic" title={m.orders.sectionBasic}>
                  <SideFields
                    testId="order-summary"
                    rows={[
                      [m.orders.confirmedAt, <When key="c" iso={o.confirmedAt} />],
                      [m.orders.customerId, <span key="u" className="font-mono">{o.customerId}</span>],
                      [m.orders.mfcId, o.mfcId],
                      [m.orders.deliveryMode, label(m.orders.mode, o.deliveryMode)],
                      [m.orders.arrival, o.arrivalWindow ? `${o.arrivalWindow.date} ${o.arrivalWindow.start}~${o.arrivalWindow.end}` : m.none],
                      [m.orders.shipments, text(o.plannedShipments)],
                      [m.orders.oosPreference, label(m.orders.oos, o.outOfStockPreference)],
                      [m.orders.weight, o.weightG === undefined ? m.none : `${o.weightG}g`],
                      [m.orders.version, o.version],
                    ]}
                  />
                  <p className="mt-4 border-t border-base-300 pt-3 text-xs text-base-content/55">{m.orders.noCancelShort}</p>
                </Section>

                <Section id="order-address-section" title={m.orders.address}>
                  <Address order={o} />
                </Section>
              </aside>
            </div>
          </>
          );
        }}
      </QueryState>
    </section>
  );
}
