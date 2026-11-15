import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { resetDb } from '../mocks/db';
import { resetMockCases } from '../mocks/caseHandlers';
import { resetMockOps } from '../mocks/opsHandlers';
import { pollConfig } from '@pmart/web-core';
import { server } from './server';

// 폴링은 테스트에서 기다리지 않는다.
pollConfig.sleep = () => Promise.resolve();
pollConfig.maxAttempts = 3;
pollConfig.intervalMs = 5;

// 목에 없는 요청은 테스트 실패로 본다(네트워크로 새지 않게).
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetDb();
  resetMockOps();
  resetMockCases();
  cleanup();
  // 세션 복원 보관(refresh token)이 다음 테스트로 새지 않게
  sessionStorage.clear();
});
afterAll(() => server.close());
