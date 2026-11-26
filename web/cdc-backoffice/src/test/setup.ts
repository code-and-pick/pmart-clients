import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { resetDb } from '../mocks/db';
import { resetOutbound } from '../mocks/outboundHandlers';
import { fakeSupplier, resetPurchase } from '../mocks/purchaseHandlers';
import { resetInbound } from '../mocks/inboundHandlers';
import { resetQuality } from '../mocks/qualityHandlers';
import { resetStock } from '../mocks/stockHandlers';
import { resetTransport } from '../mocks/transportHandlers';
import { resetMovements } from '../mocks/movementHandlers';
import { resetFleet } from '../mocks/fleetHandlers';
import { server } from './server';

// 목에 없는 요청은 테스트 실패로 본다(네트워크로 새지 않게).
beforeAll(() => {
  fakeSupplier.replyMs = 0;
  fakeSupplier.asnMs = 0;
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
  resetDb();
  resetOutbound();
  resetStock();
  resetTransport();
  resetMovements();
  resetFleet();
  resetQuality();
  resetInbound();
  resetPurchase();
  // 가짜 공급사 회신·ASN — 시험은 바로(목 웹은 몇 초 뒤)
  fakeSupplier.replyMs = 0;
  fakeSupplier.asnMs = 0;
  cleanup();
  // 세션 복원 보관(refresh token)·로그인 시작 기록이 다음 테스트로 새지 않게
  sessionStorage.clear();
  // 최근 봄·내 보기·안내 상자 접힘(이 브라우저 보관)도 다음 테스트로 새지 않게
  window.localStorage.clear();
});
afterAll(() => server.close());
