// 화면 번호(ADR-0070, 2026-11-18 사용자 결정 — 백엔드 알림 notice-display-numbers) — 사람이 알아보는 라이더·배송 표시.
// 실서버 확인(2026-11-18): 관제·배송 상세·배차에 라이더가 `RD-5c41a0e7-2ac3-…` 내부 ID 로만 보여 "기사 정보가 안 뜬다"고 느낌.
// - 라이더: "R4785"(rider riderNumber — ADR-0085 2026-11-22 부터 R + 4자리, 드물게 5자리). 목록·표·지도는 번호만, 가린 이름은
//   마우스를 올리면(title)·상세에서. riderId 만 있는 목록은 `GET /riders?riderIds=`(50개까지)로 한 번에.
// - 배송: "D74939255"(execution deliveryNumber — ADR-0085: D + 주문번호, 같은 주문 두 번째부터 "D74939255-2"). 값 그대로 보인다.
// - 번호가 없으면 ID 끝 8자리를 회색으로 + "번호 없음". 내부 ID 전체는 상세의 "시스템 번호"로만(SystemIds).
// - 이메일은 화면에 내지 않는다.
import { useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import type { components } from '../api/generated/rider';
import { useApi } from '../app/ApiContext';
import { labelText, useEmployeeLabel } from './employeeLabels';
import { messages } from './messages';
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
 * "R4785" + 시뮬 꼬리표(가린 이름은 title). [withName] 이면(상세 머리 등) "김*수 · R4785".
 * 번호가 없으면(옛 기록) 가린 이름 + ID 끝 8자리 "번호 없음"(ADR-0070 그대로).
 * 이름·번호를 이미 알면 넘기고, 모르면 useRiderSummaries 결과를 넘긴다.
 */
export function RiderName({
  riderId,
  nameMasked,
  riderNumber,
  withName = false,
  className = '',
}: {
  readonly riderId: string | null | undefined;
  readonly nameMasked?: string | null | undefined;
  readonly riderNumber?: string | null | undefined;
  readonly withName?: boolean;
  readonly className?: string;
}) {
  if (!riderId) return <span className="text-base-content/40">—</span>;
  const showName = !!nameMasked && (withName || !riderNumber);
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`} data-testid="rider-name" title={nameMasked ?? undefined}>
      {showName && <span className="font-medium">{nameMasked}</span>}
      {showName && <span className="text-base-content/50" aria-hidden="true">·</span>}
      {riderNumber ? <span className="font-mono font-semibold">{riderNumber}</span> : <NoNumber id={riderId} />}
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
  kindTag = true,
}: {
  readonly deliveryId: string;
  readonly deliveryNumber?: string | null | undefined;
  readonly orderNumber?: string | null | undefined;
  /** 같은 주문의 두 번째 배송부터(-2·-3…) 번호 뒤에 종류(회수·반납·재발송·다시 배송). 상세 머리처럼 종류 꼬리표가 따로 있으면 false */
  readonly kindTag?: boolean;
}) {
  if (deliveryNumber)
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <span className="font-mono font-semibold">{deliveryNumber}</span>
        {kindTag && SEQ_SUFFIX.test(deliveryNumber) && <DeliveryKindTag deliveryId={deliveryId} />}
      </span>
    );
  if (orderNumber)
    return (
      <span className="font-mono font-semibold" title={numberMessages.noNumber}>
        {numberMessages.order(orderNumber)}
      </span>
    );
  return <NoNumber id={deliveryId} />;
}

/** 번호 끝 -순번(ADR-0085 — 같은 주문의 두 번째 배송부터) */
const SEQ_SUFFIX = /-\d+$/;

/**
 * -2·-3 배송의 종류(2026-11-24 사용자 "-1, -2, -3 뒤에 회수·반납·재발송·다시 배송 표시 안 되던데?") — ADR-0085 "종류 표시는 번호 옆에".
 * 번호만 받은 칸이 많아 여기서 그 배송을 묶음 조회(`GET /deliveries?deliveryIds=`)로 한 번 읽는다(5분 캐시, -순번이 있는 번호만).
 * 목적(purpose)이 있으면 목적, 없으면 종류(type). 읽는 중·못 읽음이면 꼬리표를 붙이지 않는다(지어내지 않음).
 */
/**
 * 꼬리표 짧은 글자 네 가지(2026-11-24 사용자 "회수 · 반납 · 재발송 · 다시배송 네 가지로만 줄이고, 자세한 이름은 마우스를 올리면") —
 * 회수(반품 회수·오배송 회수·회수 배송), 반납(전달 실패 반납), 재발송(오배송·사고 재발송 — MFC 에서 새 상품), 다시배송(잘못 둔 곳 → 실제 집, 원래 상품).
 */
const SHORT_PURPOSE: Readonly<Record<string, string>> = {
  CLAIM_RETURN: '회수',
  MISDELIVERY_RECOVERY: '회수',
  FAILED_DELIVERY_RETURN: '반납',
  MISDELIVERY_RESHIPMENT: '재발송',
  MISDELIVERY_REDELIVERY: '다시배송',
};
const SHORT_TYPE: Readonly<Record<string, string>> = { RETURN: '회수', RESHIPMENT: '재발송' };

function DeliveryKindTag({ deliveryId }: { readonly deliveryId: string }) {
  const api = useApi();
  const q = useQuery({
    queryKey: ['delivery-kind', deliveryId],
    staleTime: 5 * 60_000,
    queryFn: () => request('GET', api.execution.GET('/deliveries', { params: { query: { deliveryIds: deliveryId, size: 1 } } })),
  });
  const d = q.data?.items?.find((x) => x.deliveryId === deliveryId);
  const purpose = d?.purpose && d.purpose !== 'DELIVERY' ? d.purpose : null;
  const type = d?.type && d.type !== 'FORWARD' ? d.type : null;
  const text = (purpose && SHORT_PURPOSE[purpose]) || (type && SHORT_TYPE[type]) || '';
  if (!text) return null;
  // 자세한 이름(반품 회수·전달 실패 반납 …)은 올려 보면
  const full = (purpose && messages.names.purpose[purpose]) || (type && messages.names.deliveryType[type]) || text;
  return (
    <span className="rounded border border-base-300 px-1 text-[11px] font-medium leading-4 text-base-content/70" title={full} data-testid="delivery-kind">
      {text}
    </span>
  );
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
      // 2026-11-24 사용자 "Claude 개발 시험 · P2026-00001 이거 뭐야? 줄일 수 있으면 줄여" — 목록·표에는 이름만, 사번은 올려 보면(title)
      <span className="whitespace-nowrap" title={`${labelText(label.data)} (${operatorId})`} data-testid="staff-name">
        {label.data.name}
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap text-base-content/70" title={operatorId} data-testid="staff-name">
      {numberMessages.staff} <span className="font-mono text-base-content/45">…{operatorId.slice(-6)}</span>
    </span>
  );
}

/** 라이더 번호 찾기 글자(ADR-0085) — R4785·r4785·4785(드물게 5자리). 서버가 같게 보므로 그대로 보낸다. */
export const RIDER_NUMBER = /^[Rr]?\d{4,5}$/;

/** 라이더 번호 입력 칸 — 앞 R(대문자로)과 숫자 5자리까지만 남긴다("r48-25x" → "R4825"). */
export const riderNumberInput = (text: string): string => /^R?\d{0,5}/.exec(text.toUpperCase().replace(/[^R\d]/g, ''))?.[0] ?? '';

/**
 * 배송 번호 찾기 글자(ADR-0085) — D74939255·d74939255·74939255·D74939255-2. 서버 `orderNumber` 는 숫자 8자리만 받으므로
 * D 와 -순번을 떼어 주문번호와 순번(없으면 1)으로 나눈다. 아니면 null.
 */
export function parseDeliveryNumber(text: string): { readonly orderNumber: string; readonly seq: number } | null {
  const m = /^[Dd]?(\d{8})(?:-(\d+))?$/.exec(text.trim());
  return m ? { orderNumber: m[1]!, seq: m[2] ? Number(m[2]) : 1 } : null;
}

/**
 * 찾기 칸 — 화면 번호로 찾는다(ADR-0070 "찾기는 화면 번호로"). 라이더 번호(R4785)면 `GET /riders?riderNumber=` 로 라이더 ID 를 찾고,
 * 그 밖 글자는 라이더 ID 로 그대로 쓴다. 번호에 맞는 라이더가 없으면 null(화면은 "없어요").
 */
export async function resolveRiderId(api: ReturnType<typeof useApi>, text: string): Promise<string | null> {
  const q = text.trim();
  if (!RIDER_NUMBER.test(q)) return q;
  const r = await request('GET', api.riders.GET('/riders', { params: { query: { riderNumber: q, size: 1 } } }));
  return r.items?.[0]?.riderId ?? null;
}

/**
 * 배송 찾기 칸 — 배송 번호("D74939255"·"D74939255-2")면 주문번호 8자리로 찾아 그 번호의 배송 ID, 그 밖 글자는 배송 ID 로 그대로.
 * 맞는 배송이 없으면 null.
 */
export async function resolveDeliveryId(api: ReturnType<typeof useApi>, text: string): Promise<string | null> {
  const q = text.trim();
  const want = parseDeliveryNumber(q);
  if (!want) return q;
  const r = await request('GET', api.execution.GET('/deliveries', { params: { query: { orderNumber: want.orderNumber, size: 20 } } }));
  return (r.items ?? []).find((d) => d.deliveryNumber && parseDeliveryNumber(d.deliveryNumber)?.seq === want.seq)?.deliveryId ?? null;
}

export const searchHint = {
  rider: '라이더 번호 R4785(또는 라이더 ID)',
  delivery: '배송 번호 D74939255(또는 배송 ID)',
} as const;

/**
 * 라이더 번호 + 라이더 상세로 가는 링크(점선 밑줄 — sim-look.css `a[href^='/riders/']`).
 * 2026-11-24 사용자 "라이더 번호 밑에 점선 표시 안 했네. 해라" — 번호가 글자로만 나오던 곳(배송 관리·상담·관제 최근 배송·배차 제안 등)도
 * 누르면 라이더 정보로 간다는 표시가 있게. 줄 펼치기와 겹치지 않게 누름은 줄로 올리지 않는다.
 */
export function RiderLink({ riderId, nameMasked, riderNumber, withName = false }: { readonly riderId: string; readonly nameMasked?: string | null | undefined; readonly riderNumber?: string | null | undefined; readonly withName?: boolean }) {
  return (
    <Link to={`/riders/${encodeURIComponent(riderId)}`} onClick={(e) => e.stopPropagation()} data-testid="rider-link">
      <RiderName riderId={riderId} nameMasked={nameMasked} riderNumber={riderNumber} withName={withName} />
    </Link>
  );
}
