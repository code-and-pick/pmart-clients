// 개인정보 열람 기록 — audit-service 0.3.0 `GET /pii-access-logs`·`/pii-access-logs/{id}`
// (백엔드 알림 backoffice/2026-11-16-notice-pii-access-log-api, ADR-0062 결정 9·10).
// - OPERATOR_ADMIN 만(서버 판정 — 403 은 오류로). 메뉴도 관리자에게만.
// - 거르기는 URL 쿼리(직원·정보주체 종류·정보주체 ID·주문/사건 참조·방식·기간). 기간은 한국 날짜 → 그날 0시(+09:00)부터 종료일 다음 날 0시 전까지.
// - 열람 시각 새 것부터 50건씩, page.nextCursor 로 다음 쪽.
// - 기록에는 원문 개인정보 값이 없다(참조·항목 코드·사유만). 열람 사유(purpose)는 직원이 쓴 글 — 화면에만 보이고 로그·콘솔에 남기지 않는다.
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/audit';
import { useApi } from '../../app/ApiContext';
import { SavedViews } from '../../shared/SavedViews';
import { messages } from '../../shared/messages';
import { isSeoulDate, label, seoulDayEnd, seoulDayStart, text, when } from '../../shared/ops';
import { CodeLabel, FieldList, PageHeader, SearchPanel, SearchRow, Section, StatusBadge, type Tone } from '../../shared/admin';

const m = messages.piiLogs;
type Log = components['schemas']['PiiAccessLog'];

const PAGE_SIZE = 50;
const SUBJECT_TYPES = ['CUSTOMER', 'RIDER', 'DRIVER', 'OPERATOR'] as const;
const ACCESS_TYPES = ['VIEW', 'DOWNLOAD', 'EXPORT', 'SEARCH'] as const;
const TEXT_KEYS = ['actorId', 'subjectRef', 'caseRef'] as const;
const KEYS = ['actorId', 'subjectType', 'subjectRef', 'caseRef', 'accessType', 'from', 'to'] as const;
type Key = (typeof KEYS)[number];
type Filters = Record<Key, string>;

const isOneOf = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v);

function readFilters(params: URLSearchParams): Filters {
  const f = Object.fromEntries(KEYS.map((k) => [k, params.get(k)?.trim() ?? ''])) as Filters;
  if (!isOneOf(SUBJECT_TYPES, f.subjectType)) f.subjectType = '';
  if (!isOneOf(ACCESS_TYPES, f.accessType)) f.accessType = '';
  if (!isSeoulDate(f.from)) f.from = '';
  if (!isSeoulDate(f.to)) f.to = '';
  return f;
}

/** 참조 → 백오피스 화면(있는 것만). ORDER:ORD-… → 주문 상세, RIDER:RD-… → 라이더 상세 */
function refLink(ref: string | null | undefined) {
  if (!ref) return messages.none;
  const [kind, id] = ref.split(/:(.*)/s);
  if (id && kind === 'ORDER') return <Link className="link font-mono" to={`/orders/${encodeURIComponent(id)}`}>{ref}</Link>;
  if (id && kind === 'RIDER') return <Link className="link font-mono" to={`/riders/${encodeURIComponent(id)}`}>{ref}</Link>;
  return <span className="font-mono">{ref}</span>;
}

function subject(log: Pick<Log, 'subjectType' | 'subjectRef'>) {
  const type = log.subjectType ?? 'CUSTOMER'; // 계약 기본값
  return (
    <>
      <span className="badge badge-ghost badge-sm mr-1">
        <CodeLabel code={type} names={m.subjectTypeName} />
      </span>
      {type === 'RIDER' ? (
        <Link className="link font-mono" to={`/riders/${encodeURIComponent(log.subjectRef)}`}>
          {log.subjectRef}
        </Link>
      ) : (
        <span className="font-mono">{log.subjectRef}</span>
      )}
    </>
  );
}

const fieldsText = (fields: readonly string[]) => fields.map((f) => label(m.fieldName, f)).join(', ');

/** 열어 본 항목 — 이름(원래 코드는 마우스를 올리면). 모르는 코드는 그대로 */
function Fields({ fields }: { readonly fields: readonly string[] }) {
  return (
    <>
      {fields.map((f, i) => (
        <span key={f}>
          {i > 0 && ', '}
          <CodeLabel code={f} names={m.fieldName} />
        </span>
      ))}
    </>
  );
}

/** 그때 역할 — 이름(원래 코드는 마우스를 올리면) */
function Roles({ roles }: { readonly roles: readonly string[] | null | undefined }) {
  if (!roles || roles.length === 0) return <>{messages.none}</>;
  return (
    <>
      {roles.map((r, i) => (
        <span key={r}>
          {i > 0 && ', '}
          <CodeLabel code={r} names={m.roleName} />
        </span>
      ))}
    </>
  );
}

export function PiiAccessLogListPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const cursor = params.get('cursor') ?? '';
  const badRange = !!filters.from && !!filters.to && filters.from > filters.to;

  const query = useQuery({
    queryKey: ['audit', 'pii-access-logs', filters, cursor],
    enabled: !badRange,
    queryFn: () =>
      request(
        'GET',
        api.audit.GET('/pii-access-logs', {
          params: {
            query: {
              size: PAGE_SIZE,
              ...(filters.actorId ? { actorId: filters.actorId } : {}),
              ...(isOneOf(SUBJECT_TYPES, filters.subjectType) ? { subjectType: filters.subjectType } : {}),
              ...(filters.subjectRef ? { subjectRef: filters.subjectRef } : {}),
              ...(filters.caseRef ? { caseRef: filters.caseRef } : {}),
              ...(isOneOf(ACCESS_TYPES, filters.accessType) ? { accessType: filters.accessType } : {}),
              ...(filters.from ? { from: seoulDayStart(filters.from) } : {}),
              ...(filters.to ? { to: seoulDayEnd(filters.to) } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
  });

  const apply = (next: Filters, nextCursor = '') => {
    const out: Record<string, string> = {};
    for (const k of KEYS) if (next[k]) out[k] = next[k];
    if (nextCursor) out.cursor = nextCursor;
    setParams(out);
  };

  return (
    <section className="space-y-4">
      <PageHeader title={m.title} description={m.intro} />
      {/* 내 보기(2026-11-18 Saleor 참고) — 지금 주소 조건을 이름 붙여 저장 */}
      <SavedViews listKey="pii-access" />
      <FilterForm key={params.toString()} initial={filters} onApply={(f) => apply(f)} />
      {badRange ? (
        <p role="alert" className="alert alert-warning alert-soft text-sm">
          {m.badRange}
        </p>
      ) : (
        <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
          {(data) => {
            const items = data.items;
            const nextCursor = data.page.nextCursor ?? null;
            return (
              // 감사 기록 카드(2026-11-18) — 위 거르기 상자와 한 카드로 붙는다(data-list-part)
              <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm" data-list-part="table">
                {items.length === 0 ? (
                  <p data-state="empty" className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-base-content/60">
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8 fill-none stroke-current text-base-content/30" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Zm-3 9 2 2 4-4" />
                    </svg>
                    {m.empty}
                  </p>
                ) : (
                  <LogList items={items} search={params.toString()} />
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-base-300 px-4 py-3 text-sm">
                  <span className="text-base-content/55">{m.shown(items.length)}</span>
                  {(cursor || nextCursor) && (
                    <div className="flex gap-2">
                      {cursor && (
                        <button type="button" className="btn btn-sm border-base-300 bg-base-100" onClick={() => apply(filters)}>
                          {m.first}
                        </button>
                      )}
                      {nextCursor && (
                        <button type="button" className="btn btn-sm border-base-300 bg-base-100" onClick={() => apply(filters, nextCursor)}>
                          {m.next}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          }}
        </QueryState>
      )}
      <p className="text-xs text-base-content/60">{m.retention}</p>
    </section>
  );
}

function FilterForm({ initial, onApply }: { readonly initial: Filters; readonly onApply: (f: Filters) => void }) {
  const [f, setF] = useState<Filters>(initial);
  const set = (k: Key, v: string) => setF((prev) => ({ ...prev, [k]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onApply(Object.fromEntries(KEYS.map((k) => [k, f[k].trim()])) as Filters);
  };
  return (
    <SearchPanel
      onSubmit={submit}
      onReset={() => {
        const blank = Object.fromEntries(KEYS.map((k) => [k, ''])) as Filters;
        setF(blank);
        onApply(blank);
      }}
      submitLabel={messages.search}
      resetLabel={m.reset}
      label={m.filters}
    >
      {TEXT_KEYS.map((k) => (
        <SearchRow key={k} label={m.filterRow[k]}>
          <input aria-label={m.filter[k]} placeholder={m.filter[k]} className="input input-sm w-72 max-w-full font-mono" maxLength={128} value={f[k]} onChange={(e) => set(k, e.target.value)} />
        </SearchRow>
      ))}
      <SearchRow label={m.filter.subjectType}>
        <select aria-label={m.filter.subjectType} className="select select-sm w-32" value={f.subjectType} onChange={(e) => set('subjectType', e.target.value)}>
          <option value="">{m.all}</option>
          {SUBJECT_TYPES.map((s) => (
            <option key={s} value={s}>
              {label(m.subjectTypeName, s)}
            </option>
          ))}
        </select>
      </SearchRow>
      <SearchRow label={m.filter.accessType}>
        <select aria-label={m.filter.accessType} className="select select-sm w-32" value={f.accessType} onChange={(e) => set('accessType', e.target.value)}>
          <option value="">{m.all}</option>
          {ACCESS_TYPES.map((s) => (
            <option key={s} value={s}>
              {label(m.accessTypeName, s)}
            </option>
          ))}
        </select>
      </SearchRow>
      <SearchRow label={m.period}>
        <input type="date" aria-label={m.filter.from} className="input input-sm w-40" value={f.from} onChange={(e) => set('from', e.target.value)} />
        <span className="text-base-content/50">~</span>
        <input type="date" aria-label={m.filter.to} className="input input-sm w-40" value={f.to} onChange={(e) => set('to', e.target.value)} />
      </SearchRow>
    </SearchPanel>
  );
}

/** 방식 색 — 보기(파랑)·검색(회색)·내려받기(노랑)·내보내기(빨강): 밖으로 나가는 것일수록 진하게 */
const ACCESS_TONE: Readonly<Record<string, Tone>> = { VIEW: 'info', SEARCH: 'neutral', DOWNLOAD: 'warning', EXPORT: 'error' };

/** 감사 기록 줄(2026-11-18): 직원 머리글자 + "누가 · 방식 · 누구의" + 열어 본 항목 + 사유, 오른쪽 시각(상세로) */
function LogList({ items, search }: { readonly items: readonly Log[]; readonly search: string }) {
  return (
    <ul className="divide-y divide-base-300/70">
      {items.map((log) => (
        <li key={log.piiAccessLogId} className="grid gap-x-4 gap-y-2 px-4 py-3 text-sm hover:bg-base-200/50 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto]" data-testid="pii-log-row">
          {/* 첫 링크 = 상세(시각) — 넓은 화면에서는 오른쪽 끝에 */}
          <div className="text-xs sm:order-last sm:text-right">
            <Link className="font-medium text-primary hover:underline" to={`/pii-access-logs/${encodeURIComponent(log.piiAccessLogId)}`} state={{ search }}>
              {when(log.occurredAt)}
            </Link>
          </div>
          <span className="hidden h-9 w-9 items-center justify-center rounded-full bg-base-300 text-xs font-bold text-base-content/70 sm:flex" aria-hidden="true">
            {(log.actor.actorId.replace(/^op-/i, '').charAt(0) || '?').toUpperCase()}
          </span>
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono font-semibold">{log.actor.actorId}</span>
              <StatusBadge tone={ACCESS_TONE[log.accessType] ?? 'ghost'}>
                <CodeLabel code={log.accessType} names={m.accessTypeName} />
              </StatusBadge>
              <span className="text-base-content/40" aria-hidden="true">
                →
              </span>
              <span className="inline-flex items-center">{subject(log)}</span>
            </div>
            {(log.actor.roles?.length ?? 0) > 0 && (
              <div className="text-xs text-base-content/50">
                <Roles roles={log.actor.roles} />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1.5">
                <span className="text-base-content/50">{m.col.fields}</span>
                <span className="rounded-md bg-warning/10 px-1.5 py-0.5 font-medium">
                  <Fields fields={log.fields} />
                </span>
              </span>
              {log.caseRef && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-base-content/50">{m.col.caseRef}</span>
                  {refLink(log.caseRef)}
                </span>
              )}
            </div>
            <p className="truncate border-l-2 border-base-300 pl-2 text-xs italic text-base-content/70" title={log.purpose}>
              {log.purpose}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function PiiAccessLogDetailPage() {
  const api = useApi();
  const { piiAccessLogId = '' } = useParams();
  const location = useLocation();
  const back = typeof (location.state as { search?: unknown } | null)?.search === 'string' ? (location.state as { search: string }).search : '';
  const query = useQuery({
    queryKey: ['audit', 'pii-access-log', piiAccessLogId],
    queryFn: () => request('GET', api.audit.GET('/pii-access-logs/{piiAccessLogId}', { params: { path: { piiAccessLogId } } })),
  });
  return (
    <section className="max-w-6xl space-y-4">
      {/* 제목은 누가·무엇을 먼저(2026-11-18 "제목이 번호뿐") — 읽기 전에는 "열람 기록 한 건" */}
      <PageHeader
        title={query.data ? m.detailHeadline(query.data.actor.actorId, fieldsText(query.data.fields), label(m.accessTypeName, query.data.accessType)) : m.detailTitle}
        back={{ to: `/pii-access-logs${back ? `?${back}` : ''}`, label: m.back }}
      />
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(log) => (
          // 감사 기록 한 건(2026-11-18): 왼쪽 = 누가·무엇을·왜(큰 상자), 오른쪽 = 기록 정보
          <div className="grid items-start gap-4 lg:grid-cols-3" data-testid="pii-log-detail">
            <div className="min-w-0 space-y-4 lg:col-span-2">
              <div className="rounded-box border border-base-300 bg-base-100 px-5 py-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-base-300 text-sm font-bold text-base-content/70" aria-hidden="true">
                    {(log.actor.actorId.replace(/^op-/i, '').charAt(0) || '?').toUpperCase()}
                  </span>
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold">{log.actor.actorId}</span>
                      <StatusBadge tone={ACCESS_TONE[log.accessType] ?? 'ghost'}>
                        <CodeLabel code={log.accessType} names={m.accessTypeName} />
                      </StatusBadge>
                      <span className="text-base-content/40" aria-hidden="true">
                        →
                      </span>
                      <span className="inline-flex items-center">{subject(log)}</span>
                    </div>
                    <p className="text-xs text-base-content/55">{when(log.occurredAt)}</p>
                  </div>
                </div>
                <div className="mt-4 space-y-1">
                  <p className="text-xs text-base-content/50">{m.col.purpose}</p>
                  <blockquote className="whitespace-pre-wrap rounded-box border-l-4 border-primary/50 bg-base-200/50 px-4 py-3 text-sm">{log.purpose}</blockquote>
                  <p className="text-xs text-base-content/55">{m.purposeNote}</p>
                </div>
              </div>
              <Section title={m.accessSection}>
                <FieldList
                  rows={[
                    [
                      m.col.fields,
                      <span className="rounded-md bg-warning/10 px-1.5 py-0.5">
                        <Fields fields={log.fields} />
                      </span>,
                    ],
                    [m.col.accessType, <CodeLabel code={log.accessType} names={m.accessTypeName} />],
                    [m.recordCount, text(log.recordCount ?? 1)],
                    [m.col.subject, subject(log)],
                    [m.col.caseRef, refLink(log.caseRef)],
                    [m.screen, text(log.screen)],
                  ]}
                />
              </Section>
            </div>
            <aside className="min-w-0 space-y-4">
              <Section title={m.actorSection}>
                <FieldList
                  rows={[
                    [m.col.actor, <span className="font-mono">{log.actor.actorId}</span>],
                    [m.roles, <Roles roles={log.actor.roles} />],
                    [m.centerScope, text(log.actor.centerScope?.join(', '))],
                  ]}
                />
              </Section>
              <Section title={m.recordSection}>
                <FieldList
                  rows={[
                    [m.col.occurredAt, when(log.occurredAt)],
                    [m.recordedAt, when(log.recordedAt)],
                    [m.sourceSystem, <CodeLabel code={log.sourceSystem} names={messages.systemName} />],
                    [m.logId, <span className="break-all font-mono">{log.piiAccessLogId}</span>],
                  ]}
                />
              </Section>
            </aside>
          </div>
        )}
      </QueryState>
    </section>
  );
}
