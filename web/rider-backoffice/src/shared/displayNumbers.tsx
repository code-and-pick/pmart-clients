// 화면 번호(ADR-0070, 2026-11-18 사용자 결정 — 백엔드 알림 notice-display-numbers) — 사람이 알아보는 라이더·배송 표시.
// 실서버 확인(2026-11-18): 관제·배송 상세·배차에 라이더가 `RD-5c41a0e7-2ac3-…` 내부 ID 로만 보여 "기사 정보가 안 뜬다"고 느낌.
// - 라이더: "이* · 482913"(가린 이름 · rider riderNumber 6자리). riderId 만 있는 목록은 `GET /riders?riderIds=`(50개까지)로 한 번에.
// - 배송: "74939255-1"(execution deliveryNumber = 주문번호-순번).
// - 번호가 없으면 ID 끝 8자리를 회색으로 + "번호 없음". 내부 ID 전체는 상세의 "시스템 번호"로만(SystemIds).
// - 이메일은 화면에 내지 않는다.
import { useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import type { components } from '../api/generated/rider';
import { useApi } from '../app/ApiContext';
import { labelText, useEmployeeLabel } from './employeeLabels';
import { SimBadge } from './sim';

type RiderSummary = components['schemas']['StaffRiderSummary'];

export const numberMessages = {
  noNumber: '번호 없음',
  order: (no: string) => `주문 ${no}`,
  systemIds: '시스템 번호',
  copy: '복사',
  copied: '복사했어요',
  me: '나',
  staff: '직원',
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

export interface DeliveryNumbers {
  readonly deliveryNumber?: string | null;
  readonly orderNumber?: string | null;
}

/**
 * 배송 ID 만 있는 목록(수행료·추가 배달료·도움요청·라이더 이력 등)의 배송 번호 — 배송마다 `GET /deliveries/{id}`(직원 조회) 한 번,
 * 5분 캐시. 한꺼번에 받는 조회(deliveryIds)가 계약에 없어 하나씩(백엔드에 요청 — 2026-11-19). 못 읽으면 빈 칸(번호 없음 표시).
 */
export function useDeliveryNumbers(deliveryIds: ReadonlyArray<string | null | undefined>) {
  const api = useApi();
  const ids = [...new Set(deliveryIds.filter((x): x is string => !!x))];
  const queries = useQueries({
    queries: ids.map((deliveryId) => ({
      queryKey: ['delivery-number', deliveryId],
      staleTime: 5 * 60_000,
      queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}', { params: { path: { deliveryId } } })),
    })),
  });
  const byId = new Map<string, DeliveryNumbers>();
  queries.forEach((q, i) => {
    const id = ids[i];
    if (id && q.data) byId.set(id, { deliveryNumber: q.data.deliveryNumber ?? null, orderNumber: q.data.orderNumber ?? null });
  });
  return byId;
}

/** 배송 화면 번호 + 배송 상세로 가는 링크(줄 누르기와 따로) */
export function DeliveryRef({ deliveryId, numbers }: { readonly deliveryId: string | null | undefined; readonly numbers?: DeliveryNumbers | undefined }) {
  if (!deliveryId) return <span className="text-base-content/40">—</span>;
  return (
    <Link to={`/deliveries/${encodeURIComponent(deliveryId)}`} className="hover:underline" onClick={(e) => e.stopPropagation()} data-testid="delivery-ref">
      <DeliveryNo deliveryId={deliveryId} deliveryNumber={numbers?.deliveryNumber} orderNumber={numbers?.orderNumber} />
    </Link>
  );
}

/** 라이더 화면 번호 + 라이더 상세로 가는 링크 */
export function RiderRef({ riderId, summary }: { readonly riderId: string | null | undefined; readonly summary?: RiderSummary | undefined }) {
  if (!riderId) return <span className="text-base-content/40">—</span>;
  return (
    <Link to={`/riders/${encodeURIComponent(riderId)}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
      <RiderName riderId={riderId} nameMasked={summary?.nameMasked} riderNumber={summary?.riderNumber} />
    </Link>
  );
}

/**
 * 직원(처리자·결정자·보낸 사람) — ADR-0070: "이름 · 사번"이 정본이고 OP-… 는 내지 않는다.
 * 2026-11-19: hr 0.8.0 `GET /hr/employee-labels`(shared/employeeLabels — 한 화면의 ID 를 50개씩 묶어 한 번에)로 "이름 · 사번".
 * 로그인한 본인이면 "나". 읽는 중·못 읽음·hr 이 모르는 ID 는 전처럼 "직원 …끝 6자리"(전체 ID 는 마우스를 올리면) — 이름을 지어내지 않는다.
 */
export function StaffName({ operatorId, me }: { readonly operatorId: string | null | undefined; readonly me?: string | undefined }) {
  if (!operatorId) return <span className="text-base-content/40">—</span>;
  if (me && operatorId === me) return <span className="font-medium">{numberMessages.me}</span>;
  if (!operatorId.startsWith('OP-')) return <span>{operatorId}</span>; // 서비스(자동 처리 등) 이름
  return <StaffLabel operatorId={operatorId} />;
}

function StaffLabel({ operatorId }: { readonly operatorId: string }) {
  const label = useEmployeeLabel(operatorId);
  if (label.data) {
    return (
      <span className="whitespace-nowrap" title={operatorId} data-testid="staff-name">
        {labelText(label.data)}
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap text-base-content/70" title={operatorId} data-testid="staff-name">
      {numberMessages.staff} <span className="font-mono text-base-content/45">…{operatorId.slice(-6)}</span>
    </span>
  );
}

/**
 * 찾기 칸 — 화면 번호로 찾는다(ADR-0070 "찾기는 화면 번호로"). 라이더 번호 6자리면 `GET /riders?riderNumber=` 로 라이더 ID 를 찾고,
 * 그 밖 글자는 라이더 ID 로 그대로 쓴다. 번호에 맞는 라이더가 없으면 null(화면은 "없어요").
 */
export async function resolveRiderId(api: ReturnType<typeof useApi>, text: string): Promise<string | null> {
  const q = text.trim();
  if (!/^\d{6}$/.test(q)) return q;
  const r = await request('GET', api.riders.GET('/riders', { params: { query: { riderNumber: q, size: 1 } } }));
  return r.items?.[0]?.riderId ?? null;
}

/**
 * 배송 찾기 칸 — 배송 번호("74939255-1")면 앞 8자리 주문번호로 찾아 그 번호의 배송 ID, 그 밖 글자는 배송 ID 로 그대로.
 * 맞는 배송이 없으면 null.
 */
export async function resolveDeliveryId(api: ReturnType<typeof useApi>, text: string): Promise<string | null> {
  const q = text.trim();
  const m = /^(\d{8})-(\d+)$/.exec(q);
  if (!m) return q;
  const r = await request('GET', api.execution.GET('/deliveries', { params: { query: { orderNumber: m[1]!, size: 20 } } }));
  return (r.items ?? []).find((d) => d.deliveryNumber === q)?.deliveryId ?? null;
}

export const searchHint = {
  rider: '라이더 번호 6자리(또는 라이더 ID)',
  delivery: '배송 번호 74939255-1(또는 배송 ID)',
} as const;
