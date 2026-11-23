import createClient from 'openapi-fetch';

import type { paths as AssistantPaths } from './generated/ai-assistant';
import type { paths as ApprovalPaths } from './generated/approval';
import type { paths as AuditPaths } from './generated/audit';
import type { paths as BffPaths } from './generated/backoffice-bff';
import type { paths as CasePaths } from './generated/case';
import type { paths as CustomerPaths } from './generated/customer';
import type { paths as CdcInventoryPaths } from './generated/cdc-inventory';
import type { paths as CenterPaths } from './generated/center-master';
import type { paths as ClaimPaths } from './generated/claim';
import type { paths as DispatchPaths } from './generated/delivery-dispatch';
import type { paths as ExecutionPaths } from './generated/delivery-execution';
import type { paths as MfcInventoryPaths } from './generated/mfc-inventory';
import type { paths as OrderPaths } from './generated/order';
import type { paths as RiderPaths } from './generated/rider';
import type { paths as PricingPaths } from './generated/pricing';
import type { paths as ProductPaths } from './generated/product';
import type { paths as PromotionPaths } from './generated/promotion';
import type { paths as ContentPaths } from './generated/product-content';
import type { paths as HrPaths } from './generated/hr';
import type { paths as SearchPaths } from './generated/search';
import type { paths as StorefrontPaths } from './generated/storefront';
import type { paths as ReviewPaths } from './generated/review';
import type { paths as CustomerAssistantPaths } from './generated/customer-assistant';
import { SOURCE_SYSTEM } from './command';
import { refreshEmployeeTokens } from './employeeAuth';
import { createPmartFetch, TokenStore, type EmployeeAuthPaths, type PmartFetch } from '@pmart/web-core';

export { SOURCE_SYSTEM };

/**
 * 게이트웨이 기준 경로. 기본은 같은 출처(개발 프록시·mock 의 MSW).
 * LAN 처럼 게이트웨이가 다른 출처면 VITE_PMART_API_BASE(예: https://192.168.0.40:8443/api/v1) — 게이트웨이 CORS 허용 출처에 있어야 한다.
 */
export const API_BASE = import.meta.env.VITE_PMART_API_BASE || `${globalThis.location.origin}/api/v1`;

/** bff 계약 servers.url = /api/v1/backoffice (게이트웨이 라우트 /api/v1/backoffice/views/**·commands/**). */
export const BFF_BASE = `${API_BASE}/backoffice`;

export const tokens = new TokenStore();

export function createApi(pmartFetch: PmartFetch, baseUrl = API_BASE) {
  const options = { baseUrl, fetch: pmartFetch };
  return {
    bff: createClient<BffPaths>({ ...options, baseUrl: `${baseUrl}/backoffice` }),
    // 고객 원문 열람(customer 0.11.0 `POST /customers/{id}/pii-reveals`, 2026-11-20 고객 메뉴)
    customer: createClient<CustomerPaths>(options),
    employeeAuth: createClient<EmployeeAuthPaths>(options),
    approval: createClient<ApprovalPaths>(options),
    product: createClient<ProductPaths>(options),
    content: createClient<ContentPaths>(options),
    pricing: createClient<PricingPaths>(options),
    mfcInventory: createClient<MfcInventoryPaths>(options),
    cdcInventory: createClient<CdcInventoryPaths>(options),
    center: createClient<CenterPaths>(options),
    assistant: createClient<AssistantPaths>(options),
    cases: createClient<CasePaths>(options),
    // 고객센터·라이더 운영(백엔드 요청 2026-11-15 cs-rider-menus)
    orders: createClient<OrderPaths>(options),
    claims: createClient<ClaimPaths>(options),
    riders: createClient<RiderPaths>(options),
    dispatch: createClient<DispatchPaths>(options),
    execution: createClient<ExecutionPaths>(options),
    // 개인정보 열람 기록(audit 0.3.0, OPERATOR_ADMIN)
    audit: createClient<AuditPaths>(options),
    // 직원 표시(ADR-0070 덧붙임 2026-11-19 — OP- 대신 이름 · 사번, hr 0.8.0 GET /hr/employee-labels)
    hr: createClient<HrPaths>(options),
    // 결과 0건 검색어(search 0.4.0, ADR-0073 — MD·OPERATOR_ADMIN)
    search: createClient<SearchPaths>(options),
    // 홈 진열 편성(storefront 0.7.0 layouts, ADR-0075 ② — MD·OPERATOR_ADMIN)
    storefront: createClient<StorefrontPaths>(options),
    // 행사·쿠폰(promotion 0.2.0, ADR-0082)
    promotion: createClient<PromotionPaths>(options),
    // 리뷰 신고 확인(review 0.7.0 BR-90, 2026-11-23 — CS_AGENT·OPERATOR_ADMIN)
    review: createClient<ReviewPaths>(options),
    // FAQ 답 의견 집계(customer-assistant 0.4.0 BR-91, 2026-11-23 — CS_AGENT·OPERATOR_ADMIN)
    customerAssistant: createClient<CustomerAssistantPaths>(options),
  };
}

export type Api = ReturnType<typeof createApi>;

export const api: Api = createApi(
  createPmartFetch({
    sourceSystem: SOURCE_SYSTEM,
    tokens,
    // 401 이면 refresh token 회전으로 한 번 갱신(single-flight, employee-auth `POST /employee-auth/tokens/refresh`). 세션이 끝나면 tokens 가 비워진다.
    refresh: () => refreshEmployeeTokens(api, tokens),
  }),
);
