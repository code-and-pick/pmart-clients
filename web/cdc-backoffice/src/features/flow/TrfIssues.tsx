// TRF 상세 — 이 요청에서 손볼 것(사용자 2026-11-27 "실시간 흐름을 파악하기가 너무 어렵다" → 2 "번호 하나로 다 보기").
// 서버 값만: TRF 상태·확보 수량, 피킹 부족(shortages PENDING 중 이 TRF), 박스 검사 불합격(lpns?trfId), MFC 입고 안 맞음(transits?trfId).
// 못 읽은 것은 "일부를 못 읽었어요"(문제 없음으로 꾸미지 않음).
import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import type { components } from '../../api/generated/cdc-outbound';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { receiptOf, transitsKey } from '../mfc-flow/transits';

const t = messages.trfIssues;
type TransferDetail = components['schemas']['TransferDetail'];

export function TrfIssues({ cdcId, trf }: { readonly cdcId: string; readonly trf: TransferDetail }) {
  const api = useApi();
  const trfId = trf.trfId;
  const [short, lpns, transit] = useQueries({
    queries: [
      {
        queryKey: ['cdc', cdcId, 'shortages', 'PENDING', 'list'],
        refetchInterval: 15_000,
        queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/shortages', { params: { path: { cdcId }, query: { state: 'PENDING', size: 200 } } })),
      },
      {
        queryKey: ['cdc', cdcId, 'lpns', 'trf', trfId],
        refetchInterval: 15_000,
        queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/lpns', { params: { path: { cdcId }, query: { trfId, size: 200 } } })),
      },
      {
        queryKey: [...transitsKey(cdcId), 'trf', trfId],
        refetchInterval: 15_000,
        enabled: trf.state === 'DEPARTED',
        queryFn: () => request('GET', api.inventory.GET('/cdcs/{cdcId}/transits', { params: { path: { cdcId }, query: { trfId, size: 1 } } })),
      },
    ],
  });
  const items: { key: string; text: string; to: string }[] = [];
  if (trf.state === 'ALLOCATION_FAILED') items.push({ key: 'alloc', text: t.allocFailed(trf.allocationError ?? null), to: centerPath(cdcId, 'inventory') });
  if (trf.state === 'PARTIALLY_ALLOCATED') items.push({ key: 'partial', text: t.partial(trf.allocatedQty, trf.approvedQty), to: centerPath(cdcId, 'inventory') });
  for (const s of (short.data?.items ?? []).filter((x) => x.trfId === trfId))
    items.push({ key: `short-${s.followupId}`, text: t.shortage(s.sku, s.unresolvedQty ?? s.shortQty, s.locationCode ?? messages.none), to: centerPath(cdcId, 'picking') });
  for (const l of (lpns.data?.items ?? []).filter((x) => x.inspection === 'FAIL'))
    items.push({ key: `lpn-${l.lpn}`, text: t.lpnFail(l.lpn, l.failReason ?? null), to: `${centerPath(cdcId, 'shipping')}?v=lpns` });
  if (trf.state === 'MISMATCHED') items.push({ key: 'mismatch', text: t.mismatched, to: `${centerPath(cdcId, 'shipping')}?result=MISMATCHED` });
  const ct = transit.data?.items[0];
  if (ct && receiptOf(ct) === 'MISMATCH') items.push({ key: 'receipt', text: t.receiptBad(ct.totals.unreconciledQty ?? 0), to: `${centerPath(cdcId, 'mfc-flow')}?receipt=MISMATCH` });
  const failed = short.isError || lpns.isError || transit.isError;
  const loading = short.isPending || lpns.isPending;
  return (
    <div className={`space-y-2 rounded-box border p-4 ${items.length > 0 ? 'border-warning bg-warning/5' : 'border-base-300 bg-base-100'}`} data-testid="trf-issues">
      <h2 className="text-base font-semibold">{t.title}</h2>
      {items.length > 0 ? (
        <ul className="space-y-1">
          {items.map((x) => (
            <li key={x.key}>
              <Link className="link-hover flex items-start gap-2 text-sm" to={x.to}>
                <span aria-hidden className="text-warning">
                  !
                </span>
                <span>{x.text} ›</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : loading ? (
        <p className="text-sm text-base-content/50">…</p>
      ) : (
        !failed && <p className="text-sm text-success">{t.none}</p>
      )}
      {failed && <p className="text-xs text-warning">{t.failed}</p>}
    </div>
  );
}
