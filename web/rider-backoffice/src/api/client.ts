import createClient from 'openapi-fetch';

import { createPmartFetch, TokenStore, type EmployeeAuthPaths, type PmartFetch } from '@pmart/web-core';
import { SOURCE_SYSTEM } from './command';
import { refreshEmployeeTokens } from './employeeAuth';
import type { paths as CasePaths } from './generated/case';
import type { paths as DispatchPaths } from './generated/delivery-dispatch';
import type { paths as ExecutionPaths } from './generated/delivery-execution';
import type { paths as CenterPaths } from './generated/center-master';
import type { paths as RiderPaths } from './generated/rider';
import type { paths as TrackingPaths } from './generated/delivery-tracking';

export { SOURCE_SYSTEM };

/** 게이트웨이 기준 경로. 기본은 같은 출처(개발 프록시·mock 의 MSW). lan 은 VITE_PMART_API_BASE(게이트웨이 CORS 허용 출처에 있어야 한다). */
export const API_BASE = import.meta.env.VITE_PMART_API_BASE || `${globalThis.location.origin}/api/v1`;

export const tokens = new TokenStore();

/**
 * 뼈대(2026-11-17)는 직원 로그인만 부른다. 메뉴 화면을 만들 때(PC 5) 쓰는 계약을 여기에 더한다 —
 * 예: rider·delivery-dispatch·delivery-execution·delivery-tracking·case·backoffice-bff(`tools/web-tools/gen-api.mjs` 복사 대상에도 같이).
 */
export function createApi(pmartFetch: PmartFetch, baseUrl = API_BASE) {
  const options = { baseUrl, fetch: pmartFetch };
  return {
    employeeAuth: createClient<EmployeeAuthPaths>(options),
    // 접수 건(사건함 — RIDER_OPS 는 배송 쪽 사건만), 배송 찾기·상세(수행), 배차 조회(dispatch)
    cases: createClient<CasePaths>(options),
    execution: createClient<ExecutionPaths>(options),
    dispatch: createClient<DispatchPaths>(options),
    // 라이더 찾기·상세·제한·대시보드 수(2026-11-17), 관제 위치(tracking), 센터 목록(center-master)
    riders: createClient<RiderPaths>(options),
    tracking: createClient<TrackingPaths>(options),
    center: createClient<CenterPaths>(options),
  };
}

export type Api = ReturnType<typeof createApi>;

export const api: Api = createApi(
  createPmartFetch({
    sourceSystem: SOURCE_SYSTEM,
    tokens,
    // 401 이면 refresh token 회전으로 한 번 갱신(single-flight). 세션이 끝나면 tokens 가 비워진다.
    refresh: () => refreshEmployeeTokens(api, tokens),
  }),
);
