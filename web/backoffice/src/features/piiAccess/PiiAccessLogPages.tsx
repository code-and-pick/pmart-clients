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
import { messages } from '../../shared/messages';
import { Facts, isSeoulDate, label, seoulDayEnd, seoulDayStart, text, when } from '../../shared/ops';
import { DataTable, PageHeader } from '../../shared/admin';

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
      <span className="badge badge-ghost badge-sm mr-1">{label(m.subjectTypeName, type)}</span>
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
      <FilterForm key={params.toString()} initial={filters} onApply={(f) => apply(f)} />
      {badRange ? (
        <p role="alert" className="alert alert-warning text-sm">
          {m.badRange}
        </p>
      ) : (
        <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
          {(data) => {
            const items = data.items;
            const nextCursor = data.page.nextCursor ?? null;
            return (
              <div className="space-y-3">
                {items.length === 0 ? (
                  <p data-state="empty" className="p-4 text-base-content/60">
                    {m.empty}
                  </p>
                ) : (
                  <LogTable items={items} search={params.toString()} />
                )}
                {(cursor || nextCursor) && (
                  <div className="flex gap-2">
                    {cursor && (
                      <button type="button" className="btn btn-sm" onClick={() => apply(filters)}>
                        {m.first}
                      </button>
                    )}
                    {nextCursor && (
                      <button type="button" className="btn btn-sm" onClick={() => apply(filters, nextCursor)}>
                        {m.next}
                      </button>
                    )}
                  </div>
                )}
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
    <form className="flex flex-wrap items-end gap-2 rounded-box border border-base-300 bg-base-100 p-3 text-sm" aria-label={m.filters} onSubmit={submit}>
      {TEXT_KEYS.map((k) => (
        <label key={k} className="flex flex-col gap-1">
          {m.filter[k]}
          <input className="input input-sm w-48 font-mono" maxLength={128} value={f[k]} onChange={(e) => set(k, e.target.value)} />
        </label>
      ))}
      <label className="flex flex-col gap-1">
        {m.filter.subjectType}
        <select className="select select-sm w-32" value={f.subjectType} onChange={(e) => set('subjectType', e.target.value)}>
          <option value="">{m.all}</option>
          {SUBJECT_TYPES.map((s) => (
            <option key={s} value={s}>
              {label(m.subjectTypeName, s)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        {m.filter.accessType}
        <select className="select select-sm w-32" value={f.accessType} onChange={(e) => set('accessType', e.target.value)}>
          <option value="">{m.all}</option>
          {ACCESS_TYPES.map((s) => (
            <option key={s} value={s}>
              {label(m.accessTypeName, s)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        {m.filter.from}
        <input type="date" className="input input-sm" value={f.from} onChange={(e) => set('from', e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        {m.filter.to}
        <input type="date" className="input input-sm" value={f.to} onChange={(e) => set('to', e.target.value)} />
      </label>
      <button type="submit" className="btn btn-sm btn-primary">
        {messages.search}
      </button>
      <button type="button" className="btn btn-sm" onClick={() => onApply(Object.fromEntries(KEYS.map((k) => [k, ''])) as Filters)}>
        {m.reset}
      </button>
    </form>
  );
}

function LogTable({ items, search }: { readonly items: readonly Log[]; readonly search: string }) {
  return (
    <div className="overflow-x-auto">
      <DataTable>
        <thead>
          <tr>
            <th>{m.col.occurredAt}</th>
            <th>{m.col.actor}</th>
            <th>{m.col.subject}</th>
            <th>{m.col.fields}</th>
            <th>{m.col.accessType}</th>
            <th>{m.col.caseRef}</th>
            <th>{m.col.purpose}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((log) => (
            <tr key={log.piiAccessLogId} data-testid="pii-log-row">
              <td>
                <Link className="link" to={`/pii-access-logs/${encodeURIComponent(log.piiAccessLogId)}`} state={{ search }}>
                  {when(log.occurredAt)}
                </Link>
              </td>
              <td>
                <span className="font-mono">{log.actor.actorId}</span>
                {(log.actor.roles?.length ?? 0) > 0 && <div className="text-xs text-base-content/60">{log.actor.roles?.join(', ')}</div>}
              </td>
              <td>{subject(log)}</td>
              <td>{fieldsText(log.fields)}</td>
              <td>{label(m.accessTypeName, log.accessType)}</td>
              <td>{refLink(log.caseRef)}</td>
              <td className="max-w-xs truncate" title={log.purpose}>
                {log.purpose}
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </div>
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
    <section className="max-w-3xl space-y-4">
      <Link className="link text-sm" to={`/pii-access-logs${back ? `?${back}` : ''}`}>
        {m.back}
      </Link>
      <PageHeader title={m.detailTitle} />
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(log) => (
          <>
            <Facts
              testId="pii-log-detail"
              rows={[
                [m.col.occurredAt, when(log.occurredAt)],
                [m.col.actor, <span className="font-mono">{log.actor.actorId}</span>],
                [m.roles, text(log.actor.roles?.join(', '))],
                [m.centerScope, text(log.actor.centerScope?.join(', '))],
                [m.col.subject, subject(log)],
                [m.col.fields, fieldsText(log.fields)],
                [m.col.accessType, label(m.accessTypeName, log.accessType)],
                [m.recordCount, text(log.recordCount ?? 1)],
                [m.col.caseRef, refLink(log.caseRef)],
                [m.screen, text(log.screen)],
                [m.col.purpose, <span className="whitespace-pre-wrap">{log.purpose}</span>],
                [m.sourceSystem, <span className="font-mono">{log.sourceSystem}</span>],
                [m.recordedAt, when(log.recordedAt)],
                [m.logId, <span className="font-mono">{log.piiAccessLogId}</span>],
              ]}
            />
            <p className="text-xs text-base-content/60">{m.purposeNote}</p>
          </>
        )}
      </QueryState>
    </section>
  );
}
