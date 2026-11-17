// 접수 건 — 라이더 운영(RIDER_OPS)·운영 관리자. case-service `GET /cases`·`GET /cases/{caseId}`(case 0.22.0).
// 보이는 범위는 서버가 정한다(RIDER_OPS = 배송 쪽 사건만 — RIDER_HELP·DELIVERY_INCIDENT·RIDER_LOCATION_STALE·MISDELIVERY·DISPATCH_FAILED).
// 1차(2026-11-17, PC 5): 보기만 — 맡기·이관·처리 끝내기는 다음 차례. 필터·쪽은 주소 쿼리에 둔다.
// 2026-11-18: 배민 주문접수 목록·상세 모양 — 처리 중/끝남 밑줄 탭 → 검색 조건 상자 → 결과 줄 → 표(줄 누르면 상세) / 상세 머리 → 구역 상자.
import { useQuery } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { ChipGroup, CursorPager, DataTable, DetailHeader, FieldList, Notice, PageHeader, ResultBar, SearchPanel, SearchRow, Section, StatusBadge } from '../../shared/admin';
import { caseTone, StateTabs } from '../support/supportUi';

const m = messages.cases;
const n = messages.names;
const none = messages.none;
const name = (map: Readonly<Record<string, string>>, v: string | null | undefined) => (v ? (map[v] ?? v) : none);
const when = (iso: string | null | undefined) => (iso ? formatSeoul(iso) : none);

type CaseKind = components['schemas']['CaseKind'];
type CaseSummary = components['schemas']['CaseSummary'];

/** 라이더 운영이 다루는 배송 쪽 종류(서버 보이는 범위와 같다) */
export const DELIVERY_KINDS: readonly CaseKind[] = ['RIDER_HELP', 'DISPATCH_FAILED', 'RIDER_LOCATION_STALE', 'MISDELIVERY', 'DELIVERY_INCIDENT'];
const PAGE_SIZE = 50;

export function CasesMenu() {
  return (
    <Routes>
      <Route index element={<CaseListPage />} />
      <Route path=":caseId" element={<CaseDetailPage />} />
    </Routes>
  );
}

function Sla({ slaDueAt, overdue }: { readonly slaDueAt: string | null | undefined; readonly overdue: boolean | null | undefined }) {
  if (!slaDueAt) return <>{none}</>;
  return (
    <span className={`whitespace-nowrap ${overdue ? 'font-semibold text-error' : ''}`} data-overdue={overdue ? 'true' : 'false'}>
      {when(slaDueAt)}
      {overdue && ` · ${m.overdue}`}
    </span>
  );
}

function Refs({ refs }: { readonly refs: CaseSummary['refs'] }) {
  const shown = (refs ?? []).filter((r) => r.refId && (r.refType === 'deliveryId' || r.refType === 'orderId' || r.refType === 'riderId'));
  if (shown.length === 0) return <>{none}</>;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-xs">
      {shown.map((r) =>
        r.refType === 'deliveryId' ? (
          <Link key={`${r.refType}-${r.refId}`} className="link link-primary" to={`/deliveries/${encodeURIComponent(r.refId ?? '')}`} onClick={(e) => e.stopPropagation()}>
            {`${name(n.refType, r.refType)} ${r.refId}`}
          </Link>
        ) : (
          <span key={`${r.refType}-${r.refId}`}>{`${name(n.refType, r.refType)} ${r.refId}`}</span>
        ),
      )}
    </span>
  );
}

function PriorityBadge({ priority }: { readonly priority: string | null | undefined }) {
  return <StatusBadge tone={priority === 'P1' ? 'error' : priority === 'P2' ? 'warning' : 'ghost'}>{priority ?? none}</StatusBadge>;
}

function CaseListPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const closed = params.get('state') === 'CLOSED';
  const rawKind = params.get('kind') ?? '';
  const kind = (DELIVERY_KINDS as readonly string[]).includes(rawKind) ? (rawKind as CaseKind) : undefined;
  const overdue = params.get('overdue') === 'true';
  const unassigned = params.get('unassigned') === 'true';
  const cursor = params.get('cursor') ?? '';
  const set = (next: Partial<{ state: string; kind: string; overdue: boolean; unassigned: boolean; cursor: string }>) => {
    const v = { state: closed ? 'CLOSED' : '', kind: kind ?? '', overdue, unassigned, cursor: '', ...next };
    setParams({
      ...(v.state ? { state: v.state } : {}),
      ...(v.kind ? { kind: v.kind } : {}),
      ...(v.overdue ? { overdue: 'true' } : {}),
      ...(v.unassigned ? { unassigned: 'true' } : {}),
      ...(v.cursor ? { cursor: v.cursor } : {}),
    });
  };
  const query = useQuery({
    queryKey: ['cases', closed, kind, overdue, unassigned, cursor],
    queryFn: () =>
      request(
        'GET',
        api.cases.GET('/cases', {
          params: {
            query: {
              size: PAGE_SIZE,
              ...(closed ? { state: 'CLOSED' as const } : {}),
              ...(kind ? { kind } : {}),
              ...(overdue ? { overdue: true } : {}),
              ...(unassigned ? { unassigned: true } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
  });
  // 거르기는 고르는 즉시 주소에 반영된다 — [조회]는 지금 조건으로 다시 불러오기, [초기화]는 거르기 비우기(탭은 그대로)
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void query.refetch();
  };
  const reset = () => set({ kind: '', overdue: false, unassigned: false });
  const open = (caseId: string | undefined) => void navigate(`/cases/${encodeURIComponent(caseId ?? '')}`);

  return (
    <section className="space-y-4">
      <PageHeader title={m.title} description={m.intro} />
      <StateTabs
        label="처리 상태"
        value={closed ? 'CLOSED' : 'OPEN'}
        options={[
          { value: 'OPEN', label: m.tabOpen },
          { value: 'CLOSED', label: m.tabClosed },
        ]}
        onChange={(v) => set({ state: v === 'CLOSED' ? 'CLOSED' : '' })}
      />
      <SearchPanel onSubmit={submit} onReset={reset}>
        <SearchRow label={m.kind}>
          <ChipGroup label={m.kind} value={kind ?? ''} options={[{ value: '', label: m.allKinds }, ...DELIVERY_KINDS.map((k) => ({ value: k, label: name(n.caseKind, k) }))]} onChange={(v) => set({ kind: v })} />
        </SearchRow>
        {!closed && (
          <SearchRow label="조건">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={overdue} onChange={(e) => set({ overdue: e.target.checked })} />
              {m.overdueOnly}
            </label>
            <label className="ml-4 flex items-center gap-2 text-sm">
              <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={unassigned} onChange={(e) => set({ unassigned: e.target.checked })} />
              {m.unassignedOnly}
            </label>
          </SearchRow>
        )}
      </SearchPanel>
      <QueryState state={toUiState(query, (r) => (r.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={closed ? m.emptyClosed : m.emptyOpen}>
        {(r) => {
          const nextCursor = r.page?.nextCursor ?? null;
          const items = r.items ?? [];
          return (
            <div className="space-y-3">
              <ResultBar count={items.length} more={!!nextCursor} />
              <DataTable>
                <thead>
                  <tr>
                    <th className="w-16">{m.col.priority}</th>
                    <th>{m.col.kind}</th>
                    <th>{m.col.summary}</th>
                    <th>{m.col.refs}</th>
                    <th>{m.col.sla}</th>
                    <th>{m.col.state}</th>
                    <th>{m.col.assignee}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c, i) => (
                    <tr key={c.caseId ?? `case-${i}`} data-testid="case-row" className={`cursor-pointer ${c.overdue ? 'bg-error/5' : ''}`} onClick={() => open(c.caseId)}>
                      <td>
                        <PriorityBadge priority={c.priority} />
                      </td>
                      <td className="whitespace-nowrap">{name(n.caseKind, c.kind)}</td>
                      <td className="font-medium">
                        <Link className="hover:underline" to={`/cases/${encodeURIComponent(c.caseId ?? '')}`} onClick={(e) => e.stopPropagation()}>
                          {c.summary || name(n.caseKind, c.kind)}
                        </Link>
                      </td>
                      <td>
                        <Refs refs={c.refs} />
                      </td>
                      <td>
                        <Sla slaDueAt={c.slaDueAt} overdue={c.overdue} />
                      </td>
                      <td>
                        <StatusBadge tone={caseTone(c.state)}>{name(n.caseState, c.state)}</StatusBadge>
                      </td>
                      <td className="font-mono text-xs">{c.assigneeId ?? <span className="font-sans text-base-content/45">{m.unassigned}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
              <CursorPager hasPrev={!!cursor} nextCursor={nextCursor} onFirst={() => set({})} onNext={(c) => set({ cursor: c })} />
            </div>
          );
        }}
      </QueryState>
    </section>
  );
}

// 상세(배민 주문내역 상세 참고): 머리(번호·긴급도·상태·요약) → 보기만 안내 → 구역 상자(접수 내용 / 이력).
function CaseDetailPage() {
  const api = useApi();
  const { caseId = '' } = useParams();
  const query = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => request('GET', api.cases.GET('/cases/{caseId}', { params: { path: { caseId } } })),
  });
  const c = query.data;
  return (
    <section className="max-w-6xl space-y-4">
      <DetailHeader
        back={{ to: '/cases', label: m.back }}
        title={m.detailTitle(caseId)}
        badges={
          c && (
            <>
              <PriorityBadge priority={c.priority} />
              <StatusBadge tone={caseTone(c.state)}>{name(n.caseState, c.state)}</StatusBadge>
              {c.overdue && <StatusBadge tone="error">{m.overdue}</StatusBadge>}
            </>
          )
        }
        summary={c && [name(n.caseKind, c.kind), c.summary, `${m.col.openedAt} ${when(c.openedAt)}`].filter(Boolean).join(' · ')}
      />
      <Notice>{m.viewOnlyNote}</Notice>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(x) => (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Section id="sec-case" title="접수 내용">
              <FieldList
                testId="case-detail"
                rows={[
                  [m.col.kind, name(n.caseKind, x.kind)],
                  [m.col.summary, x.summary || none],
                  [m.col.priority, x.priority ?? none],
                  [m.col.state, name(n.caseState, x.state)],
                  [m.col.refs, <Refs refs={x.refs} />],
                  [m.col.openedAt, when(x.openedAt)],
                  [m.col.sla, <Sla slaDueAt={x.slaDueAt} overdue={x.overdue} />],
                  [m.col.assignee, x.assigneeId ? <span className="font-mono">{x.assigneeId}</span> : m.unassigned],
                  x.closure && [m.closure, `${name(n.resolution, x.closure.resolution)}${x.closure.summary ? ` — ${x.closure.summary}` : ''} (${when(x.closure.closedAt)})`],
                ]}
              />
            </Section>
            <Section id="sec-history" title={m.history}>
              {(x.history ?? []).length === 0 ? (
                <p className="text-sm text-base-content/50">{none}</p>
              ) : (
                <ol className="relative space-y-3 border-l-2 border-base-300 pl-4 text-sm" data-testid="case-history">
                  {(x.history ?? []).map((h, i) => (
                    <li key={`${h.at ?? ''}-${i}`} className="relative">
                      <span className="absolute -left-[1.4rem] top-1 size-2.5 rounded-full bg-accent" aria-hidden />
                      <span className="font-medium">{`${name(n.caseAction, h.action)}${h.toState ? ` → ${name(n.caseState, h.toState)}` : ''}`}</span>
                      <span className="ml-2 text-base-content/55">{when(h.at)}</span>
                      {h.note && <p className="mt-0.5 text-base-content/70">{h.note}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </div>
        )}
      </QueryState>
    </section>
  );
}
