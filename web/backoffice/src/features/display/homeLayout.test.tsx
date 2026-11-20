// 홈 진열 편성(storefront 0.7.0 layouts, ADR-0075 ② — PC 1 요청서 2026-11-20)
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { decideLayout, layouts } from '../../mocks/storefrontHandlers';
import { as, renderAt } from '../../test/render';

describe('홈 진열 편성', () => {
  it('목록: 지금 홈 버전·게시본에 "지금 홈", 줄을 누르면 바로 편성 화면', async () => {
    const user = userEvent.setup();
    renderAt('/display/home', as.md);
    expect(await screen.findByTestId('layout-current')).toHaveTextContent('지금 고객 홈: 버전 1');
    const row = (await screen.findAllByTestId('layout-row'))[0]!;
    expect(row).toHaveTextContent('겨울 제철 채소 기획');
    expect(row).toHaveTextContent('배너 1 · 테마 1');
    expect(within(row).getByTestId('layout-live')).toBeInTheDocument();
    expect(row).not.toHaveTextContent('LD-');
    await user.click(row.querySelector('td:nth-child(2)')!);
    expect(await screen.findByTestId('layout-state')).toHaveTextContent('게시됨');
    expect(screen.queryByTestId('layout-submit')).not.toBeInTheDocument(); // 게시본은 고칠 수 없다
  });

  it('"지금 홈 고치기" → 게시본을 복사한 새 초안, 할인 문구는 제출 때 그 칸에 까닭 → 고치면 저장·제출·승인 요청 한 번에', async () => {
    const user = userEvent.setup();
    const view = renderAt('/display/home', as.md);
    await user.click(await screen.findByTestId('layout-new-current'));
    expect(await screen.findByTestId('layout-state')).toHaveTextContent('작성 중');
    expect(screen.getAllByTestId('layout-banner')).toHaveLength(1);
    const theme = screen.getAllByTestId('layout-theme')[0]!;
    expect(within(theme).getAllByTestId('layout-theme-product')).toHaveLength(2);
    expect(within(screen.getByTestId('layout-preview')).getByText('겨울 제철 채소')).toBeInTheDocument();

    const title = within(theme).getByLabelText('제목');
    await user.clear(title);
    await user.type(title, '겨울 채소 특가');
    expect(screen.getByTestId('layout-submit')).toHaveTextContent('저장하고 승인 요청');
    await user.click(screen.getByTestId('layout-submit'));
    expect(await within(theme).findByTestId('layout-problem')).toHaveTextContent('할인·쿠폰·특가·증정');
    expect(screen.getByTestId('layout-invalid')).toHaveTextContent('고칠 곳 1군데');

    await user.clear(title);
    await user.type(title, '겨울 제철 채소');
    await user.click(screen.getByTestId('layout-submit'));
    expect(await screen.findByTestId('layout-requested')).toHaveTextContent('승인 요청을 올렸어요');
    const cr = view.sent.find((q) => q.method === 'POST' && new URL(q.url).pathname.endsWith('/change-requests'));
    const body = (await cr!.clone().json()) as { type: string; targetService: string; targetRef: string };
    expect(body).toMatchObject({ type: 'DISPLAY', targetService: 'storefront-service' });
    expect(body.targetRef).toMatch(/^LD-/);
    const put = view.sent.find((q) => q.method === 'PUT');
    expect(put!.headers.get('X-Expected-Version')).toMatch(/^\d+$/);
  });

  it('새 배너·테마 더하기, 테마를 빼면 그 테마로 가던 배너는 "아무 데도 안 감"', async () => {
    const user = userEvent.setup();
    renderAt('/display/home', as.md);
    await user.click(await screen.findByTestId('layout-new-current'));
    await screen.findByTestId('layout-state');
    await user.click(screen.getByTestId('layout-add-theme'));
    expect(screen.getAllByTestId('layout-theme')).toHaveLength(2);
    await user.click(within(screen.getAllByTestId('layout-theme')[0]!).getAllByRole('button', { name: '빼기' })[0]!);
    const banner = screen.getAllByTestId('layout-banner')[0]!;
    expect(within(banner).getAllByRole('combobox')[1]).toHaveValue('NONE');
  });

  it('반려되면 사유와 함께 다시 고칠 수 있고, 승인되면 새 홈 버전', async () => {
    const user = userEvent.setup();
    renderAt('/display/home', as.md);
    await user.click(await screen.findByTestId('layout-new-empty'));
    await screen.findByTestId('layout-state');
    await user.click(screen.getByTestId('layout-submit'));
    await screen.findByTestId('layout-requested');
    const id = [...layouts.drafts.values()].find((d) => d.state === 'SUBMITTED')!.draftId;
    decideLayout(id, false, '배너가 없어요');
    renderAt(`/display/home/${id}`, as.md);
    await waitFor(() => expect(screen.getAllByTestId('layout-rejected').at(-1)).toHaveTextContent('반려 사유: 배너가 없어요'));
  });

  it('승인되면 목록의 지금 홈 버전이 올라간다', async () => {
    layouts.drafts.set('LD-x', { ...layouts.drafts.get('LD-seed-1')!, draftId: 'LD-x', state: 'SUBMITTED', layoutVersion: null });
    decideLayout('LD-x', true, null);
    renderAt('/display/home', as.md);
    expect(await screen.findByTestId('layout-current')).toHaveTextContent('버전 2');
  });
});
