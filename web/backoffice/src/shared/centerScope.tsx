// 센터 고르기(2026-11-23 — PC 1 백엔드 요청서 handoff/clients/backoffice/2026-11-23-request-center-filter.md, 사용자 "응").
// - 머리줄에서 "전체" 또는 운영 중(ACTIVE) MFC 하나를 고른다(center-master `GET /centers`). 화면을 옮겨도, 새로 고쳐도 이 탭에서는 그대로(sessionStorage).
// - 보기만 거른다 — 권한은 그대로. 센터 인자를 받는 목록에만 mfcId·centerId 를 붙이고, 인자가 없는 화면은 "이 화면은 센터로 거를 수 없어 모든 센터"라고 알린다.
// - 화면의 센터 칸(주문 조회 센터 ID, 실시간 배송 센터 등)에 따로 넣은 값이 있으면 그 값이 먼저다.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { useApi } from '../app/ApiContext';
import { messages } from './messages';

const m = messages.centerScope;
const KEY = 'pmart.backoffice.centerScope';

type Scope = { readonly centerId: string; readonly setCenterId: (id: string) => void };
const Ctx = createContext<Scope>({ centerId: '', setCenterId: () => undefined });

function readStored(): string {
  try {
    return window.sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function CenterScopeProvider({ children }: { readonly children: ReactNode }) {
  const [centerId, setState] = useState(readStored);
  const setCenterId = useCallback((id: string) => {
    setState(id);
    try {
      if (id) window.sessionStorage.setItem(KEY, id);
      else window.sessionStorage.removeItem(KEY);
    } catch {
      // 저장 못 해도 이 화면에서는 고른 대로
    }
  }, []);
  const value = useMemo(() => ({ centerId, setCenterId }), [centerId, setCenterId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 머리줄에서 고른 센터 ID — "전체"면 '' */
export const useCenterScope = () => useContext(Ctx).centerId;
export const useSetCenterScope = () => useContext(Ctx).setCenterId;

/** 고를 수 있는 센터 — MFC·운영 중(ACTIVE)만 */
export function useScopeCenters() {
  const api = useApi();
  return useQuery({
    queryKey: ['centers', 'MFC', 'ACTIVE'],
    staleTime: 5 * 60_000,
    queryFn: async () => ((await request('GET', api.center.GET('/centers', { params: { query: { type: 'MFC', state: 'ACTIVE' } } }))).items ?? []).filter((c) => c.type === 'MFC' && c.state === 'ACTIVE'),
  });
}

/** 센터 ID → 이름(못 읽었거나 없으면 ID 그대로) */
export function useCenterName(centerId: string): string {
  const centers = useScopeCenters();
  return centers.data?.find((c) => c.centerId === centerId)?.name ?? centerId;
}

/** 머리줄 센터 고르기 */
export function CenterPicker() {
  const { centerId, setCenterId } = useContext(Ctx);
  const centers = useScopeCenters();
  const list = centers.data ?? [];
  // 고른 센터가 목록에 없으면(닫힘·못 읽음) 그 ID 도 칸에 남겨 둔다 — 몰래 "전체"로 바꾸지 않는다
  const missing = centerId !== '' && !list.some((c) => c.centerId === centerId);
  return (
    <label className="flex shrink-0 items-center gap-1.5 text-xs text-base-content/70" title={centers.isError ? m.failed : m.hint}>
      <span>{m.label}</span>
      <select
        className={`select select-xs w-36 ${centerId ? 'border-primary font-semibold text-primary' : ''}`}
        aria-label={m.pickerLabel}
        value={centerId}
        onChange={(e) => setCenterId(e.target.value)}
        data-testid="center-scope"
      >
        <option value="">{m.all}</option>
        {list.map((c) => (
          <option key={c.centerId} value={c.centerId}>
            {c.name ?? c.centerId}
          </option>
        ))}
        {missing && <option value={centerId}>{centerId}</option>}
      </select>
      {centers.isError && (
        <span className="text-warning" data-testid="center-scope-failed">
          {m.failedShort}
        </span>
      )}
    </label>
  );
}

/**
 * 화면별 센터 고르기 적용(2026-11-23 계약 확인).
 * - applied: 이 화면 목록이 센터 인자를 받아 고른 센터 것만
 * - partial: 일부 칸만(대시보드 — 숫자·보드 중 센터 인자가 있는 것만)
 * - notApplied: 센터와 관련 있지만 계약에 센터 인자가 없어 모든 센터 — 화면에 알린다(사용자 "주문에 붙은 것만" 2026-11-23 — 이 줄들은 그대로 둔다)
 * - 클레임·라이더 컴플레인·CS 후속·처리 대기는 claim CL-8·case R-12·bff BF-4(LAN 배포) 로 applied(2026-11-23)
 * - 표에 없는 화면(상품·진열·검색·행사·고객·도우미 등)은 센터별이 아니라 알리지 않는다.
 *   승인함은 approval centerId 가 있지만 상품·진열·행사처럼 센터 없는 승인이 대부분이라 거르면 빠져 버려 걸지 않는다
 */
const SCOPE: ReadonlyArray<readonly [string, 'applied' | 'partial' | 'notApplied']> = [
  ['/orders', 'applied'],
  ['/live-delivery', 'applied'],
  ['/packing-handover', 'applied'],
  ['/deliveries', 'applied'],
  ['/cases/handovers', 'notApplied'],
  ['/cases', 'applied'],
  ['/case-metrics', 'notApplied'],
  ['/case-sla', 'applied'],
  ['/lookup', 'notApplied'],
  ['/rider-complaints', 'applied'],
  ['/inquiries', 'notApplied'],
  ['/inquiry-satisfaction', 'notApplied'],
  ['/rider-inquiries', 'notApplied'],
  ['/claims', 'applied'],
  ['/follow-ups', 'applied'],
  ['/pending', 'applied'],
  ['/delivery-stats', 'applied'],
];

export function centerScopeOf(pathname: string): 'applied' | 'partial' | 'notApplied' | null {
  if (pathname === '/') return 'partial';
  const hit = SCOPE.find(([p]) => pathname === p || pathname.startsWith(`${p}/`));
  return hit ? hit[1] : null;
}

/** 칸·줄 옆 작은 꼬리 "모든 센터" — 서버가 centerUnfilteredSources 로 센터로 못 걸렀다고 한 값(bff 0.24.0 BF-4) */
export function AllCentersTag() {
  return (
    <span className="ml-1.5 shrink-0 whitespace-nowrap rounded border border-base-300 px-1 text-[10px] font-normal leading-4 tracking-normal text-base-content/55" title={m.allCentersHint} data-testid="all-centers-tag">
      {m.allCenters}
    </span>
  );
}

/** 본문 위 한 줄 — 센터를 골랐는데 이 화면이 거르지 못하면(또는 일부만) 알린다 */
export function CenterScopeNote({ pathname }: { readonly pathname: string }) {
  const centerId = useCenterScope();
  const name = useCenterName(centerId);
  const kind = centerScopeOf(pathname);
  if (!centerId || (kind !== 'notApplied' && kind !== 'partial')) return null;
  return (
    <p className="mb-2 flex items-center gap-1.5 rounded border border-info/30 bg-info/5 px-3 py-1.5 text-xs text-base-content/75" role="note" data-testid="center-scope-note" data-kind={kind}>
      <span aria-hidden="true">ⓘ</span>
      {kind === 'partial' ? m.partial(name) : m.notApplied(name)}
    </p>
  );
}
