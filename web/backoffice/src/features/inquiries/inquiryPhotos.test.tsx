// 문의 사진(case 0.14.0) — 토큰을 붙여 받아 blob URL 로, 못 보는 사진은 "불러오지 못함"
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { as, renderAt } from '../../test/render';

describe('문의 사진', () => {
  let n = 0;
  beforeEach(() => {
    // jsdom 에는 createObjectURL 이 없다
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:mock/${(n += 1)}`), revokeObjectURL: vi.fn() }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('고객 문의 상세: 붙인 순서대로 썸네일, 본문은 토큰을 붙여 받는다, 누르면 크게 보기', async () => {
    const view = renderAt('/inquiries/INQ-MOCK-3', as.cs);
    const section = await screen.findByRole('region', { name: '사진 2장' });
    expect(within(section).getAllByTestId('inquiry-photo')).toHaveLength(2);
    expect(await within(section).findByAltText('문의 사진 1')).toHaveAttribute('src', expect.stringMatching(/^blob:mock\//));
    const fetched = view.sent.filter((r) => new URL(r.url).pathname.includes('/inquiry-photos/'));
    expect(fetched.map((r) => new URL(r.url).pathname.split('/').pop())).toEqual(expect.arrayContaining(['IPH-MOCK-1', 'IPH-MOCK-2']));
    expect(fetched[0]!.headers.get('Authorization')).toMatch(/^Bearer /);

    await userEvent.click(within(section).getByRole('button', { name: '문의 사진 2 크게 보기' }));
    const large = screen.getByTestId('inquiry-photo-large');
    expect(within(large).getByAltText('문의 사진 2')).toBeInTheDocument();
    await userEvent.click(within(large).getByRole('button', { name: '닫기' }));
    expect(screen.queryByTestId('inquiry-photo-large')).not.toBeInTheDocument();
  });

  it('라이더 문의: 볼 수 없는 사진(404)은 빈칸이 아니라 "불러오지 못함"', async () => {
    renderAt('/rider-inquiries/INQ-MOCK-R1', as.riderOps);
    const section = await screen.findByRole('region', { name: '사진 2장' });
    expect(await within(section).findByAltText('문의 사진 1')).toBeInTheDocument();
    await waitFor(() => expect(within(section).getByTestId('inquiry-photo-error')).toHaveTextContent('사진을 불러오지 못했어요'));
  });

  it('사진이 없는 문의에는 사진 칸이 없다', async () => {
    renderAt('/inquiries/INQ-MOCK-2', as.cs);
    await screen.findByTestId('inquiry-body');
    expect(screen.queryByRole('region', { name: /^사진/ })).not.toBeInTheDocument();
  });
});
