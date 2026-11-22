// 화면 번호(ADR-0070, 2026-11-18 사용자 결정 — 백엔드 알림 notice-display-numbers) — 사람이 알아보는 라이더·배송 표시.
// 실서버 확인(2026-11-18): 관제·배송 상세·배차에 라이더가 `RD-5c41a0e7-2ac3-…` 내부 ID 로만 보여 "기사 정보가 안 뜬다"고 느낌.
// - 라이더(ADR-0085, 2026-11-22): 목록엔 "R4829" 만(rider riderNumber — R + 4자리). 가린 이름은 마우스를 올리면(title)·상세에서. riderId 만 있는 목록은 `GET /riders?riderIds=`(50개까지)로 한 번에.
// - 배송(ADR-0085): "D74939255"(execution deliveryNumber = D + 주문번호, 같은 주문 두 번째부터 "D74939255-2").
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

/**
 * "R4829"(가린 이름은 title) + 시뮬 꼬리표(ADR-0085 — 목록엔 번호만). 상세·관제 패널처럼 한 라이더를 크게 보이는 곳은 showName 으로
 * "R4829 · 김*수". 이름·번호를 이미 알면 넘기고, 모르면 useRiderSummaries 결과를 넘긴다.
 */
export function RiderName({
  riderId,
  nameMasked,
  riderNumber,
  showName = false,
  className = '',
}: {
  readonly riderId: string | null | undefined;
  readonly nameMasked?: string | null | undefined;
  readonly riderNumber?: string | null | undefined;
  readonly showName?: boolean;
  readonly className?: string;
}) {
  if (!riderId) return <span className="text-base-content/40">—</span>;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`} data-testid="rider-name" title={nameMasked ?? undefined}>
      {riderNumber ? (
        <>
          <span className="font-mono font-semibold">{riderNumber}</span>
          {showName && nameMasked && (
            <>
              <span className="text-base-content/50" aria-hidden="true">·</span>
              <span className="font-medium">{nameMasked}</span>
            </>
          )}
        </>
      ) : (
        <>
          {/* 번호를 못 받았을 때만 가린 이름을 글자로(옛 기록) */}
          {nameMasked && <span className="font-medium">{nameMasked}</span>}
          <NoNumber id={riderId} />
        </>
      )}
      <SimBadge riderId={riderId} />
    </span>
  );
}

/**
 * "D74939255" — 배송 번호가 없으면(LAN 확인 2026-11-18: 번호 기능 전 배송은 null) 서버가 준 주문번호 "주문 43505165",
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
/** 묶음 조회 한 번에 넣는 배송 수(계약 상한 50) */
const DELIVERY_BATCH = 50;

export function useDeliveryNumbers(deliveryIds: ReadonlyArray<string | null | undefined>) {
  const api = useApi();
  const ids = [...new Set(deliveryIds.filter((x): x is string => !!x))].sort();
  // 50개씩 한 번에(execution 0.31.0 `GET /deliveries?deliveryIds=` — 백엔드 #217). 전에는 배송마다 따로 물었다.
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += DELIVERY_BATCH) chunks.push(ids.slice(i, i + DELIVERY_BATCH));
  const queries = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: ['delivery-numbers', chunk.join(',')],
      staleTime: 5 * 60_000,
      queryFn: () =>
        request('GET', api.execution.GET('/deliveries', { params: { query: { deliveryIds: chunk.join(','), size: chunk.length } } })),
    })),
  });
  const byId = new Map<string, DeliveryNumbers>();
  for (const q of queries) {
    for (const d of q.data?.items ?? []) {
      if (d.deliveryId) byId.set(d.deliveryId, { deliveryNumber: d.deliveryNumber ?? null, orderNumber: d.orderNumber ?? null });
    }
  }
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
 * 찾기 칸 — 화면 번호로 찾는다(ADR-0070 "찾기는 화면 번호로"). 라이더 번호(R4829·4829, ADR-0085)면 `GET /riders?riderNumber=` 로 라이더 ID 를 찾고,
 * 그 밖 글자는 라이더 ID 로 그대로 쓴다. 번호에 맞는 라이더가 없으면 null(화면은 "없어요").
 */
export async function resolveRiderId(api: ReturnType<typeof useApi>, text: string): Promise<string | null> {
  const q = text.trim();
  if (!isRiderNumber(q)) return q;
  const r = await request('GET', api.riders.GET('/riders', { params: { query: { riderNumber: q, size: 1 } } }));
  return r.items?.[0]?.riderId ?? null;
}

/** 라이더 번호 입력 칸(ADR-0085): 숫자만 받아 앞에 R 을 붙인다("4829" → "R4829", 5자리까지). 비우면 빈 글자. */
export const riderNumberInput = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 5);
  return d ? `R${d}` : '';
};

/** 라이더 번호 찾기 글자(ADR-0085): R4829·r4829·4829(5자리도) — 서버가 같은 번호로 본다. */
export const isRiderNumber = (q: string) => /^[Rr]?\d{4,5}$/.test(q.trim());

/** 배송 번호 찾기 글자(ADR-0085): D74939255·d74939255·74939255, 두 번째 배송부터 -2. 주문번호 8자리와 순번(없으면 1). */
export function parseDeliveryNumber(q: string): { readonly orderNumber: string; readonly seq: number } | null {
  const m = /^[Dd]?(\d{8})(?:-(\d{1,3}))?$/.exec(q.trim());
  return m ? { orderNumber: m[1]!, seq: m[2] ? Number(m[2]) : 1 } : null;
}

/** 주문번호·순번 → 화면 배송 번호(서버 deliveryNumber 와 같은 모양). */
export const deliveryNumberOf = (orderNumber: string, seq: number) => `D${orderNumber}${seq > 1 ? `-${seq}` : ''}`;

/**
 * 배송 찾기 칸 — 배송 번호("D74939255")면 앞 8자리 주문번호로 찾아 그 번호의 배송 ID, 그 밖 글자는 배송 ID 로 그대로.
 * 맞는 배송이 없으면 null.
 */
export async function resolveDeliveryId(api: ReturnType<typeof useApi>, text: string): Promise<string | null> {
  const q = text.trim();
  const p = parseDeliveryNumber(q);
  if (!p) return q;
  const want = deliveryNumberOf(p.orderNumber, p.seq);
  const r = await request('GET', api.execution.GET('/deliveries', { params: { query: { orderNumber: p.orderNumber, size: 20 } } }));
  return (r.items ?? []).find((d) => d.deliveryNumber === want)?.deliveryId ?? null;
}

export const searchHint = {
  rider: '라이더 번호 R4829(또는 라이더 ID)',
  delivery: '배송 번호 D74939255(또는 배송 ID)',
} as const;
