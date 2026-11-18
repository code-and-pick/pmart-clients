// 왼쪽 메뉴 업무 알림(2026-11-18 사용자 — "메뉴는 전처럼, 거기에 업무 알람이 뜨게"; 홈 타일 대신).
// - 메뉴마다 그 화면의 "할 일" 개수를 배지로. 묶음을 접어 두면 묶음 이름 옆에 합계(기한 지난 것이 있으면 빨강).
// - 이미 있는 목록 조회만 쓴다(새 API 없음). 1분마다 다시 읽고 50건까지 센다 — 다음 쪽이 있으면 "50+".
//   못 읽으면 0 이 아니라 "?"(조회 실패를 0 으로 보이지 않는다). 숫자가 늘면 잠깐 반짝인다. 소리·브라우저 알림은 쓰지 않는다.
// - 메뉴는 역할로 이미 거른 것만 그려지므로 알림도 그 메뉴를 보는 사람만 부른다(판정은 서버 — 403 이면 "?").
//   · 접수 건: 안 맡음(파랑)·기한 지남(빨강) — `GET /cases?unassigned=true` / `?overdue=true`(지금 배지와 같은 조회)
//   · 승인함: 심사 대기 — `GET /approvals?reviewState=REVIEW_PENDING`
//   · 문의 답변 / 라이더 문의: 답변 대기 — `GET /inquiries?requesterType=CUSTOMER|RIDER&status=RECEIVED`
//   · 처리 대기: 처리할 건 — bff `GET /views/pending-work` 줄 수(truncated 면 "+")
import { useQueries, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { request } from '@pmart/web-core';
import { useApi } from './ApiContext';
import { useSession } from './SessionContext';
import { messages } from '../shared/messages';

const m = messages.menuAlerts;
export const ALERT_SIZE = 50;
const REFRESH_MS = 60_000;
const FLASH_MS = 4_000;

export type AlertKey = 'casesUnassigned' | 'casesOverdue' | 'approvals' | 'inquiries' | 'riderInquiries' | 'pending';

interface Count {
  readonly n: number;
  readonly more: boolean;
}

/** 메뉴 경로 → 그 메뉴의 알림(순서 = 배지 순서). 없는 메뉴는 알림 없음 */
export const MENU_ALERTS: Readonly<Record<string, readonly AlertKey[]>> = {
  '/cases': ['casesUnassigned', 'casesOverdue'],
  '/approvals': ['approvals'],
  '/inquiries': ['inquiries'],
  '/rider-inquiries': ['riderInquiries'],
  '/pending': ['pending'],
};

/**
 * 역할로 더 거르는 알림. 접수 건은 맡을 수 있는 사람(지원센터·관리자)만 — 상담원은 메뉴가 보여도 보기만 해서 묻지 않는다(예전 배지 규칙 그대로).
 * 그 밖 알림은 메뉴가 보이는 사람이면 센다(메뉴가 이미 역할로 걸러져 있다).
 */
const canClaimCases = (roles: readonly string[]) => roles.includes('RIDER_OPS') || roles.includes('OPERATOR_ADMIN');
function useAllowed(keys: readonly AlertKey[]): AlertKey[] {
  const { session } = useSession();
  const roles = session?.roles ?? [];
  return keys.filter((k) => (k === 'casesUnassigned' || k === 'casesOverdue' ? canClaimCases(roles) : true));
}

/** 빨강(급함)으로 보일 알림 — 나머지는 파랑 */
const URGENT: ReadonlySet<AlertKey> = new Set(['casesOverdue']);

type Api = ReturnType<typeof useApi>;

/** 알림 하나의 조회(항목 배지·묶음 합계가 같은 queryKey 를 쓴다) */
function alertQuery(api: Api, key: AlertKey) {
  return {
    // 접수 건 두 개는 예전 배지와 같은 queryKey(같은 조회를 두 번 부르지 않는다)
    queryKey: key === 'casesUnassigned' ? ['cases', 'badge', 'unassigned'] : key === 'casesOverdue' ? ['cases', 'badge', 'overdue'] : ['menu-alert', key],
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<Count> => {
      const size = ALERT_SIZE;
      switch (key) {
        case 'casesUnassigned':
        case 'casesOverdue': {
          const filter = key === 'casesUnassigned' ? 'unassigned' : 'overdue';
          const r = await request('GET', api.cases.GET('/cases', { params: { query: { [filter]: true, size } } }));
          const n = (r.items ?? []).length;
          return { n, more: Boolean(r.page?.nextCursor) || n > size };
        }
        case 'approvals': {
          const r = await request('GET', api.approval.GET('/approvals', { params: { query: { reviewState: 'REVIEW_PENDING', size } } }));
          const n = (r.items ?? []).length;
          return { n, more: Boolean(r.page?.nextCursor) || n > size };
        }
        case 'inquiries':
        case 'riderInquiries': {
          const requesterType = key === 'inquiries' ? 'CUSTOMER' : 'RIDER';
          const r = await request('GET', api.cases.GET('/inquiries', { params: { query: { requesterType, status: 'RECEIVED', size } } }));
          const n = (r.items ?? []).length;
          return { n, more: Boolean(r.page?.nextCursor) || n > size };
        }
        case 'pending': {
          const r = await request('GET', api.bff.GET('/views/pending-work', {}));
          return { n: (r.items ?? []).length, more: Boolean(r.truncated) };
        }
      }
    },
  };
}

export function useAlertCount(key: AlertKey) {
  const api = useApi();
  return useQuery(alertQuery(api, key));
}

/** 늘었을 때만 잠깐 true */
function useFlash(n: number | undefined) {
  const prev = useRef<number | null>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (n === undefined) return;
    const grew = prev.current !== null && n > prev.current;
    prev.current = n;
    if (!grew) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(t);
  }, [n]);
  return flash;
}

const shown = (c: Count) => (c.more ? `${ALERT_SIZE}+` : String(c.n));

function AlertBadge({ alert }: { readonly alert: AlertKey }) {
  const q = useAlertCount(alert);
  const flash = useFlash(q.data?.n);
  if (q.isError && !q.data)
    return (
      <span className="badge badge-ghost badge-xs" title={m.failed} data-testid={`menu-alert-${alert}`}>
        ?
      </span>
    );
  if (!q.data || q.data.n === 0) return null;
  return (
    <span
      className={`badge badge-xs ${URGENT.has(alert) ? 'badge-error' : 'badge-info'} ${flash ? 'animate-pulse ring-2 ring-warning' : ''}`}
      title={m.title[alert]}
      data-testid={`menu-alert-${alert}`}
      data-flash={flash ? 'true' : 'false'}
    >
      {shown(q.data)}
    </span>
  );
}

/** 메뉴 항목 옆 배지들 */
export function MenuItemAlerts({ to }: { readonly to: string }) {
  const keys = useAllowed(MENU_ALERTS[to] ?? []);
  if (keys.length === 0) return null;
  // 메뉴 링크 이름에 숫자가 섞이지 않게 화면 읽기에서는 뺀다(배지마다 title 로 뜻을 둔다 — 예전 접수 건 배지와 같음)
  return (
    <span className="ml-auto flex gap-1" aria-hidden="true">
      {keys.map((k) => (
        <AlertBadge key={k} alert={k} />
      ))}
    </span>
  );
}

function GroupSum({ keys }: { readonly keys: readonly AlertKey[] }) {
  // 항목 배지와 같은 queryKey — 같은 캐시를 읽는다
  const api = useApi();
  const qs = useQueries({ queries: keys.map((k) => alertQuery(api, k)) });
  const results = keys.map((k, i) => ({ k, q: qs[i]! }));
  // PC 1 검토(#119): 실패한 메뉴를 0 으로 더하지 않는다 — 하나라도 못 읽었으면 "N+?"(모르는 부분이 있음), 읽는 중이면 합계를 숨긴다.
  const failed = results.some((r) => r.q.isError && !r.q.data);
  const loading = results.some((r) => !r.q.data && !r.q.isError);
  if (loading) return null;
  // 합계는 "할 일" 수 — 접수 건은 안 맡음만 더한다(기한 지남은 안 맡음과 겹칠 수 있어 색으로만)
  const todo = results.filter((r) => r.k !== 'casesOverdue');
  const sum = todo.reduce((n, r) => n + (r.q.data?.n ?? 0), 0);
  const more = todo.some((r) => r.q.data?.more);
  const urgent = results.some((r) => URGENT.has(r.k) && (r.q.data?.n ?? 0) > 0);
  if (failed)
    return (
      <span className={`badge badge-xs ${urgent ? 'badge-error' : 'badge-ghost'}`} title={m.failed} data-testid="menu-alert-group">
        {sum > 0 || more ? `${sum}${more ? '+' : ''}+?` : '?'}
      </span>
    );
  if (sum === 0 && !urgent) return null;
  return (
    <span className={`badge badge-xs ${urgent ? 'badge-error' : 'badge-info'}`} title={m.groupTitle} data-testid="menu-alert-group">
      {more ? `${sum}+` : sum}
    </span>
  );
}

/** 묶음 합계(늘 — 앱 바꾸기 "이 앱 메뉴" 칸) */
export function GroupAlertBadge({ items }: { readonly items: ReadonlyArray<{ readonly to: string }> }) {
  const keys = useAllowed(items.flatMap((i) => MENU_ALERTS[i.to] ?? []));
  if (keys.length === 0) return null;
  return <GroupSum keys={keys} />;
}

/** 묶음 이름 옆 합계 — 묶음이 접혀 있을 때만(펼치면 항목 배지가 보인다) */
export function MenuGroupAlert({ items, open }: { readonly items: ReadonlyArray<{ readonly to: string }>; readonly open: boolean }) {
  const keys = useAllowed(items.flatMap((i) => MENU_ALERTS[i.to] ?? []));
  if (open || keys.length === 0) return null;
  return <GroupSum keys={keys} />;
}
