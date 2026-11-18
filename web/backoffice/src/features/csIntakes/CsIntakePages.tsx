// 전화·채팅 접수(case 0.12.0 — 백엔드 PR #68, 요청서 backoffice/2026-11-16-request-cs-intake, BO-11).
// - 상담원(CS_AGENT)·관리자(OPERATOR_ADMIN)가 전화·채팅·메일로 받은 고객 연락을 남긴다 `POST /cs-intakes`. 접수는 명령이 아니다 — 취소·환불은 클레임·주문 메뉴에서.
// - 본인 확인 방법 필수: 주문 내용 대조(주문 번호 필요) / 앱 로그인 채팅(채팅만) / 기타(메모 필수). 고객이 말한 번호·주소는 적지 않는다.
// - 대리(PROXY)는 서버가 막지 않는다 — 화면이 "본인 확인 전에는 취소·환불을 요청하지 마세요" 경고.
// - 기존 건 연결(linkCaseId)이 없으면 서버가 상담원 문의(STAFF_INTAKE — 고객 앱에 안 보임, 답변 알림 없음)를 만든다.
// - 연락 기록 `GET /cs-intakes?caseId|customerRef|subjectRef` — 접수 건·문의 상세에 붙인다. 요약·메모는 화면에만(로그 없음).
// 화면(2026-11-18 사용자 "밋밋하다"): 접수 폼은 번호 단계 카드 4개(다 채우면 체크) + 오른쪽 "남기기 전에 확인" 카드(빈칸 목록·남기기 버튼), 연락 기록은 시간 순 줄(타임라인). 동작은 그대로.
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, uiStateFromError, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components, paths } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { CommandFeedback } from '../../shared/Feedback';
import { LeaveGuard } from '../../shared/LeaveGuard';
import { messages } from '../../shared/messages';
import { text, when } from '../../shared/ops';
import { CodeLabel, PageHeader } from '../../shared/admin';
import { Icon, ICON } from '../inquiries/HelpdeskParts';

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

/** 코드 값 → 한국어 이름(원래 코드는 마우스를 올리면), 값이 없으면 "—" */
const codeOf = (names: Readonly<Record<string, string>>, v: string | null | undefined) => (v ? <CodeLabel code={v} names={names} /> : messages.none);

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
  // 떠날 때 경고(2026-11-18): 연 값과 다르면 "작성 중" — 저장을 누르면 그 값이 새 기준(저장 뒤 폼은 잠긴다)
  const [baseline, setBaseline] = useState(() => JSON.stringify(d));
  const dirty = JSON.stringify(d) !== baseline;

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
    setBaseline(JSON.stringify(d));
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

  // 고르기(라디오) — 테두리 있는 칸 모양, 고르면 테두리·바탕이 브랜드색
  const radio = <T extends string>(name: string, values: readonly T[], names: Readonly<Record<string, string>>, value: T | '', onPick: (v: T) => void, off?: (v: T) => boolean) => (
    <div className="mt-2 flex flex-wrap gap-2">
      {values.map((v) => (
        <label
          key={v}
          className={`flex cursor-pointer items-center gap-2 rounded-field border px-3 py-2 transition-colors ${value === v ? 'border-primary bg-primary/5 font-medium' : 'border-base-300 hover:border-base-content/30'} ${off?.(v) ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <input type="radio" className="radio radio-sm radio-primary" name={name} value={v} checked={value === v} disabled={off?.(v)} onChange={() => onPick(v)} />
          {names[v] ?? v}
        </label>
      ))}
    </div>
  );
  // 단계 표시 — 그 단계에 남은 빈칸이 없으면 체크(보기만, 막는 것은 아래 확인 목록)
  const stepDone = (keys: readonly string[]) => !missing.some((x) => keys.includes(x));
  const field = 'mt-1 w-full';

  return (
    <section className="max-w-6xl space-y-4">
      <PageHeader title={m.title} description={m.intro} />
      <form className="grid items-start gap-4 text-sm lg:grid-cols-3" onSubmit={submit} aria-label={m.title}>
        <LeaveGuard when={dirty} />
        <div className="space-y-4 lg:col-span-2">
          <Step n={1} title={m.step.who.title} done={stepDone([m.need.channel, m.need.customer, m.need.relation])}>
            <fieldset disabled={locked}>
              <legend className="text-xs font-medium text-base-content/60">{m.channel}</legend>
              {radio('channel', CHANNELS, m.channelName, d.channel, (v) =>
                setD((x) => ({ ...x, channel: v, method: v !== 'CHAT' && x.method === 'APP_SIGNED_IN_CHAT' ? '' : x.method })),
              )}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-base-content/60">
                  {m.customerRef}
                  <input className={`input input-sm font-mono text-base-content ${field}`} maxLength={64} value={d.customerRef} disabled={locked} onChange={(e) => set('customerRef', e.target.value)} />
                </label>
                <p className="mt-1 text-xs text-base-content/50">{m.customerHint}</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-base-content/60">
                  {m.subjectRef}
                  <input className={`input input-sm font-mono text-base-content ${field}`} maxLength={64} value={d.subjectRef} disabled={locked} onChange={(e) => set('subjectRef', e.target.value)} />
                </label>
                {d.subjectRef.trim() && (
                  <Link className="link link-primary mt-1 inline-block text-xs" to={`/orders/${encodeURIComponent(d.subjectRef.trim())}`} target="_blank" rel="noreferrer">
                    {m.openOrder}
                  </Link>
                )}
              </div>
            </div>
            <fieldset disabled={locked}>
              <legend className="text-xs font-medium text-base-content/60">{m.relation}</legend>
              {radio('relation', ['SELF', 'PROXY'] as const, m.relationName, d.relation, (v) => set('relation', v))}
            </fieldset>
            {d.relation === 'PROXY' && (
              <p role="alert" className="alert alert-warning alert-soft text-sm" data-testid="cs-intake-proxy-warning">
                {m.proxyWarning}
              </p>
            )}
          </Step>

          <Step n={2} title={m.step.identity.title} done={stepDone([m.need.method, m.need.orderForMatch, m.need.chatOnly, m.need.note])}>
            <fieldset disabled={locked}>
              <legend className="text-xs font-medium text-base-content/60">{m.method}</legend>
              {radio('method', METHODS, m.methodName, d.method, (v) => set('method', v), (v) => v === 'APP_SIGNED_IN_CHAT' && d.channel !== 'CHAT')}
              {d.method === 'ORDER_DETAILS_MATCH' && <p className="mt-2 text-xs text-base-content/60">{m.methodHint.ORDER_DETAILS_MATCH}</p>}
              {d.method === 'OTHER' && (
                <label className="mt-3 block text-xs font-medium text-base-content/60">
                  {m.note}
                  <input className={`input input-sm text-base-content ${field}`} maxLength={MAX_NOTE} value={d.note} onChange={(e) => set('note', e.target.value)} />
                </label>
              )}
              <p className="mt-2 text-xs text-warning">{m.identityHint}</p>
            </fieldset>
          </Step>

          <Step n={3} title={m.step.content.title} done={stepDone([m.need.category, m.need.summary])}>
            <div>
              <label className="block text-xs font-medium text-base-content/60">
                {m.category}
                <select className={`select select-sm text-base-content ${field} sm:max-w-xs`} value={d.category} disabled={locked} onChange={(e) => set('category', e.target.value as Category | '')}>
                  <option value="">{m.pick}</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {messages.inquiries.categoryName[c] ?? c}
                    </option>
                  ))}
                </select>
              </label>
              <p className="mt-1 text-xs text-base-content/50">
                {m.riderHint}{' '}
                <Link className="link link-primary" to="/rider-complaints/new">
                  {messages.nav.riderComplaints}
                </Link>
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-base-content/60">
                {m.summary}
                <textarea className={`textarea text-sm text-base-content ${field}`} rows={5} maxLength={MAX_SUMMARY} value={d.summary} disabled={locked} onChange={(e) => set('summary', e.target.value)} />
              </label>
              <p className="mt-1 flex justify-between gap-2 text-xs text-base-content/50">
                <span>{m.summaryHint}</span>
                <span className="tabular-nums">{`${d.summary.length} / ${MAX_SUMMARY}`}</span>
              </p>
            </div>
          </Step>

          <Step n={4} title={m.step.extra.title} hint={m.step.extra.hint} done={stepDone([m.need.consentType])} optional>
            <details className="rounded-box border border-base-300" open={d.consentOn}>
              <summary className="cursor-pointer px-3 py-2 font-medium">{m.consent}</summary>
              <div className="space-y-3 border-t border-base-300 px-3 py-3">
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="checkbox checkbox-sm" checked={d.consentOn} disabled={locked} onChange={(e) => set('consentOn', e.target.checked)} />
                  {m.consentOn}
                </label>
                {d.consentOn && (
                  <div className="space-y-3">
                    <label className="block text-xs font-medium text-base-content/60">
                      {m.consentType}
                      <input className={`input input-sm text-base-content ${field}`} maxLength={50} placeholder={m.consentTypePlaceholder} value={d.consentType} disabled={locked} onChange={(e) => set('consentType', e.target.value)} />
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="checkbox checkbox-sm" checked={d.consentGiven} disabled={locked} onChange={(e) => set('consentGiven', e.target.checked)} />
                      {m.consentGiven}
                    </label>
                    <label className="block text-xs font-medium text-base-content/60">
                      {m.consentDetail}
                      <input className={`input input-sm text-base-content ${field}`} maxLength={MAX_CONSENT} value={d.consentDetail} disabled={locked} onChange={(e) => set('consentDetail', e.target.value)} />
                    </label>
                    <p className="text-xs text-base-content/50">{m.consentHint}</p>
                  </div>
                )}
              </div>
            </details>
            <div>
              <label className="block text-xs font-medium text-base-content/60">
                {m.linkCaseId}
                <input className={`input input-sm font-mono text-base-content ${field}`} maxLength={64} value={d.linkCaseId} disabled={locked} onChange={(e) => set('linkCaseId', e.target.value)} />
              </label>
              <p className="mt-1 text-xs text-base-content/50">{m.linkHint}</p>
            </div>
          </Step>
        </div>

        {/* 오른쪽: 남기기 전 확인 + 남기기 버튼(넓은 화면에서는 따라 내려온다) */}
        <aside className="space-y-3 lg:sticky lg:top-4">
          <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
            <h2 className="flex items-center gap-2 border-b border-base-300 px-4 py-3 text-sm font-semibold">
              <Icon d={ICON.task} className="h-4 w-4 text-base-content/50" />
              {m.checkTitle}
            </h2>
            <div className="space-y-3 px-4 py-3.5">
              {missing.length > 0 ? (
                <ul className="space-y-1.5 text-xs text-base-content/70" data-testid="cs-intake-missing">
                  {missing.map((x) => (
                    <li key={x} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
                      {x}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-2 text-xs text-success">
                  <Icon d={ICON.check} />
                  {m.ready}
                </p>
              )}
              <div className="flex justify-end border-t border-base-200 pt-3">
                <button type="submit" className="btn btn-primary btn-sm min-w-28" disabled={missing.length > 0 || locked}>
                  {m.submit}
                </button>
              </div>
              <CommandFeedback command={save} unknown={{ body: m.unknown }}>
                {(r: Intake) => (
                  <div role="status" className="space-y-1 rounded-box bg-success/10 px-3 py-2 text-success" data-testid="cs-intake-saved">
                    <p className="font-medium">{r.linked ? m.savedLinked : m.savedNew}</p>
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
            </div>
          </div>
        </aside>
      </form>
    </section>
  );
}

/** 단계 카드 — 왼쪽 번호(다 채우면 체크), 제목·도움말, 내용 */
function Step({ n, title, hint, done, optional, children }: { readonly n: number; readonly title: string; readonly hint?: string; readonly done: boolean; readonly optional?: boolean; readonly children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
      <div className="flex items-center gap-3 border-b border-base-300 px-4 py-3">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done && !optional ? 'bg-success text-success-content' : 'bg-base-200 text-base-content/60'}`}
          aria-hidden="true"
        >
          {done && !optional ? <Icon d={ICON.check} className="h-3.5 w-3.5" /> : n}
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          {hint && <p className="text-xs text-base-content/55">{hint}</p>}
        </div>
      </div>
      <div className="space-y-4 px-4 py-4">{children}</div>
    </section>
  );
}

const CHANNEL_ICON: Readonly<Record<string, string>> = { PHONE: ICON.phone, CHAT: ICON.chat, EMAIL: ICON.mail, APP: ICON.inbox };

/** "이 건/고객/주문의 연락 기록" — 조건 하나로 서버에 묻는다(최근 순). 시간 순 줄(타임라인)로 그린다. */
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
    <section className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm" aria-label={title}>
      <h2 className="flex items-center gap-2 border-b border-base-300 px-4 py-3 text-sm font-semibold">
        <Icon d={ICON.phone} className="h-4 w-4 text-base-content/50" />
        {title}
      </h2>
      <div className="px-4 py-3.5">
        {query.isPending ? (
          <QueryState state={{ kind: 'loading' }}>{() => null}</QueryState>
        ) : query.isError && items.length === 0 ? (
          <QueryState state={uiStateFromError(query.error)} onRetry={() => void query.refetch()}>
            {() => null}
          </QueryState>
        ) : items.length === 0 ? (
          <p className="py-3 text-center text-sm text-base-content/55">{m.logEmpty}</p>
        ) : (
          <>
            <ol className="relative space-y-4 text-sm before:absolute before:bottom-2 before:left-[0.9rem] before:top-2 before:w-px before:bg-base-300">
              {items.map((x) => (
                <li key={x.intakeId} className="relative flex gap-3" data-testid="cs-intake-row">
                  <span className="relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-base-300 bg-base-100 text-base-content/60" aria-hidden="true">
                    <Icon d={CHANNEL_ICON[x.channel ?? ''] ?? ICON.note} className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="badge badge-ghost badge-sm">{codeOf(m.channelName, x.channel)}</span>
                      {x.callerRelation === 'PROXY' && <span className="badge badge-warning badge-soft badge-sm">{m.relationName.PROXY}</span>}
                      <span className="font-medium">{codeOf(messages.inquiries.categoryName, x.category)}</span>
                      <span className="ml-auto whitespace-nowrap text-base-content/50">{when(x.receivedAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words">{x.summary}</p>
                    <p className="flex flex-wrap gap-x-2 text-xs text-base-content/55">
                      <span>{codeOf(m.methodName, x.identityCheck?.method)}</span>
                      {x.subjectRef && <span className="font-mono">{x.subjectRef}</span>}
                      <span>{text(x.receivedBy)}</span>
                      {x.linked && <span>{m.linkedMark}</span>}
                    </p>
                    {x.consent && <p className="text-xs text-base-content/60">{m.consentLine(x.consent.consentType ?? '', x.consent.given === true)}</p>}
                  </div>
                </li>
              ))}
            </ol>
            {query.isFetchNextPageError && <p className="mt-3 text-sm text-error">{m.moreFailed}</p>}
            {query.hasNextPage && (
              <button type="button" className="btn btn-sm mt-3 w-full" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                {m.more}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
