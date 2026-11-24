// 사건 요약 글자 다듬기(2026-11-24 사용자 "한글로 짧게 바로 알아볼 수 있게").
import { describe, expect, it } from 'vitest';

import { caseSummaryText } from './caseText';

describe('caseSummaryText', () => {
  it('영문 코드는 한글로, 종류가 따로 보이면 앞의 "종류 — " 를 뗀다', () => {
    expect(caseSummaryText('라이더 도움요청 — APP_ERROR (ASSIGNED)', '라이더 도움요청')).toBe('앱 오류 (배정)');
    expect(caseSummaryText('라이더 도움요청 — APP_ERROR (ASSIGNED)')).toBe('라이더 도움요청 — 앱 오류 (배정)');
  });

  it('ISO 시각은 화면 시각으로, 모르는 코드는 그대로', () => {
    const out = caseSummaryText('위치 끊김(마지막 2026-11-20T13:10:39.630315Z) — UNKNOWN_CODE');
    expect(out).not.toMatch(/T13:10/);
    expect(out).toContain('UNKNOWN_CODE');
  });
});
