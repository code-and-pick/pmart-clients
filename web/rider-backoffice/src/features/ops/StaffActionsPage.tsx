// 직원 조치 이력(2026-11-18, PC 5 — 백엔드 PR #202, 관리자 OPERATOR_ADMIN 만).
// 원천 셋을 함께 불러 시각 내림차순 한 표로:
//   rider `GET /rider-staff-actions`(계정 제한·풀기·제한 검토), execution `GET /delivery-staff-actions`(상태 바로잡기·실패 확정/반려·수행료·추가 배달료),
//   dispatch `GET /dispatch-staff-actions`(운영자 배차 취소). 같은 쿼리(operatorId·riderId·deliveryId·from·to — 기본 7일, 최대 31일·size·cursor), 같은 행.
// 원천마다 쪽(커서)이 따로라, 아직 덜 불러온 원천이 있으면 그 원천의 마지막 시각보다 오래된 줄은 숨기고 "더 불러오기"로 채운다
// (안 그러면 섞은 순서가 틀린다). 한 원천이 실패하면 그 원천만 "불러오지 못함"으로 알리고 나머지는 보인다(실패를 빈 목록으로 보이지 않는다).
// 표시(ADR-0070): 라이더 = RiderName, 배송 = DeliveryNo. 직원은 "이름 · 사번"이 정본이지만 HR 이름 조회가 아직 없어 actorId 그대로(PC 1 에 요청).
import { humanizeCodes } from '../../shared/codeText';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Fragment, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { DataTable, Notice, PageHeader, ResultBar, SearchPanel, SearchRow } from '../../shared/admin';
import { Caret, expandRowProps, InlineDetail, inlineMainButton, inlineSubButton, useInlineOpen } from '../../shared/simList';
import { DeliveryNo, resolveDeliveryId, resolveRiderId, RiderName, StaffName, useDeliveryNumbers, useRiderSummaries } from '../../shared/displayNumbers';
import { useSession } from '../../app/SessionContext';
import { when } from '../../shared/opsUi';

export const actionText = {
  // 2026-11-24 사용자 "조치 감사 기록이란 말 와닿지 않으니까 고쳐" — 직원이 한 처리(계정 제한·상담 결과·수행료…)를 모은 곳
  title: '직원 처리 기록',
  intro: '직원이 라이더·배송에 한 처리를 시간순으로 모아 봐요(계정 제한, 배송 상태 바로잡기, 전달 실패 결정, 수행료·지급, 소명·이의, 배차 취소). 기간을 비우면 최근 7일, 최대 31일이에요.',
  from: '시작일',
  to: '끝일',
  period: '기간',
  who: '누가·누구',
  operatorId: '조치한 직원(ID)',
  riderId: '라이더 번호',
  deliveryId: '배송 번호',
  search: '조회',
  reset: '초기화',
  tooLong: '기간은 최대 31일까지 볼 수 있어요.',
  badRange: '끝일이 시작일보다 앞서요.',
  empty: '이 조건의 조치가 없어요.',
  loading: '불러오는 중…',
  more: '더 불러오기',
  hidden: (n: number) => `더 오래된 조치 ${n}건은 다른 원천을 마저 불러온 뒤 순서대로 보여요.`,
  sourceFailed: (name: string) => `${name} 조치 이력을 불러오지 못했어요 — 표에 빠져 있어요.`,
  retry: '다시 시도',
  col: { at: '시각', action: '조치', actor: '직원', rider: '라이더', delivery: '배송', detail: '결과' },
  source: { rider: '라이더 계정', execution: '배송 수행', dispatch: '배차' },
  // 줄 펼침(2026-11-21 사용자 "배송번호를 눌러야만 상세를 볼 수 있다") — 줄 어디를 눌러도 아래에 그 조치 전부
  // 펼친 칸: 줄에 이미 있는 값(시각·조치·직원·라이더·배송)은 다시 쓰지 않고 결과·사유 전문만, 버튼은 그 정보가 있는 곳으로
  inline: { result: '결과', reason: '사유', none: '—' },
  go: {
    riderSection: { restriction: '계정 제한 보기 ›', reviews: '제한 검토 보기 ›', earnings: '수행료 보기 ›', rider: '라이더 상세 ›' },
    delivery: '배송 상세 ›',
  },
  // 수행료 조정 결과 글("STORE PAY 3200원")의 귀책·결정 코드(서버 감사 글 — 뜻은 그대로, 말만 바꾼다)
  earningCodes: { RIDER: '라이더 귀책', CUSTOMER: '고객 귀책', STORE: '센터(MFC) 귀책', PMART: '본사·시스템 귀책', PAY: '지급', NO_PAY: '미지급' } as Readonly<Record<string, string>>,
  actionName: {
    RESTRICTION_SET: '계정 제한',
    RESTRICTION_LIFTED: '제한 풀기',
    RESTRICTION_REVIEW_DECIDED: '제한 검토 결정',
    STATUS_CORRECTED: '상태 바로잡기',
    FAILURE_CONFIRM: '전달 실패 확정',
    FAILURE_REVERSED: '전달 실패 확정 되돌림',
    FAILURE_REJECT: '전달 실패 반려',
    EARNING_ADJUSTED: '수행료 조정',
    SURCHARGE_APPROVED: '추가 배달료 승인',
    SURCHARGE_REJECTED: '추가 배달료 반려',
    ASSIGNMENT_CANCELLED: '배차 취소',
    PAYOUT_PAYING: '지급 중 표시',
    PAYOUT_PAID: '지급 완료 표시',
    PAYOUT_FAILED: '지급 실패 표시',
    APPEAL_DECIDED: '소명·이의 결정',
    COMPENSATION_RECORDED: '이의 인정 보상금',
  } as Readonly<Record<string, string>>,
} as const;

/** 조치 결과 글을 화면 말로 — 수행료 조정은 귀책·지급 코드와 금액 쉼표도 */
export function actionDetailText(action: string, detail: string): string {
  const base = humanizeCodes(detail);
  if (action !== 'EARNING_ADJUSTED') return base;
  return base
    .replace(/\b(NO_PAY|PAY|RIDER|CUSTOMER|STORE|PMART)\b/g, (c) => actionText.earningCodes[c] ?? c)
    .replace(/(\d{4,})원/g, (_m, d: string) => `${Number(d).toLocaleString('ko-KR')}원`);
}

/** 조치마다 그 정보가 있는 곳 — 라이더 상세의 구역(#sec-…). 그 밖은 라이더 상세 맨 위 */
const RIDER_SECTION: Readonly<Record<string, { readonly id: string; readonly label: string }>> = {
  RESTRICTION_SET: { id: 'sec-restriction-history', label: actionText.go.riderSection.restriction },
  RESTRICTION_LIFTED: { id: 'sec-restriction-history', label: actionText.go.riderSection.restriction },
  RESTRICTION_REVIEW_DECIDED: { id: 'sec-reviews', label: actionText.go.riderSection.reviews },
  EARNING_ADJUSTED: { id: 'sec-earnings', label: actionText.go.riderSection.earnings },
  SURCHARGE_APPROVED: { id: 'sec-earnings', label: actionText.go.riderSection.earnings },
  SURCHARGE_REJECTED: { id: 'sec-earnings', label: actionText.go.riderSection.earnings },
  PAYOUT_PAYING: { id: 'sec-earnings', label: actionText.go.riderSection.earnings },
  PAYOUT_PAID: { id: 'sec-earnings', label: actionText.go.riderSection.earnings },
  PAYOUT_FAILED: { id: 'sec-earnings', label: actionText.go.riderSection.earnings },
  COMPENSATION_RECORDED: { id: 'sec-earnings', label: actionText.go.riderSection.earnings },
};

type SourceKey = keyof typeof actionText.source;
const SOURCES: readonly SourceKey[] = ['rider', 'execution', 'dispatch'];

export interface StaffActionRow {
  readonly at: string;
  readonly actorId: string;
  readonly action: string;
  readonly riderId?: string | null;
  readonly deliveryId?: string | null;
  readonly detail?: string | null;
  readonly reason?: string | null;
}

interface ActionPage {
  readonly items: readonly StaffActionRow[];
  readonly nextCursor?: string | null;
}

/** Asia/Seoul 날짜(YYYY-MM-DD) → 그날 0시(+09:00). [nextDay] 면 다음 날 0시(끝일 포함). */
export function seoulDayStart(day: string, nextDay = false): string {
  const d = new Date(`${day}T00:00:00+09:00`);
  if (nextDay) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

const DAY = 86_400_000;

/** 기간 확인 — 계약: 최대 31일. 비면 서버 기본(최근 7일). */
export function rangeProblem(from: string, to: string): string | null {
  if (!from || !to) return null;
  const span = new Date(seoulDayStart(to, true)).getTime() - new Date(seoulDayStart(from)).getTime();
  if (span <= 0) return actionText.badRange;
  if (span > 31 * DAY) return actionText.tooLong;
  return null;
}

/**
 * 원천별로 불러온 쪽을 시각 내림차순으로 섞는다. 아직 더 있는 원천의 마지막 시각보다 오래된 줄은 숨긴다
 * (그 사이에 그 원천의 다음 쪽 줄이 끼어들 수 있으므로).
 */
export function mergeActions(pages: ReadonlyArray<{ readonly rows: readonly StaffActionRow[]; readonly hasMore: boolean }>) {
  const all = pages.flatMap((p) => p.rows).toSorted((a, b) => b.at.localeCompare(a.at));
  const bounds = pages.filter((p) => p.hasMore && p.rows.length > 0).map((p) => p.rows.at(-1)!.at);
  const floor = bounds.length > 0 ? bounds.toSorted().at(-1)! : null;
  const shown = floor === null ? all : all.filter((r) => r.at >= floor);
  return { shown, hidden: all.length - shown.length };
}

export function StaffActionsMenu() {
  const api = useApi();
  const t = actionText;
  const [params, setParams] = useSearchParams();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const operatorId = params.get('operatorId') ?? '';
  const riderId = params.get('riderId') ?? '';
  const deliveryId = params.get('deliveryId') ?? '';
  const [form, setForm] = useState({ from, to, operatorId, riderId, deliveryId });
  const problem = rangeProblem(from, to);
  const query = {
    size: 50,
    ...(from ? { from: seoulDayStart(from) } : {}),
    ...(to ? { to: seoulDayStart(to, true) } : {}),
    ...(operatorId ? { operatorId } : {}),
    ...(riderId ? { riderId } : {}),
    ...(deliveryId ? { deliveryId } : {}),
  };
  // 찾기 칸은 화면 번호로(ADR-0070) — 라이더 번호(R4785)·배송 번호(D74939255)를 시스템 ID 로 바꿔 부른다. 맞는 대상이 없으면 빈 목록.
  const resolveQuery = async () => {
    const rid = riderId ? await resolveRiderId(api, riderId) : '';
    const did = deliveryId ? await resolveDeliveryId(api, deliveryId) : '';
    if (rid === null || did === null) return null;
    return {
      size: 50,
      ...(from ? { from: seoulDayStart(from) } : {}),
      ...(to ? { to: seoulDayStart(to, true) } : {}),
      ...(operatorId ? { operatorId } : {}),
      ...(rid ? { riderId: rid } : {}),
      ...(did ? { deliveryId: did } : {}),
    };
  };
  const none: ActionPage = { items: [], nextCursor: null };
  const fetchers: Record<SourceKey, (cursor: string | undefined) => Promise<ActionPage>> = {
    rider: async (cursor) => {
      const q = await resolveQuery();
      return q ? request('GET', api.riders.GET('/rider-staff-actions', { params: { query: { ...q, ...(cursor ? { cursor } : {}) } } })) : none;
    },
    execution: async (cursor) => {
      const q = await resolveQuery();
      return q ? request('GET', api.execution.GET('/delivery-staff-actions', { params: { query: { ...q, ...(cursor ? { cursor } : {}) } } })) : none;
    },
    dispatch: async (cursor) => {
      const q = await resolveQuery();
      return q ? request('GET', api.dispatch.GET('/dispatch-staff-actions', { params: { query: { ...q, ...(cursor ? { cursor } : {}) } } })) : none;
    },
  };
  const sources = {
    rider: useSource('rider', query, fetchers.rider, !problem),
    execution: useSource('execution', query, fetchers.execution, !problem),
    dispatch: useSource('dispatch', query, fetchers.dispatch, !problem),
  };
  const loaded = SOURCES.filter((s) => sources[s].data);
  const { shown, hidden } = mergeActions(
    loaded.map((s) => {
      const q = sources[s];
      const rows = (q.data?.pages ?? []).flatMap((p) => p.items);
      return { rows, hasMore: !!q.hasNextPage };
    }),
  );
  const riders = useRiderSummaries(shown.map((r) => r.riderId));
  // 배송 번호(D74939255)로 — 시스템 ID 끝자리와 "번호 없음"만 보이던 것(2026-11-24 "알 수 없는 값")
  const deliveryNos = useDeliveryNumbers(shown.map((r) => r.deliveryId));
  const me = useSession().session?.subject;
  const failed = SOURCES.filter((s) => sources[s].isError);
  const inline = useInlineOpen();
  const loading = SOURCES.some((s) => sources[s].isPending && !sources[s].isError) && !problem;
  const canMore = SOURCES.some((s) => sources[s].hasNextPage);
  const moreBusy = SOURCES.some((s) => sources[s].isFetchingNextPage);

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) if (v.trim()) p.set(k, v.trim());
    setParams(p);
  };
  const reset = () => {
    setForm({ from: '', to: '', operatorId: '', riderId: '', deliveryId: '' });
    setParams({});
  };
  /** 칩 ✕ — 조건 하나만 풀기(입력 칸도 비운다) */
  const clearOne = (k: keyof typeof form) => {
    setForm((f) => ({ ...f, [k]: '' }));
    const p = new URLSearchParams(params);
    p.delete(k);
    setParams(p);
  };
  const input = (k: keyof typeof form, label: string, type: 'date' | 'text' = 'text') => (
    <label className="flex items-center gap-2 text-sm">
      <span className="whitespace-nowrap text-base-content/60">{label}</span>
      <input type={type} className="input input-sm w-44" maxLength={64} value={form[k]} onChange={(ev) => setForm((f) => ({ ...f, [k]: ev.target.value }))} />
    </label>
  );

  return (
    <section className="max-w-[1600px] space-y-4">
      <PageHeader title={t.title} description={t.intro} />
      {/* 시뮬레이터 모양(2026-11-21): 라이더·배송은 왼쪽 찾기 칸, 기간·직원은 깔때기 팝업, 건 조건은 칩(✕ = 그 조건만 풀기) */}
      <SearchPanel
        onSubmit={submit}
        onReset={reset}
        submitLabel={t.search}
        resetLabel={t.reset}
        summary={(['from', 'to', 'operatorId', 'riderId', 'deliveryId'] as const).map((k) => [t[k], params.get(k) ?? '', () => clearOne(k)] as const)}
        search={
          <>
            <input type="search" className="input input-sm w-48" maxLength={64} value={form.riderId} placeholder={t.riderId} aria-label={t.riderId} onChange={(ev) => setForm((f) => ({ ...f, riderId: ev.target.value }))} />
            <input type="search" className="input input-sm w-52" maxLength={64} value={form.deliveryId} placeholder={t.deliveryId} aria-label={t.deliveryId} onChange={(ev) => setForm((f) => ({ ...f, deliveryId: ev.target.value }))} />
          </>
        }
      >
        <SearchRow label={t.period}>
          {input('from', t.from, 'date')}
          {input('to', t.to, 'date')}
        </SearchRow>
        <SearchRow label={t.who}>{input('operatorId', t.operatorId)}</SearchRow>
      </SearchPanel>
      {problem && (
        <p role="alert" className="alert alert-warning text-sm" data-testid="range-problem">
          {problem}
        </p>
      )}
      {failed.map((s) => (
        <div key={s} role="alert" className="alert alert-error flex flex-wrap justify-between text-sm" data-testid={`source-failed-${s}`}>
          <span>{t.sourceFailed(t.source[s])}</span>
          <button type="button" className="btn btn-xs" onClick={() => void sources[s].refetch()}>
            {t.retry}
          </button>
        </div>
      ))}
      {!problem && loading && <p className="text-sm text-base-content/60">{t.loading}</p>}
      {!problem && !loading && loaded.length > 0 && (
        <div className="space-y-3">
          <ResultBar count={shown.length} more={canMore} />
          {shown.length === 0 && failed.length === 0 ? (
            <Notice>{t.empty}</Notice>
          ) : (
            <DataTable testId="staff-actions">
              <thead>
                <tr>
                  <th>{t.col.at}</th>
                  <th>{t.col.action}</th>
                  <th>{t.col.actor}</th>
                  <th>{t.col.rider}</th>
                  <th>{t.col.delivery}</th>
                  <th>{t.col.detail}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => {
                  const s = r.riderId ? riders.get(r.riderId) : undefined;
                  const k = `${r.at}-${r.action}-${r.deliveryId ?? r.riderId ?? ''}-${i}`;
                  const isOpen = inline.isOpen(k);
                  const riderPath = r.riderId ? `/riders/${encodeURIComponent(r.riderId)}` : undefined;
                  const deliveryPath = r.deliveryId ? `/deliveries/${encodeURIComponent(r.deliveryId)}` : undefined;
                  return (
                    <Fragment key={k}>
                    <tr data-testid="staff-action-row" {...expandRowProps(isOpen, () => inline.toggle(k))}>
                      <td className="whitespace-nowrap">
                        <Caret open={isOpen} />
                        {when(r.at)}
                      </td>
                      <td className="whitespace-nowrap font-medium">{t.actionName[r.action] ?? r.action}</td>
                      <td><StaffName operatorId={r.actorId} me={me} /></td>
                      <td>
                        {r.riderId ? (
                          <Link to={`/riders/${encodeURIComponent(r.riderId)}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                            <RiderName riderId={r.riderId} nameMasked={s?.nameMasked} riderNumber={s?.riderNumber} />
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {r.deliveryId ? (
                          <Link to={`/deliveries/${encodeURIComponent(r.deliveryId)}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                            <DeliveryNo deliveryId={r.deliveryId} deliveryNumber={deliveryNos.get(r.deliveryId)?.deliveryNumber} orderNumber={deliveryNos.get(r.deliveryId)?.orderNumber} />
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      {/* 목록에는 결과만 — 사유는 줄을 펼친 칸에서(2026-11-24 사용자 "사유는 상세에 들어가야 뜨는 걸로") */}
                      <td className="text-xs">{r.detail ? actionDetailText(r.action, r.detail) : '—'}</td>
                    </tr>
                    {isOpen && (
                      <InlineDetail
                        colSpan={6}
                        testId="staff-action-inline"
                        actions={
                          <>
                            {riderPath && (
                              <Link className="btn btn-sm border-0" style={inlineMainButton} to={`${riderPath}#${RIDER_SECTION[r.action]?.id ?? 'sec-info'}`}>
                                {RIDER_SECTION[r.action]?.label ?? t.go.riderSection.rider}
                              </Link>
                            )}
                            {deliveryPath && (
                              <Link className="btn btn-sm" style={inlineSubButton} to={deliveryPath}>
                                {t.go.delivery}
                              </Link>
                            )}
                          </>
                        }
                      >
                        {/* 2026-11-24 사용자 "아까 정보는 잘 뜨던데 겹쳐서 문제였지. 지금은 정보를 다 날려 버렸네" — 정보는 전부 다시,
                            겹친 건 좁은 칸(11rem) 때문이라 넓은 칸(최소 16rem)에 값은 줄바꿈 허용 */}
                        <dl className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-x-8 gap-y-4" data-testid="staff-action-fields">
                          {(
                            [
                              [t.col.at, when(r.at)],
                              [t.col.action, t.actionName[r.action] ?? r.action],
                              [t.col.actor, <StaffName operatorId={r.actorId} me={me} />],
                              [t.col.rider, r.riderId ? <RiderName riderId={r.riderId} nameMasked={s?.nameMasked} riderNumber={s?.riderNumber} /> : t.inline.none],
                              [
                                t.col.delivery,
                                r.deliveryId ? (
                                  <DeliveryNo deliveryId={r.deliveryId} deliveryNumber={deliveryNos.get(r.deliveryId)?.deliveryNumber} orderNumber={deliveryNos.get(r.deliveryId)?.orderNumber} />
                                ) : (
                                  t.inline.none
                                ),
                              ],
                              [t.inline.result, r.detail ? actionDetailText(r.action, r.detail) : t.inline.none],
                              [t.inline.reason, r.reason ? <span className="whitespace-pre-wrap">{r.reason}</span> : t.inline.none],
                            ] as const
                          ).map(([k, v]) => (
                            <div key={k} className="min-w-0 border-l border-base-300 pl-4">
                              <dt className="text-xs font-medium text-base-content/55">{k}</dt>
                              <dd className="mt-0.5 break-words text-[15px] font-semibold">{v}</dd>
                            </div>
                          ))}
                        </dl>
                      </InlineDetail>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </DataTable>
          )}
          {hidden > 0 && <p className="text-xs text-base-content/60">{t.hidden(hidden)}</p>}
          {canMore && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={moreBusy}
              onClick={() => {
                for (const s of SOURCES) if (sources[s].hasNextPage) void sources[s].fetchNextPage();
              }}
            >
              {t.more}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function useSource(key: SourceKey, query: object, fetchPage: (cursor: string | undefined) => Promise<ActionPage>, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['staff-actions', key, query],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
