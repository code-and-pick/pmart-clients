// 주문 조회(고객센터·라이더 운영) — order-service 0.3.0 `GET /orders/lookups`, `GET /orders/lookups/{orderId}`(2026-11-15 LAN 배포).
// 조건은 URL 쿼리에 둔다. orderId·customerId 가 없으면 기간 두 값이 필요하고 31일 이하(서버 400 — 화면은 보내기 전에 안내만).
// 연락처는 숫자만 완전 일치(부분 검색 없음). 목록 연락처·상세 배송지는 서버가 가린 값(0.4.0·0.5.0) — 원문은 사유를 적고 pii-reveals(열람 기록).
// 검색 조건·배송지·연락처를 로그에 남기지 않는다. 고객센터는 주문을 취소하지 않는다(ADR-0060) — 취소 버튼 없음.
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/order';
import { useApi } from '../../app/ApiContext';
import { messages as m } from '../../shared/messages';
import { addSeoulDays, Facts, isSeoulDate, label, seoulDayEnd, seoulDayStart, seoulToday, spanDays, text, when, won } from '../../shared/ops';
import { ClaimsOfOrder } from '../claims/ClaimPages';
import { ReturnIntakeLink } from '../claims/ReturnClaim';
import { DeliveriesOf } from '../deliveries/DeliveryPages';

type OrderStatus = components['schemas']['OrderStatus'];
type Detail = components['schemas']['StaffOrderDetail'];
type PiiField = components['schemas']['StaffPiiField'];
type Reveal = components['schemas']['StaffPiiReveal'];

const STATUSES = Object.keys(m.orders.statusName) as OrderStatus[];
const MAX_DAYS = 31;
const isStatus = (v: string | null): v is OrderStatus => v !== null && (STATUSES as readonly string[]).includes(v);
const digits = (v: string) => v.replace(/\D/g, '');

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

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">{m.orders.title}</h1>
      <p className="text-sm opacity-70">{m.orders.intro}</p>
      <form className="grid max-w-4xl grid-cols-2 gap-2 rounded-box bg-base-100 p-4 md:grid-cols-4" onSubmit={submit} aria-label={m.orders.title}>
        <label className="text-sm">
          {m.orders.orderId}
          <input className="input input-sm mt-1 w-full" maxLength={64} {...field('orderId')} />
        </label>
        <label className="text-sm">
          {m.orders.customerId}
          <input className="input input-sm mt-1 w-full" maxLength={64} {...field('customerId')} />
        </label>
        <label className="text-sm">
          {m.orders.receiverPhone}
          <input className="input input-sm mt-1 w-full" inputMode="numeric" maxLength={20} placeholder={m.orders.receiverPhoneHint} autoComplete="off" {...field('receiverPhone')} />
        </label>
        <label className="text-sm">
          {m.orders.mfcId}
          <input className="input input-sm mt-1 w-full" maxLength={40} {...field('mfcId')} />
        </label>
        <label className="text-sm">
          {m.orders.status}
          <select className="select select-sm mt-1 w-full" {...field('status')}>
            <option value="">{m.orders.any}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {m.orders.statusName[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {m.orders.from}
          <input type="date" className="input input-sm mt-1 w-full" {...field('from')} />
        </label>
        <label className="text-sm">
          {m.orders.to}
          <input type="date" className="input input-sm mt-1 w-full" {...field('to')} />
        </label>
        <div className="flex items-end">
          <button type="submit" className="btn btn-primary btn-sm">
            {m.orders.search}
          </button>
        </div>
      </form>

      {blocked ? (
        <p role="alert" className="text-sm text-warning" data-testid="order-search-blocked">
          {blocked}
        </p>
      ) : (
        <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
          {(r) =>
            r.items.length === 0 ? (
              <p className="text-sm opacity-70">{m.orders.empty}</p>
            ) : (
              <>
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>{m.orders.orderId}</th>
                      <th>{m.orders.status}</th>
                      <th>{m.orders.confirmedAt}</th>
                      <th>{m.orders.mfcId}</th>
                      <th>{m.orders.customerId}</th>
                      <th>{m.orders.phone}</th>
                      <th>{m.orders.items}</th>
                      <th>{m.orders.total}</th>
                      <th>{m.orders.openIssues}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.items.map((o) => (
                      <tr key={o.orderId} data-testid="order-row">
                        <td>
                          <Link className="link" to={`/orders/${encodeURIComponent(o.orderId)}`}>
                            {o.orderId}
                          </Link>
                        </td>
                        <td>{label(m.orders.statusName, o.status)}</td>
                        <td>{when(o.confirmedAt)}</td>
                        <td>{o.mfcId}</td>
                        <td>{o.customerId}</td>
                        <td>{text(o.receiverPhoneMasked)}</td>
                        <td>{o.itemCount}</td>
                        <td>{won(o.approvedAmount)}</td>
                        <td>{o.openFulfillmentIssues > 0 ? <span className="badge badge-warning badge-sm">{o.openFulfillmentIssues}</span> : 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="join">
                  <button type="button" className="btn join-item btn-sm" disabled={page === 0} onClick={() => goPage(page - 1)}>
                    {m.orders.prev}
                  </button>
                  <span className="btn join-item btn-sm btn-disabled">{m.orders.pageLabel(r.page.page)}</span>
                  <button type="button" className="btn join-item btn-sm" disabled={!r.page.hasNext} onClick={() => goPage(page + 1)}>
                    {m.orders.next}
                  </button>
                </div>
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
      {order.shippingAddressMasked && <p className="text-xs opacity-60">{m.orders.pii.maskedNote}</p>}
      <Facts
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
        <div role="status" className="flex flex-wrap items-center gap-2 text-xs">
          <span>{m.orders.pii.opened(opened.piiAccessLogId, when(opened.recordedAt))}</span>
          <button type="button" className="btn btn-xs" onClick={() => reveal.reset()}>
            {m.orders.pii.hide}
          </button>
        </div>
      ) : (
        <form
          className="space-y-2 rounded-box bg-base-100 p-3 text-sm"
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

export function OrderDetailPage() {
  const { orderId = '' } = useParams();
  const api = useApi();
  const query = useQuery({
    queryKey: ['orders', 'lookup', orderId],
    queryFn: () => request('GET', api.orders.GET('/orders/lookups/{orderId}', { params: { path: { orderId } } })),
  });

  return (
    <section className="max-w-4xl space-y-4">
      <h1 className="text-xl font-bold">{`${m.orders.detailTitle} ${orderId}`}</h1>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(o) => (
          <>
            <Facts
              testId="order-summary"
              rows={[
                [m.orders.status, <span key="s" data-testid="order-status">{label(m.orders.statusName, o.status)}</span>],
                [m.orders.confirmedAt, when(o.confirmedAt)],
                [m.orders.customerId, o.customerId],
                [m.orders.mfcId, o.mfcId],
                [m.orders.deliveryMode, label(m.orders.mode, o.deliveryMode)],
                [m.orders.arrival, o.arrivalWindow ? `${o.arrivalWindow.date} ${o.arrivalWindow.start}~${o.arrivalWindow.end}` : m.none],
                [m.orders.shipments, text(o.plannedShipments)],
                [m.orders.oosPreference, label(m.orders.oos, o.outOfStockPreference)],
                [m.orders.weight, o.weightG === undefined ? m.none : `${o.weightG}g`],
                [m.orders.version, o.version],
              ]}
            />
            <p className="text-xs opacity-60">{`${m.orders.noCancel} ${m.orders.noDeliveryNote}`}</p>

            <h2 className="font-bold">{m.orders.amounts}</h2>
            <Facts
              rows={[
                [m.orders.itemAmount, won(o.amounts.itemAmount)],
                [m.orders.deliveryTip, won(o.amounts.deliveryTip)],
                [m.orders.deliveryTipBase, won(o.amounts.deliveryTipBase)],
                [m.orders.deliveryTipReason, o.amounts.deliveryTipReason],
                [m.orders.firstPurchase, o.amounts.firstPurchaseApplied ? 'O' : 'X'],
                [m.orders.bagFee, won(o.amounts.bagFee)],
                [m.orders.totalAmount, won(o.amounts.totalAmount)],
                [m.orders.approvedAmount, won(o.amounts.approvedAmount)],
                [m.orders.paymentAttemptId, o.payment.paymentAttemptId],
                [m.orders.pgTransactionId, text(o.payment.pgTransactionId)],
              ]}
            />

            <h2 className="font-bold">{m.orders.address}</h2>
            <Address order={o} />

            <h2 className="font-bold">{m.orders.lines}</h2>
            <table className="table table-sm rounded-box bg-base-100">
              <thead>
                <tr>
                  <th>{m.orders.product}</th>
                  <th>SKU</th>
                  <th>{m.orders.qty}</th>
                  <th>{m.orders.lineAmount}</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l, i) => (
                  <tr key={l.orderLineId ?? `line-${i}`} data-testid="order-line">
                    <td>
                      {text(l.productName)}
                      {l.optionLabel && <span className="ml-1 opacity-60">{l.optionLabel}</span>}
                    </td>
                    <td>{text(l.sku)}</td>
                    <td>{[l.originalQty, l.cancelledBeforeShipQty, l.handedOverQty, l.deliveredQty, l.returnedQty].map((q) => text(q)).join(' / ')}</td>
                    <td>{won(l.lineAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h2 className="font-bold">{m.orders.issues}</h2>
            {o.fulfillmentIssues.length === 0 ? (
              <p className="text-sm opacity-70">{m.orders.noIssues}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {o.fulfillmentIssues.map((f, i) => (
                  <li key={f.issueId ?? `issue-${i}`} className="rounded-box bg-base-100 p-2" data-testid="order-issue">
                    {`${label(m.orders.issueState, f.state)} · ${text(f.reason)} · ${text(f.sku)} × ${text(f.blockedQty)} · ${when(f.blockedAt)}`}
                  </li>
                ))}
              </ul>
            )}

            <h2 className="font-bold">{m.deliveries.ofOrder}</h2>
            <DeliveriesOf orderId={o.orderId} />

            <h2 className="font-bold">{m.orders.claims}</h2>
            <ClaimsOfOrder orderId={o.orderId} />
            {o.lines.some((l) => (l.handedOverQty ?? 0) > (l.returnedQty ?? 0)) && <ReturnIntakeLink orderId={o.orderId} />}
          </>
        )}
      </QueryState>
      <Link className="link text-sm" to="/orders">
        {m.orders.back}
      </Link>
    </section>
  );
}
