// 리포트·KPI — 백엔드 회신 2026-11-26-reply-kpi-workforce. 탭 ?v=metrics|daily|workers, 기간 ?from=&to=(서울 날짜, 최대 31일 — 넘으면 서버 400).
// - 운영 확인 기준(KP-1) `GET /cdcs/{cdcId}/operating-metrics?from&to&mfcId` — 6항목 고정 순서. status NA 면 값 대신 사유(N/A 와 0 을 구분), provisional 이면 "잠정".
//   BI·목표 수치가 아니다 — 계산은 서버, 화면은 표시만(사용자 결정 "있는 자료만 + 나머지 N/A").
// - 일별 출고(KP-2) `GET /cdcs/{cdcId}/outbound-summary/daily?from&to` — 날짜마다 outbound-summary.
// - 작업자 실적(WF-1) `GET /cdcs/{cdcId}/worker-throughput?from&to` — 끝난 작업 담당자별(낱개, 단위 섞지 않음).
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { DailyView, WorkersView } from './ReportViews';

const t = messages.reports;
const VIEWS = ['metrics', 'daily', 'workers'] as const;
type View = (typeof VIEWS)[number];
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const seoul = (t0: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(t0));
const num = (n: number | null | undefined) => (n === null || n === undefined ? messages.none : n.toLocaleString('ko-KR'));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? messages.none : `${(v * 100).toFixed(1)}%`);

/** `/c/:cdcId/reports` */
export function ReportsMenu({ cdcId }: { readonly cdcId: string }) {
  const [params, setParams] = useSearchParams();
  const view: View = VIEWS.find((v) => v === params.get('v')) ?? 'metrics';
  // 기본 기간 = 최근 7일(오늘 포함)
  const [today] = useState(() => seoul(Date.now()));
  const [weekAgo] = useState(() => seoul(Date.now() - 6 * 86_400_000));
  // 작업자 실적은 하루(오늘)가 기본 — 여러 날이면 시간당·그날 근무를 보일 수 없다
  const from = isDate(params.get('from')) ? params.get('from')! : view === 'workers' ? today : weekAgo;
  const to = isDate(params.get('to')) ? params.get('to')! : today;
  const mfcId = params.get('mfc') ?? '';
  const [f, setF] = useState({ from, to, mfc: mfcId });
  const apply = (next: Record<string, string>) => {
    const q = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    setParams(q, { replace: true });
  };
  return (
    <section className="space-y-4">
      <div>
        <h1>{messages.menus.reports}</h1>
        <p className="max-w-4xl text-sm text-base-content/60">{t.lead}</p>
      </div>
      <div role="tablist" className="tabs tabs-box w-fit" data-testid="report-views">
        {VIEWS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={`tab ${view === k ? 'tab-active' : ''}`} onClick={() => apply({ v: k === 'metrics' ? '' : k })}>
            {t.views[k]}
          </button>
        ))}
      </div>
      <form
        className="flex flex-wrap items-end gap-3 rounded-box border border-base-300 bg-base-100 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ from: f.from, to: f.to, mfc: f.mfc.trim() });
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          {t.from}
          <input type="date" className="input input-sm w-40" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} data-testid="report-from" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.to}
          <input type="date" className="input input-sm w-40" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} data-testid="report-to" />
        </label>
        {view === 'metrics' && (
          <label className="flex flex-col gap-1 text-sm">
            {t.mfc}
            <input className="input input-sm w-40 font-mono" value={f.mfc} onChange={(e) => setF({ ...f, mfc: e.target.value.toUpperCase() })} data-testid="report-mfc" />
          </label>
        )}
        <button type="submit" className="btn btn-sm btn-primary" data-testid="report-go">
          {t.go}
        </button>
        <span className="text-xs text-base-content/55">{t.maxDays}</span>
      </form>
      {view === 'metrics' && <MetricsView cdcId={cdcId} from={from} to={to} mfcId={mfcId} />}
      {view === 'daily' && <DailyView cdcId={cdcId} from={from} to={to} />}
      {view === 'workers' && <WorkersView cdcId={cdcId} from={from} to={to} />}
    </section>
  );
}

function MetricsView({ cdcId, from, to, mfcId }: { readonly cdcId: string; readonly from: string; readonly to: string; readonly mfcId: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'operating-metrics', from, to, mfcId],
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/operating-metrics', { params: { path: { cdcId }, query: { from, to, ...(mfcId ? { mfcId } : {}) } } })),
  });
  return (
    <QueryState state={toUiState(query, () => false)} onRetry={() => void query.refetch()}>
      {(data) => (
        <div className="space-y-3">
          <p className="text-xs text-base-content/60" data-testid="metrics-meta">
            {t.definition(data.definitionVersion, data.evaluatedTrfCount ?? 0)} · {t.asOf(formatSeoul(data.asOf))}
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="metric-cards">
            {data.items.map((m) => {
              const na = m.status === 'NA';
              const count = m.unit === 'COUNT';
              const value = na ? t.na : count ? t.count(m.value ?? 0) : m.unit === 'MINUTES' ? t.minutes(m.value ?? 0) : pct(m.value);
              return (
                <article key={m.key} className="space-y-2 rounded-box border border-base-300 bg-base-100 p-4" data-testid="metric-card" data-status={m.status}>
                  <header className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">{t.metric[m.key] ?? m.label ?? m.key}</h3>
                      <p className="text-xs text-base-content/55">{t.metricHint[m.key] ?? ''}</p>
                    </div>
                    {m.provisional && <span className="badge badge-sm badge-warning whitespace-nowrap">{t.provisional}</span>}
                  </header>
                  <p className={`text-3xl font-semibold tabular-nums ${na ? 'text-base-content/40' : ''}`} data-testid="metric-value">
                    {value}
                  </p>
                  {!na && !count && m.numerator !== null && m.numerator !== undefined && (
                    <p className="text-xs tabular-nums text-base-content/60">{t.fraction(num(m.numerator), num(m.denominator))}</p>
                  )}
                  {(m.components?.length ?? 0) > 0 && (
                    <ul className="space-y-0.5 text-xs">
                      {m.components!.map((c) => (
                        <li key={c.key} className="flex justify-between gap-2">
                          <span>{t.component[c.key ?? ''] ?? c.key}</span>
                          <span className={`tabular-nums ${c.status === 'NA' ? 'text-base-content/40' : ''}`}>{c.status === 'NA' ? t.na : t.count(c.count ?? 0)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {(m.reasons?.length ?? 0) > 0 && (
                    <p className="flex flex-wrap gap-1">
                      {m.reasons!.map((r) => (
                        <span key={r} className="badge badge-sm badge-ghost">
                          {t.reason[r] ?? r}
                        </span>
                      ))}
                    </p>
                  )}
                  {(m.sources?.length ?? 0) > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-base-content/60">{t.sources(m.sources!.length)}</summary>
                      <p className="mt-1 break-all font-mono">{m.sources!.join(', ')}</p>
                    </details>
                  )}
                </article>
              );
            })}
          </div>
          <p className="text-xs text-base-content/55">{t.receiptNote}</p>
        </div>
      )}
    </QueryState>
  );
}

