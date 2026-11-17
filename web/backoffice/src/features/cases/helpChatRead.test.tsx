// 사건함 도움요청 "새 메시지" 점(bff 0.6.0) — 두 시각 + 직원별 읽음(이 탭)
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';
import { hasNewRiderMessage } from './helpChatRead';

describe('새 메시지 판단', () => {
  it('라이더가 지원센터 답 뒤에 썼고(또는 답 없음) 아직 안 봤을 때만', () => {
    expect(hasNewRiderMessage('2026-11-17T01:00:00Z', null, undefined)).toBe(true);
    expect(hasNewRiderMessage('2026-11-17T01:00:00Z', '2026-11-17T01:05:00Z', undefined)).toBe(false); // 답이 더 늦음
    expect(hasNewRiderMessage('2026-11-17T01:10:00Z', '2026-11-17T01:05:00Z', undefined)).toBe(true);
    expect(hasNewRiderMessage('2026-11-17T01:10:00Z', null, '2026-11-17T01:10:00Z')).toBe(false); // 이미 봄
    expect(hasNewRiderMessage(null, null, undefined)).toBe(false);
  });
});

describe('사건함 새 메시지 점', () => {
  beforeEach(() => sessionStorage.clear());

  it('도움요청 건에 "새 메시지" — 대화를 열어 본 뒤에는 이 직원에게 사라진다', async () => {
    renderAt('/cases', as.riderOps);
    const row = (await screen.findAllByTestId('case-row')).find((r) => within(r).queryByTestId('case-new-message'));
    expect(row).toBeDefined();
    expect(within(row!).getByTestId('case-new-message')).toHaveTextContent('새 메시지');
    cleanup();

    renderAt('/cases/CASE-MOCK-1', as.riderOps);
    await screen.findAllByTestId('help-message');
    await waitFor(() => expect(Object.keys(sessionStorage).some((k) => k.endsWith('op-rider-ops-1'))).toBe(true));
    cleanup();

    renderAt('/cases', as.riderOps);
    await screen.findAllByTestId('case-row');
    expect(screen.queryByTestId('case-new-message')).not.toBeInTheDocument();
  });

  it('다른 직원은 아직 안 봤으니 그대로 점', async () => {
    renderAt('/cases/CASE-MOCK-1', as.riderOps);
    await screen.findAllByTestId('help-message');
    cleanup();
    renderAt('/cases', as.admin);
    expect(await screen.findByTestId('case-new-message')).toBeInTheDocument();
  });
});
