// 라이더 운영 화면 공통 부품(2026-11-17, PC 5): 이름표·시각, 명령 결과 나누기, 센터 고르기.
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { CommandRejectedFailure, request, UnknownResultFailure, type CommandResponse } from '@pmart/web-core';
import { formatKrw, formatSeoul } from '@pmart/web-ui';
import { useApi } from '../app/ApiContext';
import { messages } from './messages';
import { ops } from './opsMessages';
import { SearchSelect } from './SearchSelect';

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
  compact = false,
}: {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly allowAll?: boolean;
  /** 머리줄용 — 위 "센터" 글자 없이 한 줄(RS-7) */
  readonly compact?: boolean;
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
  // 쳐서 찾는 고르기(2026-11-19 통합 백오피스 SearchSelect 처럼 — 초성도). 센터 ID 는 보이지 않는 찾기 낱말로만(붙여 넣기용, ADR-0070)
  return (
    <div className="flex flex-col gap-1 text-sm">
      {!compact && <span aria-hidden="true">{ops.center.label}</span>}
      <SearchSelect
        label={ops.center.label}
        className={compact ? 'w-full sm:w-44' : 'w-56'}
        value={value}
        loading={centers.isPending}
        {...(allowAll ? { allowEmpty: ops.dashboard.allCenters } : {})}
        placeholder="센터 이름으로 찾기"
        options={(centers.data?.items ?? []).map((c) => ({ value: c.centerId ?? '', label: c.name ?? c.centerId ?? '', keywords: c.centerId ?? '' }))}
        onChange={onChange}
        testId="center-picker"
      />
    </div>
  );
}

/**
 * 센터 ID → 이름(center-master MFC 목록 — 센터 고르기와 같은 캐시). 배송 조회에 mfcName 이 없을 때(옛 배송 등) "MFC-SEED-01" 대신 이름을 보인다.
 * 목록을 못 읽었거나 모르는 ID 는 ID 그대로(이름을 지어내지 않는다).
 */
export function useCenterName(): (id: string | null | undefined) => string | null {
  const api = useApi();
  const centers = useQuery({
    queryKey: ['centers', 'MFC'],
    queryFn: () => request('GET', api.center.GET('/centers', { params: { query: { type: 'MFC' } } })),
    staleTime: 5 * 60_000,
  });
  return (id) => (id ? ((centers.data?.items ?? []).find((c) => c.centerId === id)?.name ?? id) : null);
}

/**
 * 배달지역 짧은 이름(2026-11-24 사용자 "라이더 관리에 배달지역 목포 부산진구 이런식으로 적어줘") — center-master 이름에서
 * 회사·시설 말("PMart ", " MFC", "지점", "센터")만 떼어 지역 이름만. 떼고 남는 게 없으면 원래 이름, 이름을 모르면 ID 그대로.
 */
export function useAreaName(): (id: string | null | undefined) => string | null {
  const centerName = useCenterName();
  return (id) => {
    const full = centerName(id);
    if (!full || full === id) return full;
    const short = full
      .replace(/^PMart\s*/i, '')
      .replace(/\s*(MFC|지점|센터)$/i, '')
      .trim();
    return short || full;
  };
}
