// 화면 번호(ADR-0070, 2026-11-18 사용자 결정 — 백엔드 알림 notice-display-numbers) — 사람이 알아보는 라이더·배송 표시.
// 실서버 확인(2026-11-18): 관제·배송 상세·배차에 라이더가 `RD-5c41a0e7-2ac3-…` 내부 ID 로만 보여 "기사 정보가 안 뜬다"고 느낌.
// - 라이더: "이* · 482913"(가린 이름 · rider riderNumber 6자리). riderId 만 있는 목록은 `GET /riders?riderIds=`(50개까지)로 한 번에.
// - 배송: "74939255-1"(execution deliveryNumber = 주문번호-순번).
// - 번호가 없으면 ID 끝 8자리를 회색으로 + "번호 없음". 내부 ID 전체는 상세의 "시스템 번호"로만(SystemIds).
// - 이메일은 화면에 내지 않는다.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '@pmart/web-core';
import type { components } from '../api/generated/rider';
import { useApi } from '../app/ApiContext';
import { SimBadge } from './sim';

type RiderSummary = components['schemas']['StaffRiderSummary'];

export const numberMessages = {
  noNumber: '번호 없음',
  order: (no: string) => `주문 ${no}`,
  systemIds: '시스템 번호',
  copy: '복사',
  copied: '복사했어요',
} as const;

const tail = (id: string) => id.slice(-8);

/** 번호가 없을 때: ID 끝 8자리 회색 + "번호 없음" */
function NoNumber({ id }: { readonly id: string }) {
  return (
    <span className="text-base-content/45" title={numberMessages.noNumber}>
      <span className="font-mono">{tail(id)}</span>
      <span className="ml-1 text-[11px]">{numberMessages.noNumber}</span>
    </span>
  );
}

/** 라이더 여럿의 가린 이름·번호를 한 번에(50개씩). 못 읽으면 빈 표 — 화면은 "번호 없음"으로 보인다(이름을 지어내지 않는다). */
export function useRiderSummaries(riderIds: ReadonlyArray<string | null | undefined>) {
  const api = useApi();
  const ids = [...new Set(riderIds.filter((x): x is string => !!x))].sort();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  const query = useQuery({
    queryKey: ['rider-summaries', ids],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const pages = await Promise.all(
        chunks.map((c) => request('GET', api.riders.GET('/riders', { params: { query: { riderIds: c.join(','), size: c.length } } }))),
      );
      return pages.flatMap((p) => p.items ?? []);
    },
  });
  const byId = new Map<string, RiderSummary>();
  for (const r of query.data ?? []) if (r.riderId) byId.set(r.riderId, r);
  return byId;
}

/** "이* · 482913" + 시뮬 꼬리표. 이름·번호를 이미 알면 넘기고, 모르면 useRiderSummaries 결과를 넘긴다. */
export function RiderName({
  riderId,
  nameMasked,
  riderNumber,
  className = '',
}: {
  readonly riderId: string | null | undefined;
  readonly nameMasked?: string | null | undefined;
  readonly riderNumber?: string | null | undefined;
  readonly className?: string;
}) {
  if (!riderId) return <span className="text-base-content/40">—</span>;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`} data-testid="rider-name">
      {nameMasked && <span className="font-medium">{nameMasked}</span>}
      {nameMasked && <span className="text-base-content/30">·</span>}
      {riderNumber ? <span className="font-mono font-semibold">{riderNumber}</span> : <NoNumber id={riderId} />}
      <SimBadge riderId={riderId} />
    </span>
  );
}

/**
 * "74939255-1" — 배송 번호가 없으면(LAN 확인 2026-11-18: 번호 기능 전 배송은 null) 서버가 준 주문번호 "주문 43505165",
 * 그것도 없으면 ID 끝 8자리 회색 + "번호 없음".
 */
export function DeliveryNo({
  deliveryId,
  deliveryNumber,
  orderNumber,
}: {
  readonly deliveryId: string;
  readonly deliveryNumber?: string | null | undefined;
  readonly orderNumber?: string | null | undefined;
}) {
  if (deliveryNumber) return <span className="font-mono font-semibold">{deliveryNumber}</span>;
  if (orderNumber)
    return (
      <span className="font-mono font-semibold" title={numberMessages.noNumber}>
        {numberMessages.order(orderNumber)}
      </span>
    );
  return <NoNumber id={deliveryId} />;
}

/** 상세의 접힌 "시스템 번호" — 내부 ID 전체 + 복사 */
export function SystemIds({ ids }: { readonly ids: ReadonlyArray<readonly [string, string | null | undefined]> }) {
  const [copied, setCopied] = useState('');
  const rows = ids.filter((x): x is readonly [string, string] => !!x[1]);
  if (rows.length === 0) return null;
  return (
    <details className="text-xs text-base-content/60" data-testid="system-ids">
      <summary className="cursor-pointer select-none">{numberMessages.systemIds}</summary>
      <dl className="mt-1 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt>{k}</dt>
            <dd className="break-all font-mono">{v}</dd>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => {
                void navigator.clipboard?.writeText(v).then(() => setCopied(v));
              }}
            >
              {copied === v ? numberMessages.copied : numberMessages.copy}
            </button>
          </div>
        ))}
      </dl>
    </details>
  );
}
