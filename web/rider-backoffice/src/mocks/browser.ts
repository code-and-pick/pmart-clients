import { setupWorker } from 'msw/browser';

import { analysisHandlers } from './analysisFixtures';
import { handlers } from './handlers';

// 대시보드 분석 그림용 배송(브라우저 목에만 — 시험은 기본 handlers 그대로)
export const worker = setupWorker(...analysisHandlers, ...handlers);
