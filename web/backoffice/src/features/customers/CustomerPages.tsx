// 고객 메뉴(2026-11-20) — bff 0.22.0 BF-2(백엔드 #287, main f397211b) 1단계: 조회만.
// - 찾기 `GET /backoffice/views/customer-search` — customerNumber·phone·orderNumber 중 **하나만**, 완전 일치(이름 검색·전체 목록 없음). 속성 필터에서 하나를 고르면 다른 조건은 지운다.
// - 상세 `GET /backoffice/views/customer/{customerId}` — 머리는 가린 값 그대로. 칸(주문·문의·상담원 접수·클레임)은 원천 실패면 null → "확인 못 함"(0건 아님).
// - 클레임 칸(bff 0.23.0, claim CL-7): 최근 10건, 더 있으면 클레임 목록(customerId)으로. 사유는 싣지 않는다 — 상세에서.
// - 원문 `POST /customers/{id}/pii-reveals`(customer 0.11.0) — 사유 2~200자, 열람 기록이 남은 뒤 고른 항목만. 받은 원문은 메모리에만(라이더 상세와 같은 방식).
// - bff 0.25.0 BF-5(2026-11-23): 배송 칸(주문 칸 주문들의 배송, 주소 없음)·클레임 종류별 수(0 까지)·클레임 줄 사유·환불 금액·개인정보 열람 기록(관리자만 — 그 밖 직원은 늘 null 이라 "관리자만", 실패 아님).
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/backoffice-bff';
import type { components as CustomerC } from '../../api/generated/customer';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { ago } from '../../app/DashboardBoard';
import { CodeLabel, DataTable, DetailHeader, FieldList, Notice, PropertyFilter, Section, StatusBadge, type FilterProp, type Tone, ListHeader, listCount, refreshOf } from '../../shared/admin';
import { messages } from '../../shared/messages';
import { label, text, when, won } from '../../shared/ops';
import { statusTone } from '../orders/OrderLookupPages';
import { claimLabel, claimTone } from '../claims/ClaimPages';
import { useHelp } from '../../shared/HelpPanel';
import { CopyButton } from '../../shared/CopyButton';

const m = messages.customers;
type Detail = components['schemas']['ComposedView'] & components['schemas']['CustomerDetailView'];
type PiiField = CustomerC['schemas']['CustomerPiiField'];
const PII_FIELDS: readonly PiiField[] = ['NAME', 'PHONE'];
const KEYS = ['customerNumber', 'phone', 'orderNumber'] as const;
type Key = (typeof KEYS)[number];

const statusToneOf = (s: string | null | undefined): Tone => (s === 'ACTIVE' ? 'success' : s === 'WITHDRAW_PENDING' ? 'warning' : 'ghost');

export function CustomerSearchPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const given = KEYS.filter((k) => (params.get(k) ?? '').trim() !== '');
  const by: Key | undefined = given.length === 1 ? given[0] : undefined;
  const value = by ? (params.get(by) ?? '').trim() : '';
  const query = useQuery({
    queryKey: ['customers', 'search', by, value],
    enabled: by !== undefined,
    queryFn: () => request('GET', api.bff.GET('/views/customer-search', { params: { query: by ? { [by]: by === 'phone' ? value.replace(/[\s-]/g, '') : value } : {} } })),
  });
  // 하나만 — 새 조건을 고르면 다른 조건은 지운다(계약: 둘 이상이면 400)
  const change = (patch: Readonly<Record<string, string | null>>) => {
    const next = new URLSearchParams(params);
    const set = Object.entries(patch).find(([, v]) => v !== null && v.trim() !== '');
    if (set) for (const k of KEYS) next.delete(k);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || !v.trim()) next.delete(k);
      else next.set(k, v.trim());
    }
    setParams(next);
  };
  const help = useHelp('customers', m.title, <>{messages.help.customers.map((t) => <p key={t}>{t}</p>)}</>);
  const props: FilterProp[] = KEYS.map((k) => ({ key: k, label: m.by[k], text: { hint: m.byHint[k], maxLength: k === 'phone' ? 20 : 16, numeric: true } }));
  return (
    <section className="space-y-4">
      <ListHeader title={m.title} count={by ? listCount(query) : undefined} refresh={by ? refreshOf(query) : undefined} onInfo={help?.open} />
      <div className="rounded-box border border-base-300 bg-base-100 px-5 py-3" data-list-part="top">
        <PropertyFilter props={props} value={Object.fromEntries(KEYS.map((k) => [k, params.get(k) ?? undefined]))} onChange={change} testId="customer-filter" />
        <p className="mt-2 text-xs text-base-content/60">{m.searchHint}</p>
      </div>
      {by && (
        <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
          {(r) => (
            <div className="space-y-2">
              {(r.unavailableSources ?? []).length > 0 && <Notice tone="warning">{m.sourceFailed}</Notice>}
              {r.items.length === 0 ? (
                <p className="rounded-box border border-base-300 bg-base-100 px-5 py-6 text-center text-sm text-base-content/60" data-testid="customer-empty">
                  {m.empty}
                </p>
              ) : (
                <DataTable testId="customer-results">
                  <thead>
                    <tr>
                      <th>{m.col.number}</th>
                      <th>{m.col.name}</th>
                      <th>{m.col.phone}</th>
                      <th>{m.col.status}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.items.map((c) => (
                      <tr key={c.customerId} data-testid="customer-row">
                        <td>
                          <Link to={`/customers/${encodeURIComponent(c.customerId)}`}>{c.customerNumber ?? m.detailTitle}</Link>
                        </td>
                        <td>{text(c.nameMasked)}</td>
                        <td className="font-mono text-sm">{text(c.phoneMasked)}</td>
                        <td>
                          <StatusBadge tone={statusToneOf(c.status)}>{label(m.statusName, c.status)}</StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              )}
            </div>
          )}
        </QueryState>
      )}
    </section>
  );
}

/** 칸 — 원천 실패(null)면 "확인 못 함", 비었으면 "없음", 더 있으면 "최근 10건만" */
function Part<T>({ title, part, children, testId, more, head, nullText }: { readonly title: string; readonly part: { readonly hasMore?: boolean; readonly items?: readonly T[] } | null | undefined; readonly children: (items: readonly T[]) => React.ReactNode; readonly testId: string; readonly more?: React.ReactNode; readonly head?: React.ReactNode; readonly nullText?: string }) {
  return (
    <Section title={title} testId={testId} aside={part?.hasMore ? (more ?? <span className="text-xs text-base-content/60">{m.recentOnly}</span>) : undefined}>
      {part !== null && part !== undefined && head}
      {part === null || part === undefined ? (
        nullText ? (
          <p className="text-sm text-base-content/60" data-testid={`${testId}-restricted`}>
            {nullText}
          </p>
        ) : (
          <p className="text-sm text-warning" data-testid={`${testId}-failed`}>
            {m.sourceFailed}
          </p>
        )
      ) : (part.items ?? []).length === 0 ? (
        <p className="text-sm text-base-content/60">{m.noneRows}</p>
      ) : (
        children(part.items ?? [])
      )}
    </Section>
  );
}

export function CustomerDetailPage() {
  const { customerId = '' } = useParams();
  const api = useApi();
  const q = useQuery({
    queryKey: ['customers', 'detail', customerId],
    queryFn: () => request('GET', api.bff.GET('/views/customer/{customerId}', { params: { path: { customerId } } })),
  });
  return (
    <QueryState state={toUiState(q)} onRetry={() => void q.refetch()}>
      {(d) => <CustomerDetail d={d} />}
    </QueryState>
  );
}

function CustomerDetail({ d }: { readonly d: Detail }) {
  const api = useApi();
  const { session } = useSession();
  // 열람 기록은 OPERATOR_ADMIN 만 값이 온다 — 그 밖 직원의 null 은 장애가 아니다
  const admin = session?.roles.includes('OPERATOR_ADMIN') ?? false;
  const c = d.customer;
  const [fields, setFields] = useState<readonly PiiField[]>(PII_FIELDS);
  const [reason, setReason] = useState('');
  const reveal = useCommand(async (v: { reason: string; fields: readonly PiiField[] }, key) =>
    request('POST', api.customer.POST('/customers/{customerId}/pii-reveals', { ...commandParams(key, { path: { customerId: c.customerId } }), body: { reason: v.reason, fields: [...v.fields] } })),
  );
  const opened = reveal.phase.kind === 'done' ? reveal.phase.result : null;
  const isOpen = (f: PiiField) => opened?.fields?.includes(f) ?? false;
  const reasonOk = reason.trim().length >= 2 && reason.trim().length <= 200;
  // 도움말(위치 줄 ⓘ) — 찾기 화면과 같은 글
  useHelp('customers', m.title, <>{messages.help.customers.map((t) => <p key={t}>{t}</p>)}</>);
  return (
    <section className="space-y-4" data-testid="customer-detail">
      <DetailHeader
        back={{ to: '/customers', label: m.back }}
        title={`${text(c.nameMasked)} · ${c.customerNumber ?? ''}`}
        badges={
          <>
            {/* 고객번호 복사(2026-11-20 AWS 값 옆 복사) */}
            {c.customerNumber && <CopyButton value={c.customerNumber} />}
            <StatusBadge tone={statusToneOf(c.status)}>{label(m.statusName, c.status)}</StatusBadge>
            {c.socialProvider && <span className="text-sm text-base-content/70">{label(m.providerName, c.socialProvider)}</span>}
          </>
        }
        summary={c.joinedAt ? `${m.joinedAt} ${when(c.joinedAt)}` : undefined}
      />
      {(d.unavailableSources ?? []).length > 0 && <Notice tone="warning">{m.sourceFailed}</Notice>}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Section title={m.basic}>
            <FieldList
              testId="customer-basic"
              rows={[
                [m.name, <span key="n" data-testid="customer-name" data-masked={!isOpen('NAME')}>{isOpen('NAME') ? text(opened?.name) : text(c.nameMasked)}</span>],
                [m.phone, <span key="p" className="font-mono" data-testid="customer-phone" data-masked={!isOpen('PHONE')}>{isOpen('PHONE') ? text(opened?.phone) : text(c.phoneMasked)}</span>],
                [m.email, text(c.emailMasked)],
                [m.provider, c.socialProvider ? <CodeLabel key="s" code={c.socialProvider} names={m.providerName} /> : messages.none],
                [m.phoneVerified, c.phoneVerified === null || c.phoneVerified === undefined ? messages.none : c.phoneVerified ? m.verified : m.notVerified],
                [m.joinedAt, when(c.joinedAt)],
              ]}
            />
          </Section>
        </div>
        <aside className="min-w-0">
          {c.status === 'WITHDRAW_COMPLETED' ? (
            // 탈퇴 완료(customer 0.12.0) — 지운 값이라 열람할 원문이 없다
            <Notice>
              <span data-testid="customer-withdrawn">{m.withdrawnNote}</span>
            </Notice>
          ) : opened ? (
            <div role="status" className="space-y-2 rounded-box border-2 border-warning bg-warning/10 p-4 text-xs">
              <p>{m.pii.opened(text(opened.piiAccessLogId), when(opened.recordedAt))}</p>
              <button type="button" className="btn btn-sm" onClick={() => reveal.reset()}>
                {m.pii.hide}
              </button>
            </div>
          ) : (
            <form
              className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4 text-sm"
              aria-label={m.pii.title}
              onSubmit={(e) => {
                e.preventDefault();
                if (!reasonOk || fields.length === 0) return;
                if (reveal.phase.kind === 'rejected') reveal.reset();
                void reveal.run({ reason: reason.trim(), fields });
              }}
            >
              <h3 className="font-bold">{m.pii.title}</h3>
              <fieldset className="flex flex-wrap gap-3">
                <legend className="mb-1 text-sm font-semibold text-base-content/80">{m.pii.fields}</legend>
                {PII_FIELDS.map((f) => (
                  <label key={f} className="flex items-center gap-1">
                    <input type="checkbox" className="checkbox checkbox-xs" checked={fields.includes(f)} onChange={(e) => setFields((cur) => (e.target.checked ? PII_FIELDS.filter((x) => x === f || cur.includes(x)) : cur.filter((x) => x !== f)))} />
                    {m.pii.fieldName[f]}
                  </label>
                ))}
              </fieldset>
              <label className="flex flex-col gap-1 text-sm font-semibold text-base-content/80">
                {m.pii.reason}
                <input className="input input-sm w-full font-normal" maxLength={200} autoComplete="off" placeholder={m.pii.reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <button type="submit" className="btn btn-sm w-full" disabled={!reasonOk || fields.length === 0 || reveal.busy}>
                {m.pii.open}
              </button>
              <CommandFeedback command={reveal} />
            </form>
          )}
        </aside>
      </div>

      <Part title={m.orders} part={d.orders} testId="customer-orders">
        {(items) => (
          <DataTable>
            <thead>
              <tr>
                <th>{m.orderCol.number}</th>
                <th>{m.orderCol.status}</th>
                <th>{m.orderCol.at}</th>
                <th className="text-right">{m.orderCol.items}</th>
                <th className="text-right">{m.orderCol.total}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.orderId}>
                  <td>
                    <Link to={`/orders/${encodeURIComponent(o.orderId ?? '')}`}>{o.orderNumber ?? messages.displayNumber.missing}</Link>
                  </td>
                  <td>
                    <StatusBadge tone={statusTone(o.status ?? undefined)}>{label(messages.orders.statusName, o.status)}</StatusBadge>
                  </td>
                  <td>{ago(o.confirmedAt) ?? messages.none}</td>
                  <td className="text-right tabular-nums">{text(o.itemCount)}</td>
                  <td className="text-right tabular-nums">{o.totalAmount === null || o.totalAmount === undefined ? messages.none : won(o.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Part>

      <Part title={m.deliveries} part={d.deliveries} testId="customer-deliveries">
        {(items) => (
          <DataTable>
            <thead>
              <tr>
                <th>{m.deliveryCol.number}</th>
                <th>{m.deliveryCol.order}</th>
                <th>{m.deliveryCol.type}</th>
                <th>{m.deliveryCol.state}</th>
                <th>{m.deliveryCol.promisedAt}</th>
                <th>{m.deliveryCol.completedAt}</th>
                <th>{m.deliveryCol.method}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((x, i) => (
                <tr key={x.deliveryId ?? i} data-testid="customer-delivery-row">
                  <td>{x.deliveryId ? <Link to={`/deliveries/${encodeURIComponent(x.deliveryId)}`}>{x.deliveryNumber ?? messages.displayNumber.missing}</Link> : (x.deliveryNumber ?? messages.none)}</td>
                  <td>{x.orderId ? <Link to={`/orders/${encodeURIComponent(x.orderId)}`}>{x.orderNumber ?? messages.displayNumber.missing}</Link> : messages.none}</td>
                  <td>{x.type ? <CodeLabel code={x.type} names={messages.deliveries.typeName} /> : messages.none}</td>
                  <td>{x.state ? <CodeLabel code={x.state} names={messages.deliveries.executionState} /> : messages.none}</td>
                  <td>{when(x.promisedAt)}</td>
                  <td>{when(x.completedAt)}</td>
                  <td>{x.completionMethod ? <CodeLabel code={x.completionMethod} names={m.completionMethodName} /> : messages.none}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Part>

      <Part
        title={m.claims}
        part={d.claims}
        testId="customer-claims"
        head={
          d.claimCounts ? (
            <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label={m.claimCountsLabel} data-testid="customer-claim-counts">
              {(d.claimCounts.counts ?? []).map((k) => (
                <span key={k.key} className={k.count ? '' : 'text-base-content/50'}>
                  {label(messages.claims.typeName, k.key)} <b className="tabular-nums">{k.count ?? 0}</b>
                </span>
              ))}
            </p>
          ) : (
            <p className="mb-3 text-xs text-warning" data-testid="customer-claim-counts-failed">
              {m.claimCountsFailed}
            </p>
          )
        }
        more={
          <Link className="text-xs text-primary hover:underline" to={`/claims?customerId=${encodeURIComponent(c.customerId)}`} data-testid="customer-claims-all">
            {m.allClaims}
          </Link>
        }
      >
        {(items) => (
          <DataTable>
            <thead>
              <tr>
                <th>{m.claimCol.claim}</th>
                <th>{m.claimCol.state}</th>
                <th>{m.claimCol.reason}</th>
                <th>{m.claimCol.refund}</th>
                <th>{m.claimCol.at}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.claimId} data-testid="customer-claim-row">
                  <td>
                    <Link to={`/claims/${encodeURIComponent(x.claimId ?? '')}`}>{claimLabel(x.orderNumber, x.type, x.openedAt, x.claimSeq)}</Link>
                  </td>
                  <td>
                    <StatusBadge tone={claimTone(x.state)}>{label(messages.claims.stateName, x.state)}</StatusBadge>
                  </td>
                  <td>{x.reason ? <CodeLabel code={x.reason} names={messages.claims.reasonName} /> : messages.none}</td>
                  <td>
                    {x.refundState ? label(messages.claims.listView.refundState, x.refundState) : messages.none}
                    {/* bff 0.25.0 — 서버 금액 그대로(계산하지 않는다) */}
                    {(typeof x.refundRequestedAmount === 'number' || typeof x.refundedAmount === 'number') && (
                      <span className="block text-xs tabular-nums text-base-content/60" data-testid="customer-claim-refund">
                        {m.refundAmounts(typeof x.refundRequestedAmount === 'number' ? won(x.refundRequestedAmount) : messages.none, typeof x.refundedAmount === 'number' ? won(x.refundedAmount) : messages.none)}
                      </span>
                    )}
                  </td>
                  <td>{ago(x.openedAt) ?? messages.none}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Part>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Part title={m.inquiries} part={d.inquiries} testId="customer-inquiries">
          {(items) => (
            <DataTable>
              <thead>
                <tr>
                  <th>{m.inquiryCol.number}</th>
                  <th>{m.inquiryCol.category}</th>
                  <th>{m.inquiryCol.status}</th>
                  <th>{m.inquiryCol.at}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => (
                  <tr key={x.inquiryId}>
                    <td>
                      <Link to={`/inquiries/${encodeURIComponent(x.inquiryId ?? '')}`}>{x.inquiryNumber ?? messages.displayNumber.missing}</Link>
                    </td>
                    <td>{label(messages.inquiries.categoryName, x.category)}</td>
                    <td>{label(messages.inquiries.status, x.status)}</td>
                    <td>{ago(x.createdAt) ?? messages.none}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Part>
        <Part title={m.csIntakes} part={d.csIntakes} testId="customer-intakes">
          {(items) => (
            <DataTable>
              <thead>
                <tr>
                  <th>{m.intakeCol.at}</th>
                  <th>{m.intakeCol.channel}</th>
                  <th>{m.intakeCol.by}</th>
                  <th>{m.intakeCol.link}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => (
                  <tr key={x.intakeId}>
                    <td>{ago(x.receivedAt) ?? messages.none}</td>
                    <td>{label(messages.csIntake.channelName, x.channel)}</td>
                    <td>{x.receivedByLabel?.name ?? messages.none}</td>
                    <td>
                      {x.caseId ? (
                        <Link to={`/cases/${encodeURIComponent(x.caseId)}`}>{messages.nav.cases}</Link>
                      ) : x.inquiryId ? (
                        <Link to={`/inquiries/${encodeURIComponent(x.inquiryId)}`}>{m.inquiries}</Link>
                      ) : (
                        messages.none
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Part>
      </div>

      <Part title={m.piiLogs} part={d.piiAccessLogs} testId="customer-pii-logs" {...(admin ? {} : { nullText: m.piiLogsAdminOnly })}>
        {(items) => (
          <DataTable>
            <thead>
              <tr>
                <th>{m.piiLogCol.at}</th>
                <th>{m.piiLogCol.actor}</th>
                <th>{m.piiLogCol.fields}</th>
                <th>{m.piiLogCol.type}</th>
                <th>{m.piiLogCol.purpose}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((x, i) => (
                <tr key={`${x.occurredAt ?? ''}:${x.actorId ?? ''}:${i}`} data-testid="customer-pii-log-row">
                  <td>{when(x.occurredAt)}</td>
                  <td>{x.actorLabel?.name ? `${x.actorLabel.name}${x.actorLabel.employeeNo ? ` · ${x.actorLabel.employeeNo}` : ''}` : messages.none}</td>
                  <td>{(x.fields ?? []).map((f) => label(messages.piiLogs.fieldName, f)).join(', ') || messages.none}</td>
                  <td>{x.accessType ? <CodeLabel code={x.accessType} names={messages.piiLogs.accessTypeName} /> : messages.none}</td>
                  <td className="max-w-[20rem] truncate" title={x.purpose ?? undefined}>
                    {text(x.purpose)}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Part>
    </section>
  );
}
