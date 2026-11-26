import { http } from 'msw';

import { API_BASE } from '../api/client';
import { authHandlers } from './authHandlers';
import { meHandlers } from './meHandlers';
import { outboundHandlers } from './outboundHandlers';
import { purchaseHandlers } from './purchaseHandlers';
import { inboundHandlers } from './inboundHandlers';
import { qualityHandlers } from './qualityHandlers';
import { stockHandlers } from './stockHandlers';
import { operator, unauthorized } from './support';

/** 게이트웨이 공개 경로(계약 security: []) */
const PUBLIC = [`${API_BASE}/employee-auth/tokens`, `${API_BASE}/employee-auth/tokens/refresh`];

/** 게이트웨이처럼: 공개 경로가 아니면 유효한 access token 이 있어야 한다(없거나 만료·폐기 → 401). */
const gateway = http.all(`${API_BASE}/*`, ({ request }) => {
  const url = request.url.split('?')[0] ?? '';
  if (PUBLIC.includes(url)) return undefined;
  return operator(request) ? undefined : unauthorized();
});

// DC 이름은 sessions/current 의 centerDetails 로 온다(authHandlers 의 mockCenterNames).
export const handlers = [gateway, ...authHandlers, ...meHandlers, ...outboundHandlers, ...stockHandlers, ...qualityHandlers, ...inboundHandlers, ...purchaseHandlers];
