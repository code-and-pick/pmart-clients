// 지급 실패 묶음(2026-11-24 사용자 "정상으로 지급해야 하는 건 지급 실패로 처리해도 다시 지급하려고 시도해야 하고 무조건 줘야 하잖아" → "1번 바로 만들고").
// 다시 지급이 끝날 때까지(지급 완료) 메뉴 숫자·지급 관리 위 경고·대시보드 할 일에서 사라지지 않게 한다.
// 계약 GET /rider-payouts 는 지급 예정일 하나씩만 조회된다(state 만으로 모든 날을 묻는 길이 없다) — 오늘 포함 최근 14일을 날마다 묻는다.
// (백엔드에 "state 만으로 여러 날" 조회와 실패 묶음 다음 지급일 자동 넘김을 요청함 — 2026-11-24)
import { useQueries } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';

export const FAILED_LOOKBACK_DAYS = 14;
const REFRESH_MS = 5 * 60_000;

const seoulDay = (offsetDays: number) => {
  const d = new Date(Date.now() + 9 * 3600_000);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
};

export interface FailedPayouts {
  /** 실패 묶음 수(읽은 날 합계) */
  readonly count: number;
  /** 실패 묶음이 있는 지급 예정일(최근 순) */
  readonly dates: readonly string[];
  /** 하루라도 못 읽었으면 true(0 으로 보이지 않게) */
  readonly failed: boolean;
  /** 아직 읽는 중 */
  readonly loading: boolean;
}

export function useFailedPayouts(enabled = true): FailedPayouts {
  const api = useApi();
  const days = Array.from({ length: FAILED_LOOKBACK_DAYS }, (_, i) => seoulDay(i));
  const qs = useQueries({
    queries: days.map((payoutDate) => ({
      queryKey: ['failed-payouts', payoutDate],
      enabled,
      staleTime: 60_000,
      refetchInterval: REFRESH_MS,
      queryFn: () => request('GET', api.execution.GET('/rider-payouts', { params: { query: { payoutDate, state: 'PAYMENT_FAILED' } } })),
    })),
  });
  let count = 0;
  const dates: string[] = [];
  qs.forEach((q, i) => {
    const n = (q.data?.items ?? []).filter((p) => p.state === 'PAYMENT_FAILED' || p.state === 'MIXED').length;
    if (n > 0) {
      count += n;
      dates.push(days[i]!);
    }
  });
  return { count, dates, failed: qs.some((q) => q.isError), loading: qs.some((q) => q.isPending && enabled) };
}

export const failedText = {
  menuTitle: '다시 지급해야 할 지급 실패 묶음',
  bannerTitle: (n: number) => `지급 실패 ${n}건 — 다시 지급해야 해요`,
  bannerBody: '회계에서 다시 보낸 뒤 "지급 중"·"지급 완료"로 표시해요. 끝날 때까지 이 경고가 남아요.',
  dateLink: (d: string) => `${d.slice(5).replace('-', '/')} 보기`,
  todo: '지급 실패',
  readFail: '지급 실패를 다 읽지 못했어요',
} as const;
