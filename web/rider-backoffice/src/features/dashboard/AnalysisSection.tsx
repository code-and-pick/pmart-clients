// 대시보드 분석 구역(2026-11-21 사용자 "대시보드가 허전해 — 라이더 시뮬레이션 분석 탭 같으면 좋겠다", 라이더 시뮬 세션 요청서).
// 라이더 시뮬레이터 ui/AnalyzePage.tsx 구성을 옮김: 숫자 타일 6개(작은 그림) · 시간대별 쌓인 막대(최근 2시간/하루/7일, 말풍선, 누르면 목록 → 배송 번호 누르면 바로 아래 흐름)
// · 상태 도넛 · 구간별 평균 여정 막대 · 라이더별 배송(오늘/7일 띠, 표시 누르면 흐름).
// 원천: execution 직원 배송 목록 GET /deliveries(최근 7일, 생긴 시각 최신순으로 커서를 따라 읽음 — 상한에 닿으면 "일부만"을 알린다). 시각 해석은 analysisData.ts 머리.
// 지연 타일: dispatch 정시 배송률 GET /metrics/on-time-deliveries(최근 7일 — 약속 끝 날짜 기준, OPERATOR_ADMIN 이 아니면 센터 필수) + 지금 배차 지연 GET /dispatch-delays.
// 펼친 흐름: 배송 상세 GET /deliveries/{id}(상세 화면과 같은 캐시 ['delivery', id]) — 단계 시각(history, 가게 도착·고객 도착 포함) | 주문 내역(orderSummary).
// (0.34.0) 목록의 firstAssignedAt·arrivedAtStoreAt·arrivedAtCustomerAt·promisedAt·completionMethod — 다섯 구간 평균, 건별 지연 고리(약속 없으면 판정 없음), 흐름의 약속 시각·도착 시각 대체.
// 전화·주소·고객 이름은 넣지 않는다(이름은 가린 값). 다른 화면으로 넘기지 않고 같은 자리에서 펼친다(배송 상세 링크만 작게).
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { isOperatorAdmin } from '../../app/nav';
import { useSession } from '../../app/SessionContext';
import { DeliveryNo, RiderName, useRiderSummaries } from '../../shared/displayNumbers';
import { messages } from '../../shared/messages';
import { label } from '../../shared/opsUi';
import type { components } from '../../api/generated/delivery-execution';
import {
  binCount,
  binLabel,
  binRange,
  type ChartView,
  DAY,
  dayStart,
  defaultView,
  dur,
  flowSteps,
  frame,
  frameTitle,
  isLate,
  isRow,
  hhmm,
  KIND_LABEL,
  type Kind,
  KINDS,
  kindOf,
  type Leg,
  type LegKey,
  lateness,
  metrics,
  ms,
  niceStep,
  onTimeTotals,
  pack,
  seoulDate,
  seoulDay,
  shift,
  spanOf,
  type Summary,
  unrealCompletion,
} from './analysisData';

/** 한 번에 읽는 최대 쪽 수(50건씩) — 넘으면 오래된 쪽이 빠졌다고 알린다 */
export const ANALYSIS_MAX_PAGES = 20;

const t = {
  title: '분석',
  range: '최근 7일',
  asOf: (s: string) => `${s} 기준`,
  partial: (n: number) => `배송이 많아 최근 ${n.toLocaleString('ko-KR')}건만 셌어요. 7일 앞쪽 일부가 빠졌어요.`,
  deliveries: '배송',
  active: (n: number) => `진행 중 ${n}건`,
  rate: '완료율',
  rateSub: (d: number, f: number) => `완료 ${d} · 실패 ${f}`,
  avgTotal: '한 건 평균',
  avgTotalSub: '배차 요청 → 전달 완료',
  avgFind: '라이더 찾기 평균',
  avgFindSub: '배차 요청 → 첫 배정',
  late: '지연',
  onTimeRate: (rate: number | null) => `정시율 ${rate === null ? '—' : `${Math.round(rate * 100)}%`}`,
  delayNow: (n: number | null) => `지금 배차 지연 ${n === null ? '—' : `${n}건`}`,
  pickCentre: '센터를 고르면 보여요',
  loadFail: '불러오지 못했어요',
  retry: '다시',
  problems: '실패·이상',
  problemsSub: '실패 등록·확정·보류',
  timeTitle: '시간대별 배송 건수',
  state: '상태',
  phases: '구간별 평균',
  phasesNote: (n: number) => `완료 ${n}건 기준`,
  phasesExcluded: (n: number) => `고객 확인·자동 완료 ${n}건 뺌`,
  promised: '약속 시각',
  lateBy: (s: string) => `${s} 늦음`,
  onTime: '약속 안에',
  unjudged: '판정 없음',
  lateMark: '약속보다 늦음',
  byCustomer: '고객 확인 완료',
  phasesEmpty: '완료된 배송이 생기면 나와요.',
  riders: '라이더별 배송',
  noRider: '배정 전',
  empty: '이 기간에는 배송이 없어요.',
  lastDay: (d: string) => `마지막 배송이 있던 ${d} 보기 →`,
  close: '닫기',
  openDetail: '배송 상세 화면',
  flow: '배송 흐름',
  order: '주문 내역',
  orderLoading: '주문 내역을 불러오는 중…',
  orderMissing: '주문 내역을 받지 못했어요',
  itemAmount: '상품 합계',
  note: '요청사항',
  auto: '자동 완료',
} as const;

const won = (n: number | null | undefined) => (typeof n === 'number' ? `${n.toLocaleString('ko-KR')}원` : '—');

/** 구간 색 — 청록·파랑·노랑·주황·회색(보라 없음). 합친 구간(도착 시각 없는 배송)은 두 색을 이은 그라데이션 */
const PHASE: Record<LegKey, { readonly label: string; readonly color: string; readonly to?: string }> = {
  find: { label: '라이더 찾기', color: 'var(--an-c1)' },
  toStore: { label: 'MFC 이동', color: 'var(--an-c2)' },
  atStore: { label: 'MFC 대기', color: 'var(--an-c3)' },
  store: { label: 'MFC 이동·대기', color: 'var(--an-c2)', to: 'var(--an-c3)' },
  toCustomer: { label: '고객에게', color: 'var(--an-c4)' },
  atCustomer: { label: '고객 앞', color: 'var(--an-c5)' },
  customer: { label: '고객에게·고객 앞', color: 'var(--an-c4)', to: 'var(--an-c5)' },
};
const legStyle = (k: LegKey) => {
  const p = PHASE[k];
  // 흰 광택 없이 평평한 색(2026-11-21 사용자 "볼록한 음영 말고") — 합친 구간만 두 구간 색을 가로로 잇는다
  return p.to ? { backgroundColor: p.color, backgroundImage: `linear-gradient(to right, ${p.color}, ${p.to})` } : { backgroundColor: p.color };
};

/** 최근 7일 배송(최신순으로 생긴 시각이 7일 앞보다 오래될 때까지) */
function useWeekDeliveries(mfcId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['dashboard-analysis', mfcId],
    refetchInterval: 60_000,
    queryFn: async () => {
      const from = dayStart(Date.now()) - 6 * DAY;
      const items: Summary[] = [];
      let cursor: string | undefined;
      let pages = 0;
      let reachedStart = false;
      for (; pages < ANALYSIS_MAX_PAGES; pages++) {
        const page = await request('GET', api.execution.GET('/deliveries', { params: { query: { sort: 'NEWEST', size: 50, ...(mfcId ? { mfcId } : {}), ...(cursor ? { cursor } : {}) } } }));
        for (const it of (page.items ?? []).filter(isRow)) {
          const c = ms(it.createdAt);
          if (c !== null && c < from) reachedStart = true;
          else items.push(it);
        }
        cursor = page.page?.nextCursor ?? undefined;
        if (reachedStart || !cursor) break;
      }
      return { items, partial: !reachedStart && !!cursor, asOf: Date.now() };
    },
  });
}

/** 정시 배송률(최근 7일 — 약속 끝의 서울 날짜). 관리자가 아니면 센터를 골라야 부를 수 있다(서버가 mfcId 필수 — 0 으로 보이지 않게 부르지 않는다) */
function useOnTime(mfcId: string, canAll: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['dashboard-on-time', mfcId],
    enabled: canAll || !!mfcId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const now = Date.now();
      const query = { from: seoulDate(dayStart(now) - 6 * DAY), to: seoulDate(now), ...(mfcId ? { mfcId } : {}) };
      const res = await request('GET', api.dispatch.GET('/metrics/on-time-deliveries', { params: { query } }));
      return onTimeTotals(res.items);
    },
  });
}

/** 지금 배차 지연(픽업 전, 약속보다 늦을 것으로 본 배송 — 최대 200건) */
function useDispatchDelays(mfcId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['dashboard-dispatch-delays', mfcId],
    refetchInterval: 60_000,
    queryFn: () => request('GET', api.dispatch.GET('/dispatch-delays', { params: { query: mfcId ? { mfcId } : {} } })),
  });
}

export function AnalysisSection({ mfcId }: { readonly mfcId: string }) {
  const q = useWeekDeliveries(mfcId);
  return (
    <section className="an" aria-label={t.title} data-testid="analysis">
      <header className="an-head">
        <h2>
          {t.title} <span>{t.range}</span>
        </h2>
        {q.data && <span className="an-asof">{t.asOf(hhmm(q.data.asOf))}</span>}
      </header>
      <QueryState state={toUiState(q)} onRetry={() => void q.refetch()}>
        {(data) => <AnalysisBody rows={data.items} partial={data.partial} now={data.asOf} mfcId={mfcId} />}
      </QueryState>
    </section>
  );
}

function AnalysisBody({ rows, partial, now, mfcId }: { readonly rows: readonly Summary[]; readonly partial: boolean; readonly now: number; readonly mfcId: string }) {
  const m = metrics(rows, now);
  const canAll = isOperatorAdmin(useSession().session?.roles ?? []);
  const onTime = useOnTime(mfcId, canAll);
  const delays = useDispatchDelays(mfcId);
  const delayNow = delays.data ? delays.data.items.length : null;
  const riders = useRiderSummaries(rows.map((r) => r.riderId));
  const name = (id: string | null | undefined) => (id ? <RiderName riderId={id} nameMasked={riders.get(id)?.nameMasked} riderNumber={riders.get(id)?.riderNumber} /> : <span className="an-sub-t">{t.noRider}</span>);
  return (
    <>
      {partial && (
        <p className="an-partial" role="status" data-testid="analysis-partial">
          {t.partial(rows.length)}
        </p>
      )}
      <div className="an-tiles">
        <Tile testId="an-tile-total" label={t.deliveries} value={String(m.total)} unit="건" sub={t.active(m.counts.active)} viz={<Spark values={m.hourly} />} />
        <Tile
          testId="an-tile-rate"
          label={t.rate}
          value={m.rate !== null ? String(Math.round(m.rate * 100)) : '—'}
          unit={m.rate !== null ? '%' : ''}
          sub={t.rateSub(m.counts.done, m.counts.failed)}
          viz={m.rate !== null ? <Ring ratio={m.rate} /> : undefined}
        />
        <Tile testId="an-tile-avg" label={t.avgTotal} value={dur(m.avgTotalSec)} sub={t.avgTotalSub} />
        <Tile testId="an-tile-find" label={t.avgFind} value={dur(m.avgFindSec)} sub={t.avgFindSub} />
        {!canAll && !mfcId ? (
          <Tile testId="an-tile-late" label={t.late} value="—" sub={t.pickCentre} />
        ) : onTime.data ? (
          <Tile
            testId="an-tile-late"
            label={t.late}
            value={String(onTime.data.late)}
            unit="건"
            sub={
              <>
                <span>{t.onTimeRate(onTime.data.rate)}</span>
                <span>{t.delayNow(delayNow)}</span>
              </>
            }
            bad={onTime.data.late > 0}
            viz={onTime.data.rate !== null ? <Ring ratio={onTime.data.rate} name="정시율" /> : undefined}
          />
        ) : (
          <Tile
            testId="an-tile-late"
            label={t.late}
            value={onTime.isError ? '—' : '…'}
            sub={
              onTime.isError ? (
                <>
                  {t.loadFail}{' '}
                  <button type="button" className="an-link" onClick={() => void onTime.refetch()}>
                    {t.retry}
                  </button>
                </>
              ) : (
                ' '
              )
            }
          />
        )}
        <Tile testId="an-tile-problems" label={t.problems} value={String(m.problems)} unit="건" sub={t.problemsSub} bad={m.problems > 0} />
      </div>

      <div className="an-row">
        <section className="an-card an-fill" aria-label={t.timeTitle}>
          <TimeChart rows={rows} now={now} name={name} />
        </section>
        <section className="an-card" aria-label={`${t.state} · ${t.phases}`}>
          <div className="an-card-h">
            <h3>{t.state}</h3>
          </div>
          <StatusDonut counts={m.counts} total={m.total} />
          <div className="an-card-h an-gap">
            <h3>{t.phases}</h3>
            {m.phases && (
              <span className="an-note" data-testid="an-phases-note">
                {t.phasesNote(m.phases.n)}
                {m.phases.excluded > 0 && ` · ${t.phasesExcluded(m.phases.excluded)}`}
              </span>
            )}
          </div>
          {m.phases ? <Journey segments={m.phases.segments} total={m.phases.totalSec} /> : <p className="an-empty">{t.phasesEmpty}</p>}
        </section>
      </div>

      <section className="an-card" aria-label={t.riders}>
        <RiderTable rows={rows} now={now} name={name} />
      </section>
    </>
  );
}

function Tile({ label: text, value, unit, sub, bad = false, viz, testId }: { readonly label: string; readonly value: string; readonly unit?: string; readonly sub: ReactNode; readonly bad?: boolean; readonly viz?: ReactNode; readonly testId: string }) {
  return (
    <div className={`an-tile ${bad ? 'bad' : ''} ${viz ? 'has-viz' : ''}`} data-testid={testId}>
      <span className="l">{text}</span>
      <span className="v">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      <span className="s">{sub}</span>
      {viz && <span className="viz">{viz}</span>}
    </div>
  );
}

/** 작은 추세선 — 최근 12시간 1시간마다 생긴 배송 수 */
function Spark({ values }: { readonly values: readonly number[] }) {
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 34 - (v / max) * 28] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  // 선 아래 면은 위에서 아래로 옅어지는 그라데이션(2026-11-21 사용자 "그래프에 그라데이션") — id 는 타일마다 달라야 한다
  const grad = `an-spark-${useId().replace(/:/g, '')}`;
  return (
    <svg className="an-spark" viewBox="0 0 100 36" preserveAspectRatio="none" role="img" aria-label={`최근 12시간 1시간마다 배송: ${values.join(', ')}`}>
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="g0" />
          <stop offset="100%" className="g1" />
        </linearGradient>
      </defs>
      <path d={`${line} L100,36 L0,36 Z`} className="area" fill={`url(#${grad})`} />
      <path d={line} className="line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Ring({ ratio, name = '완료율' }: { readonly ratio: number; readonly name?: string }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  // 고리도 옅은 색 → 진한 색 그라데이션(2026-11-21)
  const grad = `an-ring-${useId().replace(/:/g, '')}`;
  return (
    <svg className="an-ring" viewBox="0 0 50 50" role="img" aria-label={`${name} ${Math.round(ratio * 100)}%`}>
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" className="g0" />
          <stop offset="100%" className="g1" />
        </linearGradient>
      </defs>
      <circle cx="25" cy="25" r={r} className="track" />
      <circle cx="25" cy="25" r={r} className="arc" stroke={`url(#${grad})`} strokeDasharray={`${c * ratio} ${c}`} transform="rotate(-90 25 25)" />
    </svg>
  );
}

function StatusDonut({ counts, total }: { readonly counts: Record<Kind, number>; readonly total: number }) {
  const [hov, setHov] = useState<Kind | null>(null);
  if (!total) return <p className="an-empty">{t.empty}</p>;
  const ks = KINDS.filter((k) => counts[k]);
  const r = 46;
  const c = 2 * Math.PI * r;
  const gap = ks.length > 1 ? 2.5 : 0;
  const starts = ks.map((_, i) => ks.slice(0, i).reduce((a, k) => a + (counts[k] / total) * c, 0));
  const cur = hov ? { label: KIND_LABEL[hov], n: counts[hov] } : { label: '전체 배송', n: total };
  return (
    <div className="an-donut-wrap" data-testid="an-donut">
      <div className="an-donut">
        <svg viewBox="0 0 120 120" role="img" aria-label={ks.map((k) => `${KIND_LABEL[k]} ${counts[k]}건`).join(', ')}>
          <circle cx="60" cy="60" r={r} className="track" />
          {ks.map((k, i) => {
            const len = (counts[k] / total) * c;
            return (
              <circle
                key={k}
                cx="60"
                cy="60"
                r={r}
                className={`seg s-${k} ${hov && hov !== k ? 'dim' : ''} ${hov === k ? 'on' : ''}`}
                strokeDasharray={`${Math.max(0.5, len - gap)} ${c}`}
                strokeDashoffset={-(starts[i] ?? 0)}
                transform="rotate(-90 60 60)"
                onMouseEnter={() => setHov(k)}
                onMouseLeave={() => setHov(null)}
              />
            );
          })}
        </svg>
        <div className="an-donut-c">
          <b>
            {cur.n}
            <small>건</small>
          </b>
          <span>{cur.label}</span>
        </div>
      </div>
      <ul className="an-donut-keys">
        {ks.map((k) => (
          <li key={k} className={hov === k ? 'on' : ''} onMouseEnter={() => setHov(k)} onMouseLeave={() => setHov(null)}>
            <i className={`k-${k}`} />
            <span>{KIND_LABEL[k]}</span>
            <b>{counts[k]}건</b>
            <em>{Math.round((counts[k] / total) * 100)}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 여정 막대 — 너비는 전체 걸린 시간 중 그 구간 몫(share), 숫자는 그 구간을 잴 수 있었던 배송만의 평균과 건수 */
function Journey({ segments, total }: { readonly segments: readonly Leg[]; readonly total: number }) {
  return (
    <div className="an-journey" data-testid="an-journey">
      <div className="an-journey-bar" role="img" aria-label={segments.map((x) => `${PHASE[x.key].label} ${dur(x.sec)} ${x.n}건`).join(', ')}>
        {segments.map((x, i) => (
          <i key={x.key} style={{ flexGrow: Math.max(x.share, 0.05), ...legStyle(x.key) }}>
            {i + 1}
          </i>
        ))}
      </div>
      <div className="an-journey-ends">
        <span>배차 요청</span>
        <span>전달 완료</span>
      </div>
      <ol className="an-journey-legs">
        {segments.map((x, i) => (
          <li key={x.key} data-testid={`an-leg-${x.key}`}>
            <span className="n" style={legStyle(x.key)}>
              {i + 1}
            </span>
            <span className="l">{PHASE[x.key].label}</span>
            <b>{dur(x.sec)}</b>
            <span className="c">{x.n}건</span>
            <em>{Math.round(x.share * 100)}%</em>
          </li>
        ))}
        <li className="tot">
          <span className="n" />
          <span className="l">합계(한 건 평균)</span>
          <b>{dur(total)}</b>
          <span className="c" />
          <em />
        </li>
      </ol>
    </div>
  );
}

function Legend() {
  return (
    <span className="an-legend" aria-label="범례">
      {KINDS.map((k) => (
        <span key={k}>
          <i className={`k-${k}`} />
          {KIND_LABEL[k]}
        </span>
      ))}
    </span>
  );
}

function Seg<T extends string>({ value, options, onChange, label: text }: { readonly value: T; readonly options: ReadonlyArray<readonly [T, string]>; readonly onChange: (v: T) => void; readonly label: string }) {
  return (
    <div className="an-seg" role="tablist" aria-label={text}>
      {options.map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

type NameFn = (id: string | null | undefined) => ReactNode;

function TimeChart({ rows, now, name }: { readonly rows: readonly Summary[]; readonly now: number; readonly name: NameFn }) {
  const [chosen, setChosen] = useState<ChartView | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const items = rows.flatMap((r) => {
    const at = ms(r.createdAt);
    return at === null ? [] : [{ at, kind: kindOf(r.state), r }];
  });
  const v = chosen ?? defaultView(items.map((i) => i.at), now);
  const f = frame(v, now);
  const bins = binCount(items, f);
  const total = bins.reduce((a, b) => a + b.total, 0);
  const sum = (k: Kind) => bins.reduce((a, b) => a + b.counts[k], 0);
  const peak = Math.max(0, ...bins.map((b) => b.total));
  const latest = items.length ? Math.max(...items.map((i) => i.at)) : null;
  const go = (n: ChartView) => {
    setHover(null);
    setPick(null);
    setOpenId(null);
    setChosen(n);
  };
  const yStep = niceStep(peak);
  const max = Math.max(yStep, Math.ceil(peak / yStep) * yStep);
  const ticks = Array.from({ length: Math.round(max / yStep) + 1 }, (_, i) => i * yStep);
  const hv = hover !== null ? bins[hover] : undefined;
  const pb = pick !== null ? bins.find((b) => b.from === pick) : undefined;
  const picked = pb ? items.filter((i) => i.at >= pb.from && i.at < pb.to).sort((a, b) => a.at - b.at) : [];
  const unit = f.mode === 'recent' ? '10분' : f.mode === 'day' ? '1시간' : '하루';
  return (
    <>
      <div className="an-card-h">
        <h3>{t.timeTitle}</h3>
        <div className="an-ctl">
          {v.mode !== 'recent' && (
            <span className="an-nav">
              <button type="button" aria-label={v.mode === 'day' ? '전날' : '앞 7일'} onClick={() => go(shift(v, -1))}>
                ‹
              </button>
              <b>{frameTitle(f, now)}</b>
              <button type="button" aria-label={v.mode === 'day' ? '다음 날' : '뒤 7일'} onClick={() => go(shift(v, 1))} disabled={f.to > now}>
                ›
              </button>
            </span>
          )}
          <Seg
            label="보는 기간"
            value={v.mode}
            options={[
              ['recent', '최근 2시간'],
              ['day', '하루'],
              ['week', '7일'],
            ]}
            onChange={(mode) => go({ mode, anchor: mode === 'recent' ? now : v.anchor })}
          />
        </div>
      </div>
      <div className="an-sum">
        <span className="big">
          {total}
          <small>건</small>
        </span>
        <span className="parts">
          {KINDS.filter((k) => k !== 'other' || sum('other')).map((k) => (
            <span key={k}>
              <i className={`k-${k}`} />
              {KIND_LABEL[k]} <b>{sum(k)}</b>
            </span>
          ))}
        </span>
        <span className="an-note right">
          {v.mode === 'recent' ? `${frameTitle(f, now)} · ` : ''}배차 요청 시각 · {unit} 단위
        </span>
      </div>
      {total === 0 ? (
        <div className="an-chart-empty">
          <p>{t.empty}</p>
          {latest !== null && (
            <button type="button" className="an-link" onClick={() => go({ mode: 'day', anchor: latest })}>
              {t.lastDay(seoulDay(latest))}
            </button>
          )}
        </div>
      ) : (
        <div className="an-plot" onMouseLeave={() => setHover(null)} data-testid="an-plot">
          <div className="an-yaxis" aria-hidden="true">
            {ticks.map((tk) => (
              <span key={tk} style={{ bottom: `${(tk / max) * 100}%` }}>
                {tk}
              </span>
            ))}
          </div>
          <div className="an-bars">
            {ticks.map((tk) => (
              <i key={tk} className="an-grid" style={{ bottom: `${(tk / max) * 100}%` }} />
            ))}
            {bins.map((b, i) => {
              const isNow = now >= b.from && now < b.to;
              const future = b.from > now;
              const [l1, l2] = binLabel(f.mode, b.from);
              const showLabel = i % f.labelEvery === 0 || isNow;
              const clickable = f.mode === 'week' || b.total > 0;
              const onPick = f.mode === 'week' ? () => go({ mode: 'day', anchor: b.from }) : b.total ? () => { setPick(pick === b.from ? null : b.from); setOpenId(null); } : undefined;
              return (
                <div key={b.from} className={`an-col ${isNow ? 'now' : ''} ${future ? 'future' : ''} ${pick === b.from ? 'picked' : ''} ${clickable ? 'click' : ''}`} onMouseEnter={() => setHover(i)}>
                  <button
                    type="button"
                    className="an-hit"
                    disabled={!onPick}
                    aria-label={`${binRange(f.mode, b)} ${b.total}건`}
                    data-testid="an-bar"
                    onClick={onPick}
                    onFocus={() => setHover(i)}
                  />
                  <div className="an-stack" style={{ height: `${(b.total / max) * 100}%` }}>
                    {b.total > 0 && <span className="val">{b.total}</span>}
                    {[...KINDS].reverse().map((k) => (b.counts[k] ? <i key={k} className={`k-${k}`} style={{ flexGrow: b.counts[k] }} /> : null))}
                  </div>
                  <span className="x">
                    {showLabel ? (isNow && f.mode !== 'week' ? '지금' : l1) : ''}
                    {l2 && <em>{isNow ? '오늘' : l2}</em>}
                  </span>
                  {hv && hover === i && (
                    <div className="an-tip" role="status">
                      <b>{binRange(f.mode, hv)}</b>
                      {hv.total ? (
                        <>
                          {KINDS.filter((k) => hv.counts[k]).map((k) => (
                            <span key={k}>
                              <i className={`k-${k}`} />
                              {KIND_LABEL[k]} <b>{hv.counts[k]}</b>
                            </span>
                          ))}
                          <em>{f.mode === 'week' ? '누르면 그날 시간대로' : '누르면 아래에 배송 목록'}</em>
                        </>
                      ) : (
                        <span>배송 없음</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {pb && (
        <div className="an-detail" data-testid="an-bin-list">
          <div className="an-detail-h">
            <b>
              {binRange(f.mode, pb)} · {picked.length}건
            </b>
            <button type="button" className="an-x" aria-label={t.close} onClick={() => { setPick(null); setOpenId(null); }}>
              ✕
            </button>
          </div>
          <table className="an-table">
            <thead>
              <tr>
                <th>배차 요청</th>
                <th>배송</th>
                <th>라이더</th>
                <th>상태</th>
                <th className="num">걸린 시간</th>
              </tr>
            </thead>
            <tbody>
              {picked.map(({ r, at, kind }) => {
                const end = ms(r.completedAt);
                return (
                  <tr key={r.deliveryId} className={openId === r.deliveryId ? 'on' : ''}>
                    <td className="num">{hhmm(at)}</td>
                    <td>
                      <button type="button" className="an-link" aria-expanded={openId === r.deliveryId} onClick={() => setOpenId(openId === r.deliveryId ? null : r.deliveryId)} data-testid="an-open-delivery">
                        <DeliveryNo deliveryId={r.deliveryId} deliveryNumber={r.deliveryNumber} orderNumber={r.orderNumber} />
                      </button>
                    </td>
                    <td>{name(r.riderId)}</td>
                    <td>
                      <span className="an-state">
                        <i className={`k-${kind}`} />
                        {label(messages.names.executionState, r.state)}
                      </span>
                      {isLate(r, now) && <LateMark />}
                    </td>
                    <td className="num">{dur(((end ?? (kind === 'active' ? now : at)) - at) / 1000)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pb && openId && (() => {
        const it = picked.find((x) => x.r.deliveryId === openId);
        return it ? <Flow row={it.r} name={name} now={now} onClose={() => setOpenId(null)} /> : null;
      })()}
    </>
  );
}

/** 약속(promisedAt)보다 늦은 배송 표시 — 주황 고리 */
function LateMark() {
  return <span className="an-late" role="img" aria-label={t.lateMark} title={t.lateMark} data-testid="an-late" />;
}

/** 배송 상세 — 상세 화면·펼친 요약과 같은 키(['delivery', id])라 캐시를 같이 쓴다 */
function useDeliveryDetail(deliveryId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['delivery', deliveryId],
    queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}', { params: { path: { deliveryId } } })),
  });
}

/** 배송 한 건 — 왼쪽 흐름(상세 이력의 단계 시각, 못 읽으면 목록 시각) | 오른쪽 주문 내역. 같은 자리에서 펼친다 */
function Flow({ row, name, now, onClose }: { readonly row: Summary; readonly name: NameFn; readonly now: number; readonly onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [row.deliveryId]);
  const detail = useDeliveryDetail(row.deliveryId);
  const kind = kindOf(row.state);
  const shown = flowSteps(row, detail.data);
  const start = ms(row.createdAt);
  const last = ms(row.completedAt) ?? (kind === 'active' ? now : null);
  const promised = ms(row.promisedAt);
  const lt = lateness(row, now);
  return (
    <div className="an-detail" ref={ref} data-testid="an-flow">
      <div className="an-detail-h">
        <b>
          배송 <DeliveryNo deliveryId={row.deliveryId} deliveryNumber={row.deliveryNumber} orderNumber={row.orderNumber} />
          <span className={`an-pill k-${kind}`}>{label(messages.names.executionState, row.state)}</span>
        </b>
        <span className="an-detail-a">
          <Link className="an-link" to={`/deliveries/${encodeURIComponent(row.deliveryId)}`}>
            {t.openDetail} ↗
          </Link>
          <button type="button" className="an-x" aria-label={t.close} onClick={onClose}>
            ✕
          </button>
        </span>
      </div>
      <div className="an-flow-cols">
        <div>
          <h4 className="an-sub">{t.flow}</h4>
          <dl className="an-facts">
            <div>
              <dt>라이더</dt>
              <dd>{name(row.riderId)}</dd>
            </div>
            <div>
              <dt>배차 요청부터</dt>
              <dd>{start !== null && last !== null ? dur((last - start) / 1000) : '—'}</dd>
            </div>
            <div data-testid="an-promise">
              <dt>{t.promised}</dt>
              <dd>
                {promised !== null ? `${seoulDay(promised)} ${hhmm(promised)}` : '—'}
                {!lt.judged ? (
                  <span className="an-tag mute">{t.unjudged}</span>
                ) : lt.late ? (
                  <span className="an-tag">{t.lateBy(dur(Math.ceil(lt.lateSec / 60) * 60))}</span>
                ) : (
                  <span className="an-tag ok">{t.onTime}</span>
                )}
              </dd>
            </div>
          </dl>
          <ol className="an-steps" data-testid="an-steps">
            {shown.map((st, i) => {
              const prev = shown[i - 1];
              return (
                <li key={st.key} className={st.bad ? 'bad' : ''}>
                  <span className="t">
                    {seoulDay(st.at)} {hhmm(st.at)}
                  </span>
                  <span className="l">
                    {st.label}
                    {st.auto && <span className="an-tag">{t.auto}</span>}
                    {st.byCustomer && <span className="an-tag">{t.byCustomer}</span>}
                  </span>
                  <span className="g">{prev ? `+${dur((st.at - prev.at) / 1000)}` : ''}</span>
                </li>
              );
            })}
          </ol>
        </div>
        <section className="an-order" aria-label={t.order} data-testid="an-order">
          <h4 className="an-sub">{t.order}</h4>
          {detail.isPending ? (
            <p className="an-empty" role="status">
              {t.orderLoading}
            </p>
          ) : detail.isError ? (
            <p className="an-empty bad" role="alert">
              {t.loadFail}{' '}
              <button type="button" className="an-link" onClick={() => void detail.refetch()}>
                {t.retry}
              </button>
            </p>
          ) : detail.data.orderSummary ? (
            <OrderItems order={detail.data.orderSummary} />
          ) : (
            <p className="an-empty">{t.orderMissing}</p>
          )}
        </section>
      </div>
    </div>
  );
}

type OrderSummary = NonNullable<components['schemas']['DeliveryExecution']['orderSummary']>;

/** 주문 내역 — 서버 값(품목·수량·줄 금액·상품 합계)을 그대로. 클라이언트가 더하지 않는다 */
function OrderItems({ order }: { readonly order: OrderSummary }) {
  const items = order.items ?? [];
  return (
    <>
      {order.orderNumber && <p className="an-order-no">주문번호 {order.orderNumber}</p>}
      <ul className="an-items">
        {items.map((it, i) => (
          <li key={it.orderLineId ?? i}>
            <span className="nm">
              {it.name ?? '—'}
              {it.optionLabel && <em>{it.optionLabel}</em>}
            </span>
            <span className="q">{typeof it.qty === 'number' ? `${it.qty}개` : '—'}</span>
            <b>{won(it.lineAmount)}</b>
          </li>
        ))}
      </ul>
      <div className="an-items-sum">
        <span>{t.itemAmount}</span>
        <b>{won(order.itemAmount)}</b>
      </div>
      {order.deliveryNote && (
        <p className="an-order-note">
          <span>{t.note}</span>
          {order.deliveryNote}
        </p>
      )}
    </>
  );
}

type Range = 'today' | 'week';

function RiderTable({ rows, now, name }: { readonly rows: readonly Summary[]; readonly now: number; readonly name: NameFn }) {
  const [range, setRange] = useState<Range>('today');
  const [picked, setPicked] = useState<string | null>(null);
  const today = dayStart(now);
  const from = range === 'today' ? today : today - 6 * DAY;
  const to = today + DAY;
  const pct = (x: number) => Math.min(100, Math.max(0, ((x - from) / (to - from)) * 100));
  const byRider = new Map<string, ReturnType<typeof spanOf>[]>();
  for (const r of rows) {
    const sp = spanOf(r, now);
    if (!sp || sp.e < from) continue;
    const id = r.riderId ?? '';
    byRider.set(id, [...(byRider.get(id) ?? []), sp]);
  }
  const lanes = [...byRider.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : b[1].length - a[1].length));
  const ticks = range === 'today' ? [0, 6, 12, 18, 24].map((h) => from + h * 3600_000) : Array.from({ length: 8 }, (_, i) => from + i * DAY);
  const tickLabel = (x: number) => (range === 'today' ? `${Math.round((x - from) / 3600_000)}시` : seoulDay(x));
  const pick = picked ? rows.find((r) => r.deliveryId === picked) : undefined;
  return (
    <>
      <div className="an-card-h">
        <h3>{t.riders}</h3>
        <div className="an-ctl">
          <Legend />
          <Seg
            label="보는 기간"
            value={range}
            options={[
              ['today', '오늘'],
              ['week', '7일'],
            ]}
            onChange={(r) => {
              setRange(r);
              setPicked(null);
            }}
          />
        </div>
      </div>
      {lanes.length === 0 ? (
        <p className="an-empty">{range === 'today' ? '오늘 배송이 없어요. 7일을 눌러 보세요.' : '7일 동안 배송이 없어요.'}</p>
      ) : (
        <div className="an-scroll">
          <table className="an-table an-riders" data-testid="an-riders">
            <thead>
              <tr>
                <th>라이더</th>
                <th className="num">맡은 배송</th>
                <th className="num">완료</th>
                <th className="num">진행 중</th>
                <th className="num">평균 걸린 시간</th>
                <th className="strip-h">
                  <span className="an-ticks">
                    {ticks.map((x) => (
                      <span key={x} style={{ left: `${pct(x)}%` }}>
                        {tickLabel(x)}
                      </span>
                    ))}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lanes.map(([id, raw]) => {
                const list = raw.filter((x): x is NonNullable<typeof x> => !!x);
                const done = list.filter((x) => x.row.state === 'COMPLETED' && ms(x.row.completedAt) !== null);
                const active = list.filter((x) => kindOf(x.row.state) === 'active').length;
                // 평균 걸린 시간은 완료 시각이 실제인 건만(고객 확인·자동 완료 뺌)
                const timed = done.filter((x) => !unrealCompletion(x.row));
                const avgSec = timed.length ? timed.reduce((a, x) => a + (x.e - x.s), 0) / timed.length / 1000 : null;
                const packed = pack(list.map((x) => ({ ...x, s: Math.max(x.s, from) })));
                return (
                  <tr key={id || 'none'} className={id ? '' : 'none'}>
                    <td className="name">{name(id || null)}</td>
                    <td className="num">{list.length}건</td>
                    <td className="num">{id ? `${done.length}건` : '—'}</td>
                    <td className="num">{active ? `${active}건` : '—'}</td>
                    <td className="num">{id && avgSec !== null ? dur(avgSec) : '—'}</td>
                    <td className="strip-c">
                      <div className="an-strip" style={{ height: `${8 + packed.lines * 10}px` }}>
                        {ticks.map((x) => (
                          <i key={x} className="g" style={{ left: `${pct(x)}%` }} />
                        ))}
                        {now >= from && now <= to && <i className="nowline" style={{ left: `${pct(now)}%` }} />}
                        {packed.placed.map(({ row, s, e, line }) => {
                          const late = isLate(row, now);
                          return (
                            <button
                              key={row.deliveryId}
                              type="button"
                              className={`mk k-${kindOf(row.state)} ${late ? 'late' : ''} ${picked === row.deliveryId ? 'on' : ''}`}
                              style={{ left: `${pct(s)}%`, width: `max(6px, ${pct(e) - pct(s)}%)`, top: `${4 + line * 10}px` }}
                              title={`${row.deliveryNumber ?? row.deliveryId} · ${KIND_LABEL[kindOf(row.state)]} · ${dur((e - s) / 1000)}${late ? ` · ${t.lateMark}` : ''}`}
                              aria-label={`배송 ${row.deliveryNumber ?? row.deliveryId}${late ? ` ${t.lateMark}` : ''} 흐름 보기`}
                              data-testid="an-mark"
                              data-late={late || undefined}
                              onClick={() => setPicked(picked === row.deliveryId ? null : row.deliveryId)}
                            />
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pick && <Flow row={pick} name={name} now={now} onClose={() => setPicked(null)} />}
    </>
  );
}
