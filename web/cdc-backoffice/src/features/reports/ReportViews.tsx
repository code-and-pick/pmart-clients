// 리포트·KPI — 일별 출고·작업자 실적 표. 줄을 누르면 펼친다(사용자 2026-11-26 "목록 눌러도 아무것도 안 들어가짐").
// - 일별: 그날 TRF 상태별 수·MFC 별 승인·할당·피킹·부족(outbound-summary/daily 의 byMfc — 서버 집계 그대로), 그날 대시보드로.
// - 작업자: 종류별 작업 수, 일한 구간·시간당(첫 시작~마지막 끝 기준 참고값 — 쉬는 시간 포함), 그날 근무 배치(shift-assignments), 평면도·작업자·인력으로.
import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/cdc-outbound';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { MfcName } from '../../shared/MfcName';
import { Who } from '../../shared/OperatorLabel';

const t = messages.reports;
const wf = messages.workforce;
type Day = components['schemas']['OutboundSummary'];
const num = (n: number | null | undefined) => (n === null || n === undefined ? messages.none : n.toLocaleString('ko-KR'));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? messages.none : `${(v * 100).toFixed(1)}%`);

function Caret({ open }: { readonly open: boolean }) {
  return (
    <span aria-hidden className="mr-1 inline-block w-3 text-base-content/50">
      {open ? '▾' : '▸'}
    </span>
  );
}

export function DailyView({ cdcId, from, to }: { readonly cdcId: string; readonly from: string; readonly to: string }) {
  const api = useApi();
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'outbound-daily', from, to],
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/outbound-summary/daily', { params: { path: { cdcId }, query: { from, to } } })),
  });
  return (
    <div className="space-y-2">
      <p className="text-xs text-base-content/60">{t.dailyNote}</p>
      <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={t.emptyDaily}>
        {(data) => {
          const max = Math.max(1, ...data.items.map((d) => d.approvedQty));
          return (
            <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <table className="table table-sm" data-testid="daily-table">
                <thead>
                  <tr>
                    <th>{t.date}</th>
                    <th className="text-right">{t.trfs}</th>
                    <th className="text-right">{t.approved}</th>
                    <th className="text-right">{t.allocated}</th>
                    <th className="text-right">{t.picked}</th>
                    <th className="text-right">{t.short}</th>
                    <th className="w-64">{t.progress}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((d) => {
                    const isOpen = open === d.date;
                    return (
                      <Fragment key={d.date}>
                        <tr data-testid="daily-row" className="cursor-pointer hover" onClick={() => setOpen(isOpen ? null : d.date)} aria-expanded={isOpen}>
                          <td className="whitespace-nowrap">
                            <Caret open={isOpen} />
                            {d.date}
                          </td>
                          <td className="text-right tabular-nums">{num(d.transferCount)}</td>
                          <td className="text-right tabular-nums">{num(d.approvedQty)}</td>
                          <td className="text-right tabular-nums">{num(d.allocatedQty)}</td>
                          <td className="text-right tabular-nums">{num(d.pickedQty)}</td>
                          <td className={`text-right tabular-nums ${d.shortQty > 0 ? 'text-error' : ''}`}>{num(d.shortQty)}</td>
                          <td>
                            <span className="flex items-center gap-2">
                              <span className="relative h-2 flex-1 rounded bg-base-200">
                                <span className="absolute inset-y-0 left-0 rounded bg-base-300" style={{ width: `${(d.approvedQty / max) * 100}%` }} />
                                <span className="absolute inset-y-0 left-0 rounded bg-primary" style={{ width: `${(d.pickedQty / max) * 100}%` }} />
                              </span>
                              <span className="w-14 text-right text-xs tabular-nums">{pct(d.progress)}</span>
                            </span>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={7} className="pm-detail bg-base-200/50">
                              <DayDetail cdcId={cdcId} d={d} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}

function DayDetail({ cdcId, d }: { readonly cdcId: string; readonly d: Day }) {
  const byMfc = d.byMfc ?? [];
  return (
    <div className="space-y-3 p-1" data-testid="day-detail">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{t.dayStates}</span>
        {d.transfersByState.length === 0 ? (
          <span className="text-base-content/60">{messages.none}</span>
        ) : (
          d.transfersByState.map((x) => (
            <span key={x.key} className="badge badge-outline badge-sm">
              {messages.trf.state[x.key] ?? x.key} {x.count}
            </span>
          ))
        )}
        <Link className="btn btn-xs ml-auto" to={`${centerPath(cdcId, 'dashboard')}?date=${d.date}`}>
          {t.openDay}
        </Link>
      </div>
      {byMfc.length === 0 ? (
        <p className="text-sm text-base-content/60">{t.noByMfc}</p>
      ) : (
        <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
          <table className="table table-xs" data-testid="day-by-mfc">
            <thead>
              <tr>
                <th>MFC</th>
                <th className="text-right">{t.trfs}</th>
                <th className="text-right">{t.approved}</th>
                <th className="text-right">{t.allocated}</th>
                <th className="text-right">{t.picked}</th>
                <th className="text-right">{t.short}</th>
                <th className="text-right">{t.progress}</th>
              </tr>
            </thead>
            <tbody>
              {byMfc.map((m) => (
                <tr key={m.mfcId}>
                  <td>
                    <MfcName id={m.mfcId} />
                  </td>
                  <td className="text-right tabular-nums">{num(m.transferCount)}</td>
                  <td className="text-right tabular-nums">{num(m.approvedQty)}</td>
                  <td className="text-right tabular-nums">{num(m.allocatedQty)}</td>
                  <td className="text-right tabular-nums">{num(m.pickedQty)}</td>
                  <td className={`text-right tabular-nums ${m.shortQty > 0 ? 'text-error' : ''}`}>{num(m.shortQty)}</td>
                  <td className="text-right tabular-nums">{m.approvedQty > 0 ? pct(m.pickedQty / m.approvedQty) : messages.none}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface Throughput {
  readonly workerId: string;
  readonly tasks: number;
  readonly tasksByKind?: readonly { readonly key: string; readonly count: number }[];
  readonly pickedLines: number;
  readonly pickedQty: number;
  readonly shortLines: number;
  readonly shortQty: number;
  readonly firstStartedAt?: string | null;
  readonly lastCompletedAt?: string | null;
  readonly mainFloor?: string | null;
  readonly mainZone?: string | null;
}

export function WorkersView({ cdcId, from, to }: { readonly cdcId: string; readonly from: string; readonly to: string }) {
  const api = useApi();
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'worker-throughput', from, to],
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/worker-throughput', { params: { path: { cdcId }, query: { from, to } } })),
  });
  return (
    <div className="space-y-2">
      <p className="text-xs text-base-content/60">{t.workersNote}</p>
      <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={t.emptyWorkers}>
        {(data) => (
          <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
            <table className="table table-sm" data-testid="throughput-table">
              <thead>
                <tr>
                  <th>{t.worker}</th>
                  <th className="text-right">{t.tasks}</th>
                  <th className="text-right">{t.pickedLines}</th>
                  <th className="text-right">{t.pickedQty}</th>
                  <th className="text-right">{t.shortLabel}</th>
                  <th>{t.first}</th>
                  <th>{t.last}</th>
                  <th>{t.main}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((w) => {
                  const isOpen = open === w.workerId;
                  return (
                    <Fragment key={w.workerId}>
                      <tr data-testid="throughput-row" className="cursor-pointer hover" onClick={() => setOpen(isOpen ? null : w.workerId)} aria-expanded={isOpen}>
                        <td className="whitespace-nowrap">
                          <Caret open={isOpen} />
                          <Who id={w.workerId} />
                        </td>
                        <td className="text-right tabular-nums">{num(w.tasks)}</td>
                        <td className="text-right tabular-nums">{num(w.pickedLines)}</td>
                        <td className="text-right tabular-nums">{num(w.pickedQty)}</td>
                        <td className={`text-right tabular-nums ${w.shortLines > 0 ? 'text-error' : ''}`}>
                          {num(w.shortLines)} · {num(w.shortQty)}
                        </td>
                        <td className="whitespace-nowrap">{w.firstStartedAt ? formatSeoul(w.firstStartedAt) : messages.none}</td>
                        <td className="whitespace-nowrap">{w.lastCompletedAt ? formatSeoul(w.lastCompletedAt) : messages.none}</td>
                        <td className="whitespace-nowrap">{[w.mainFloor ? `${w.mainFloor}층` : null, w.mainZone].filter(Boolean).join(' · ') || messages.none}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={8} className="pm-detail bg-base-200/50">
                            <WorkerDetail cdcId={cdcId} w={w} from={from} to={to} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </div>
  );
}

function WorkerDetail({ cdcId, w, from, to }: { readonly cdcId: string; readonly w: Throughput; readonly from: string; readonly to: string }) {
  const api = useApi();
  const oneDay = from === to;
  const shifts = useQuery({
    queryKey: ['cdc', cdcId, 'workforce', 'assignments', to],
    enabled: oneDay,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/shift-assignments', { params: { path: { cdcId }, query: { date: to } } })),
  });
  const mine = (shifts.data?.items ?? []).filter((a) => a.workerId === w.workerId);
  const hours = w.firstStartedAt && w.lastCompletedAt ? (new Date(w.lastCompletedAt).getTime() - new Date(w.firstStartedAt).getTime()) / 3_600_000 : null;
  const perHour = (n: number) => (hours && hours > 0 && oneDay ? (n / hours).toFixed(1) : messages.none);
  return (
    <div className="grid gap-3 p-1 md:grid-cols-3" data-testid="worker-detail">
      <div className="rounded-box border border-base-300 bg-base-100 p-3 text-sm">
        <h3 className="mb-1 font-semibold">{t.byKind}</h3>
        {(w.tasksByKind ?? []).length === 0 ? (
          <p className="text-base-content/60">{messages.none}</p>
        ) : (
          <ul className="space-y-0.5">
            {(w.tasksByKind ?? []).map((k) => (
              <li key={k.key} className="flex justify-between">
                <span>{messages.task.kind[k.key] ?? k.key}</span>
                <span className="tabular-nums">{t.count(k.count)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-box border border-base-300 bg-base-100 p-3 text-sm">
        <h3 className="mb-1 font-semibold">{t.pace}</h3>
        <p>{hours !== null && oneDay ? t.span(hours.toFixed(1)) : t.spanMulti}</p>
        <p>
          {t.perHourLines} <span className="font-semibold tabular-nums">{perHour(w.pickedLines)}</span> · {t.perHourQty}{' '}
          <span className="font-semibold tabular-nums">{perHour(w.pickedQty)}</span>
        </p>
        <p className="mt-1 text-xs text-base-content/55">{t.paceNote}</p>
      </div>
      <div className="rounded-box border border-base-300 bg-base-100 p-3 text-sm">
        <h3 className="mb-1 font-semibold">{t.shiftOfDay}</h3>
        {!oneDay ? (
          <p className="text-base-content/60">{t.shiftOneDay}</p>
        ) : mine.length === 0 ? (
          <p className="text-base-content/60">{shifts.isError ? messages.loadFailed : t.noShift}</p>
        ) : (
          mine.map((a) => (
            <p key={a.assignmentId}>
              {a.shiftCode} · {wf.floorLabel(a.floor ?? '')} · {wf.roles[a.role ?? ''] ?? a.role}
              <span className="block text-xs text-base-content/60">
                {wf.in} {a.checkInAt ? formatSeoul(a.checkInAt) : messages.none} · {wf.out} {a.checkOutAt ? formatSeoul(a.checkOutAt) : messages.none}
              </span>
            </p>
          ))
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {w.mainFloor && (
            <Link className="btn btn-xs" to={`${centerPath(cdcId, 'floor')}?f=${w.mainFloor}`}>
              {t.openFloor(w.mainFloor)}
            </Link>
          )}
          <Link className="btn btn-xs" to={`${centerPath(cdcId, 'workers')}?date=${to}`}>
            {t.openWorkforce}
          </Link>
        </div>
      </div>
    </div>
  );
}
