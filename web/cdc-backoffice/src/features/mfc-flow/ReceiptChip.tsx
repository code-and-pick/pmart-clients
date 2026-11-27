// 출발한 TRF 의 MFC 입고 반영 한 칸 — "MFC 입고 전 / 받음·n개 안 맞음 / ✓ MFC 입고 완료"(서버 TransitState 그대로).
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { formatSeoul } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { receiptOf, transitsKey, type CenterTransit, type Transits } from './transits';

const r = messages.receipt;

/** 출발한 TRF 한 건 — 최근 출발 200건(transits)에 없으면 trfId 로 한 번 더 묻는다(오래된 출발) */
export function TrfReceiptChip({ cdcId, trfId, transits }: { readonly cdcId: string; readonly trfId: string; readonly transits: Transits }) {
  const api = useApi();
  const listed = transits.byTrf.get(trfId);
  const one = useQuery({
    queryKey: [...transitsKey(cdcId), 'trf', trfId],
    enabled: !listed && !transits.loading && !transits.failed,
    staleTime: 15_000,
    queryFn: () => request('GET', api.inventory.GET('/cdcs/{cdcId}/transits', { params: { path: { cdcId }, query: { trfId, size: 1 } } })),
  });
  return <ReceiptChip ct={listed ?? one.data?.items[0]} loading={transits.loading || one.isFetching} failed={transits.failed || one.isError} />;
}

export function ReceiptChip({ ct, loading, failed }: { readonly ct: CenterTransit | undefined; readonly loading: boolean; readonly failed: boolean }) {
  if (!ct)
    return (
      <span className="text-xs text-base-content/50" data-testid="receipt-chip">
        {loading ? '…' : failed ? r.chipFailed : r.chipNone}
      </span>
    );
  const kind = receiptOf(ct);
  const at = ct.transit.lastReceiptAt ?? ct.transit.reconciledAt;
  const cls = kind === 'DONE' ? 'badge-success' : kind === 'MISMATCH' ? 'badge-warning' : 'badge-ghost';
  return (
    <span className={`badge badge-sm whitespace-nowrap ${cls}`} data-testid="receipt-chip" title={at ? r.chipAt(formatSeoul(at)) : undefined}>
      {kind === 'DONE' ? r.chipDone : kind === 'MISMATCH' ? r.chipMismatch(ct.totals.unreconciledQty ?? 0) : r.chipWaiting}
    </span>
  );
}
