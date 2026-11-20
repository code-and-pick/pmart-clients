import { http, HttpResponse } from 'msw';

import { API_BASE, BFF_BASE } from '../api/client';
import { approvalHandlers } from './approvalHandlers';
import { authHandlers } from './authHandlers';
import { catalogHandlers } from './catalogHandlers';
import { approvalInbox, centerList } from './fixtures';
import { inquiryHandlers } from './inquiryHandlers';
import { caseHandlers } from './caseHandlers';
import { csIntakeHandlers } from './csIntakeHandlers';
import { liveDeliveryHandlers } from './liveDeliveryHandlers';
import { packingHandlers } from './packingHandlers';
import { lookupHandlers } from './lookupHandlers';
import { opsHandlers } from './opsHandlers';
import { workCountsHandlers } from './workCountsHandlers';
import { salesMetricsHandlers } from './salesMetricsHandlers';
import { piiAccessLogHandlers } from './piiAccessLogHandlers';
import { hrLabelHandlers } from './hrLabelHandlers';
import { priceImportHandlers } from './priceImportHandlers';
import { pricingHandlers } from './pricingHandlers';
import { searchHandlers } from './searchHandlers';
import { storefrontHandlers } from './storefrontHandlers';
import { promotionHandlers } from './promotionHandlers';
import { operator, unauthorized } from './support';
import { customerHandlers } from './customerHandlers';

/** 게이트웨이 공개 경로(계약 security: []) */
const PUBLIC = [`${API_BASE}/employee-auth/tokens`, `${API_BASE}/employee-auth/tokens/refresh`];

/** 게이트웨이처럼: 공개 경로가 아니면 유효한 access token 이 있어야 한다(없거나 만료·폐기 → 401). */
const gateway = http.all(`${API_BASE}/*`, ({ request }) => {
  const url = request.url.split('?')[0] ?? '';
  if (PUBLIC.includes(url)) return undefined;
  return operator(request) ? undefined : unauthorized();
});

export const handlers = [
  gateway,
  http.get(`${BFF_BASE}/views/approval-inbox`, () => HttpResponse.json(approvalInbox)),
  http.get(`${API_BASE}/centers`, () => HttpResponse.json(centerList)),
  ...authHandlers,
  ...approvalHandlers,
  ...catalogHandlers,
  ...pricingHandlers,
  ...priceImportHandlers,
  ...inquiryHandlers,
  // 지표 경로(/orders/metrics/*·/claims/metrics/*)가 /claims/:claimId 같은 경로에 먼저 잡히지 않게 앞에
  ...salesMetricsHandlers,
  ...opsHandlers,
  ...customerHandlers, // 고객 메뉴(bff 0.22.0, 2026-11-20)
  ...workCountsHandlers,
  ...caseHandlers,
  ...csIntakeHandlers,
  ...lookupHandlers,
  ...liveDeliveryHandlers,
  ...packingHandlers,
  ...piiAccessLogHandlers,
  ...hrLabelHandlers,
  ...searchHandlers,
  ...storefrontHandlers,
  ...promotionHandlers,
];
