// 작업자·인력 — 배치된 작업자 줄 펼침(사용자 2026-11-26 "작업자 인력 목록 눌러도 아무것도 안 들어가짐").
// 근무(근무조·층·직무·배치한 사람·출퇴근·근무 시간) · 지금 위치(cdc-outbound workers — PDA 마지막 스캔) · 그날 실적(worker-throughput 그날, 그 작업자).
// 모두 서버 값. 근무 시간만 출근~퇴근(아직이면 지금)으로 셈한 참고값.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul } from '@pmart/web-ui';
import type { components } from '../../api/generated/cdc-outbound';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { Who } from '../../shared/OperatorLabel';

const t = messages.workforce;
type Assignment = components['schemas']['ShiftAssignment'];

export function AssignmentDetail({ cdcId, a }: { readonly cdcId: string; readonly a: Assignment }) {
  const api = useApi();
  const date = a.workDate ?? '';
  const [now] = useState(() => Date.now());
  const where = useQuery({
    queryKey: ['cdc', cdcId, 'workers', 'all'],
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/workers', { params: { path: { cdcId } } })),
  });
  const done = useQuery({
    queryKey: ['cdc', cdcId, 'worker-throughput', date, date],
    enabled: !!date,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/worker-throughput', { params: { path: { cdcId }, query: { from: date, to: date } } })),
  });
  const loc = where.data?.workers.find((w) => w.workerId === a.workerId);
  const mine = done.data?.items.find((w) => w.workerId === a.workerId);
  const hours = a.checkInAt ? ((a.checkOutAt ? new Date(a.checkOutAt).getTime() : now) - new Date(a.checkInAt).getTime()) / 3_600_000 : null;
  return (
    <div className="grid gap-3 p-1 md:grid-cols-3" data-testid="assignment-detail">
      <div className="rounded-box border border-base-300 bg-base-100 p-3 text-sm">
        <h3 className="mb-1 font-semibold">{t.detailShift}</h3>
        <p>
          {t.floorLabel(a.floor ?? '')} · {t.roles[a.role ?? ''] ?? a.role}
        </p>
        <p className="text-xs text-base-content/60">
          {t.assignedBy} <Who id={a.assignedBy} />
        </p>
        <p className="mt-1">{hours === null ? t.notIn : t.worked(hours.toFixed(1), !a.checkOutAt)}</p>
      </div>
      <div className="rounded-box border border-base-300 bg-base-100 p-3 text-sm" data-testid="assignment-where">
        <h3 className="mb-1 font-semibold">{t.detailWhere}</h3>
        {where.isError ? (
          <p className="text-base-content/60">{messages.loadFailed}</p>
        ) : !loc ? (
          <p className="text-base-content/60">{where.isPending ? '…' : t.noScan}</p>
        ) : (
          <>
            <p className="font-mono text-xs">{loc.locationCode ?? messages.none}</p>
            <p>
              {[loc.floor ? `${loc.floor}층` : null, loc.zone].filter(Boolean).join(' · ') || messages.none}
              {loc.locationState !== 'FRESH' && <span className="ml-1 badge badge-sm badge-ghost">{t.stale}</span>}
            </p>
            <p className="text-xs text-base-content/60">{loc.scannedAt ? t.scannedAt(formatSeoul(loc.scannedAt)) : messages.none}</p>
            {loc.floor && (
              <Link className="btn btn-xs mt-1" to={`${centerPath(cdcId, 'floor')}?f=${loc.floor}`}>
                {messages.reports.openFloor(loc.floor)}
              </Link>
            )}
          </>
        )}
      </div>
      <div className="rounded-box border border-base-300 bg-base-100 p-3 text-sm" data-testid="assignment-done">
        <h3 className="mb-1 font-semibold">{t.detailDone}</h3>
        {done.isError ? (
          <p className="text-base-content/60">{messages.loadFailed}</p>
        ) : !mine ? (
          <p className="text-base-content/60">{done.isPending ? '…' : t.noDone}</p>
        ) : (
          <ul className="space-y-0.5">
            <li className="flex justify-between">
              <span>{messages.reports.tasks}</span>
              <span className="tabular-nums">{mine.tasks}</span>
            </li>
            <li className="flex justify-between">
              <span>{messages.reports.pickedLines}</span>
              <span className="tabular-nums">{mine.pickedLines}</span>
            </li>
            <li className="flex justify-between">
              <span>{messages.reports.pickedQty}</span>
              <span className="tabular-nums">{mine.pickedQty.toLocaleString('ko-KR')}</span>
            </li>
            <li className={`flex justify-between ${mine.shortLines > 0 ? 'text-error' : ''}`}>
              <span>{messages.reports.shortLabel}</span>
              <span className="tabular-nums">
                {mine.shortLines} · {mine.shortQty}
              </span>
            </li>
          </ul>
        )}
        <Link className="btn btn-xs mt-2" to={`${centerPath(cdcId, 'reports')}?v=workers&from=${date}&to=${date}`}>
          {t.throughputLink}
        </Link>
      </div>
    </div>
  );
}
