// 다시 지급해야 할 묶음(2026-11-24 사용자 "정상으로 지급해야 하는 건 지급 실패로 처리해도 다시 지급하려고 시도해야 하고 무조건 줘야 하잖아").
// 다시 지급이 끝날 때까지(지급 완료) 메뉴 숫자·지급 관리 위 경고·대시보드 할 일에서 사라지지 않게 한다.
// execution 0.42.0(2026-11-24 "실패한 지급을 다음 지급일로 자동으로 넘겨"): 실패 줄은 서버가 다음 지급일 묶음으로 넘겨 CONFIRMED 가 된다.
// 그래서 세는 것 = 넘어온 줄이 있는데 아직 지급 완료가 아닌 묶음(rolledInCount > 0) + 아직 안 넘어간 지급 실패 묶음(1분 주기 사이).
// 기간 조회 한 번(`GET /rider-payouts?from&to`, 최대 31일) — 오늘 앞뒤 15일(넘긴 날은 다음 영업일이라 앞날도 본다).
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';

export const FAILED_WINDOW_DAYS = 15;
const REFRESH_MS = 5 * 60_000;

const seoulDay = (offsetDays: number) => {
  const d = new Date(Date.now() + 9 * 3600_000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

type Bundle = { readonly state: string; readonly rolledInCount?: number | undefined; readonly payoutDate: string; readonly riderId: string; readonly total: number; readonly escalated?: boolean | undefined };

/** 다시 지급해야 하는 묶음인가(지급 실패이거나, 실패로 넘어온 줄이 있는데 아직 지급 완료 전) */
export const needsRepay = (p: Bundle) => p.state === 'PAYMENT_FAILED' || ((p.rolledInCount ?? 0) > 0 && p.state !== 'PAID');

export interface FailedPayouts {
  /** 다시 지급해야 할 묶음 수 */
  readonly count: number;
  /** 그 묶음의 지급 예정일(가까운 날 먼저) */
  readonly dates: readonly string[];
  /** 못 읽었으면 true(0 으로 보이지 않게) */
  readonly failed: boolean;
  /** 아직 읽는 중 */
  readonly loading: boolean;
  /** (0.43.0) 자동 넘김 상한(0.43.2 기본 2번)을 다 쓰고 또 실패 — 직원이 직접 지급해야 하는 묶음(날짜 무관) */
  readonly escalated: readonly Bundle[];
}

export function useFailedPayouts(enabled = true): FailedPayouts {
  const api = useApi();
  const from = seoulDay(-FAILED_WINDOW_DAYS);
  const to = seoulDay(FAILED_WINDOW_DAYS);
  const q = useQuery({
    queryKey: ['failed-payouts', from, to],
    enabled,
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
    queryFn: () => request('GET', api.execution.GET('/rider-payouts', { params: { query: { from, to } } })),
  });
  // (0.43.0, 사용자 "넘기는 횟수에 상한을 둬. 3번 안에는 반드시 줘야해") 상한을 다 쓴 묶음은 날짜와 상관없이 따로 묻는다
  const esc = useQuery({
    queryKey: ['failed-payouts', 'escalated'],
    enabled,
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
    queryFn: () => request('GET', api.execution.GET('/rider-payouts', { params: { query: { escalated: true } } })),
  });
  const escalated = esc.data?.items ?? [];
  const key = (p: Bundle) => `${p.riderId}|${p.payoutDate}`;
  const escKeys = new Set(escalated.map(key));
  // 기간 안 묶음 중 상한 묶음과 겹치는 것은 한 번만 센다
  const hits = (q.data?.items ?? []).filter((p) => needsRepay(p) && !escKeys.has(key(p)));
  const dates = [...new Set(hits.map((p) => p.payoutDate))].toSorted();
  return { count: hits.length + escalated.length, dates, failed: q.isError || esc.isError, loading: (q.isPending || esc.isPending) && enabled, escalated };
}

export const failedText = {
  menuTitle: '다시 지급해야 할 묶음(지급 실패로 넘어옴)',
  bannerTitle: (n: number) => `지급 실패로 넘어온 묶음 ${n}건 — 그날 꼭 지급해요`,
  escalatedTitle: (n: number) => `직접 지급해야 할 묶음 ${n}건 — 자동 넘김을 다 썼어요`,
  escalatedBody: '더 넘어가지 않아요. 회계에서 직접 보낸 뒤 지급 완료로 표시해요.',
  escalatedItem: (rider: string, date: string, amount: string) => `${rider} · ${date} · ${amount}`,
  bannerBody: '실패한 줄은 다음 지급일로 자동으로 넘어가요.',
  dateLink: (d: string) => `${d.slice(5).replace('-', '/')} 보기`,
  todo: '지급 실패',
  readFail: '지급 실패를 다 읽지 못했어요',
} as const;
