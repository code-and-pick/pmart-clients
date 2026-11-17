// 접수 건 알림 배지(백엔드 요청 2026-11-17 request-last-seen-and-badges §2, 사용자 결정 — 백엔드 변경 없음).
// 화면이 열려 있는 동안 1분마다 `GET /cases?unassigned=true&size=50`·`?overdue=true&size=50` 의 개수를 세어 메뉴 "접수 건" 옆에 배지로.
// 50건을 넘으면(다음 쪽이 있으면) "50+". 늘었을 때만 잠깐 강조 — 소리·브라우저 알림은 쓰지 않는다.
// 맡을 수 있는 사람(지원센터·관리자)에게만. 못 읽으면 0 이 아니라 "?"(조회 실패를 0 으로 보이지 않는다).
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { request } from '@pmart/web-core';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { messages } from '../../shared/messages';

const m = messages.caseBadges;
const SIZE = 50;
const REFRESH_MS = 60_000;
const FLASH_MS = 4_000;

type Filter = 'unassigned' | 'overdue';

function useCaseCount(filter: Filter, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['cases', 'badge', filter],
    enabled,
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const r = await request('GET', api.cases.GET('/cases', { params: { query: { [filter]: true, size: SIZE } } }));
      const n = (r.items ?? []).length;
      return { n, more: Boolean(r.page?.nextCursor) || n > SIZE };
    },
  });
}

function Badge({ filter, enabled }: { readonly filter: Filter; readonly enabled: boolean }) {
  const q = useCaseCount(filter, enabled);
  const prev = useRef<number | null>(null);
  const [flash, setFlash] = useState(false);
  const n = q.data?.n;
  useEffect(() => {
    if (n === undefined) return;
    const grew = prev.current !== null && n > prev.current;
    prev.current = n;
    if (!grew) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(t);
  }, [n]);
  if (!enabled) return null;
  if (q.isError && !q.data)
    return (
      <span className="badge badge-ghost badge-xs" title={m.failed} data-testid={`case-badge-${filter}`}>
        ?
      </span>
    );
  if (!q.data || q.data.n === 0) return null;
  const tone = filter === 'overdue' ? 'badge-error' : 'badge-info';
  return (
    <span
      className={`badge badge-xs ${tone} ${flash ? 'animate-pulse ring-2 ring-warning' : ''}`}
      title={m.title[filter]}
      data-testid={`case-badge-${filter}`}
      data-flash={flash ? 'true' : 'false'}
    >
      {q.data.more ? `${SIZE}+` : q.data.n}
    </span>
  );
}

/** 메뉴 "접수 건" 옆 배지 두 개(안 맡음·기한 지남). 화면 읽기 프로그램에는 링크 이름과 따로 읽힌다(title). */
export function CaseNavBadges() {
  const { session } = useSession();
  const roles = session?.roles ?? [];
  const enabled = roles.includes('RIDER_OPS') || roles.includes('OPERATOR_ADMIN');
  if (!enabled) return null;
  return (
    <span className="ml-auto flex gap-1" aria-hidden="true">
      <Badge filter="unassigned" enabled={enabled} />
      <Badge filter="overdue" enabled={enabled} />
    </span>
  );
}
