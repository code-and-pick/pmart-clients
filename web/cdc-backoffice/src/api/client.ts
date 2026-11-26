import createClient from 'openapi-fetch';

import { createPmartFetch, TokenStore, type EmployeeAuthPaths, type PmartFetch } from '@pmart/web-core';
import { SOURCE_SYSTEM } from './command';
import { refreshEmployeeTokens } from './employeeAuth';
import type { paths as CenterPaths } from './generated/center-master';
import type { paths as InventoryPaths } from './generated/cdc-inventory';
import type { paths as LocationPaths } from './generated/cdc-location';
import type { paths as OutboundPaths } from './generated/cdc-outbound';
import type { paths as QualityPaths } from './generated/cdc-quality';
import type { paths as HrPaths } from './generated/hr';
import type { paths as ProductPaths } from './generated/product';
import type { paths as PurchasePaths } from './proposed/purchase';

export { SOURCE_SYSTEM };

/** 게이트웨이 기준 경로. 기본은 같은 출처(개발 프록시·mock 의 MSW). lan 은 VITE_PMART_API_BASE(게이트웨이 CORS 허용 출처에 있어야 한다). */
export const API_BASE = import.meta.env.VITE_PMART_API_BASE || `${globalThis.location.origin}/api/v1`;

export const tokens = new TokenStore();

/** 메뉴별 계약(백엔드 계획 docs/cdc/cdc-backoffice-plan.md §2): TRF·Wave·작업 = cdc-outbound, 재고·상품 취급 = cdc-inventory, 로케이션 = cdc-location */
export function createApi(pmartFetch: PmartFetch, baseUrl = API_BASE) {
  const options = { baseUrl, fetch: pmartFetch };
  return {
    employeeAuth: createClient<EmployeeAuthPaths>(options),
    center: createClient<CenterPaths>(options),
    outbound: createClient<OutboundPaths>(options),
    inventory: createClient<InventoryPaths>(options),
    location: createClient<LocationPaths>(options),
    // 품질 보류·해제·폐기·리콜(cdc-quality 0.3.0)
    quality: createClient<QualityPaths>(options),
    // 내 정보 — hr-service 본인 조회
    hr: createClient<HrPaths>(options),
    // 상품 이름(관리용 명칭) — CDC 응답에 이름이 없어 SKU 로 찾는다(shared/SkuName, 백엔드 P-1 요청)
    product: createClient<ProductPaths>(options),
    // 상품 발주·공급사 — 제안 계약(목 전용, api/proposed/purchase.ts). 실서버에서는 부르지 않는다
    purchase: createClient<PurchasePaths>(options),
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
