// 라이더 운영 화면 공통 부품(2026-11-17, PC 5): 이름표·시각, 명령 결과 나누기, 센터 고르기.
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { CommandRejectedFailure, request, UnknownResultFailure, type CommandResponse } from '@pmart/web-core';
import { formatKrw, formatSeoul } from '@pmart/web-ui';
import { useApi } from '../app/ApiContext';
import { messages } from './messages';
import { ops } from './opsMessages';

export const none = messages.none;
export const label = (map: Readonly<Record<string, string>>, v: string | null | undefined) => (v ? (map[v] ?? v) : none);
export const when = (iso: string | null | undefined) => (iso ? formatSeoul(iso) : none);
export const won = (n: number | null | undefined) => (n === null || n === undefined ? none : formatKrw(n));

/** CommandResponse: REJECTED 는 거절, UNKNOWN_RESULT 는 불명으로 던진다(useCommand 가 나눠 보인다). */
export function settled(res: CommandResponse): CommandResponse {
  if (res.status === 'REJECTED') throw new CommandRejectedFailure(res.nextAction, res.requestId);
  if (res.status === 'UNKNOWN_RESULT') throw new UnknownResultFailure(undefined, res.requestId);
  return res;
}

/** 이름·값 두 칸 목록 */
export function Facts({ rows, testId }: { readonly rows: ReadonlyArray<readonly [string, ReactNode]>; readonly testId?: string }) {
  return (
    <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-1 rounded-box bg-base-100 p-4 text-sm" {...(testId ? { 'data-testid': testId } : {})}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="opacity-70">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** MFC 고르기 — center-master 목록, 못 읽으면 직접 입력(빈 값 = 모든 센터, allowAll 일 때만) */
export function CenterPicker({
  value,
  onChange,
  allowAll = false,
}: {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly allowAll?: boolean;
}) {
  const api = useApi();
  const centers = useQuery({
    queryKey: ['centers', 'MFC'],
    queryFn: () => request('GET', api.center.GET('/centers', { params: { query: { type: 'MFC' } } })),
    staleTime: 5 * 60_000,
  });
  if (centers.isError) {
    return (
      <label className="flex flex-col gap-1 text-sm">
        {ops.center.label}
        <input className="input input-sm w-44" placeholder={ops.center.idPlaceholder} value={value} onChange={(e) => onChange(e.target.value.trim())} />
        <span className="text-xs opacity-60">{ops.center.loadFailed}</span>
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-sm">
      {ops.center.label}
      <select className="select select-sm w-56" value={value} onChange={(e) => onChange(e.target.value)}>
        {(allowAll || !value) && <option value="">{allowAll ? ops.dashboard.allCenters : '—'}</option>}
        {(centers.data?.items ?? []).map((c) => (
          <option key={c.centerId} value={c.centerId ?? ''}>
            {c.name ? `${c.name} (${c.centerId})` : c.centerId}
          </option>
        ))}
      </select>
    </label>
  );
}
