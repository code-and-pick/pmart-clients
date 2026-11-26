// 보충관리 — 피킹 선반 칸 판단 펼침(사용자 2026-11-26 "보충관리 목록 눌러도 아무것도 안 들어가짐", "뭔소린지 보기도 어렵고").
// 서버가 계산한 숫자(현재·최소·목표·진행 중·필요·지시·박스 입수)를 그대로 쓰고, 어떻게 나온 값인지 문장으로 풀어 준다.
// 그 칸의 지금 재고(location-stocks)와 이동 이력·로케이션 상세로 바로 간다.
import { Link } from 'react-router';

import { centerPath } from '../../app/nav';
import type { components } from '../../api/generated/cdc-inbound';
import { messages } from '../../shared/messages';
import { HistoryLink } from '../inventory/HistoryTab';
import { LocationStockTable } from '../inventory/LocationStock';

const t = messages.putaway;
type Check = components['schemas']['ReplenishmentCheck'];
const q = (v: number | null | undefined) => (v === null || v === undefined ? null : v.toLocaleString('ko-KR'));

export function CheckDetail({ cdcId, x }: { readonly cdcId: string; readonly x: Check }) {
  const code = x.locationCode ?? '';
  const steps = [
    q(x.currentQty) !== null && q(x.minQty) !== null ? t.explainNow(q(x.currentQty)!, q(x.minQty)!, (x.currentQty ?? 0) <= (x.minQty ?? 0)) : null,
    q(x.needQty) !== null && q(x.targetQty) !== null ? t.explainNeed(q(x.targetQty)!, q(x.currentQty) ?? '0', q(x.openQty) ?? '0', q(x.needQty)!) : null,
    q(x.unitQty) !== null && q(x.orderedQty) !== null ? t.explainUnit(q(x.unitQty)!, q(x.orderedQty)!) : null,
  ].filter((v): v is string => !!v);
  return (
    <div className="space-y-3 p-1" data-testid="check-detail">
      <div className="rounded-box border border-base-300 bg-base-100 p-3 text-sm">
        <h3 className="mb-1 font-semibold">{t.explainTitle}</h3>
        {steps.length > 0 && (
          <ol className="list-decimal space-y-0.5 pl-5">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        )}
        <p className="mt-2" data-testid="check-reason">
          <span className="font-semibold">{t.checkReason[x.reason ?? ''] ?? x.reason}</span> — {t.reasonLong[x.reason ?? ''] ?? messages.none}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link className="btn btn-xs" to={centerPath(cdcId, `master/locations/${encodeURIComponent(code)}`)}>
            {t.openLocation}
          </Link>
          <HistoryLink cdcId={cdcId} loc={code} sku={x.sku ?? undefined} testId="check-history" />
        </div>
      </div>
      <div>
        <h3 className="mb-1 text-sm font-semibold">{t.stockHere}</h3>
        <LocationStockTable cdcId={cdcId} prefix={code} single />
      </div>
    </div>
  );
}
