// 전화·채팅 접수(case 0.12.0 — 백엔드 PR #68, 요청서 backoffice/2026-11-16-request-cs-intake, BO-11).
// - 상담원(CS_AGENT)·관리자(OPERATOR_ADMIN)가 전화·채팅·메일로 받은 고객 연락을 남긴다 `POST /cs-intakes`. 접수는 명령이 아니다 — 취소·환불은 클레임·주문 메뉴에서.
// - 본인 확인 방법 필수: 주문 내용 대조(주문 번호 필요) / 앱 로그인 채팅(채팅만) / 기타(메모 필수). 고객이 말한 번호·주소는 적지 않는다.
// - 대리(PROXY)는 서버가 막지 않는다 — 화면이 "본인 확인 전에는 취소·환불을 요청하지 마세요" 경고.
// - 기존 건 연결(linkCaseId)이 없으면 서버가 상담원 문의(STAFF_INTAKE — 고객 앱에 안 보임, 답변 알림 없음)를 만든다.
// - 연락 기록 `GET /cs-intakes?caseId|customerRef|subjectRef` — 접수 건·문의 상세에 붙인다. 요약·메모는 화면에만(로그 없음).
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, uiStateFromError, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components, paths } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { CommandFeedback } from '../../shared/Feedback';
import { messages } from '../../shared/messages';
import { label, text, when } from '../../shared/ops';

const m = messages.csIntake;
type Intake = components['schemas']['Intake'];
type NewIntake = paths['/cs-intakes']['post']['requestBody']['content']['application/json'];
type Channel = 'PHONE' | 'CHAT' | 'EMAIL';
type Method = 'ORDER_DETAILS_MATCH' | 'APP_SIGNED_IN_CHAT' | 'OTHER';
type Relation = 'SELF' | 'PROXY';
type Category = 'ORDER' | 'DELIVERY' | 'PAYMENT' | 'REFUND' | 'PRODUCT' | 'ACCOUNT' | 'OTHER';

const CHANNELS: readonly Channel[] = ['PHONE', 'CHAT', 'EMAIL'];
const METHODS: readonly Method[] = ['ORDER_DETAILS_MATCH', 'APP_SIGNED_IN_CHAT', 'OTHER'];
const CATEGORIES: readonly Category[] = ['ORDER', 'DELIVERY', 'PAYMENT', 'REFUND', 'PRODUCT', 'ACCOUNT', 'OTHER'];
const MAX_SUMMARY = 2000;
const MAX_NOTE = 200;
const MAX_CONSENT = 500;

/** 연락 기록을 볼 수 있는 역할(그 밖은 서버 403 — 칸을 그리지 않는다) */
export const canSeeIntakes = (roles: readonly string[]) => roles.includes('CS_AGENT') || roles.includes('OPERATOR_ADMIN');

interface Draft {
  channel: Channel | '';
  category: Category | '';
  customerRef: string;
  subjectRef: string;
  method: Method | '';
  note: string;
  relation: Relation | '';
  summary: string;
  consentOn: boolean;
  consentType: string;
  consentGiven: boolean;
  consentDetail: string;
  linkCaseId: string;
}

/** 화면에서 먼저 막는 것(서버도 400) — 빈 배열이면 보낼 수 있다 */
function problems(d: Draft): string[] {
  const out: string[] = [];
  if (!d.channel) out.push(m.need.channel);
  if (!d.category) out.push(m.need.category);
  if (!d.customerRef.trim()) out.push(m.need.customer);
  if (!d.method) out.push(m.need.method);
  if (d.method === 'ORDER_DETAILS_MATCH' && !d.subjectRef.trim()) out.push(m.need.orderForMatch);
  if (d.method === 'APP_SIGNED_IN_CHAT' && d.channel !== 'CHAT') out.push(m.need.chatOnly);
  if (d.method === 'OTHER' && !d.note.trim()) out.push(m.need.note);
  if (!d.relation) out.push(m.need.relation);
  if (!d.summary.trim()) out.push(m.need.summary);
  if (d.consentOn && !d.consentType.trim()) out.push(m.need.consentType);
  return out;
}

export function NewCsIntakePage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [search] = useSearchParams();
  const [d, setD] = useState<Draft>({
    channel: '',
    category: '',
    customerRef: search.get('customerRef') ?? '',
    subjectRef: search.get('subjectRef') ?? '',
    method: '',
    note: '',
    relation: '',
    summary: '',
    consentOn: false,
    consentType: '',
    consentGiven: true,
    consentDetail: '',
    linkCaseId: search.get('linkCaseId') ?? '',
  });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = useCommand(async (body: NewIntake, key) => {
    const r = await request('POST', api.cases.POST('/cs-intakes', { ...commandParams(key), body }));
    void queryClient.invalidateQueries({ queryKey: ['cs-intakes'] });
    void queryClient.invalidateQueries({ queryKey: ['inquiries'] });
    return r;
  });
  const locked = save.busy || save.phase.kind === 'done';
  const missing = problems(d);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (missing.length > 0 || locked || !d.channel || !d.category || !d.method || !d.relation) return;
    if (save.phase.kind === 'rejected') save.reset();
    void save.run({
      channel: d.channel,
      category: d.category,
      customerRef: d.customerRef.trim(),
      ...(d.subjectRef.trim() ? { subjectRef: d.subjectRef.trim() } : {}),
      summary: d.summary.trim(),
      identityCheck: { method: d.method, ...(d.note.trim() ? { note: d.note.trim() } : {}) },
      callerRelation: d.relation,
      ...(d.consentOn
        ? { consent: { consentType: d.consentType.trim(), given: d.consentGiven, ...(d.consentDetail.trim() ? { detail: d.consentDetail.trim() } : {}) } }
        : {}),
      ...(d.linkCaseId.trim() ? { linkCaseId: d.linkCaseId.trim() } : {}),
    });
  };

  const radio = <T extends string>(name: string, values: readonly T[], names: Readonly<Record<string, string>>, value: T | '', onPick: (v: T) => void, off?: (v: T) => boolean) => (
    <div className="mt-1 flex flex-wrap gap-4">
      {values.map((v) => (
        <label key={v} className={`flex items-center gap-1 ${off?.(v) ? 'opacity-50' : ''}`}>
          <input type="radio" className="radio radio-sm" name={name} value={v} checked={value === v} disabled={off?.(v)} onChange={() => onPick(v)} />
          {names[v] ?? v}
        </label>
      ))}
    </div>
  );

  return (
    <section className="max-w-2xl space-y-4">
      <h1 className="text-xl font-bold">{m.title}</h1>
      <p className="text-sm opacity-70">{m.intro}</p>
      <form className="space-y-3 rounded-box bg-base-100 p-4 text-sm" onSubmit={submit} aria-label={m.title}>
        <fieldset disabled={locked}>
          <legend className="font-semibold">{m.channel}</legend>
          {radio('channel', CHANNELS, m.channelName, d.channel, (v) =>
            setD((x) => ({ ...x, channel: v, method: v !== 'CHAT' && x.method === 'APP_SIGNED_IN_CHAT' ? '' : x.method })),
          )}
        </fieldset>
        <label className="block">
          {m.customerRef}
          <input className="input input-sm mt-1 w-full" maxLength={64} value={d.customerRef} disabled={locked} onChange={(e) => set('customerRef', e.target.value)} />
        </label>
        <p className="text-xs opacity-60">{m.customerHint}</p>
        <label className="block">
          {m.subjectRef}
          <input className="input input-sm mt-1 w-full" maxLength={64} value={d.subjectRef} disabled={locked} onChange={(e) => set('subjectRef', e.target.value)} />
        </label>
        {d.subjectRef.trim() && (
          <Link className="link text-xs" to={`/orders/${encodeURIComponent(d.subjectRef.trim())}`} target="_blank" rel="noreferrer">
            {m.openOrder}
          </Link>
        )}
        <fieldset disabled={locked}>
          <legend className="font-semibold">{m.method}</legend>
          {radio('method', METHODS, m.methodName, d.method, (v) => set('method', v), (v) => v === 'APP_SIGNED_IN_CHAT' && d.channel !== 'CHAT')}
          {d.method === 'ORDER_DETAILS_MATCH' && <p className="mt-1 text-xs opacity-70">{m.methodHint.ORDER_DETAILS_MATCH}</p>}
          {d.method === 'OTHER' && (
            <label className="mt-2 block">
              {m.note}
              <input className="input input-sm mt-1 w-full" maxLength={MAX_NOTE} value={d.note} onChange={(e) => set('note', e.target.value)} />
            </label>
          )}
          <p className="mt-1 text-xs text-warning">{m.identityHint}</p>
        </fieldset>
        <fieldset disabled={locked}>
          <legend className="font-semibold">{m.relation}</legend>
          {radio('relation', ['SELF', 'PROXY'] as const, m.relationName, d.relation, (v) => set('relation', v))}
        </fieldset>
        {d.relation === 'PROXY' && (
          <p role="alert" className="alert alert-warning text-sm" data-testid="cs-intake-proxy-warning">
            {m.proxyWarning}
          </p>
        )}
        <label className="block">
          {m.category}
          <select className="select select-sm mt-1 w-full" value={d.category} disabled={locked} onChange={(e) => set('category', e.target.value as Category | '')}>
            <option value="">{m.pick}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {messages.inquiries.categoryName[c] ?? c}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs opacity-60">
          {m.riderHint}{' '}
          <Link className="link" to="/rider-complaints/new">
            {messages.nav.riderComplaints}
          </Link>
        </p>
        <label className="block">
          {m.summary}
          <textarea className="textarea mt-1 w-full" rows={4} maxLength={MAX_SUMMARY} value={d.summary} disabled={locked} onChange={(e) => set('summary', e.target.value)} />
        </label>
        <p className="text-xs opacity-60">{`${m.summaryHint} ${d.summary.length} / ${MAX_SUMMARY}`}</p>
        <details className="rounded-box bg-base-200 p-2" open={d.consentOn}>
          <summary className="cursor-pointer">{m.consent}</summary>
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" className="checkbox checkbox-sm" checked={d.consentOn} disabled={locked} onChange={(e) => set('consentOn', e.target.checked)} />
            {m.consentOn}
          </label>
          {d.consentOn && (
            <div className="mt-2 space-y-2">
              <label className="block">
                {m.consentType}
                <input className="input input-sm mt-1 w-full" maxLength={50} placeholder={m.consentTypePlaceholder} value={d.consentType} disabled={locked} onChange={(e) => set('consentType', e.target.value)} />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="checkbox checkbox-sm" checked={d.consentGiven} disabled={locked} onChange={(e) => set('consentGiven', e.target.checked)} />
                {m.consentGiven}
              </label>
              <label className="block">
                {m.consentDetail}
                <input className="input input-sm mt-1 w-full" maxLength={MAX_CONSENT} value={d.consentDetail} disabled={locked} onChange={(e) => set('consentDetail', e.target.value)} />
              </label>
              <p className="text-xs opacity-60">{m.consentHint}</p>
            </div>
          )}
        </details>
        <label className="block">
          {m.linkCaseId}
          <input className="input input-sm mt-1 w-full" maxLength={64} value={d.linkCaseId} disabled={locked} onChange={(e) => set('linkCaseId', e.target.value)} />
        </label>
        <p className="text-xs opacity-60">{m.linkHint}</p>
        {missing.length > 0 && (
          <ul className="list-inside list-disc text-xs opacity-70" data-testid="cs-intake-missing">
            {missing.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
        <button type="submit" className="btn btn-primary btn-sm" disabled={missing.length > 0 || locked}>
          {m.submit}
        </button>
        <CommandFeedback command={save} unknown={{ body: m.unknown }}>
          {(r: Intake) => (
            <div role="status" className="space-y-1 text-success" data-testid="cs-intake-saved">
              <p>{r.linked ? m.savedLinked : m.savedNew}</p>
              <p className="flex flex-wrap gap-3">
                {r.caseId && (
                  <Link className="link" to={`/cases/${encodeURIComponent(r.caseId)}`}>
                    {m.openCase(r.caseId)}
                  </Link>
                )}
                {r.inquiryId && (
                  <Link className="link" to={`/inquiries/${encodeURIComponent(r.inquiryId)}`}>
                    {m.openInquiry(r.inquiryId)}
                  </Link>
                )}
              </p>
            </div>
          )}
        </CommandFeedback>
      </form>
    </section>
  );
}

/** "이 건/고객/주문의 연락 기록" — 조건 하나로 서버에 묻는다(최근 순). */
export function CsIntakeLog({ caseId, customerRef, subjectRef, title }: {
  readonly caseId?: string;
  readonly customerRef?: string;
  readonly subjectRef?: string;
  readonly title: string;
}) {
  const api = useApi();
  const { session } = useSession();
  const filter = { ...(caseId ? { caseId } : {}), ...(customerRef ? { customerRef } : {}), ...(subjectRef ? { subjectRef } : {}) };
  const enabled = canSeeIntakes(session?.roles ?? []) && Object.keys(filter).length > 0;
  const query = useInfiniteQuery({
    queryKey: ['cs-intakes', filter],
    enabled,
    queryFn: ({ pageParam }) => request('GET', api.cases.GET('/cs-intakes', { params: { query: { ...filter, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });
  if (!enabled) return null;
  const items: Intake[] = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  return (
    <section className="space-y-2" aria-label={title}>
      <h2 className="font-bold">{title}</h2>
      {query.isPending ? (
        <QueryState state={{ kind: 'loading' }}>{() => null}</QueryState>
      ) : query.isError && items.length === 0 ? (
        <QueryState state={uiStateFromError(query.error)} onRetry={() => void query.refetch()}>
          {() => null}
        </QueryState>
      ) : items.length === 0 ? (
        <p className="text-sm opacity-70">{m.logEmpty}</p>
      ) : (
        <>
          <ul className="space-y-1 text-sm">
            {items.map((x) => (
              <li key={x.intakeId} className="rounded-box bg-base-100 p-2" data-testid="cs-intake-row">
                <div className="flex flex-wrap items-center gap-2 text-xs opacity-70">
                  <span className="badge badge-ghost badge-sm">{label(m.channelName, x.channel)}</span>
                  {x.callerRelation === 'PROXY' && <span className="badge badge-warning badge-sm">{m.relationName.PROXY}</span>}
                  <span>{label(m.methodName, x.identityCheck?.method)}</span>
                  <span>{label(messages.inquiries.categoryName, x.category)}</span>
                  {x.subjectRef && <span className="font-mono">{x.subjectRef}</span>}
                  <span>{text(x.receivedBy)}</span>
                  <span>{when(x.receivedAt)}</span>
                  {x.linked && <span>{m.linkedMark}</span>}
                </div>
                <p className="whitespace-pre-wrap break-words">{x.summary}</p>
                {x.consent && <p className="text-xs opacity-70">{m.consentLine(x.consent.consentType ?? '', x.consent.given === true)}</p>}
              </li>
            ))}
          </ul>
          {query.isFetchNextPageError && <p className="text-sm text-error">{m.moreFailed}</p>}
          {query.hasNextPage && (
            <button type="button" className="btn btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              {m.more}
            </button>
          )}
        </>
      )}
    </section>
  );
}
