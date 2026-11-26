// 평면도 작업자 — cdc-outbound 0.18.0 M-1 `GET /cdcs/{cdcId}/workers`(PDA 스캔·피킹 실적의 마지막 칸, 10분 지나면 STALE = "모름").
// 점은 FRESH 만 그 통로 가운데에 찍는다(칸 코드 {센터}-{구역}-{층}-{통로}-… → 평면도 통로). 오래된·모르는 위치는 목록에만 "모름"으로.
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/cdc-outbound';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { useOperatorLabel, Who } from '../../shared/OperatorLabel';

const t = messages.floor;
export type WorkerLocation = components['schemas']['WorkerLocation'];

export function useWorkers(cdcId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['cdc', cdcId, 'workers'],
    refetchInterval: 15_000,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/workers', { params: { path: { cdcId } } })),
  });
}

/** 칸 코드 → 구역·층·통로 번호(모르면 null) */
export function aisleOf(code: string | null | undefined): { zone: string; floor: string; no: number } | null {
  const p = (code ?? '').split('-');
  const no = Number(p[3]);
  if (p.length < 4 || !p[1] || !p[2] || !Number.isFinite(no)) return null;
  return { zone: p[1], floor: p[2], no };
}

/** SVG 안 점 하나 — 이름은 마우스를 올리면(title) */
export function WorkerDot({ w, x, y }: { readonly w: WorkerLocation; readonly x: number; readonly y: number }) {
  const q = useOperatorLabel(w.workerId);
  const name = q.data ? `${q.data.name} · ${q.data.employeeNo}` : messages.operator.unknown;
  return (
    <g data-testid="floor-worker" pointerEvents="none">
      <title>{`${name} — ${w.locationCode ?? ''}`}</title>
      <circle cx={x} cy={y} r={1.1} fill="var(--color-secondary)" stroke="var(--color-base-100)" strokeWidth={0.35} />
      <text x={x} y={y + 0.45} textAnchor="middle" fontSize={1.2} fontWeight={700} fill="var(--color-secondary-content)">
        {q.data?.name.slice(0, 1) ?? '·'}
      </text>
    </g>
  );
}

/** 옆 칸 목록 — 이 층 작업자(신선한 위치 먼저), 모르는 위치는 "모름" */
export function WorkerList({ query, floor }: { readonly query: ReturnType<typeof useWorkers>; readonly floor: string }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-3" data-testid="floor-workers">
      <p className="mb-2 text-sm font-semibold">{t.workers}</p>
      <QueryState state={toUiState(query, (d) => d.workers.filter((w) => w.floor === floor).length === 0)} onRetry={() => void query.refetch()} emptyText={t.workersEmpty}>
        {(d) => (
          <ul className="space-y-1.5 text-sm">
            {d.workers
              .filter((w) => w.floor === floor)
              .sort((a, b) => (a.locationState === 'FRESH' ? 0 : 1) - (b.locationState === 'FRESH' ? 0 : 1))
              .map((w) => (
                <li key={w.workerId} className="flex flex-wrap items-center gap-x-2" data-testid="floor-worker-row">
                  <span className={`inline-block h-2 w-2 rounded-full ${w.locationState === 'FRESH' ? 'bg-secondary' : 'bg-base-content/30'}`} />
                  <Who id={w.workerId} />
                  <span className="font-mono text-xs text-base-content/60">{w.locationState === 'FRESH' ? w.locationCode : t.unknownPlace}</span>
                  {w.taskKind && <span className="text-xs">{`${messages.task.kind[w.taskKind] ?? w.taskKind} · ${messages.task.state[w.taskState ?? ''] ?? w.taskState ?? ''}`}</span>}
                  {w.scannedAt && <span className="text-xs text-base-content/50">{formatSeoul(w.scannedAt)}</span>}
                </li>
              ))}
          </ul>
        )}
      </QueryState>
      <p className="mt-2 text-xs text-base-content/50">{t.workersHint}</p>
    </div>
  );
}
