// 처리 기한 지킴(접수 건) — bff 0.13.0 `GET /backoffice/views/metrics?metric=CASE_SLA&from&to[&granularity][&centerId]`(원천 case 0.24.0 `GET /cases/metrics/sla`).
// 백엔드 알림 backoffice/2026-11-18-notice-metrics-case-sla(백엔드 #164 — main 에 들어감, LAN 배포 전이라 지금은 목으로 확인). 본사 관리자(OPERATOR_ADMIN)만.
// 업무 원문 BO-28: 분모를 줄여 비율을 올리지 않는다, 분모 0 은 N/A, 승인된 정의만.
// - 비율만 보이지 않고 "N건 중 M건"을 같이. ratio null 은 "—"(0%·100% 로 그리지 않는다). 기한 없던 건(unjudged)은 따로.
// - 종류마다 기한이 달라 한 숫자로만 보이지 않고 종류·팀으로 나눠 본다.
// - 기간 합계 비율은 서버가 준 건수(분자·분모)를 더한 것으로만 — 분모 0 이면 "—".
// - 503 = 접수 건 원천에 닿지 않음(0건 아님), 400 = 서버 detail 그대로(DAY 93일·HOUR 7일). currentOverdue null = 그 원천만 실패(+ unavailableSources).
// - LAN 데이터는 시험·시뮬레이터라 운영 성과처럼 읽히지 않게 안내.
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';

import { ProblemFailure, request } from '@pmart/web-core';
import { QueryState, uiStateFromError, type UiState } from '@pmart/web-ui';
import type { paths } from '../../api/generated/backoffice-bff';
import { useCenterScope } from '../../shared/centerScope';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { addSeoulDays, label } from '../../shared/ops';
import { SourceStamps } from '../../shared/SourceStamps';
import { ChipGroup, DataTable, PageHeader, SearchPanel, SearchRow, Section } from '../../shared/admin';
import { Insight, KpiCell, KpiStrip, LineChart, Meter, TrendLine } from '../../app/Charts';
import { PeriodPresets } from '../../shared/PeriodPresets';

const m = messages.caseSla;

type MetricsView = paths['/views/metrics']['get']['responses'][200]['content']['application/json'];
type CaseSlaView = MetricsView;
type Point = NonNullable<MetricsView['points']>[number];
type Total = NonNullable<MetricsView['totals']>[number];
/** 분자·분모·비율·판정 불가 — 줄·묶음 합 공통 */
type Counts = Pick<Total, 'numerator' | 'denominator' | 'ratio' | 'unjudged'>;

type Granularity = 'DAY' | 'HOUR';
type SplitBy = 'kind' | 'group' | 'both';

const KST = 9 * 3_600_000;
const seoulToday = (offsetDays = 0) => new Date(Date.now() + KST + offsetDays * 86_400_000).toISOString().slice(0, 10);

/** "N건 중 M건" + 비율(분모 0 이면 "—") */
export function slaText(c: { numerator: number; denominator: number }): { readonly count: string; readonly ratio: string } {
  return {
    count: m.ofDue(c.numerator, c.denominator),
    ratio: c.denominator === 0 ? m.na : `${Math.round((c.numerator / c.denominator) * 1000) / 10}%`,
  };
}

/** 서버 비율이 있으면 그것, 없으면(null) "—" — 화면이 0 으로 바꾸지 않는다 */
const ratioOf = (c: Counts) => (c.ratio === null || c.ratio === undefined ? m.na : `${Math.round(c.ratio * 1000) / 10}%`);

function sum(rows: readonly Counts[]) {
  let numerator = 0;
  let denominator = 0;
  let unjudged = 0;
  for (const r of rows) {
    numerator += r.numerator;
    denominator += r.denominator;
    unjudged += r.unjudged ?? 0;
  }
  return { numerator, denominator, unjudged };
}

function Breakdown({ points }: { readonly points: readonly Point[] }) {
  const [by, setBy] = useState<SplitBy>('kind');
  const keyOf = (p: Point) => {
    const kind = label(messages.cases.kindName, p.segment?.kind ?? null);
    const group = p.segment?.assigneeGroup ? label(messages.cases.groupName, p.segment.assigneeGroup) : m.noGroup;
    return by === 'kind' ? kind : by === 'group' ? group : `${kind} · ${group}`;
  };
  const groups = new Map<string, Point[]>();
  for (const p of points) groups.set(keyOf(p), [...(groups.get(keyOf(p)) ?? []), p]);
  const rows = [...groups.entries()].map(([name, ps]) => ({ name, ...sum(ps) })).sort((a, b) => b.denominator + b.unjudged - (a.denominator + a.unjudged));
  // 가장 낮은 줄(판정할 건이 있는 것 중) — 먼저 볼 곳
  const judged = rows.filter((r) => r.denominator > 0);
  const worst = judged.length > 1 ? judged.reduce((w, r) => (r.numerator / r.denominator < w.numerator / w.denominator ? r : w)) : null;
  return (
    <Section id="case-sla-split" title={m.split} aside={<ChipGroup label={m.splitBy} value={by} onChange={setBy} options={[{ value: 'kind', label: m.byKind }, { value: 'group', label: m.byGroup }, { value: 'both', label: m.byBoth }]} />}>
      {rows.length === 0 ? (
        <p className="text-sm text-base-content/60">{m.noClosed}</p>
      ) : (
        <div className="space-y-3">
        {worst && <Insight>{m.lowest(worst.name, slaText(worst).ratio, slaText(worst).count)}</Insight>}
        <DataTable testId="case-sla-split">
          <thead>
            <tr>
              <th>{by === 'group' ? m.group : by === 'kind' ? m.kind : `${m.kind} · ${m.group}`}</th>
              <th>{m.inTime}</th>
              <th className="text-right">{m.ratio}</th>
              <th className="text-right">{m.unjudged}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const t = slaText(r);
              return (
                <tr key={r.name} data-testid="case-sla-split-row">
                  <td>{r.name}</td>
                  <td>
                    <span>{t.count}</span>
                    <Meter value={r.denominator > 0 ? r.numerator / r.denominator : null} tone={worst && r.name === worst.name ? 'danger' : 'neutral'} />
                  </td>
                  <td className="text-right font-semibold">{t.ratio}</td>
                  <td className="text-right">{r.unjudged > 0 ? m.countOf(r.unjudged) : m.zero}</td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
        </div>
      )}
    </Section>
  );
}

export function CaseSlaPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const granularity: Granularity = params.get('granularity') === 'HOUR' ? 'HOUR' : 'DAY';
  const applied = {
    from: params.get('from') ?? seoulToday(-6),
    to: params.get('to') ?? seoulToday(),
    granularity,
    centerId: params.get('centerId') ?? '',
  };
  // 머리줄 센터 고르기(2026-11-23) — 화면 센터 칸에 넣은 값이 먼저
  const scope = useCenterScope();
  const centerId = applied.centerId || scope;
  const [draft, setDraft] = useState(applied);
  const query = useQuery({
    queryKey: ['bff', 'metrics', 'CASE_SLA', applied, centerId],
    queryFn: async (): Promise<CaseSlaView> =>
      await request(
        'GET',
        api.bff.GET('/views/metrics', {
          params: { query: { metric: 'CASE_SLA', from: applied.from, to: applied.to, granularity: applied.granularity, ...(centerId ? { centerId } : {}) } },
        }),
      ),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setParams({ from: draft.from, to: draft.to, granularity: draft.granularity, ...(draft.centerId.trim() ? { centerId: draft.centerId.trim() } : {}) });
  };

  const failure = query.error instanceof ProblemFailure ? query.error : null;
  const badRequest = failure?.problem.status === 400 ? (failure.problem.detail ?? m.badRange) : null;
  const unreachable = failure?.problem.status === 503;
  const state: UiState<CaseSlaView> = query.isPending
    ? { kind: 'loading' }
    : query.isError
      ? uiStateFromError(query.error)
      : (query.data.unavailableSources?.length ?? 0) > 0
        ? { kind: 'partial', data: query.data, missing: query.data.unavailableSources ?? [] }
        : { kind: 'ready', data: query.data };

  return (
    <section className="space-y-4">
      <PageHeader title={m.title} />
      <SearchPanel onSubmit={submit} onReset={() => setDraft({ from: seoulToday(-6), to: seoulToday(), granularity: 'DAY', centerId: '' })} submitLabel={m.show} resetLabel={m.reset} label={m.title}>
        <SearchRow label={m.period}>
          <PeriodPresets from={draft.from} to={draft.to} onPick={(r) => setDraft((d) => ({ ...d, from: r.from, to: r.to }))} />
          <input type="date" aria-label={m.from} className="input input-sm w-40" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
          <span className="text-base-content/50">~</span>
          <input type="date" aria-label={m.to} className="input input-sm w-40" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
        </SearchRow>
        <SearchRow label={m.granularity}>
          <ChipGroup label={m.granularity} value={draft.granularity} onChange={(g) => setDraft((d) => ({ ...d, granularity: g }))} options={[{ value: 'DAY', label: m.day }, { value: 'HOUR', label: m.hour }]} />
        </SearchRow>
        <SearchRow label={m.center}>
          <input aria-label={m.center} placeholder={m.centerHint} className="input input-sm w-48" value={draft.centerId} onChange={(e) => setDraft((d) => ({ ...d, centerId: e.target.value }))} />
        </SearchRow>
      </SearchPanel>

      {badRequest ? (
        <p role="alert" className="alert alert-warning alert-soft text-sm" data-testid="case-sla-bad-range">
          {badRequest}
        </p>
      ) : unreachable ? (
        <div role="alert" className="alert alert-error flex flex-col items-start gap-1 text-sm" data-testid="case-sla-unreachable">
          <span className="font-bold">{m.unreachable}</span>
          <button type="button" className="btn btn-xs" onClick={() => void query.refetch()}>
            {m.retry}
          </button>
        </div>
      ) : (
        <QueryState state={state} onRetry={() => void query.refetch()}>
          {(v) => {
            const all = sum(v.totals ?? v.points ?? []);
            const t = slaText(all);
            const overdueTotal = v.currentOverdue ? v.currentOverdue.reduce((n, o) => n + o.overdue, 0) : null;
            // 그림 칸 — 하루 묶음이면 기간의 모든 날(닫힌 건이 없는 날도 칸은 있고 값은 "—"), 시간 묶음이면 서버가 준 묶음
            const byBucket = new Map((v.totals ?? []).map((b) => [applied.granularity === 'DAY' ? b.bucket.slice(0, 10) : b.bucket, b]));
            const slots: string[] = [];
            if (applied.granularity === 'DAY') for (let d = applied.from; d <= applied.to && slots.length < 93; d = addSeoulDays(d, 1)) slots.push(d);
            else slots.push(...byBucket.keys());
            const slotRatio = (k: string) => {
              const b = byBucket.get(k);
              return b && b.denominator > 0 ? b.numerator / b.denominator : null;
            };
            return (
              <>
                <SourceStamps sources={v.sources} unavailableSources={v.unavailableSources} />
                {/* 숫자 줄(2026-11-20 통계 개편) — 한 상자에 셋, 기한 지킴은 날마다 비율 추세선 */}
                <KpiStrip>
                  <KpiCell
                    hero
                    label={m.inTimeTotal}
                    value={<span data-testid="case-sla-ratio">{t.ratio}</span>}
                    sub={<span data-testid="case-sla-count">{t.count}</span>}
                    trend={<TrendLine values={slots.map(slotRatio)} max={1} />}
                  >
                    <Meter value={all.denominator > 0 ? all.numerator / all.denominator : null} />
                  </KpiCell>
                  <KpiCell label={m.unjudged} value={<span data-testid="case-sla-unjudged">{m.countOf(all.unjudged)}</span>} sub={m.unjudgedHint} tone={all.unjudged === 0 ? 'muted' : undefined} />
                  <KpiCell
                    label={m.overdueNow}
                    value={<span data-testid="case-sla-overdue">{overdueTotal === null ? m.na : m.countOf(overdueTotal)}</span>}
                    sub={overdueTotal === null ? m.overdueUnavailable : m.overdueHint}
                    tone={overdueTotal !== null && overdueTotal > 0 ? 'danger' : undefined}
                  />
                </KpiStrip>

                <Breakdown points={v.points ?? []} />

                <Section id="case-sla-buckets" title={applied.granularity === 'HOUR' ? m.byHour : m.byDay}>
                  {(v.totals ?? []).length === 0 ? (
                    <p className="text-sm text-base-content/60">{m.noClosed}</p>
                  ) : (
                    <div className="space-y-5">
                    {/* 추이 그림(2026-11-20) — 아래 표가 같은 숫자(그림을 못 보는 사람·정확한 값) */}
                    <LineChart
                      label={applied.granularity === 'HOUR' ? m.byHour : m.byDay}
                      avg={all.denominator > 0 ? { value: all.numerator / all.denominator, text: m.avgLine(t.ratio) } : null}
                      points={slots.map((k) => {
                        const b = byBucket.get(k);
                        return {
                          key: k,
                          title: k,
                          label: applied.granularity === 'HOUR' ? `${k.slice(11, 13)}시` : k.slice(5, 10).replace('-', '.'),
                          value: slotRatio(k),
                          tip: b ? [[ratioOf(b), m.ratio] as const, [m.ofDue(b.numerator, b.denominator), m.inTime] as const] : [[m.na, m.noClosedShort] as const],
                        };
                      })}
                    />
                    <DataTable testId="case-sla-buckets">
                      <thead>
                        <tr>
                          <th>{m.bucket}</th>
                          <th>{m.inTime}</th>
                          <th className="text-right">{m.ratio}</th>
                          <th className="text-right">{m.unjudged}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(v.totals ?? []).map((b) => (
                          <tr key={b.bucket} data-testid="case-sla-bucket">
                            <td className="font-mono text-xs">{b.bucket}</td>
                            <td>
                              <span>{m.ofDue(b.numerator, b.denominator)}</span>
                              <Meter value={b.denominator > 0 ? b.numerator / b.denominator : null} />
                            </td>
                            <td className="text-right font-semibold">{ratioOf(b)}</td>
                            <td className="text-right">{(b.unjudged ?? 0) > 0 ? m.countOf(b.unjudged ?? 0) : m.zero}</td>
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
                    </div>
                  )}
                </Section>

                <Section id="case-sla-overdue" title={m.overdueNow} aside={<span className="text-xs text-base-content/55">{m.overdueAside}</span>}>
                  {v.currentOverdue === null || v.currentOverdue === undefined ? (
                    <p role="note" className="text-sm text-warning" data-testid="case-sla-overdue-unavailable">
                      {m.overdueUnavailable}
                    </p>
                  ) : v.currentOverdue.length === 0 ? (
                    <p className="text-sm text-base-content/60">{m.noOverdue}</p>
                  ) : (
                    <DataTable>
                      <thead>
                        <tr>
                          <th>{m.kind}</th>
                          <th className="text-right">{m.openNow}</th>
                          <th className="text-right">{m.overdue}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {v.currentOverdue.map((o) => (
                          <tr key={o.kind}>
                            <td>{label(messages.cases.kindName, o.kind)}</td>
                            <td className="text-right">{o.open}</td>
                            <td className={`text-right ${o.overdue > 0 ? 'font-bold text-error' : ''}`}>{o.overdue}</td>
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
                  )}
                </Section>
              </>
            );
          }}
        </QueryState>
      )}
    </section>
  );
}
