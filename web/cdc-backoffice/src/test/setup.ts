import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { resetDb } from '../mocks/db';
import { resetOutbound } from '../mocks/outboundHandlers';
import { resetStock } from '../mocks/stockHandlers';
import { server } from './server';

// 목에 없는 요청은 테스트 실패로 본다(네트워크로 새지 않게).
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetDb();
  resetOutbound();
  resetStock();
  cleanup();
  // 세션 복원 보관(refresh token)·로그인 시작 기록이 다음 테스트로 새지 않게
  sessionStorage.clear();
  // 최근 봄·내 보기·안내 상자 접힘(이 브라우저 보관)도 다음 테스트로 새지 않게
  window.localStorage.clear();
});
afterAll(() => server.close());
