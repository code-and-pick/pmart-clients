import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { resetDb } from '../mocks/db';
import { resetNotices } from '../mocks/noticeHandlers';
import { resetPayoutAppeals } from '../mocks/payoutAppealHandlers';
import { resetOps } from '../mocks/opsHandlers';
import { server } from './server';

// 목에 없는 요청은 테스트 실패로 본다(네트워크로 새지 않게).
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetDb();
  resetOps();
  resetNotices();
  resetPayoutAppeals();
  cleanup();
  // 세션 복원 보관(refresh token)·로그인 시작 기록이 다음 테스트로 새지 않게
  sessionStorage.clear();
});
afterAll(() => server.close());
