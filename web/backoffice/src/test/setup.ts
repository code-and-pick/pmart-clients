import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { resetDb } from '../mocks/db';
import { resetMockCases } from '../mocks/caseHandlers';
import { resetMockCsIntakes } from '../mocks/csIntakeHandlers';
import { resetMockInquiries } from '../mocks/inquiryHandlers';
import { resetMockOps } from '../mocks/opsHandlers';
import { pollConfig } from '@pmart/web-core';
import { server } from './server';
import { clearToasts } from '../shared/toast';

// 폴링은 테스트에서 기다리지 않는다.
pollConfig.sleep = () => Promise.resolve();
pollConfig.maxAttempts = 3;
pollConfig.intervalMs = 5;

// 화면은 열 때 받는다(2026-11-19) — 시험 파일마다 첫 화면을 받는 동안 전체 시험 중에는 1초를 넘길 때가 있어 기다림 기본값만 3초로(확인 내용은 그대로)
configure({ asyncUtilTimeout: 3000 });

// 시험 화면은 사무실 모니터 폭(1440px)으로 — 좁은 화면(메뉴 접힘)은 그 시험에서 따로 바꾼다(2026-11-19 메뉴 접기)
Object.defineProperty(window, 'innerWidth', { value: 1440, writable: true, configurable: true });

// 목에 없는 요청은 테스트 실패로 본다(네트워크로 새지 않게).
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetDb();
  resetMockOps();
  resetMockCases();
  resetMockCsIntakes();
  resetMockInquiries();
  clearToasts();
  cleanup();
  // 세션 복원 보관(refresh token)이 다음 테스트로 새지 않게
  sessionStorage.clear();
});
afterAll(() => server.close());
