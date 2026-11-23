// 지급 관리(2026-11-19, PC 5 — 백엔드 execution 0.29.0, 사용자 "결과 받는 창구 + 수동 표시").
// 지급 실행은 외부 회계 — 이 화면은 회계 결과를 수동으로 표시한다. 묶음 = 라이더 1명 × 지급 예정일(확정 수행료).
// - 보기: `GET /rider-payouts?payoutDate&riderId&state`(RIDER_OPS·OPERATOR_ADMIN). payoutDate 기본 = 오늘(서버, Asia/Seoul).
// - 결과 표시: `POST /rider-payouts/{riderId}/{payoutDate}/results`(OPERATOR_ADMIN 만) — PAYING·PAID·FAILED(사유 필수).
//   예정일 전 PAYING·PAID 는 422 PAYOUT_NOT_DUE, 바꿀 줄이 없으면 409. 라이더 알림함은 PAID·PAYMENT_FAILED 를 묶음마다 한 번(서버).
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, uiStateFromError, useCommand, type UiState } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import { useApi } from '../../app/ApiContext';
import { isOperatorAdmin } from '../../app/nav';
import { useSession } from '../../app/SessionContext';
import { ChipGroup, DataTable, PageHeader, ResultBar, SearchPanel, SearchRow, StatusBadge, type Tone } from '../../shared/admin';
import { SavedViews } from '../../shared/SavedViews';
import { DeliveryRef, resolveRiderId, RiderName, searchHint, StaffName, useDeliveryNumbers, useRiderSummaries, RIDER_NUMBER } from '../../shared/displayNumbers';
import { isAdjustedEarning } from '../../shared/adjustedTag';
import { when, won } from '../../shared/opsUi';
import { Caret, expandRowProps, InlineDetail, useInlineOpen } from '../../shared/simList';
import { RiderDeliveriesButton, RiderInline } from '../riders/RiderPages';

export const payoutText = {
  title: '지급 관리',
  intro: '지급은 외부 회계가 해요. 회계 결과를 여기서 표시하면 라이더 정산 내역과 알림에 반영돼요. 묶음 = 라이더 한 명의 같은 지급 예정일 수행료.',
  date: '지급 예정일',
  rider: searchHint.rider,
  state: '상태',
  all: '전체',
  search: '조회',
  reset: '초기화',
  empty: '이 조건의 지급 묶음이 없어요.',
  col: { rider: '라이더', date: '지급 예정일', count: '건수', total: '합계', state: '상태', last: '마지막 표시', act: '결과 표시' },
  stateName: { CONFIRMED: '확정(지급 전)', PAYING: '지급 중', PAID: '지급 완료', PAYMENT_FAILED: '지급 실패', MIXED: '섞임' } as Readonly<Record<string, string>>,
  resultName: { PAYING: '지급 중', PAID: '지급 완료', FAILED: '지급 실패' } as Readonly<Record<string, string>>,
  pick: '결과',
  reference: '회계 처리 번호(있으면)',
  failureReason: '실패 사유(필수, 계좌번호 등 개인정보 금지)',
  record: '표시',
  recorded: (s: string) => `${s}(으)로 표시했어요.`,
  doneLine: (rider: string, date: string, s: string) => `${rider} · ${date} 묶음을 ${s}(으)로 표시했어요.`,
  adminOnly: '관리자만 표시할 수 있어요',
  compensations: (n: number) => `(보상 ${n})`,
  adjustedCount: (n: number) => `조정 ${n}`,
  normalCount: (n: number) => `정상 ${n}`,
  kind: '수행료 구분',
  kindName: { normal: '정상', adjusted: '조정' } as const,
  kindEmpty: (k: string) => `이 날짜에 ${k} 수행료가 든 묶음이 없어요.`,
  kindUnknown: (n: number) => `${n}개 묶음은 수행료를 불러오지 못해 구분 없이 그대로 보여요.`,
  lastLine: (result: string, at: string) => `${result} · ${at} ·`,
  items: {
    title: '이 묶음의 배송',
    col: { delivery: '배송', order: '주문번호', kind: '종류', amount: '금액' },
    earning: '정상 수행료',
    adjustedEarning: '조정 수행료',
    compensation: '보상금',
    empty: '이 묶음의 배송을 찾지 못했어요',
    partial: (found: number, count: number) => `묶음 ${count}건 중 ${found}건만 찾았어요 — 오래전 배송을 늦게 조정한 건은 여기 안 보일 수 있어요`,
  },
} as const;

/** 묶음에 든 지급 상태(지급 예정일이 같아도 산정 전·조정 대기는 묶음이 아니다 — 계약 /rider-payouts 설명) */
const BUNDLED = new Set(['CONFIRMED', 'PAYING', 'PAID', 'PAYMENT_FAILED']);
/** 지급 예정일 = 수행일 + 3영업일이라, 그 앞 31일 수행분에서 찾는다(조정으로 늦게 확정된 오래된 건은 빠질 수 있어 건수를 맞춰 본다). */
const LOOKBACK_DAYS = 31;
function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * 지급 묶음 안의 배송(2026-11-24 사용자 "지급 관리에 어떤 주문건에 관한 지급인지 볼 수가 없네").
 * 묶음 조회(/rider-payouts)에는 건 목록이 없어, 같은 라이더의 수행료(/rider-earnings, 수행일 기간)와 보상금(/rider-compensations)에서
 * payoutDate 가 같은 묶음 상태 건을 모은다. 찾은 수가 묶음 건수와 다르면 그대로 알린다(다 찾은 척 하지 않는다).
 */
/** 묶음 건 조회(펼친 칸과 줄의 "조정 n"이 같은 캐시를 쓴다) */
/** 묶음의 수행료 조회(줄의 정상·조정 수, 펼친 칸, 구분 거르기가 같은 캐시를 쓴다) */
function earningsQuery(api: ReturnType<typeof useApi>, riderId: string, payoutDate: string) {
  return {
    queryKey: ['payout-earnings', riderId, payoutDate],
    queryFn: () =>
      request('GET', api.execution.GET('/rider-earnings', { params: { query: { riderId, from: daysBefore(payoutDate, LOOKBACK_DAYS), to: payoutDate, size: 200 } } })),
  };
}

type EarningItem = { readonly payoutDate?: string | null; readonly settlementState?: string | null; readonly adjustmentRef?: string | null; readonly note?: string | null };
/** 그 묶음(지급 예정일)의 정상·조정 수 */
function kindCounts(items: readonly EarningItem[], payoutDate: string): { readonly normal: number; readonly adjusted: number } {
  const mine = items.filter((it) => it.payoutDate === payoutDate && BUNDLED.has(it.settlementState ?? ''));
  const adjusted = mine.filter((it) => isAdjustedEarning(it)).length;
  return { normal: mine.length - adjusted, adjusted };
}

type KindFilter = '' | 'normal' | 'adjusted';

function usePayoutSources(riderId: string, payoutDate: string) {
  const api = useApi();
  return useQueries({
    queries: [
      earningsQuery(api, riderId, payoutDate),
      {
        queryKey: ['payout-compensations', riderId],
        queryFn: () => request('GET', api.execution.GET('/rider-compensations', { params: { query: { riderId } } })),
      },
    ],
  });
}

/**
 * 지급 관리 줄의 "조정 n"(2026-11-24 사용자 "지급관리에 조정한 수행료인지 정상지급 수행료인지 이건 계속 안 뜨네") — 줄을 펼치지 않아도
 * 그 묶음에 조정한 수행료가 몇 건인지. 못 읽거나 읽는 중이면 아무것도 붙이지 않는다(0 으로 보이지 않게).
 */
/**
 * 지급 관리 줄의 정상·조정 수(2026-11-24 사용자 "정상수행료인지 조정수행료인지 뜨게 하라고") — 조정이 없는 묶음도 "정상 2"처럼
 * 늘 적는다(전에는 조정이 있을 때만 붙어 정상 묶음에는 아무 표시가 없었다). 못 읽거나 읽는 중이면 적지 않는다(0 으로 보이지 않게).
 */
function EarningKinds({ riderId, payoutDate }: { readonly riderId: string; readonly payoutDate: string }) {
  const [earnings] = usePayoutSources(riderId, payoutDate);
  if (!earnings.data) return null;
  const { normal, adjusted } = kindCounts(earnings.data.items ?? [], payoutDate);
  // 0 인 쪽은 적지 않는다(2026-11-24 사용자 "정상1 조정0 이렇게 되어있는데 0인 건 표시 안 해도 될 것 같아")
  if (normal === 0 && adjusted === 0) return null;
  return (
    <span className="mt-0.5 flex justify-end gap-1 text-[11px]" data-testid="payout-kinds">
      {normal > 0 && <span className="rounded border border-base-300 px-1 py-px text-base-content/70">{payoutText.normalCount(normal)}</span>}
      {adjusted > 0 && (
        <span className="rounded border border-warning/50 px-1 py-px font-semibold text-warning" data-testid="payout-adjusted-count">
          {payoutText.adjustedCount(adjusted)}
        </span>
      )}
    </span>
  );
}

function PayoutItems({ riderId, payoutDate, count, kind = '' }: { readonly riderId: string; readonly payoutDate: string; readonly count: number; readonly kind?: KindFilter }) {
  const t = payoutText.items;
  const [earnings, comps] = usePayoutSources(riderId, payoutDate);
  const rows = [
    ...(earnings.data?.items ?? [])
      .filter((it) => it.payoutDate === payoutDate && BUNDLED.has(it.settlementState ?? ''))
      .map((it) => ({ key: `e-${it.earningId}`, deliveryId: it.deliveryId, kind: isAdjustedEarning(it) ? t.adjustedEarning : t.earning, amount: it.total, adjusted: isAdjustedEarning(it) })),
    ...(comps.data?.items ?? [])
      .filter((it) => it.payoutDate === payoutDate && BUNDLED.has(it.settlementState))
      .map((it) => ({ key: `c-${it.compensationId}`, deliveryId: it.deliveryId, kind: t.compensation, amount: it.amount, adjusted: false })),
  ];
  // 수행료 구분으로 걸렀으면 그 종류만(보상금은 수행료가 아니라 뺀다)
  const shownRows = kind === '' ? rows : rows.filter((r) => r.key.startsWith('e-') && (kind === 'adjusted' ? r.adjusted : !r.adjusted));
  const numbers = useDeliveryNumbers(shownRows.map((r) => r.deliveryId));
  const loading = earnings.isPending || comps.isPending;
  const failed = earnings.isError || comps.isError;
  return (
    <div data-testid="payout-items">
      <h4>{t.title}</h4>
      <QueryState
        state={loading ? { kind: 'loading' } : failed ? uiStateFromError(earnings.error ?? comps.error) : shownRows.length === 0 ? { kind: 'empty' } : { kind: 'ready', data: shownRows }}
        onRetry={() => {
          void earnings.refetch();
          void comps.refetch();
        }}
        emptyText={t.empty}
      >
        {() => (
          <>
            <table className="table table-sm w-auto min-w-[28rem] bg-base-100">
              <thead>
                <tr>
                  <th>{t.col.delivery}</th>
                  <th>{t.col.order}</th>
                  <th>{t.col.kind}</th>
                  <th className="text-right">{t.col.amount}</th>
                </tr>
              </thead>
              <tbody>
                {shownRows.map((r) => {
                  const no = numbers.get(r.deliveryId ?? '');
                  return (
                    <tr key={r.key} data-testid="payout-item">
                      <td>
                        <DeliveryRef deliveryId={r.deliveryId} numbers={no} />
                      </td>
                      <td className="font-mono">{no?.orderNumber ?? '—'}</td>
                      <td>
                        <span className={r.adjusted ? 'font-semibold text-warning' : undefined} data-testid={r.adjusted ? 'payout-item-adjusted' : undefined}>
                          {r.kind}
                        </span>
                      </td>
                      <td className="text-right tabular-nums">{typeof r.amount === 'number' ? won(r.amount) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {kind === '' && rows.length !== count && (
              <p className="mt-2 text-xs text-warning" data-testid="payout-items-partial">
                {t.partial(rows.length, count)}
              </p>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}

/** 오늘(Asia/Seoul) YYYY-MM-DD — 날짜 칸 기본값(표시용) */
function seoulToday(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

type PayoutState = 'CONFIRMED' | 'PAYING' | 'PAID' | 'PAYMENT_FAILED';
const STATES: readonly PayoutState[] = ['CONFIRMED', 'PAYING', 'PAID', 'PAYMENT_FAILED'];
type Result = 'PAYING' | 'PAID' | 'FAILED';

const stateTone = (s: string): Tone => (s === 'PAID' ? 'success' : s === 'PAYMENT_FAILED' ? 'error' : s === 'PAYING' ? 'info' : s === 'MIXED' ? 'warning' : 'ghost');

export function PayoutsMenu() {
  const api = useApi();
  const { session } = useSession();
  const admin = isOperatorAdmin(session?.roles ?? []);
  const t = payoutText;
  const [params, setParams] = useSearchParams();
  const payoutDate = params.get('payoutDate') ?? '';
  const riderId = params.get('riderId') ?? '';
  const rawState = params.get('state');
  const state = STATES.find((s) => s === rawState) ?? 'ALL';
  // 수행료 구분 거르기(2026-11-24 사용자 "필터에 조정인지 정상 수행료인지 거를 수 있게") — 묶음 안 수행료를 보고 화면에서 거른다(서버 조회 조건에는 없음)
  const rawKind = params.get('kind');
  const kind: KindFilter = rawKind === 'normal' || rawKind === 'adjusted' ? rawKind : '';
  // 칸에는 늘 날짜가 보이게 — 비어 있으면 오늘(서울)(2026-11-24 사용자 "비우면 오늘이라고 적은 거 지우고 검색탭에 오늘 날짜를 2026-11-24 이렇게 적어")
  const [dateInput, setDateInput] = useState(payoutDate || seoulToday());
  const [riderInput, setRiderInput] = useState(riderId);
  const patch = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p);
  };
  const list = useQuery({
    queryKey: ['rider-payouts', payoutDate, riderId, state],
    queryFn: async () => {
      // 라이더 번호(R4785)로도 찾는다(ADR-0070) — 맞는 라이더가 없으면 빈 목록
      const rid = riderId ? await resolveRiderId(api, riderId) : '';
      if (rid === null) return { items: [] };
      return request(
        'GET',
        api.execution.GET('/rider-payouts', {
          params: { query: { ...(payoutDate ? { payoutDate } : {}), ...(rid ? { riderId: rid } : {}), ...(state === 'ALL' ? {} : { state }) } },
        }),
      );
    },
  });
  // 구분 거르기: 묶음마다 수행료를 읽어(펼친 칸과 같은 캐시) 고른 종류가 있는 묶음만. 읽는 중이면 기다리고, 못 읽은 묶음은 빼지 않고 알린다.
  const bundles = list.data?.items ?? [];
  const kindQs = useQueries({ queries: kind === '' ? [] : bundles.map((p) => earningsQuery(api, p.riderId, p.payoutDate)) });
  const kindLoading = kind !== '' && kindQs.some((q) => q.isPending);
  const unknownKinds = kind === '' ? 0 : kindQs.filter((q) => q.isError).length;
  const kindItems =
    kind === ''
      ? bundles
      : bundles.filter((p, i) => {
          const q = kindQs[i];
          if (!q?.data) return true; // 못 읽은 묶음은 남긴다(구분 모름 안내)
          const c = kindCounts(q.data.items ?? [], p.payoutDate);
          return kind === 'adjusted' ? c.adjusted > 0 : c.normal > 0;
        });
  const kindState: UiState<{ readonly items: typeof bundles }> =
    list.isSuccess && !kindLoading ? (kindItems.length === 0 ? { kind: 'empty' } : { kind: 'ready', data: { items: kindItems } }) : kindLoading ? { kind: 'loading' } : toUiState(list, (x) => x.items.length === 0);
  // 줄을 누르면 아래에 라이더 요약(한 번에 한 줄)
  const inline = useInlineOpen();
  // 표시가 끝나면 줄이 바뀌어(지급 완료 → 입력 칸 없음) 줄 안 알림이 사라지므로 위에 남긴다.
  const [done, setDone] = useState<string | null>(null);
  const riders = useRiderSummaries((list.data?.items ?? []).map((p) => p.riderId));
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    patch({ payoutDate: dateInput, riderId: riderInput.trim() });
  };
  const reset = () => {
    setDateInput(seoulToday());
    setRiderInput('');
    setParams({});
  };
  return (
    <section className="max-w-[1600px] space-y-4">
      <PageHeader title={t.title} description={t.intro} actions={<SavedViews listKey="payouts" />} />
      {done && (
        <p role="status" className="alert alert-success text-sm" data-testid="payout-done">
          {done}
        </p>
      )}
      <SearchPanel
        onSubmit={submit}
        onReset={reset}
        submitLabel={t.search}
        resetLabel={t.reset}
        // 지급 예정일은 찾기 줄 날짜 칸에 늘 보여 칩·필터 개수에 넣지 않는다(2026-11-24 사용자 "지급 관리에 날짜가 왜 필터야?")
        summary={[
          [t.state, state === 'ALL' ? '' : (t.stateName[state] ?? state), () => patch({ state: '' })],
          [t.kind, kind === '' ? '' : t.kindName[kind], () => patch({ kind: '' })],
          ['라이더', riderId ? (RIDER_NUMBER.test(riderId) ? riderId : '한 라이더') : '', () => {
            setRiderInput('');
            patch({ riderId: '' });
          }],
        ]}
        // 왼쪽 찾기 칸(시뮬레이터처럼) — 라이더 번호·지급일. 지급 상태는 깔때기 팝업
        search={
          <>
            <input type="search" className="input input-sm w-48" maxLength={64} value={riderInput} placeholder={t.rider} aria-label={t.rider} onChange={(ev) => setRiderInput(ev.target.value)} />
            <input type="date" className="input input-sm w-40" aria-label={t.date} value={dateInput} onChange={(ev) => setDateInput(ev.target.value)} />
          </>
        }
      >
        <SearchRow label={t.state}>
          <ChipGroup
            label={t.state}
            value={state}
            options={[{ value: 'ALL' as const, label: t.all }, ...STATES.map((s) => ({ value: s, label: t.stateName[s] ?? s }))]}
            onChange={(s) => patch({ state: s === 'ALL' ? '' : s })}
          />
        </SearchRow>
        <SearchRow label={t.kind}>
          <ChipGroup
            label={t.kind}
            value={kind === '' ? 'ALL' : kind}
            options={[{ value: 'ALL' as const, label: t.all }, { value: 'normal' as const, label: t.kindName.normal }, { value: 'adjusted' as const, label: t.kindName.adjusted }]}
            onChange={(k) => patch({ kind: k === 'ALL' ? '' : k })}
          />
        </SearchRow>

      </SearchPanel>
      <QueryState state={kindState} onRetry={() => void list.refetch()} emptyText={kind === '' ? t.empty : t.kindEmpty(t.kindName[kind])}>
        {(x) => (
          <div className="space-y-3">
            <ResultBar count={x.items.length} />
            {unknownKinds > 0 && (
              <p role="note" className="text-xs text-warning" data-testid="payout-kind-unknown">
                {t.kindUnknown(unknownKinds)}
              </p>
            )}
            <DataTable testId="payouts">
              <thead>
                <tr>
                  <th>{t.col.rider}</th>
                  <th>{t.col.date}</th>
                  <th className="text-right">{t.col.count}</th>
                  <th className="text-right">{t.col.total}</th>
                  <th>{t.col.state}</th>
                  <th>{t.col.last}</th>
                  <th>{t.col.act}</th>
                </tr>
              </thead>
              <tbody>
                {x.items.map((p) => {
                  const s = riders.get(p.riderId);
                  const last = p.lastResult;
                  // 2026-11-23 사용자 "지급관리 라이더 클릭해도 안 열려" — 줄을 누르면 아래에 라이더 요약(정산계좌 포함), 번호는 라이더 상세로
                  const k = `${p.riderId}-${p.payoutDate}`;
                  const isOpen = inline.isOpen(k);
                  const to = `/riders/${encodeURIComponent(p.riderId)}`;
                  return (
                    <Fragment key={k}>
                    <tr data-testid="payout-row" {...expandRowProps(isOpen, () => inline.toggle(k))}>
                      <td className="whitespace-nowrap">
                        <Caret open={isOpen} />
                        <Link className="hover:underline" to={to} onClick={(e) => e.stopPropagation()} data-testid="payout-rider-link">
                          <RiderName riderId={p.riderId} nameMasked={s?.nameMasked} riderNumber={s?.riderNumber} />
                        </Link>
                      </td>
                      <td className="whitespace-nowrap">{p.payoutDate}</td>
                      <td className="text-right">
                        {p.count}
                        {p.compensationCount ? <span className="ml-1 text-xs text-base-content/60">{t.compensations(p.compensationCount)}</span> : null}
                        <EarningKinds riderId={p.riderId} payoutDate={p.payoutDate} />
                      </td>
                      <td className="text-right font-semibold">{won(p.total)}</td>
                      <td>
                        <StatusBadge tone={stateTone(p.state)}>{t.stateName[p.state] ?? p.state}</StatusBadge>
                      </td>
                      <td className="text-xs">
                        {last?.result ? (
                          <>
                            <p>
                              {t.lastLine(t.resultName[last.result] ?? last.result, when(last.recordedAt))} <StaffName operatorId={last.recordedBy} me={session?.subject} />
                            </p>
                            {last.reference && <p className="font-mono text-base-content/60">{last.reference}</p>}
                            {last.failureReason && <p className="text-error">{last.failureReason}</p>}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{p.state === 'PAID' ? '—' : admin ? <PayoutResultForm riderId={p.riderId} payoutDate={p.payoutDate} onDone={(r) => setDone(t.doneLine(s?.riderNumber ?? p.riderId, p.payoutDate, t.stateName[r.state] ?? r.state))} /> : <span className="text-xs text-base-content/50">{t.adminOnly}</span>}</td>
                    </tr>
                    {isOpen && (
                      <InlineDetail colSpan={7} to={to} testId="payout-inline" actions={<RiderDeliveriesButton riderId={p.riderId} />}>
                        <RiderInline riderId={p.riderId} lead={<PayoutItems riderId={p.riderId} payoutDate={p.payoutDate} count={p.count} kind={kind} />} />
                      </InlineDetail>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </DataTable>
          </div>
        )}
      </QueryState>
    </section>
  );
}

function PayoutResultForm({ riderId, payoutDate, onDone }: { readonly riderId: string; readonly payoutDate: string; readonly onDone: (p: { readonly state: string }) => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const t = payoutText;
  const [result, setResult] = useState<Result | ''>('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const record = useCommand(async (body: { result: Result; reference?: string; failureReason?: string }, key) => {
    try {
      const res = await request('POST', api.execution.POST('/rider-payouts/{riderId}/{payoutDate}/results', { ...commandParams(key, { path: { riderId, payoutDate } }), body }));
      onDone(res);
      return res;
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['rider-payouts'] });
    }
  });
  const ok = result !== '' && (result !== 'FAILED' || reason.trim().length >= 2);
  const locked = record.busy || record.phase.kind === 'done';
  return (
    <form
      className="min-w-72 space-y-1"
      aria-label={`지급 결과 표시 ${riderId} ${payoutDate}`}
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!ok) return;
        void record.run({
          result,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          ...(result === 'FAILED' ? { failureReason: reason.trim() } : {}),
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <select className="select select-xs w-28" aria-label={t.pick} value={result} disabled={locked} onChange={(ev) => setResult(ev.target.value as Result | '')}>
          <option value="">—</option>
          {(['PAYING', 'PAID', 'FAILED'] as const).map((r) => (
            <option key={r} value={r}>
              {t.resultName[r]}
            </option>
          ))}
        </select>
        <input className="input input-xs w-36" aria-label={t.reference} placeholder={t.reference} maxLength={64} value={reference} disabled={locked} onChange={(ev) => setReference(ev.target.value)} />
        <button type="submit" className="btn btn-xs btn-primary" disabled={!ok || locked}>
          {t.record}
        </button>
      </div>
      {result === 'FAILED' && <input className="input input-xs w-full" aria-label={t.failureReason} placeholder={t.failureReason} maxLength={200} value={reason} disabled={locked} onChange={(ev) => setReason(ev.target.value)} />}
      <CommandFeedback command={record}>{(p) => <p className="text-xs text-success">{t.recorded(t.stateName[p.state] ?? p.state)}</p>}</CommandFeedback>
    </form>
  );
}
