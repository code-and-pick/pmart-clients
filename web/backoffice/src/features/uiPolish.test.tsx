// 2026-11-20 화면 점검으로 고친 것 — 메뉴 이름 = 화면 제목, 열람 기록 직원 이름표, 제목 없는 문의
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('화면 점검 고침(2026-11-20)', () => {
  it('화면 제목이 메뉴 이름과 같다 — 배송·배차 확인·문의 답변', async () => {
    renderAt('/deliveries', as.admin);
    expect(await screen.findByRole('heading', { level: 1, name: '배송·배차 확인' })).toBeInTheDocument();
  });

  it('문의 답변: 제목 없는 문의는 "-" 대신 "제목 없는 문의"', async () => {
    renderAt('/inquiries', as.admin);
    expect(await screen.findByRole('heading', { level: 1, name: '문의 답변' })).toBeInTheDocument();
    const untitled = await screen.findAllByTestId('inquiry-untitled');
    expect(untitled[0]).toHaveTextContent('제목 없는 문의');
  });

  it('개인정보 열람 기록: 열람한 직원은 "이름 · 사번"(시스템 ID 안 보임)', async () => {
    renderAt('/pii-access-logs', as.admin);
    const names = await screen.findAllByTestId('pii-actor');
    await within(names[0]!).findByText(/· P2026-/);
    expect(screen.getAllByText('[목] 최상담 · P2026-00005').length).toBeGreaterThan(0);
    expect(screen.queryByText('op-cs-1')).not.toBeInTheDocument();
  });
});
