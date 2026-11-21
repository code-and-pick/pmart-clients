import { setupWorker } from 'msw/browser';

import { analysisHandlers } from './analysisFixtures';
import { handlers } from './handlers';
import { restoreMockSessions, saveMockSessions } from './sessionKeep';

// 대시보드 분석 그림용 배송(브라우저 목에만 — 시험은 기본 handlers 그대로)
export const worker = setupWorker(...analysisHandlers, ...handlers);

// 새로고침·주소창 이동·HMR 뒤에도 목 로그인이 이어지게 — 목 세션만 이 탭에 이어 둔다(sessionKeep.ts)
restoreMockSessions();
worker.events.on('response:mocked', ({ request }) => {
  if (new URL(request.url).pathname.includes('/employee-auth/')) saveMockSessions();
});
