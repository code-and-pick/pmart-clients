// 오늘 흐름 — DC → MFC 일곱 칸(사용자 2026-11-27 "백오피스로 내용이나 실시간 흐름을 파악하기가 너무 어렵다" → 1).
// 칸 = 지금 그 단계에 있는 요청(TRF) 수. 칸을 누르면(주소 ?stage=) 아래에 그 요청들, 요청을 누르면 TRF 상세(처음부터 끝까지·손볼 것).
// 읽는 것: 최근 바뀐 TRF 200건(cdc-outbound) · 운행 정차(transport-execution — 인계) · MFC 입고(cdc-inventory transits). 15초마다.
// ⑦ MFC 입고 끝은 오늘(서울) 입고한 것만 — 지난 날 끝난 것까지 세면 칸이 계속 커진다.
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/cdc-outbound';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { MfcName } from '../../shared/MfcName';
import { shortRef } from '../../shared/shortRef';
import { useTransits } from '../mfc-flow/transits';
import { useTripStops } from '../mfc-flow/tripStops';
import { todaySeoul } from '../transport/TransportPage';
import { trfWavePath } from '../trf-wave/TrfWavePages';
import { FLOW_STAGES, flagsOf, flowStageOf, type FlowStage } from './flowStage';

const t = messages.flowBoard;
const REFRESH = 15_000;
const LIST_MAX = 50;
type TransferSummary = components['schemas']['TransferSummary'];
const seoulDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(iso));

export function FlowBoard({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const transfers = useQuery({
    queryKey: ['cdc', cdcId, 'transfers', 'flow'],
    refetchInterval: REFRESH,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/transfers', { params: { path: { cdcId }, query: { size: 200 } } })),
  });
  const stops = useTripStops(cdcId, REFRESH);
  const transits = useTransits(cdcId, REFRESH);
  const [params, setParams] = useSearchParams();
  const raw = params.get('stage') ?? '';
  const picked = (FLOW_STAGES as readonly string[]).includes(raw) ? (raw as FlowStage) : null;
  const pick = (s: FlowStage | null) => {
    const q = new URLSearchParams(params);
    if (s && s !== picked) q.set('stage', s);
    else q.delete('stage');
    setParams(q, { replace: true });
  };
  const today = todaySeoul();

  const byStage = useMemo(() => {
    const m = new Map<FlowStage, { x: TransferSummary; flags: ReturnType<typeof flagsOf> }[]>(FLOW_STAGES.map((s) => [s, []]));
    for (const x of transfers.data?.items ?? []) {
      const at = stops.byTrf.get(x.trfId);
      const ct = transits.byTrf.get(x.trfId);
      const s = flowStageOf(x.state, at, ct);
      if (!s) continue;
      if (s === 'STOCKED') {
        const when = ct?.transit.lastReceiptAt ?? ct?.transit.reconciledAt;
        if (!when || seoulDay(when) !== today) continue;
      }
      m.get(s)!.push({ x, flags: flagsOf(x, at, ct) });
    }
    const at = (x: TransferSummary) => Date.parse(x.updatedAt ?? x.createdAt ?? '') || 0;
    for (const rows of m.values()) rows.sort((a, b) => b.flags.length - a.flags.length || at(b.x) - at(a.x));
    return m;
  }, [transfers.data, stops.byTrf, transits.byTrf, today]);

  return (
    <section className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4" data-testid="flow-board">
      <div>
        <h2 className="text-base font-semibold">{t.title}</h2>
        <p className="text-xs text-base-content/60">{t.lead}</p>
      </div>
      <QueryState state={toUiState(transfers)} onRetry={() => void transfers.refetch()}>
        {(d) => (
          <>
            <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7" data-testid="flow-board-steps">
              {FLOW_STAGES.map((s, i) => {
                const rows = byStage.get(s) ?? [];
                const bad = rows.filter((r) => r.flags.length > 0).length;
                const on = picked === s;
                const dcSide = i < 4;
                return (
                  <li key={s}>
                    <button
                      type="button"
                      className={`flex h-full w-full flex-col gap-1 rounded-box border p-3 text-left transition ${on ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-base-300 hover:bg-base-200'}`}
                      aria-pressed={on}
                      onClick={() => pick(s)}
                      data-testid={`flow-board-${s}`}
                    >
                      <span className={`text-[11px] font-medium ${dcSide ? 'text-base-content/50' : 'text-info'}`}>{dcSide ? 'DC' : 'MFC 로'}</span>
                      <span className="text-sm font-semibold">{t.steps[s]}</span>
                      <span className="text-2xl font-semibold tabular-nums">{t.count(rows.length)}</span>
                      {bad > 0 && <span className="badge badge-warning badge-sm">{t.problems(bad)}</span>}
                      <span className="mt-auto text-[11px] leading-snug text-base-content/55">{t.says[s]}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {(stops.failed || transits.failed) && (
              <p role="note" className="text-xs text-warning">
                {t.failed}
              </p>
            )}
            {d.hasNext && <p className="text-xs text-base-content/55">{t.partial}</p>}
            {picked ? <StageList cdcId={cdcId} stage={picked} rows={byStage.get(picked) ?? []} /> : <p className="text-xs text-base-content/55">{t.pick}</p>}
          </>
        )}
      </QueryState>
    </section>
  );
}

function StageList({ cdcId, stage, rows }: { readonly cdcId: string; readonly stage: FlowStage; readonly rows: readonly { x: TransferSummary; flags: ReturnType<typeof flagsOf> }[] }) {
  const f = t.flag;
  return (
    <div className="space-y-2" data-testid="flow-board-list">
      <h3 className="text-sm font-semibold">{t.listTitle(t.steps[stage] ?? stage, rows.length)}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-base-content/60">{t.listEmpty}</p>
      ) : (
        <div className="overflow-x-auto rounded-box border border-base-300">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>{t.col.no}</th>
                <th>{t.col.mfc}</th>
                <th>{t.col.due}</th>
                <th>{t.col.updated}</th>
                <th>{t.col.note}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, LIST_MAX).map(({ x, flags }) => (
                <tr key={x.trfId} className="hover" data-testid="flow-board-row">
                  <td>
                    <Link className="link font-mono text-xs font-semibold" to={trfWavePath(cdcId, `trf/${encodeURIComponent(x.trfId)}`)} title={x.trfId}>
                      {x.trfNumber ?? shortRef(x.trfId)} ›
                    </Link>
                  </td>
                  <td className="text-xs">
                    <MfcName id={x.mfcId} />
                  </td>
                  <td className="whitespace-nowrap text-xs">{formatSeoul(x.dueAt)}</td>
                  <td className="whitespace-nowrap text-xs text-base-content/60">{x.updatedAt ? formatSeoul(x.updatedAt) : messages.none}</td>
                  <td className="text-xs">
                    {flags.length === 0 ? (
                      <span className="text-base-content/40">{messages.none}</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {flags.map((g) => (
                          <span key={g} className="badge badge-warning badge-sm whitespace-nowrap">
                            {g === 'short' ? f.short(x.shortQty) : f[g]}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > LIST_MAX && (
        <Link className="link text-xs" to={centerPath(cdcId, 'trf-wave')}>
          {t.more(rows.length - LIST_MAX)}
        </Link>
      )}
    </div>
  );
}
