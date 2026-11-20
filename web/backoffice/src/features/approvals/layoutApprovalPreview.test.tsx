// 홈 진열 편성 승인 상세 — 전시 승인자가 무엇을 승인하는지 초안 그대로 본다(2026-11-20 백엔드 회신 ①: storefront 0.7.1 DISPLAY_APPROVER 읽기).
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { db } from '../../mocks/db';
import { as, renderAt } from '../../test/render';

describe('홈 진열 편성 승인 — 초안 미리보기', () => {
  it('전시 승인자(DISPLAY_APPROVER)도 승인 상세에서 편성 초안(배너·테마)을 본다', async () => {
    const seed = db.approvals.get('apv-seed-price-1')!;
    db.approvals.set('apv-test-layout', { ...seed, approvalId: 'apv-test-layout', type: 'DISPLAY', targetService: 'storefront-service', targetRef: 'LD-seed-1', summary: '홈 진열 편성 — 배너 1개 · 테마 1개', allowedActions: ['PUBLISH_LAYOUT'], lines: [{ lineKey: 'LD-seed-1', attributes: { draftHash: 'h-seed' } }] });
    renderAt('/approvals/apv-test-layout', as.approver);
    const box = await screen.findByTestId('approval-layout-preview');
    expect(await within(box).findByText('겨울 제철 채소')).toBeInTheDocument();
    expect(within(box).getByTestId('layout-preview')).toBeInTheDocument();
  });
});
