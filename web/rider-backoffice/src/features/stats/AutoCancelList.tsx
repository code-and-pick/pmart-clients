// 배차 불가 자동 취소 내역(2026-11-24 — 사용자 "자동 취소한 것도 라이더 백오피스에서 확인"). dispatch `GET /metrics/auto-cancellations`(0.17.0):
// 약속 + 30분이 지나도 라이더 없이 배차 대기였던 고객 배송에 시스템 취소를 부른 결과. CANCELLED = 주문 취소됨, BLOCKED = 거절돼 다시 부르지 않음(MFC 관리자가 직접 취소).
// 운영 통계(기간)와 관제(막혔고 아직 대기 — BLOCKED_OPEN)가 같이 쓴다.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { ChipGroup, StatusBadge } from '../../shared/admin';
import { DeliveryNo } from '../../shared/displayNumbers';
import { when } from '../../shared/opsUi';

type Filter = 'ALL' | 'CANCELLED' | 'BLOCKED' | 'BLOCKED_OPEN';

export const autoCancelText = {
  title: '배차 불가 자동 취소',
  intro: '라이더가 없어 시스템이 취소를 요청한 배송이에요.',
  // 2026-11-24 사용자 "– 작대기 별론데 UI 이게 최선이야?"·"회색 글 너무 길다" — 제목 · 건수 알약, 안내는 한 마디
  openTitle: '자동 취소 실패',
  openIntro: 'MFC 관리자가 직접 취소해야 해요.',
  filter: { ALL: '전체', CANCELLED: '취소됨', BLOCKED: '막힘' } as const,
  cancelled: '취소됨',
  blocked: '막힘',
  promised: (t: string) => `약속 ${t}`,
  attempted: (t: string) => `요청 ${t}`,
  rejectCode: (c: string) => `거절 ${c}`,
  stillWaiting: '아직 배차 대기',
  empty: '이 기간에 자동 취소한 배송이 없어요.',
  emptyOpen: '직접 취소할 배송이 없어요.',
  failed: '자동 취소 내역을 불러오지 못했어요.',
  loading: '불러오는 중…',
  more: '200건까지 보여요 — 기간을 줄여 보세요.',
} as const;

/** 막혔고 아직 배차 대기인 건 수 — 관제 "먼저 확인해 주세요"(1분마다). 못 읽으면 null */
export function useBlockedAutoCancels(mfcId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['auto-cancellations', 'BLOCKED_OPEN', mfcId],
    enabled: mfcId !== '',
    refetchInterval: 60_000,
    queryFn: () => request('GET', api.dispatch.GET('/metrics/auto-cancellations', { params: { query: { mfcId, filter: 'BLOCKED_OPEN' } } })),
  });
}

export function AutoCancelList({ from, to, mfcId, open = false, centerName }: { readonly from?: string; readonly to?: string; readonly mfcId?: string; readonly open?: boolean; readonly centerName?: (id: string) => string }) {
  const api = useApi();
  const [filter, setFilter] = useState<Exclude<Filter, 'BLOCKED_OPEN'>>('ALL');
  const which: Filter = open ? 'BLOCKED_OPEN' : filter;
  const list = useQuery({
    queryKey: ['auto-cancellations', which, from ?? '', to ?? '', mfcId ?? ''],
    queryFn: () =>
      request(
        'GET',
        api.dispatch.GET('/metrics/auto-cancellations', {
          params: { query: { ...(open ? {} : { from, to }), ...(mfcId ? { mfcId } : {}), filter: which } },
        }),
      ),
  });
  const items = list.data?.items ?? [];
  return (
    <section aria-label={autoCancelText.title} className={`rounded-box border bg-base-100 ${open && items.length > 0 ? 'border-error/40' : 'border-base-300'}`} data-testid={open ? 'auto-cancel-open' : 'auto-cancel-list'}>
      <div className="space-y-2 border-b border-base-300 px-4 py-3">
        {open ? (
          <h2 className="flex items-center gap-2 font-bold">
            {autoCancelText.openTitle}
            {list.data && <span className="pm-count" data-tone={items.length > 0 ? 'urgent' : 'todo'}>{items.length}건</span>}
          </h2>
        ) : (
          <h2 className="font-bold">{autoCancelText.title}</h2>
        )}
        <p className="text-xs text-base-content/60">{open ? autoCancelText.openIntro : autoCancelText.intro}</p>
        {!open && <ChipGroup label="결과" value={filter} options={(['ALL', 'CANCELLED', 'BLOCKED'] as const).map((f) => ({ value: f, label: autoCancelText.filter[f] }))} onChange={setFilter} />}
      </div>
      {list.isPending ? (
        <p className="p-4 text-sm text-base-content/60">{autoCancelText.loading}</p>
      ) : list.isError ? (
        <p role="alert" className="p-4 text-sm text-error">
          {autoCancelText.failed}
        </p>
      ) : items.length === 0 ? (
        <p data-state="empty" className="p-4 text-sm text-base-content/60" style={{ fontWeight: 400 }}>
          {open ? autoCancelText.emptyOpen : autoCancelText.empty}
        </p>
      ) : (
        <ul className="max-h-80 divide-y divide-base-200 overflow-y-auto">
          {items.map((x) => (
            <li key={x.deliveryId} data-testid="auto-cancel-row" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
              {x.result === 'CANCELLED' ? <StatusBadge tone="ghost">{autoCancelText.cancelled}</StatusBadge> : <StatusBadge tone="error">{autoCancelText.blocked}</StatusBadge>}
              <Link className="font-mono text-xs font-semibold hover:underline" to={`/deliveries/${encodeURIComponent(x.deliveryId)}`}>
                <DeliveryNo deliveryId={x.deliveryId} deliveryNumber={x.deliveryNumber} />
              </Link>
              {centerName && <span className="text-xs text-base-content/70">{centerName(x.mfcId)}</span>}
              {x.promisedAt && <span className="text-xs text-base-content/60">{autoCancelText.promised(when(x.promisedAt))}</span>}
              <span className="text-xs text-base-content/60">{autoCancelText.attempted(when(x.attemptedAt))}</span>
              {x.result === 'BLOCKED' && x.rejectCode && <span className="font-mono text-[11px] text-error">{autoCancelText.rejectCode(x.rejectCode)}</span>}
              {x.result === 'BLOCKED' && x.deliveryState === 'DISPATCHING' && <StatusBadge tone="warning">{autoCancelText.stillWaiting}</StatusBadge>}
            </li>
          ))}
        </ul>
      )}
      {items.length >= 200 && <p className="border-t border-base-300 px-4 py-2 text-xs text-base-content/50">{autoCancelText.more}</p>}
    </section>
  );
}
