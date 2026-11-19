// 목록 화면 공통 보탬(2026-11-19 통합 백오피스와 맞추기 — 지침 all/2026-11-19-request-ui-ux-align §2·§3·§4).
// - 목록 순서 기억(상세의 이전·다음), 최근 봄 표시, 새로 들어온 줄 5초 강조를 한 번에.
// - 숫자 칸 글자: 서버가 센 값만. 읽는 중 "…", 못 읽음 "?"(0 이 아님), 서버가 한 쪽만 돌려줘 다 세지 못하면 "N건 이상".
import type { ReactNode } from 'react';

import { useNewIds } from './motion';
import { useSeenPaths } from './recentViews';
import { SeenMark } from './SeenMark';
import { ui } from './uiMessages';
import { useRememberQueue } from './workQueue';

/** paths = 목록에 보이는 순서의 상세 주소. scope = 탭·거르기(바뀌면 "새 줄"을 다시 센다) */
export function useListRows(paths: readonly string[] | undefined, scope: string) {
  useRememberQueue(paths);
  const seen = useSeenPaths();
  const fresh = useNewIds(paths, scope);
  return {
    /** 줄에 붙일 class — 방금 새로 들어온 줄만 잠깐 강조(움직임 줄이기면 CSS 가 끈다) */
    rowClass: (path: string) => (fresh.has(path) ? 'row-new' : ''),
    /** 이 브라우저에서 최근 열어 본 상세면 "최근 봄" */
    seenMark: (path: string): ReactNode => <SeenMark seen={seen.has(path)} />,
  };
}

/** 서버가 센 수 하나(통계 API) */
export const statText = (n: number | null | undefined, failed: boolean): string => (typeof n === 'number' ? String(n) : failed ? ui.strip.unknown : ui.strip.loading);

/** 서버 목록 한 쪽으로 센 수 — 다음 쪽이 있으면 "N건 이상" */
export const listCountText = (r: { readonly n: number; readonly more: boolean } | null | undefined, failed: boolean): string =>
  r ? (r.more ? ui.strip.atLeast(r.n) : ui.strip.count(r.n)) : failed ? ui.strip.unknown : ui.strip.loading;
