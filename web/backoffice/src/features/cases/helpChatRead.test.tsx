// 사건함 도움요청 "새 메시지" 점(case 0.20.0·bff 0.10.0) — 읽음은 서버(POST /cases/{id}/views → myLastSeenAt)
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';
import { hasNewRiderMessage } from './helpChatRead';

describe('새 메시지 판단', () => {
  it('라이더 마지막 메시지가 있고, 내가 본 적 없거나 그보다 먼저 봤을 때만', () => {
    expect(hasNewRiderMessage('2026-11-17T01:00:00Z', null)).toBe(true);
    expect(hasNewRiderMessage('2026-11-17T01:10:00Z', '2026-11-17T01:05:00Z')).toBe(true);
    expect(hasNewRiderMessage('2026-11-17T01:10:00Z', '2026-11-17T01:10:00Z')).toBe(false); // 이미 봄
    expect(hasNewRiderMessage(null, null)).toBe(false);
  });
});

describe('사건함 새 메시지 점', () => {
  it('도움요청 건에 "새 메시지" — 접수 건을 열면 서버에 "봤음"을 남기고, 이 직원에게 점이 사라진다', async () => {
    renderAt('/cases', as.riderOps);
    const row = (await screen.findAllByTestId('case-row')).find((r) => within(r).queryByTestId('case-new-message'));
    expect(row).toBeDefined();
    cleanup();

    const view = renderAt('/cases/CASE-MOCK-1', as.riderOps);
    await screen.findAllByTestId('help-message');
    await waitFor(() => expect(view.sent.some((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/cases/CASE-MOCK-1/views'))).toBe(true));
    const post = view.sent.find((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/views'))!;
    expect(post.headers.get('Idempotency-Key')).toBeNull(); // 멱등 키 필요 없음
    expect(Object.keys(sessionStorage)).toHaveLength(0); // 탭 저장소는 이제 안 씀
    cleanup();

    renderAt('/cases', as.riderOps);
    await screen.findAllByTestId('case-row');
    expect(screen.queryByTestId('case-new-message')).not.toBeInTheDocument();
  });

  it('다른 직원은 아직 안 봤으니 그대로 점(직원별)', async () => {
    renderAt('/cases/CASE-MOCK-1', as.riderOps);
    await screen.findAllByTestId('help-message');
    cleanup();
    renderAt('/cases', as.admin);
    expect(await screen.findByTestId('case-new-message')).toBeInTheDocument();
  });
});
