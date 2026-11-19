import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { resetCases } from '../mocks/caseHandlers';
import { resetDb } from '../mocks/db';
import { resetNotices } from '../mocks/noticeHandlers';
import { resetPayoutAppeals } from '../mocks/payoutAppealHandlers';
import { resetOps } from '../mocks/opsHandlers';
import { server } from './server';

// findBy·waitFor 기다림 3초(2026-11-19 — 통합 백오피스 시험과 같게). 화면마다 숫자 띠·직원 이름 조회가 늘어 전체를 돌리면 1초를 넘기는 화면이 있다
configure({ asyncUtilTimeout: 3_000 });

// 목에 없는 요청은 테스트 실패로 본다(네트워크로 새지 않게).
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetDb();
  resetCases();
  resetOps();
  resetNotices();
  resetPayoutAppeals();
  cleanup();
  // 세션 복원 보관(refresh token)·로그인 시작 기록이 다음 테스트로 새지 않게
  sessionStorage.clear();
  // 최근 봄·내 보기·테마(이 브라우저 편의 기억)도 다음 테스트로 새지 않게
  window.localStorage.clear();
});
afterAll(() => server.close());
