// 메뉴 숫자 보는 법(2026-11-20 사용자 "뭐가 파랑이고 뭐가 빨강인지 구분이 안 된다") — 색은 뜻만, 기한 넘김은 시계 표시도
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('메뉴 숫자 보는 법', () => {
  it('펼친 메뉴 맨 아래 "할 일"·"기한 넘김" 보는 법, 기한 넘김 칩에는 시계 표시(숫자 글자는 그대로)', async () => {
    renderAt('/cases', as.riderOps);
    const legend = await screen.findByTestId('menu-alert-legend');
    expect(legend).toHaveTextContent('할 일');
    expect(legend).toHaveTextContent('기한 넘김');
    // 보는 법임을 밝히고, 실제 개수로 읽히는 예시 숫자는 두지 않는다(2026-11-20 사용자 "알림 현황이 메뉴와 다르다")
    expect(legend).toHaveTextContent('메뉴 숫자 보는 법');
    expect(legend.textContent).not.toMatch(/\d/);
    const urgent = await screen.findByTestId('menu-alert-casesOverdue');
    expect(urgent).toHaveAttribute('data-tone', 'urgent');
    expect(urgent.querySelector('svg')).not.toBeNull();
    expect(urgent.getAttribute('title')).toMatch(/^기한 넘김 — /);
    // 지금 메뉴(접수 건)여도 할 일 칩은 회색 그대로 — 파랑 없음(색은 CSS, 여기선 뜻 표시만)
    expect(within(screen.getByTestId('side-menu')).getByTestId('menu-alert-casesUnassigned')).toHaveAttribute('data-tone', 'todo');
  });
});
