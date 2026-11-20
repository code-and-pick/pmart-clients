// case 0.31.0 CS-MFC-Q 품질 사고 고객 영향(MFC_QUALITY_IMPACT) — 종류 이름·거르기·관련 번호 이름
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('품질 사고 고객 영향 접수 건', () => {
  it('상세: 종류 이름이 코드가 아니라 "품질 사고 고객 영향", 관련은 사고·주문·LOT', async () => {
    renderAt('/cases/CASE-MOCK-Q1', as.cs);
    expect((await screen.findAllByText('품질 사고 고객 영향')).length).toBeGreaterThan(0);
    expect(screen.queryByText('MFC_QUALITY_IMPACT')).not.toBeInTheDocument();
    expect(await screen.findByText(/품질 사고\(파손\) 상품이 이 주문으로 나감/)).toBeInTheDocument();
  });

  it('목록: 상담원 종류 고르기에 "품질 사고 고객 영향"이 있고, 주소로 거르면 그 종류가 골라져 있다', async () => {
    renderAt('/cases?tab=unassigned&kind=MFC_QUALITY_IMPACT', as.cs);
    const option = await screen.findByRole('option', { name: '품질 사고 고객 영향' });
    expect((option as HTMLOptionElement).selected).toBe(true);
  });
});
