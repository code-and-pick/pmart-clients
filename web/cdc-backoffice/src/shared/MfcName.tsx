// MFC 이름 — center-master `GET /centers?type=MFC`(이름 = 관리용 명칭). DC 응답에는 MFC ID 만 있어 화면에서 이름을 붙인다.
// 목록을 못 받거나(403·장애) 이름이 없으면 ID 그대로 — 지어낸 이름을 보이지 않는다. 마우스를 올리면 ID.
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { useApi } from '../app/ApiContext';

export function useMfcNames() {
  const api = useApi();
  return useQuery({
    queryKey: ['center-master', 'centers', 'MFC'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const names = new Map<string, string>();
      let cursor: string | undefined;
      for (let i = 0; i < 5; i++) {
        const page = await request('GET', api.center.GET('/centers', { params: { query: { type: 'MFC', size: 200, ...(cursor ? { cursor } : {}) } } }));
        for (const c of page.items ?? []) if (c.centerId && c.name) names.set(c.centerId, c.name);
        cursor = page.page?.nextCursor ?? undefined;
        if (!cursor) break;
      }
      return names;
    },
  });
}

/** 글자만(문구 안에 넣을 때) */
export function useMfcLabel() {
  const names = useMfcNames().data;
  return (id: string | null | undefined) => (id ? (names?.get(id) ?? id) : '');
}

export function MfcName({ id, className = '' }: { readonly id: string | null | undefined; readonly className?: string }) {
  const names = useMfcNames().data;
  if (!id) return null;
  const name = names?.get(id);
  return name ? (
    <span className={className} title={id} data-testid="mfc-name">
      {name}
    </span>
  ) : (
    <span className={`font-mono ${className}`}>{id}</span>
  );
}
