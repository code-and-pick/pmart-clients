// 행사·쿠폰(promotion 0.2.0, ADR-0082 — 사용자 결정 2026-11-20, 요청서 pmart-backend handoff/clients/backoffice/2026-11-20-request-promotions-coupons-screen.md).
// 목록 → 만들기·고치기(DRAFT·REJECTED) → 저장하고 승인 요청(제출 = 검사·잠금 → approvalRequest 를 approval POST /change-requests, 진열 편성과 같은 방식)
// → 승인되면 APPROVED(시작~끝 사이 진행 중). 승인된 행사는 조기 종료 승인 요청, 직원 지정 발급 쿠폰은 진행 중에 고객별 발급.
// 상태·단계·문제(problems)는 서버 값 그대로 — 화면은 판정하지 않는다(보내기 전 안내만). 주문 금액 반영은 서버 다음 단계.
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { PmartFailure, ProblemFailure, request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { requestApproval, type ApprovalRequested } from '../../api/approvalFlow';
import { commandParams, IdempotencyKey } from '../../api/command';
import { ISSUE_MODES, PROMOTION_KINDS, PROMOTION_STATES, type ApprovalRequestBody, type CouponPolicy, type Promotion, type PromotionInput, type PromotionKind } from '../../api/models';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { RequestApproval } from '../approvals/RequestApproval';
import { Person } from '../lookup/parts';
import { DataTable, FieldList, ListHeader, listCount, PageHeader, refreshOf, Section, StatusBadge, type Tone } from '../../shared/admin';
import { CommandFeedback, FailureAlert } from '../../shared/Feedback';
import { LeaveGuard } from '../../shared/LeaveGuard';
import { messages } from '../../shared/messages';
import { SearchSelect } from '../../shared/SearchSelect';

const m = messages.promotions;
const f = m.form;

const MANAGE = ['MARKETING', 'OPERATOR_ADMIN'];
const GRANT = ['MARKETING', 'CS_AGENT', 'OPERATOR_ADMIN'];
function useRoles() {
  const { session } = useSession();
  const roles = session?.roles ?? [];
  return { canManage: roles.some((r) => MANAGE.includes(r)), canGrant: roles.some((r) => GRANT.includes(r)) };
}

const label = (names: Readonly<Record<string, string>>, v: string | null | undefined) => (v ? (names[v] ?? v) : messages.none);
const stateTone = (s: string): Tone => (s === 'APPROVED' ? 'success' : s === 'REJECTED' ? 'error' : s === 'SUBMITTED' ? 'warning' : s === 'ENDED' ? 'ghost' : 'info');
const phaseTone = (p: string): Tone => (p === 'RUNNING' ? 'success' : p === 'SCHEDULED' ? 'info' : 'ghost');

export function discountText(p: Pick<Promotion, 'kind' | 'discount'>): string {
  return p.discount.type === 'RATE' ? m.rate(p.discount.value, p.discount.maxAmount) : m.amount(p.discount.value, p.kind === 'PRICE_DISCOUNT');
}
const periodText = (p: Pick<Promotion, 'startsAt' | 'endsAt'>) => `${formatSeoul(p.startsAt)} ~ ${formatSeoul(p.endsAt)}`;

// ── 시각 칸: datetime-local(서울 시각) ↔ ISO ──
const seoulInput = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const toLocalInput = (iso: string | null | undefined) => (iso ? seoulInput.format(new Date(iso)).replace(' ', 'T') : '');
const fromLocalInput = (v: string) => (v ? `${v}:00+09:00` : '');

// ── 목록 ──
export function PromotionListPage() {
  const api = useApi();
  const { canManage } = useRoles();
  const [params, setParams] = useSearchParams();
  const kind = PROMOTION_KINDS.find((k) => k === params.get('kind'));
  const state = PROMOTION_STATES.find((s) => s === params.get('state'));
  const query = useInfiniteQuery({
    queryKey: ['promotions', 'list', kind, state],
    queryFn: ({ pageParam }) =>
      request('GET', api.promotion.GET('/promotions', { params: { query: { ...(kind ? { kind } : {}), ...(state ? { state } : {}), ...(pageParam ? { cursor: pageParam } : {}), size: 50 } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next);
  };
  return (
    <section className="space-y-4">
      <ListHeader
        title={m.title}
        count={listCount(query)}
        refresh={refreshOf(query)}
        actions={
          canManage && (
            <Link className="btn btn-primary btn-sm" to="/promotions/new">
              {m.create}
            </Link>
          )
        }
      />
      <p className="text-xs text-base-content/60" data-testid="promotion-stage-note">
        {m.stageNote}
      </p>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-box border border-base-300 bg-base-100 px-4 py-3" role="group" aria-label={m.filters}>
        <label className="flex flex-col gap-1 text-xs font-medium text-base-content/60">
          {m.col.kind}
          <select className="select select-sm w-40" aria-label={m.col.kind} value={kind ?? ''} onChange={(e) => setParam('kind', e.target.value)}>
            <option value="">{m.all}</option>
            {PROMOTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {m.kindName[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-base-content/60">
          {m.col.state}
          <select className="select select-sm w-36" aria-label={m.col.state} value={state ?? ''} onChange={(e) => setParam('state', e.target.value)}>
            <option value="">{m.all}</option>
            {PROMOTION_STATES.map((s) => (
              <option key={s} value={s}>
                {m.stateName[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <QueryState state={toUiState(query, () => items.length === 0)} onRetry={() => void query.refetch()} emptyText={m.empty}>
        {() => (
          <DataTable testId="promotion-table">
            <thead>
              <tr>
                <th>{m.col.name}</th>
                <th>{m.col.kind}</th>
                <th>{m.col.state}</th>
                <th>{m.col.period}</th>
                <th className="text-right">{m.col.discount}</th>
                <th className="text-right">{m.col.coupons}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.promotionId} data-testid="promotion-row">
                  <td>
                    <Link className="font-medium hover:underline" to={`/promotions/${encodeURIComponent(p.promotionId)}`}>
                      {p.name}
                    </Link>
                    {p.problems.length > 0 && (
                      <span className="ml-2 text-xs text-warning" title={f.problemsTitle}>
                        {f.problemsCount(p.problems.length)}
                      </span>
                    )}
                  </td>
                  <td>{label(m.kindName, p.kind)}</td>
                  <td>
                    <span className="inline-flex flex-wrap gap-1">
                      <StatusBadge tone={stateTone(p.state)}>{label(m.stateName, p.state)}</StatusBadge>
                      {p.state === 'APPROVED' || p.state === 'ENDED' ? <StatusBadge tone={phaseTone(p.phase)}>{label(m.phaseName, p.phase)}</StatusBadge> : null}
                    </span>
                  </td>
                  <td className="text-xs tabular-nums">{periodText(p)}</td>
                  <td className="text-right tabular-nums">{discountText(p)}</td>
                  <td className="text-right text-xs tabular-nums">{p.kind === 'COUPON' ? m.coupons(p.issuedCount ?? 0, p.usedCount ?? 0, p.coupon?.totalQuantity) : <span className="text-base-content/35">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </QueryState>
      {query.hasNextPage && (
        <div className="flex justify-center">
          <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {m.more}
          </button>
        </div>
      )}
    </section>
  );
}

// ── 만들기·고치기 ──
interface Draft {
  readonly kind: PromotionKind;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly discountType: 'RATE' | 'AMOUNT';
  readonly value: string;
  readonly maxAmount: string;
  readonly targets: ReadonlyArray<{ readonly type: 'SKU' | 'CATEGORY'; readonly id: string }>;
  readonly issueMode: CouponPolicy['issueMode'];
  readonly minOrderAmount: string;
  readonly totalQuantity: string;
  readonly perCustomerLimit: string;
  readonly useMode: 'days' | 'until';
  readonly useDays: string;
  readonly useUntil: string;
}

const emptyDraft = (kind: PromotionKind): Draft => ({
  kind,
  name: '',
  startsAt: '',
  endsAt: '',
  discountType: 'RATE',
  value: '',
  maxAmount: '',
  targets: [],
  issueMode: 'DOWNLOAD',
  minOrderAmount: '0',
  totalQuantity: '',
  perCustomerLimit: '1',
  useMode: 'days',
  useDays: '7',
  useUntil: '',
});

function draftOf(p: Promotion): Draft {
  const c = p.coupon;
  return {
    kind: p.kind,
    name: p.name,
    startsAt: toLocalInput(p.startsAt),
    endsAt: toLocalInput(p.endsAt),
    discountType: p.discount.type,
    value: String(p.discount.value),
    maxAmount: p.discount.maxAmount ? String(p.discount.maxAmount) : '',
    targets: (p.targets ?? []).map((t) => ({ type: t.type, id: t.id })),
    issueMode: c?.issueMode ?? 'DOWNLOAD',
    minOrderAmount: String(c?.minOrderAmount ?? 0),
    totalQuantity: c?.totalQuantity ? String(c.totalQuantity) : '',
    perCustomerLimit: String(c?.perCustomerLimit ?? 1),
    useMode: c?.useUntil ? 'until' : 'days',
    useDays: c?.useDays ? String(c.useDays) : '7',
    useUntil: toLocalInput(c?.useUntil),
  };
}

const num = (v: string) => (v.trim() === '' ? null : Number(v));

/** 화면 칸 → 계약 본문(검사는 서버 — 비운 숫자는 0·null 로 보내고 서버 problems 로 돌려받는다) */
function inputOf(d: Draft): PromotionInput {
  const base = {
    kind: d.kind,
    name: d.name.trim(),
    startsAt: fromLocalInput(d.startsAt),
    endsAt: fromLocalInput(d.endsAt),
    discount: { type: d.discountType, value: num(d.value) ?? 0, maxAmount: d.kind === 'COUPON' && d.discountType === 'RATE' ? num(d.maxAmount) : null },
  };
  if (d.kind === 'PRICE_DISCOUNT') return { ...base, targets: d.targets.filter((t) => t.id.trim() !== '').map((t) => ({ type: t.type, id: t.id.trim() })) };
  return {
    ...base,
    coupon: {
      issueMode: d.issueMode,
      minOrderAmount: num(d.minOrderAmount) ?? 0,
      totalQuantity: num(d.totalQuantity),
      perCustomerLimit: num(d.perCustomerLimit) ?? 1,
      useDays: d.useMode === 'days' ? num(d.useDays) : null,
      useUntil: d.useMode === 'until' && d.useUntil ? fromLocalInput(d.useUntil) : null,
    },
  };
}

/** 문제 칸 이름(field → 화면 칸 이름) */
const FIELD_NAME: Readonly<Record<string, string>> = {
  name: f.name,
  startsAt: f.startsAt,
  endsAt: f.endsAt,
  discount: f.discountType,
  'discount.type': f.discountType,
  'discount.value': f.value.RATE ?? '',
  'discount.maxAmount': f.maxAmount,
  targets: f.targets,
  coupon: f.issueMode,
  'coupon.issueMode': f.issueMode,
  'coupon.minOrderAmount': f.minOrderAmount,
  'coupon.totalQuantity': f.totalQuantity,
  'coupon.perCustomerLimit': f.perCustomerLimit,
  'coupon.useDays': f.usePeriod,
  'coupon.useUntil': f.useUntil,
};
const fieldName = (field: string) => FIELD_NAME[field] ?? FIELD_NAME[field.replace(/\[\d+\].*$/, '')] ?? field;

/** 서버 422 PROMOTION_INVALID details */
function rejectedProblems(failure: PmartFailure | null): ReadonlyArray<{ field: string; reason: string }> {
  if (!(failure instanceof ProblemFailure) || failure.problem.code !== 'PROMOTION_INVALID') return [];
  return (failure.problem.details ?? []).map((d) => ({ field: d.field ?? '', reason: d.reason ?? '' }));
}

function Problems({ items }: { readonly items: ReadonlyArray<{ field: string; reason: string }> }) {
  if (items.length === 0) return null;
  return (
    <div role="alert" className="alert alert-warning alert-soft flex-col items-start gap-1 text-sm" data-testid="promotion-problems">
      <p className="font-semibold">
        {f.problemsTitle} · {f.problemsCount(items.length)}
      </p>
      <ul className="list-disc pl-5">
        {items.map((p, i) => (
          <li key={i}>
            <span className="font-medium">{fieldName(p.field)}</span> — {p.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

const fieldCls = 'flex flex-col items-start gap-1 text-sm';

function PromotionForm({ initial, existing, editable }: { readonly initial: Draft; readonly existing: Promotion | null; readonly editable: boolean }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [d, setD] = useState<Draft>(initial);
  const [base, setBase] = useState({ draft: initial, version: existing?.version ?? 0, id: existing?.promotionId ?? null });
  const [saved, setSaved] = useState<Promotion | null>(existing);
  const dirty = JSON.stringify(d) !== JSON.stringify(base.draft);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const tree = useQuery({ queryKey: ['product', 'category-tree'], queryFn: () => request('GET', api.product.GET('/categories/tree', {})), enabled: d.kind === 'PRICE_DISCOUNT' });

  /** 만들기(POST) 또는 고치기(PUT, X-Expected-Version) */
  const put = async (key: IdempotencyKey, now: Draft): Promise<Promotion> => {
    const body = inputOf(now);
    const p = base.id
      ? await request('PUT', api.promotion.PUT('/promotions/{promotionId}', { ...commandParams(key, { path: { promotionId: base.id }, version: base.version }), body }))
      : await request('POST', api.promotion.POST('/promotions', { ...commandParams(key), body }));
    setBase({ draft: now, version: p.version, id: p.promotionId });
    setSaved(p);
    qc.setQueryData(['promotions', 'one', p.promotionId], p);
    void qc.invalidateQueries({ queryKey: ['promotions', 'list'] });
    return p;
  };
  // 보낼 값은 누른 때 만들어 명령 값으로(2026-11-23 #410 후속) — 결과 불명 뒤 "같은 요청으로 결과 확인"(같은 키)은 처음 값 그대로
  const save = useCommand((now: Draft, key) => put(key, now));
  // 한 번 누르면: (새것이거나 바뀌었으면) 저장 → 제출(검사·잠금) → 승인 요청. 키 하나에서 단계별 키(다시 누르면 같은 키)
  const submit = useCommand(async (v: { readonly draft: Draft; readonly needSave: boolean }, key): Promise<{ id: string; requested: ApprovalRequested | null; retry: ApprovalRequestBody | null; failure: PmartFailure | null }> => {
    const p = v.needSave ? await put(new IdempotencyKey(`${key.value}:save`), v.draft) : saved!;
    const sub = await request('POST', api.promotion.POST('/promotions/{promotionId}/submissions', { ...commandParams(new IdempotencyKey(`${key.value}:submit`), { path: { promotionId: p.promotionId } }) }));
    void qc.invalidateQueries({ queryKey: ['promotions'] });
    const ap = sub.approvalRequest as unknown as ApprovalRequestBody;
    try {
      return { id: p.promotionId, requested: await requestApproval(api, ap, new IdempotencyKey(`${key.value}:approval`)), retry: null, failure: null };
    } catch (e) {
      return { id: p.promotionId, requested: null, retry: ap, failure: e instanceof PmartFailure ? e : null };
    }
  });
  const result = submit.phase.kind === 'done' ? submit.phase.result : null;
  const problems = [...rejectedProblems(submit.phase.kind === 'rejected' ? submit.phase.failure : null)];
  const shown = problems.length > 0 ? problems : (saved?.problems ?? []);
  const locked = !editable || save.busy || submit.busy || result !== null;
  const coupon = d.kind === 'COUPON';

  return (
    <form
      className="space-y-4"
      aria-label={existing ? existing.name : m.newTitle}
      onSubmit={(e) => {
        e.preventDefault();
        if (!locked) void submit.run({ draft: d, needSave: !base.id || dirty });
      }}
    >
      <LeaveGuard when={editable && dirty && result === null} />
      <Section title={f.kind}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={f.kind}>
            {PROMOTION_KINDS.map((k) => (
              <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-box border px-3 py-2 text-sm ${d.kind === k ? 'border-primary bg-primary/5' : 'border-base-300'}`}>
                <input type="radio" className="radio radio-sm" name="kind" value={k} checked={d.kind === k} disabled={locked || existing !== null} onChange={() => set({ kind: k })} />
                {m.kindName[k]}
              </label>
            ))}
          </div>
          <p className="text-xs text-base-content/60">{f.kindHint[d.kind]}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={`${fieldCls} sm:col-span-2`}>
              {f.name}
              <input className="input input-sm w-full max-w-lg" maxLength={60} value={d.name} disabled={locked} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label className={fieldCls}>
              {f.startsAt}
              <input type="datetime-local" className="input input-sm" value={d.startsAt} disabled={locked} onChange={(e) => set({ startsAt: e.target.value })} />
            </label>
            <label className={fieldCls}>
              {coupon ? f.endsAtCoupon : f.endsAt}
              <input type="datetime-local" className="input input-sm" value={d.endsAt} min={d.startsAt || undefined} disabled={locked} onChange={(e) => set({ endsAt: e.target.value })} />
            </label>
            <label className={fieldCls}>
              {f.discountType}
              <select className="select select-sm w-40" value={d.discountType} disabled={locked} onChange={(e) => set({ discountType: e.target.value === 'AMOUNT' ? 'AMOUNT' : 'RATE' })}>
                <option value="RATE">{f.discountTypeName.RATE}</option>
                <option value="AMOUNT">{f.discountTypeName.AMOUNT}</option>
              </select>
            </label>
            <label className={fieldCls}>
              {f.value[d.discountType]}
              <input type="number" inputMode="numeric" className="input input-sm w-40" min={1} max={d.discountType === 'RATE' ? 90 : undefined} value={d.value} disabled={locked} onChange={(e) => set({ value: e.target.value })} />
            </label>
            {!coupon && d.discountType === 'AMOUNT' && <p className="text-xs text-base-content/60 sm:col-span-2">{f.amountPerUnit}</p>}
            {coupon && d.discountType === 'RATE' && (
              <label className={fieldCls}>
                {f.maxAmount}
                <input type="number" inputMode="numeric" className="input input-sm w-40" min={1} value={d.maxAmount} disabled={locked} onChange={(e) => set({ maxAmount: e.target.value })} />
              </label>
            )}
          </div>
        </div>
      </Section>

      {coupon ? (
        <Section title={f.issueMode}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={fieldCls}>
              {f.issueMode}
              <select className="select select-sm w-56" value={d.issueMode} disabled={locked} onChange={(e) => set({ issueMode: ISSUE_MODES.find((x) => x === e.target.value) ?? 'DOWNLOAD' })}>
                {ISSUE_MODES.map((x) => (
                  <option key={x} value={x}>
                    {m.issueModeName[x]}
                  </option>
                ))}
              </select>
            </label>
            <label className={fieldCls}>
              {f.minOrderAmount}
              <input type="number" inputMode="numeric" className="input input-sm w-40" min={0} value={d.minOrderAmount} disabled={locked} onChange={(e) => set({ minOrderAmount: e.target.value })} />
            </label>
            <label className={fieldCls}>
              {f.totalQuantity}
              <input type="number" inputMode="numeric" className="input input-sm w-40" min={1} value={d.totalQuantity} disabled={locked} onChange={(e) => set({ totalQuantity: e.target.value })} />
            </label>
            <label className={fieldCls}>
              {f.perCustomerLimit}
              <input type="number" inputMode="numeric" className="input input-sm w-40" min={1} max={10} value={d.perCustomerLimit} disabled={locked} onChange={(e) => set({ perCustomerLimit: e.target.value })} />
            </label>
            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-sm">{f.usePeriod}</legend>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" className="radio radio-sm" name="useMode" checked={d.useMode === 'days'} disabled={locked} onChange={() => set({ useMode: 'days' })} />
                  {f.useDaysMode}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" className="radio radio-sm" name="useMode" checked={d.useMode === 'until'} disabled={locked} onChange={() => set({ useMode: 'until' })} />
                  {f.useUntilMode}
                </label>
              </div>
              {d.useMode === 'days' ? (
                <label className={fieldCls}>
                  {f.useDays}
                  <input type="number" inputMode="numeric" className="input input-sm w-32" min={1} max={365} value={d.useDays} disabled={locked} onChange={(e) => set({ useDays: e.target.value })} />
                  {num(d.useDays) ? <span className="text-xs text-base-content/60">{f.useDaysHint(num(d.useDays)!)}</span> : null}
                </label>
              ) : (
                <label className={fieldCls}>
                  {f.useUntil}
                  <input type="datetime-local" className="input input-sm" value={d.useUntil} min={d.endsAt || undefined} disabled={locked} onChange={(e) => set({ useUntil: e.target.value })} />
                </label>
              )}
            </fieldset>
          </div>
        </Section>
      ) : (
        <Section title={f.targets} aside={<span className="text-base-content/55">{d.targets.length} / 500</span>}>
          <div className="space-y-2">
            <p className="text-xs text-base-content/60">{f.targetsHint}</p>
            {d.targets.length === 0 && <p className="text-sm text-base-content/50">{f.noTargets}</p>}
            {d.targets.map((t, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2" data-testid="promotion-target">
                <label className={fieldCls}>
                  {f.targetType}
                  <select
                    className="select select-sm w-56"
                    value={t.type}
                    disabled={locked}
                    onChange={(e) => set({ targets: d.targets.map((x, j) => (j === i ? { type: e.target.value === 'CATEGORY' ? 'CATEGORY' : 'SKU', id: '' } : x)) })}
                  >
                    <option value="SKU">{m.targetTypeName.SKU}</option>
                    <option value="CATEGORY">{m.targetTypeName.CATEGORY}</option>
                  </select>
                </label>
                {t.type === 'SKU' ? (
                  <label className={fieldCls}>
                    {f.targetId}
                    <input className="input input-sm w-56 font-mono" maxLength={64} value={t.id} disabled={locked} onChange={(e) => set({ targets: d.targets.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) })} />
                  </label>
                ) : (
                  <div className={fieldCls}>
                    <span>{f.targetCategory}</span>
                    <SearchSelect
                      label={`${f.targetCategory} ${i + 1}`}
                      className="w-72"
                      value={t.id}
                      options={(tree.data?.nodes ?? []).map((n) => ({ value: n.categoryId, label: n.path ?? n.name }))}
                      loading={tree.isPending}
                      onChange={(v) => set({ targets: d.targets.map((x, j) => (j === i ? { ...x, id: v } : x)) })}
                    />
                  </div>
                )}
                <button type="button" className="btn btn-ghost btn-sm" disabled={locked} onClick={() => set({ targets: d.targets.filter((_, j) => j !== i) })}>
                  {f.removeTarget}
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-sm" disabled={locked || d.targets.length >= 500} onClick={() => set({ targets: [...d.targets, { type: 'SKU', id: '' }] })}>
              {f.addTarget}
            </button>
          </div>
        </Section>
      )}

      <Problems items={shown} />
      {submit.phase.kind === 'rejected' && problems.length === 0 && <FailureAlert failure={submit.phase.failure} />}
      {save.phase.kind === 'rejected' && <FailureAlert failure={save.phase.failure} />}

      {editable && result === null && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm" disabled={locked || (!dirty && base.id !== null)} onClick={() => void save.run(d)}>
            {f.save}
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={locked}>
            {f.submit}
          </button>
          {save.phase.kind === 'done' && !dirty && (
            <span role="status" className="self-center text-sm text-success">
              {f.saved}
            </span>
          )}
        </div>
      )}
      {result && (
        <div className="space-y-2" data-testid="promotion-submitted">
          {result.requested ? (
            <div role="status" className="alert alert-success alert-soft">
              <span>{f.submitted}</span>
              {result.requested.approvalId && (
                <Link className="link" to={`/approvals/${encodeURIComponent(result.requested.approvalId)}`}>
                  {m.detail.openApproval}
                </Link>
              )}
            </div>
          ) : (
            <>
              <p role="alert" className="text-sm text-warning">
                {f.approvalRetry}
              </p>
              {result.failure && <FailureAlert failure={result.failure} />}
              {result.retry && <RequestApproval body={result.retry} />}
            </>
          )}
          {!existing && (
            <button type="button" className="btn btn-sm" onClick={() => void navigate(`/promotions/${encodeURIComponent(result.id)}`)}>
              {m.detail.summary}
            </button>
          )}
        </div>
      )}
    </form>
  );
}

export function PromotionNewPage() {
  const { canManage } = useRoles();
  return (
    <section className="max-w-4xl space-y-4">
      <PageHeader title={m.newTitle} back={{ to: '/promotions', label: m.detail.back }} description={m.stageNote} />
      {canManage ? <PromotionForm initial={emptyDraft('COUPON')} existing={null} editable /> : <p className="text-sm text-base-content/60">{messages.nav.noMenu}</p>}
    </section>
  );
}

// ── 상세 ──
export function PromotionDetailPage() {
  const { promotionId = '' } = useParams();
  const api = useApi();
  const { canManage, canGrant } = useRoles();
  const query = useQuery({
    queryKey: ['promotions', 'one', promotionId],
    queryFn: () => request('GET', api.promotion.GET('/promotions/{promotionId}', { params: { path: { promotionId } } })),
  });
  return (
    <section className="max-w-4xl space-y-4">
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(p) => {
          const editable = canManage && (p.state === 'DRAFT' || p.state === 'REJECTED');
          return (
            <>
              <PageHeader
                back={{ to: '/promotions', label: m.detail.back }}
                title={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {p.name}
                    <StatusBadge tone={stateTone(p.state)}>{label(m.stateName, p.state)}</StatusBadge>
                    {(p.state === 'APPROVED' || p.state === 'ENDED') && <StatusBadge tone={phaseTone(p.phase)}>{label(m.phaseName, p.phase)}</StatusBadge>}
                  </span>
                }
                description={m.stageNote}
              />
              <Section title={m.detail.summary}>
                <FieldList
                  testId="promotion-summary"
                  rows={[
                    [m.col.kind, label(m.kindName, p.kind)],
                    [m.col.period, periodText(p)],
                    [m.col.discount, discountText(p)],
                    p.kind === 'COUPON' && [m.col.coupons, m.coupons(p.issuedCount ?? 0, p.usedCount ?? 0, p.coupon?.totalQuantity)],
                    p.kind === 'COUPON' && p.coupon && [m.detail.couponPolicy, <CouponPolicyText key="c" c={p.coupon} />],
                    p.endedAt ? [m.detail.endedAt, formatSeoul(p.endedAt)] : null,
                    [m.detail.createdBy, <Person key="by" id={p.createdBy} />],
                    [
                      m.detail.approval,
                      p.approvalId ? (
                        <Link className="link" to={`/approvals/${encodeURIComponent(p.approvalId)}`}>
                          {m.detail.openApproval}
                        </Link>
                      ) : (
                        messages.none
                      ),
                    ],
                  ]}
                />
              </Section>
              {editable ? (
                <>
                  {p.state === 'REJECTED' && <p className="text-sm text-base-content/70">{f.lockedReject}</p>}
                  <PromotionForm key={`${p.promotionId}:${p.version}`} initial={draftOf(p)} existing={p} editable />
                </>
              ) : (
                <>
                  {p.kind === 'PRICE_DISCOUNT' && <TargetList p={p} />}
                  {p.problems.length > 0 && <Problems items={p.problems} />}
                  {(p.state === 'DRAFT' || p.state === 'REJECTED' || p.state === 'SUBMITTED') && <p className="text-xs text-base-content/55">{f.locked}</p>}
                </>
              )}
              {canGrant && p.kind === 'COUPON' && p.coupon?.issueMode === 'ADMIN' && p.state === 'APPROVED' && <CouponGrant p={p} />}
              {canManage && p.state === 'APPROVED' && p.phase !== 'FINISHED' && <EndPromotion p={p} />}
            </>
          );
        }}
      </QueryState>
    </section>
  );
}

function CouponPolicyText({ c }: { readonly c: CouponPolicy }) {
  const d = m.detail;
  const parts: string[] = [
    label(m.issueModeName, c.issueMode),
    d.minOrder(c.minOrderAmount),
    c.totalQuantity ? `${m.form.totalQuantity.split('(')[0]} ${c.totalQuantity.toLocaleString('ko-KR')}장` : `${m.form.totalQuantity.split('(')[0]} ${d.unlimited}`,
    d.perCustomer(c.perCustomerLimit),
    c.useDays ? d.usePeriodDays(c.useDays) : c.useUntil ? d.usePeriodUntil(formatSeoul(c.useUntil)) : messages.none,
  ];
  return <span>{parts.join(' · ')}</span>;
}

function TargetList({ p }: { readonly p: Promotion }) {
  return (
    <Section title={m.detail.target} aside={<span className="text-base-content/55">{p.targets.length}</span>}>
      {p.targets.length === 0 ? (
        <p className="text-sm text-base-content/50">{f.noTargets}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5 text-sm" data-testid="promotion-targets">
          {p.targets.map((t) => (
            <li key={`${t.type}:${t.id}`} className="rounded border border-base-300 px-2 py-0.5">
              <span className="text-xs text-base-content/55">{t.type === 'SKU' ? 'SKU' : f.targetCategory}</span> <span className="font-mono">{t.id}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function EndPromotion({ p }: { readonly p: Promotion }) {
  const api = useApi();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const cmd = useCommand(async (r: string, key) => {
    const sub = await request('POST', api.promotion.POST('/promotions/{promotionId}/end-submissions', { ...commandParams(new IdempotencyKey(`${key.value}:end`), { path: { promotionId: p.promotionId } }), body: { reason: r } }));
    const ap = sub.approvalRequest as unknown as ApprovalRequestBody;
    const done = await requestApproval(api, ap, new IdempotencyKey(`${key.value}:approval`));
    void qc.invalidateQueries({ queryKey: ['promotions'] });
    return done;
  });
  const done = cmd.phase.kind === 'done';
  return (
    <Section title={m.end.title}>
      <form
        className="space-y-2"
        aria-label={m.end.title}
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) void cmd.run(reason.trim());
        }}
      >
        <p className="text-xs text-base-content/60">{m.end.intro}</p>
        <label className={fieldCls}>
          {m.end.reason}
          <input className="input input-sm w-full max-w-lg" maxLength={200} value={reason} disabled={cmd.busy || done} onChange={(e) => setReason(e.target.value)} />
        </label>
        {!done && (
          <button type="submit" className="btn btn-sm" disabled={!reason.trim() || cmd.busy}>
            {m.end.submit}
          </button>
        )}
        <CommandFeedback command={cmd}>
          {(r) => (
            <div role="status" className="alert alert-success alert-soft">
              <span>{m.end.requested}</span>
              {r.approvalId && (
                <Link className="link" to={`/approvals/${encodeURIComponent(r.approvalId)}`}>
                  {m.detail.openApproval}
                </Link>
              )}
            </div>
          )}
        </CommandFeedback>
      </form>
    </Section>
  );
}

const g = m.grant;
const accountsOf = (text: string) => [...new Set(text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];

function CouponGrant({ p }: { readonly p: Promotion }) {
  const api = useApi();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const ids = accountsOf(text);
  const tooMany = ids.length > 100;
  const running = p.phase === 'RUNNING';
  const cmd = useCommand(async (v: { accountIds: string[]; reason: string }, key) => {
    const r = await request('POST', api.promotion.POST('/promotions/{promotionId}/coupon-grants', { ...commandParams(key, { path: { promotionId: p.promotionId } }), body: v }));
    void qc.invalidateQueries({ queryKey: ['promotions'] });
    return r;
  });
  return (
    <Section title={g.title}>
      <form
        className="space-y-2"
        aria-label={g.title}
        onSubmit={(e) => {
          e.preventDefault();
          if (ids.length > 0 && !tooMany && reason.trim() && running) {
            if (cmd.phase.kind === 'done' || cmd.phase.kind === 'rejected') cmd.reset();
            void cmd.run({ accountIds: ids, reason: reason.trim() });
          }
        }}
      >
        <p className="text-xs text-base-content/60">
          {g.intro}{' '}
          <Link className="link" to="/customers">
            {g.findCustomer}
          </Link>
        </p>
        {!running && (
          <p role="status" className="text-sm text-warning">
            {g.notRunning}
          </p>
        )}
        <label className={fieldCls}>
          {g.accounts}
          <textarea className="textarea textarea-sm w-full max-w-lg font-mono" rows={3} value={text} disabled={cmd.busy || !running} onChange={(e) => setText(e.target.value)} />
        </label>
        <p className={`text-xs ${tooMany ? 'text-error' : 'text-base-content/55'}`} aria-live="polite">
          {tooMany ? g.tooMany : `${ids.length}명`}
        </p>
        <label className={fieldCls}>
          {g.reason}
          <input className="input input-sm w-full max-w-lg" maxLength={200} value={reason} disabled={cmd.busy || !running} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!running || ids.length === 0 || tooMany || !reason.trim() || cmd.busy}>
          {g.submit}
        </button>
        <CommandFeedback command={cmd}>
          {(r) => (
            <div className="space-y-1" data-testid="grant-results">
              <p role="status" className="text-sm font-medium">
                {g.resultTitle} · {g.resultCount(r.results.filter((x) => x.result === 'ISSUED').length, r.results.length)}
              </p>
              <DataTable>
                <tbody>
                  {r.results.map((x) => (
                    <tr key={x.accountId} data-testid="grant-result">
                      <td className="font-mono text-xs">{x.accountId}</td>
                      <td>
                        <StatusBadge tone={x.result === 'ISSUED' ? 'success' : 'warning'}>{label(g.result, x.result)}</StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
          )}
        </CommandFeedback>
      </form>
    </Section>
  );
}
