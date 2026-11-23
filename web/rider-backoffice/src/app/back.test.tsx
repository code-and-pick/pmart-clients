// 상세 제목 왼쪽 ‹ 뒤로(2026-11-24 사용자 "세부 탭에 들어가고 나면 < 이런 뒤로가기 버튼이 어딘가에 있었으면") — 목(MSW) 기준.
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('상세 뒤로 단추', () => {
  it('주소로 바로 연 라이더 상세에서 ‹ 를 누르면 라이더 목록으로', async () => {
    renderAt('/riders/RD-7', as.riderOps);
    const back = await screen.findByTestId('detail-back');
    await userEvent.click(back);
    expect((await screen.findAllByTestId('rider-row', {}, { timeout: 3000 })).length).toBeGreaterThan(0);
  });
});
