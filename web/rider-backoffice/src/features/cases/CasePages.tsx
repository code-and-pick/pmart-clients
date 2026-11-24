// 접수 건 — 라이더 운영(RIDER_OPS)·운영 관리자. case-service `GET /cases`·`GET /cases/{caseId}`(case 0.22.0).
// 보이는 범위는 서버가 정한다(RIDER_OPS = 배송 쪽 사건만 — RIDER_HELP·DELIVERY_INCIDENT·RIDER_LOCATION_STALE·MISDELIVERY·DISPATCH_FAILED).
// 1차(2026-11-17, PC 5): 보기만 — 맡기·이관·처리 끝내기는 다음 차례. 필터·쪽은 주소 쿼리에 둔다.
// 2026-11-18: 배민 주문접수 목록·상세 모양 — 처리 중/끝남 밑줄 탭 → 검색 조건 상자 → 결과 줄 → 표(줄 누르면 상세) / 상세 머리 → 구역 상자.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, failureCode, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { DeliveryRef, RiderRef, StaffName, SystemIds, useDeliveryNumbers, useRiderSummaries } from '../../shared/displayNumbers';
import { useSession } from '../../app/SessionContext';
import { AllDone, ChipGroup, GuideBox, CursorPager, DataTable, DetailHeader, FieldList, PageHeader, ResultBar, SearchPanel, SearchRow, Section, StatCard, StatStrip, StatusBadge } from '../../shared/admin';
import { ui } from '../../shared/uiMessages';
import { listCountText, useListRows } from '../../shared/listKit';
import { SavedViews } from '../../shared/SavedViews';
import { Caret, expandRowProps, InlineDetail, useInlineOpen } from '../../shared/simList';
import { useNow } from '../../shared/useNow';
import { elapsedText } from '../deliveries/DeliveryExtras';
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


/** 기한 15분 안 — 남은 분(서버 기한 slaDueAt 과 지금 시각의 차, 넘김 판정은 서버 overdue). 2026-11-19 통합 백오피스처럼 숨쉬기 */
const SOON_MIN = 15;
function Sla({ slaDueAt, overdue, now, wrap = false }: { readonly slaDueAt: string | null | undefined; readonly overdue: boolean | null | undefined; readonly now?: number | null; readonly wrap?: boolean }) {
  if (!slaDueAt) return <>{none}</>;
  const left = !overdue && now != null ? Math.ceil((new Date(slaDueAt).getTime() - now) / 60_000) : null;
  const soon = left !== null && left > 0 && left <= SOON_MIN;
  return (
    <span className={`${wrap ? '' : 'whitespace-nowrap'} ${overdue ? 'font-semibold text-error' : ''}`} data-overdue={overdue ? 'true' : 'false'}>
      {when(slaDueAt)}
      {/* 좁은 칸(펼친 줄)에서는 "기한 넘김"을 다음 줄로 — 옆 "담당" 칸을 밀어 붙지 않게(2026-11-24) */}
      {overdue && (wrap ? <span className="block">{m.overdue}</span> : ` · ${m.overdue}`)}
      {soon && (
        <span className="breathe ml-1 font-semibold text-warning" data-testid="sla-soon">
          · {cx.minutesLeft(left)}
        </span>
      )}
    </span>
  );
}

/** 이 화면에서 더한 문구(2026-11-19 통합 백오피스와 맞추기) */
const cx = {
  stripLabel: '처리 중 접수 건 수',
  unassigned: '아무도 안 맡음',
  overdue: '기한 넘김',
  listHint: '불러온 것 기준',
  minutesLeft: (n: number) => `${n}분 남음`,
} as const;

/** 관련 대상 — 배송·라이더는 화면 번호(ADR-0070), 주문은 시스템 ID 라 목록에 내지 않는다(배송 번호 안에 주문번호가 있다) */
function Refs({ refs }: { readonly refs: CaseSummary['refs'] }) {
  const deliveryIds = (refs ?? []).filter((r) => r.refType === 'deliveryId' && r.refId).map((r) => r.refId!);
  const riderIds = (refs ?? []).filter((r) => r.refType === 'riderId' && r.refId).map((r) => r.refId!);
  const nos = useDeliveryNumbers(deliveryIds);
  const riders = useRiderSummaries(riderIds);
  if (deliveryIds.length === 0 && riderIds.length === 0) return <>{none}</>;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
      {deliveryIds.map((id) => (
        <span key={`d-${id}`} className="inline-flex items-center gap-1">
          <span className="text-base-content/50">{name(n.refType, 'deliveryId')}</span>
          <DeliveryRef deliveryId={id} numbers={nos.get(id)} />
        </span>
      ))}
      {riderIds.map((id) => (
        <span key={`r-${id}`} className="inline-flex items-center gap-1">
          <span className="text-base-content/50">{name(n.refType, 'riderId')}</span>
          <RiderRef riderId={id} summary={riders.get(id)} />
        </span>
      ))}
    </span>
  );
}

// 2026-11-24 사용자 "P2가 뭔데" — 계약 Priority(P1 긴급·P2 높음·P3 보통·P4 낮음)를 글자로, 코드는 올려 보면
const PRIORITY_NAME: Readonly<Record<string, string>> = { P1: '긴급', P2: '높음', P3: '보통', P4: '낮음' };
function PriorityBadge({ priority }: { readonly priority: string | null | undefined }) {
  return (
    <span title={priority ? `우선순위 ${priority}` : undefined}>
      <StatusBadge tone={priority === 'P1' ? 'error' : priority === 'P2' ? 'warning' : 'ghost'}>{priority ? (PRIORITY_NAME[priority] ?? priority) : none}</StatusBadge>
    </span>
  );
}

type CaseHistoryItem = NonNullable<components['schemas']['Case']['history']>[number];
/** 처음에 보이는 이력 수(2026-11-24 사용자 "일정 개수 넘어가면 더보기로 열게 해주고 최신 게 위에") */
const HISTORY_SHOWN = 5;
/** 동작 뒤 상태가 같은 뜻이면 상태를 빼고 동작만 */
const SAME_AS_ACTION: Readonly<Record<string, readonly string[]>> = { OPENED: ['OPEN'], ASSIGNED: ['ASSIGNED'], CLOSED: ['CLOSED'], REOPENED: ['REOPENED'], RECURRED: ['OPEN', 'ASSIGNED', 'ACTION_PENDING', 'MONITORING'] };
/** 이력 메모의 사건 이름(서버 영문) → 화면 글자 */
const EVENT_NOTE: Readonly<Record<string, string>> = { DispatchFailed: '배차 실패', DeliveryIncidentRaised: '배송 사고 접수', RiderHelpRequested: '라이더 도움요청' };

/** 사건 이력 — 최신이 위, 처음엔 5개 + "이전 기록 n개 더 보기" */
function CaseHistoryList({ history, timeline = false, testId }: { readonly history: readonly CaseHistoryItem[]; readonly timeline?: boolean; readonly testId: string }) {
  const [all, setAll] = useState(false);
  const sorted = [...history].map((h, i) => ({ h, i })).sort((a, b) => (b.h.at ?? '').localeCompare(a.h.at ?? '') || b.i - a.i).map((x) => x.h);
  const shown = all ? sorted : sorted.slice(0, HISTORY_SHOWN);
  const hidden = sorted.length - shown.length;
  if (sorted.length === 0) return <p className="text-sm text-base-content/50">{none}</p>;
  return (
    <div className="space-y-2">
      <ol className={timeline ? 'relative space-y-3 border-l-2 border-base-300 pl-4 text-sm' : 'space-y-1.5 text-sm'} data-testid={testId}>
        {shown.map((h, i) => (
          <li key={`${h.at ?? ''}-${i}`} className={timeline ? 'relative' : undefined}>
            {timeline && <span className="absolute -left-[1.4rem] top-1 size-2.5 rounded-full bg-accent" aria-hidden />}
            {/* "접수 → 접수됨"·"맡음 → 맡음" 처럼 동작이 곧 상태면 동작만(2026-11-24 사용자 "접수 -> 접수됨은 뭐냐") */}
            <span className="font-medium">{`${name(n.caseAction, h.action)}${h.toState && !SAME_AS_ACTION[h.action ?? '']?.includes(h.toState) ? ` → ${name(n.caseState, h.toState)}` : ''}`}</span>
            <span className="ml-2 text-base-content/55">{when(h.at)}</span>
            {h.note && <p className={timeline ? 'mt-0.5 text-base-content/70' : 'text-base-content/70'}>{EVENT_NOTE[h.note] ?? tidySummary(h.note)}</p>}
          </li>
        ))}
      </ol>
      {sorted.length > HISTORY_SHOWN && (
        <button type="button" className="btn btn-ghost btn-xs w-full" onClick={() => setAll((v) => !v)} data-testid="case-history-more">
          {all ? '최근 기록만 보기' : `이전 기록 ${hidden}개 더 보기`}
        </button>
      )}
    </div>
  );
}

/**
 * 처리 안 된 채 기한을 넘긴 사건 — 펼친 칸·상세 맨 위 빨간 경고(2026-11-24 사용자 "4일째 배차 찾고 있는데 왜 아무데도 위급하다고 빨리 처리하라는
 * 알림이나 글이 안 적혀 있냐고"). 기한 넘김은 서버 overdue 값, 경과는 처리 기한부터.
 */
function CaseUrgent({ c }: { readonly c: { readonly state?: string | null; readonly overdue?: boolean | null; readonly slaDueAt?: string | null; readonly assigneeId?: string | null; readonly history?: readonly CaseHistoryItem[] | null } }) {
  const now = useNow();
  if (c.state === 'CLOSED' || !c.overdue) return null;
  const recurred = (c.history ?? []).filter((h) => h.action === 'RECURRED').length;
  const over = c.slaDueAt && now !== null ? elapsedText(c.slaDueAt, now) : null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-box border border-error bg-error/10 px-4 py-3" data-testid="case-urgent">
      <span className="mt-1 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-error" aria-hidden />
      <div className="text-sm">
        <p className="font-bold text-error">{over ? `처리 기한을 ${over} 넘겼어요 — 빨리 처리해 주세요` : '처리 기한을 넘겼어요 — 빨리 처리해 주세요'}</p>
        <p>
          {[c.assigneeId ? null : '아직 아무도 안 맡았어요', recurred > 0 ? `같은 문제가 ${recurred}번 더 생겼어요` : null].filter(Boolean).join(' · ')}
        </p>
      </div>
    </div>
  );
}

/** 요약 글자 다듬기 — 서버 요약에 섞인 ISO 시각(2026-11-20T13:10:39.63Z)을 화면 시각으로 */
const CODE_WORDS: Readonly<Record<string, string>> = { ...n.helpCategory, ...n.executionState };
const tidySummary = (text: string) =>
  tidyIso(text)
    // 2026-11-24 사용자(상세 "라이더 도움요청 — APP_ERROR (ASSIGNED)") — 서버 요약 속 영문 코드를 화면 글자로
    .replace(/\b[A-Z][A-Z_]{2,}\b/g, (code) => CODE_WORDS[code] ?? code);
const tidyIso = (text: string) => text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g, (iso) => when(iso));

/** 처리함의 "배송 사건" 탭(2026-11-21) — embedded 면 쪽 제목 없이, 주소의 tab=cases 를 지킨다 */
export function CaseListPage({ embedded = false }: { readonly embedded?: boolean }) {
  const api = useApi();
  const me = useSession().session?.subject;
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
      ...(embedded ? { tab: 'cases' } : {}),
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
  const inline = useInlineOpen();
  const casePath = caseDetailPath;
  // 숫자 띠(2026-11-19) — 처리 중인 건 중 안 맡은 것·기한 넘긴 것. 서버 목록 한 쪽(50건)으로 세고, 다음 쪽이 있으면 "N건 이상"
  const countQuery = (flag: 'unassigned' | 'overdue') => ({
    queryKey: ['cases-count', flag],
    refetchInterval: 30_000,
    queryFn: async () => {
      const r = await request('GET', api.cases.GET('/cases', { params: { query: { size: PAGE_SIZE, [flag]: true } } }));
      return { n: (r.items ?? []).length, more: !!r.page?.nextCursor };
    },
  });
  const unassignedCount = useQuery(countQuery('unassigned'));
  const overdueCount = useQuery(countQuery('overdue'));
  const listRows = useListRows(query.data?.items?.map((c) => casePath(c.caseId)), [closed, kind, overdue, unassigned, cursor].join('|'));
  const now = useNow();

  return (
    <section className="space-y-4">
      {embedded ? (
        <div className="flex justify-end">
          <SavedViews listKey="cases" />
        </div>
      ) : (
        <PageHeader title={m.title} actions={<SavedViews listKey="cases" />} />
      )}
      <GuideBox title={ui.guideTitle} items={[m.intro]} storeKey="cases" testId="cases-guide" />
      <StatStrip label={cx.stripLabel} testId="case-strip">
        <StatCard layout="row" label={cx.unassigned} value={listCountText(unassignedCount.data, unassignedCount.isError)} hint={cx.listHint} to={`${CASE_LIST}&unassigned=true`} active={!closed && unassigned && !overdue} tone={(unassignedCount.data?.n ?? 0) > 0 ? 'warning' : undefined} testId="strip-unassigned" />
        <StatCard layout="row" label={cx.overdue} value={listCountText(overdueCount.data, overdueCount.isError)} hint={cx.listHint} to={`${CASE_LIST}&overdue=true`} active={!closed && overdue && !unassigned} tone={(overdueCount.data?.n ?? 0) > 0 ? 'error' : undefined} testId="strip-overdue" />
      </StatStrip>
      <StateTabs
        label="처리 상태"
        value={closed ? 'CLOSED' : 'OPEN'}
        options={[
          { value: 'OPEN', label: m.tabOpen },
          { value: 'CLOSED', label: m.tabClosed },
        ]}
        onChange={(v) => set({ state: v === 'CLOSED' ? 'CLOSED' : '' })}
      />
      <SearchPanel
        onSubmit={submit}
        onReset={reset}
        summary={[
          [m.kind, kind ? name(n.caseKind, kind) : '', () => set({ kind: '' })],
          ['기한', overdue ? m.overdueOnly : '', () => set({ overdue: false })],
          ['담당', unassigned ? m.unassignedOnly : '', () => set({ unassigned: false })],
        ]}
      >
        <SearchRow label={m.kind}>
          <ChipGroup label={m.kind} value={kind ?? ''} options={[{ value: '', label: m.allKinds }, ...DELIVERY_KINDS.map((k) => ({ value: k, label: name(n.caseKind, k) }))]} onChange={(v) => set({ kind: v })} />
        </SearchRow>
        {!closed && (
          <SearchRow label="조건">
            <label className="flex flex-row items-center gap-2 text-sm">
              <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={overdue} onChange={(e) => set({ overdue: e.target.checked })} />
              {m.overdueOnly}
            </label>
            <label className="flex flex-row items-center gap-2 text-sm">
              <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={unassigned} onChange={(e) => set({ unassigned: e.target.checked })} />
              {m.unassignedOnly}
            </label>
          </SearchRow>
        )}
      </SearchPanel>
      {/* 할 일이 서버 0건이면 "수고하셨어요"(2026-11-19 통합 백오피스 AllDone) — 읽는 중·실패·거르기를 건 때는 그리지 않는다 */}
      {query.isSuccess && (query.data.items ?? []).length === 0 && !closed && !kind && !overdue && !unassigned && !cursor ? (
        <AllDone title={ui.allDone} body={m.emptyOpen} testId="cases-all-done" />
      ) : (
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
                    {items.map((c, i) => {
                      const k = c.caseId ?? `case-${i}`;
                      const isOpen = inline.isOpen(k);
                      return (
                      <Fragment key={k}>
                      {/* 줄을 누르면 바로 아래에 접수 내용·이력(시뮬레이터처럼). 처리 끝내기는 요약 링크·"전체 상세 ›"에서 */}
                      <tr data-testid="case-row" className={`${c.overdue ? 'bg-error/5' : ''} ${listRows.rowClass(casePath(c.caseId))}`} {...expandRowProps(isOpen, () => inline.toggle(k))}>
                        <td>
                          {/* 삼각형과 꼬리표를 한 줄로(2026-11-24 "조그만 삼각형 때문에 P2가 내려가 보이니") */}
                          <span className="flex items-center gap-1 whitespace-nowrap">
                            <Caret open={isOpen} />
                            <PriorityBadge priority={c.priority} />
                          </span>
                        </td>
                        <td className="whitespace-nowrap">{name(n.caseKind, c.kind)}</td>
                        <td className="font-medium">
                          {/* 내용은 한 줄(넘치면 … — 전체는 올려 보거나 줄을 펼치면, 2026-11-24 "내용도 2줄 이상 되니까 보기 힘들잖아") */}
                          <Link className="block max-w-md truncate hover:underline" title={tidySummary(c.summary || '')} to={casePath(c.caseId)} onClick={(e) => e.stopPropagation()}>
                            {c.summary ? tidySummary(c.summary) : name(n.caseKind, c.kind)}
                          </Link>
                          {listRows.seenMark(casePath(c.caseId))}
                        </td>
                        <td>
                          <Refs refs={c.refs} />
                        </td>
                        <td>
                          <Sla slaDueAt={c.slaDueAt} overdue={c.overdue} now={c.state === 'CLOSED' ? null : now} />
                        </td>
                        <td>
                          <StatusBadge tone={caseTone(c.state)}>{name(n.caseState, c.state)}</StatusBadge>
                        </td>
                        <td>{c.assigneeId ? <StaffName operatorId={c.assigneeId} me={me} /> : <span className="text-base-content/45">{m.unassigned}</span>}</td>
                      </tr>
                      {isOpen && c.caseId && (
                        <InlineDetail colSpan={7} to={casePath(c.caseId)} testId="case-inline">
                          <CaseInline caseId={c.caseId} />
                        </InlineDetail>
                      )}
                      </Fragment>
                      );
                    })}
                  </tbody>
                </DataTable>
                <CursorPager hasPrev={!!cursor} nextCursor={nextCursor} onFirst={() => set({})} onNext={(c) => set({ cursor: c })} />
              </div>
            );
          }}
        </QueryState>
      )}
    </section>
  );
}

/** 목록 줄 아래 펼친 접수 건 요약(2026-11-21 시뮬레이터 .md-inline) — 상세와 같은 조회(['case', id]), 새 API 없음. 처리 끝내기는 전체 상세에서 */
function CaseInline({ caseId }: { readonly caseId: string }) {
  const api = useApi();
  const me = useSession().session?.subject;
  const query = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => request('GET', api.cases.GET('/cases/{caseId}', { params: { path: { caseId } } })),
  });
  return (
    <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
      {(x) => (
        <div className="space-y-3">
        <CaseUrgent c={x} />
        <div className="pm-inline-cols">
          <div>
            <h4>접수 내용</h4>
            {/* 내용은 칸 하나에 3줄로 접혀 읽기 어려웠다(2026-11-24 "글 3줄 넘어가서 눈에 안 들어오고") — 위에 한 줄로 따로 */}
            {x.summary && (
              <p className="mb-3 text-[15px] font-semibold" data-testid="case-inline-summary">
                {tidySummary(x.summary)}
              </p>
            )}
            <FieldList
              testId="case-inline-detail"
              rows={[
                [m.col.kind, name(n.caseKind, x.kind)],
                [m.col.refs, <Refs refs={x.refs} />],
                [m.col.openedAt, when(x.openedAt)],
                [m.col.sla, <Sla slaDueAt={x.slaDueAt} overdue={x.overdue} wrap />],
                [m.col.assignee, x.assigneeId ? <StaffName operatorId={x.assigneeId} me={me} /> : m.unassigned],
                x.closure && [m.closure, `${name(n.resolution, x.closure.resolution)}${x.closure.summary ? ` — ${x.closure.summary}` : ''} (${when(x.closure.closedAt)})`],
              ]}
            />
          </div>
          <div className="pm-inline-side">
            <h4>{m.history}</h4>
            <CaseHistoryList history={x.history ?? []} testId="case-inline-history" />
          </div>
        </div>
        </div>
      )}
    </QueryState>
  );
}

/** 처리함 안 배송 사건 자리(2026-11-21 — 옛 /cases 는 App 이 여기로 넘긴다) */
export const CASE_LIST = '/consults?tab=cases';
export const caseDetailPath = (caseId: string | undefined) => `/consults/cases/${encodeURIComponent(caseId ?? '')}`;

// 상세(배민 주문내역 상세 참고): 머리(번호·긴급도·상태·요약) → 보기만 안내 → 구역 상자(접수 내용 / 이력).
export function CaseDetailPage() {
  const api = useApi();
  const me = useSession().session?.subject;
  const { caseId = '' } = useParams();
  const query = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => request('GET', api.cases.GET('/cases/{caseId}', { params: { path: { caseId } } })),
  });
  const [closedNow, setClosedNow] = useState(false);
  const c = query.data;
  return (
    <section className="max-w-[1600px] space-y-4">
      <DetailHeader
        seen={!!c}
        back={{ to: CASE_LIST, label: m.back }}
        // 2026-11-24 사용자 "위쪽에 왜 이렇게 UI 복잡한데 글도 줄줄 적혀 있고" — 제목은 요약(코드는 글자로), 밑줄은 종류·접수 시각만, 안내 상자 뺌
        title={c ? (c.summary ? tidySummary(c.summary) : name(n.caseKind, c.kind)) : m.detailTitle('')}
        badges={
          c && (
            <>
              <PriorityBadge priority={c.priority} />
              <StatusBadge tone={caseTone(c.state)}>{name(n.caseState, c.state)}</StatusBadge>
              {c.overdue && <StatusBadge tone="error">{m.overdue}</StatusBadge>}
            </>
          )
        }
        summary={c && [name(n.caseKind, c.kind), `${m.col.openedAt} ${when(c.openedAt)}`].join(' · ')}
      />
      {c && <CaseUrgent c={c} />}
      {closedNow && (
        <p role="status" className="rounded-box bg-success/10 px-4 py-3 text-sm text-success" data-testid="case-closed-now">
          {closeText.done}
        </p>
      )}
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(x) => (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Section id="sec-case" title="접수 내용">
              <FieldList
                testId="case-detail"
                rows={[
                  // 제목·꼬리표에 있는 내용·긴급도·상태·종류·접수 시각은 다시 적지 않는다
                  [m.col.refs, <Refs refs={x.refs} />],
                  [m.col.sla, <Sla slaDueAt={x.slaDueAt} overdue={x.overdue} wrap />],
                  [m.col.assignee, x.assigneeId ? <StaffName operatorId={x.assigneeId} me={me} /> : m.unassigned],
                  x.closure && [m.closure, `${name(n.resolution, x.closure.resolution)}${x.closure.summary ? ` — ${x.closure.summary}` : ''} (${when(x.closure.closedAt)})`],
                ]}
              />
              <SystemIds ids={[['접수 건', caseId], ...(x.refs ?? []).filter((r) => r.refId).map((r) => [name(n.refType, r.refType), r.refId] as const)]} />
            </Section>
            {x.state !== 'CLOSED' && (
              <Section id="sec-close" action title={closeText.title}>
                <CaseClose caseId={caseId} version={(x as { version?: number }).version} onClosed={() => setClosedNow(true)} />
              </Section>
            )}
            <Section id="sec-history" title={m.history}>
              <CaseHistoryList history={x.history ?? []} timeline testId="case-history" />
            </Section>
          </div>
        )}
      </QueryState>
    </section>
  );
}

const closeText = {
  title: '처리 끝내기',
  // 2026-11-24 회색 글 줄이기
  intro: '닫으면 붙은 도움요청도 함께 처리 끝이 돼요.',
  resolution: '결과',
  summary: '처리 내용(라이더 개인정보는 적지 않아요, 1~2000자)',
  submit: '처리 끝내기',
  done: '처리를 끝냈어요.',
  openObligations: '아직 끝나지 않은 후속 처리(의무)가 있어서 닫을 수 없어요. 그것부터 끝내 주세요.',
  forbidden: '닫을 권한이 없어요 — 다른 직원이 맡은 건은 관리자만 닫을 수 있어요.',
  unknown: '닫혔는지 확인하지 못했어요. 같은 내용으로 다시 누르면 같은 요청으로 확인해요.',
} as const;

const RESOLUTIONS = ['RESOLVED', 'NOT_REPRODUCIBLE', 'DUPLICATE', 'NO_ACTION_REQUIRED', 'ESCALATED_EXTERNAL'] as const;

/**
 * 접수 건 처리 끝내기(case `POST /cases/{caseId}/closures` — 배송 쪽은 RIDER_OPS·OPERATOR_ADMIN).
 * 도움요청이 붙은 건은 도움요청 화면에서 닫지 못한다(409 HELP_REQUEST_HAS_CASE) — 여기서 닫으면 도움요청도 RESOLVED
 * (사용자 2026-11-19 "백오피스에 처리 완료 버튼이 없네").
 */
function CaseClose({ caseId, version, onClosed }: { readonly caseId: string; readonly version: number | undefined; readonly onClosed: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [resolution, setResolution] = useState<(typeof RESOLUTIONS)[number]>('RESOLVED');
  const [summary, setSummary] = useState('');
  const close = useCommand(async (body: { resolution: (typeof RESOLUTIONS)[number]; summary: string }, key) => {
    try {
      const res = await request(
        'POST',
        api.cases.POST('/cases/{caseId}/closures', {
          ...commandParams(key, { path: { caseId }, ...(version !== undefined ? { version } : {}) }),
          body,
        }),
      );
      onClosed();
      return res;
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['case', caseId] });
      void queryClient.invalidateQueries({ queryKey: ['cases'] });
      void queryClient.invalidateQueries({ queryKey: ['help-queue'] });
    }
  });
  const locked = close.busy || close.phase.kind === 'done';
  const ok = summary.trim().length >= 1;
  const code = close.phase.kind === 'rejected' ? failureCode(close.phase.failure) : undefined;
  return (
    <form
      className="space-y-3"
      aria-label={closeText.title}
      data-testid="case-close"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (ok) void close.run({ resolution, summary: summary.trim() });
      }}
    >
      <p className="text-sm text-base-content/70">{closeText.intro}</p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-base-content/60">{closeText.resolution}</span>
        <select className="select select-sm w-60" value={resolution} disabled={locked} onChange={(ev) => setResolution(ev.target.value as (typeof RESOLUTIONS)[number])}>
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {name(n.resolution, r)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-base-content/60">{closeText.summary}</span>
        <textarea className="textarea textarea-sm w-full" rows={3} maxLength={2000} value={summary} disabled={locked} onChange={(ev) => setSummary(ev.target.value)} />
      </label>
      <div className="flex justify-end">
        <button type="submit" className="btn btn-sm btn-primary" disabled={!ok || locked}>
          {closeText.submit}
        </button>
      </div>
      {code === 'OPEN_OBLIGATIONS' ? (
        <p role="alert" className="text-sm text-error">{closeText.openObligations}</p>
      ) : code === 'FORBIDDEN' ? (
        <p role="alert" className="text-sm text-error">{closeText.forbidden}</p>
      ) : (
        <CommandFeedback command={close} unknown={{ body: closeText.unknown }}>
          {() => <p className="text-sm text-success">{closeText.done}</p>}
        </CommandFeedback>
      )}
    </form>
  );
}
