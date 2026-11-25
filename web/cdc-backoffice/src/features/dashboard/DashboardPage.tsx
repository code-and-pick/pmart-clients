// 대시보드·관제 — cdc-outbound 0.11.0 `GET /cdcs/{cdcId}/outbound-summary?date=`(그날 기한 TRF 기준 출고 집계).
// 숫자는 서버 값만(진행률도 서버 progress — 승인 0 이면 null → "승인 0"). 입고는 서비스가 없어 없다고 적는다(지어낸 숫자 없음).
// 설비 가동·공간 점유율·차량 입출차 칸은 두지 않는다(사용자 2026-11-25 "설비센서자산 같은 건 제외").
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import { StatCard } from '@pmart/web-ui/standard';
import type { components } from '../../api/generated/cdc-outbound';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';

const t = messages.dashboard;
type CountByKey = components['schemas']['CountByKey'];

/** 오늘(서울) yyyy-mm-dd */
const todaySeoul = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

export function DashboardPage({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : todaySeoul();
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'outbound-summary', date],
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/outbound-summary', { params: { path: { cdcId }, query: { date } } })),
    refetchInterval: 30_000,
  });
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1>{t.title}</h1>
        <label className="flex items-center gap-2 text-sm">
          {t.date}
          <input
            type="date"
            className="input input-sm w-40"
            value={date}
            onChange={(e) => {
              const q = new URLSearchParams(params);
              if (e.target.value) q.set('date', e.target.value);
              else q.delete('date');
              setParams(q, { replace: true });
            }}
            data-testid="dash-date"
          />
        </label>
      </div>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(s) => (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="dash-cards">
              <StatCard label={t.trfCount} value={s.transferCount} to={centerPath(cdcId, 'trf-wave')} testId="dash-trf" />
              <StatCard label={t.progress} hint={t.progressHint} value={s.progress === null || s.progress === undefined ? t.noProgress : `${Math.round(s.progress * 100)}%`} testId="dash-progress" tone="info" />
              <StatCard label={t.approved} value={messages.qty(s.approvedQty)} testId="dash-approved" />
              <StatCard label={t.allocated} value={messages.qty(s.allocatedQty)} testId="dash-allocated" />
              <StatCard label={t.picked} value={messages.qty(s.pickedQty)} testId="dash-picked" />
              <StatCard label={t.short} value={messages.qty(s.shortQty)} tone={s.shortQty > 0 ? 'error' : undefined} testId="dash-short" />
            </div>
            {s.progress !== null && s.progress !== undefined && (
              <progress className="progress progress-primary h-2 w-full" value={Math.round(s.progress * 100)} max={100} aria-label={t.progress} />
            )}
            <div className="grid gap-4 lg:grid-cols-3">
              <Breakdown title={t.byState} rows={s.transfersByState} name={(k) => messages.trf.state[k] ?? k} link={(k) => `${centerPath(cdcId, 'trf-wave')}?state=${encodeURIComponent(k)}`} testId="dash-trf-states" />
              <Breakdown title={t.waves} rows={s.wavesByState} name={(k) => messages.wave.state[k] ?? k} link={(k) => `${centerPath(cdcId, 'trf-wave')}?view=waves&state=${encodeURIComponent(k)}`} testId="dash-waves" />
              <Breakdown
                title={t.tasks}
                rows={s.tasksByKindState}
                name={(k) => {
                  const [kind = '', state = ''] = k.split(':');
                  return `${messages.task.kind[kind] ?? kind} · ${messages.task.state[state] ?? state}`;
                }}
                testId="dash-tasks"
              />
            </div>
            <p className="text-xs text-base-content/55">
              {s.asOf ? `${t.asOf(formatSeoul(s.asOf))} · ` : ''}
              {t.noInbound}
            </p>
          </>
        )}
      </QueryState>
    </section>
  );
}

/** 상태별 수 — 가로 막대(가장 큰 값 기준 길이). 줄을 누르면 그 상태로 거른 목록 */
function Breakdown({ title, rows, name, link, testId }: { readonly title: string; readonly rows: readonly CountByKey[]; readonly name: (key: string) => string; readonly link?: (key: string) => string; readonly testId: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-4" data-testid={testId}>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-base-content/55">{t.empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const body = (
              <>
                <span className="w-32 shrink-0 truncate text-sm">{name(r.key)}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-base-200">
                  <span className="block h-full rounded-full bg-primary/70" style={{ width: `${(r.count / max) * 100}%` }} />
                </span>
                <span className="w-10 text-right text-sm font-semibold tabular-nums">{r.count}</span>
              </>
            );
            return (
              <li key={r.key}>
                {link ? (
                  <Link className="flex items-center gap-3 rounded px-1 hover:bg-base-200" to={link(r.key)}>
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 px-1">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
