// 홈 진열 편성(storefront 0.7.0 layouts, ADR-0075 ② — PC 1 요청서 2026-11-20)
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

  it('"지금 홈 고치기" → 게시본을 복사한 새 초안, 근거 없는 "최저가"는 제출 때 그 칸에 까닭 → 특가 문구는 통과(0.9.0)·저장·제출·승인 요청 한 번에', async () => {
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
    await user.type(title, '겨울 채소 최저가');
    expect(screen.getByTestId('layout-submit')).toHaveTextContent('저장하고 승인 요청');
    await user.click(screen.getByTestId('layout-submit'));
    expect(await within(theme).findByTestId('layout-problem')).toHaveTextContent('근거 없는 "최저가"');
    expect(screen.getByTestId('layout-invalid')).toHaveTextContent('고칠 곳 1군데');

    await user.clear(title);
    await user.type(title, '겨울 채소 특가 20% 할인');
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

  it('0.9.0 자동 랭킹 테마·남은 시간(끝 시각 필수)·MD 탭(넣은 테마는 홈에서 빠짐, 한 테마는 한 탭에만)·팝업 배너', async () => {
    const user = userEvent.setup();
    const view = renderAt('/display/home', as.md);
    await user.click(await screen.findByTestId('layout-new-current'));
    await screen.findByTestId('layout-state');

    // 자동 랭킹 — 상품 고르기 대신 상위 몇 개
    await user.click(screen.getByTestId('layout-add-theme'));
    const rank = screen.getAllByTestId('layout-theme')[1]!;
    await user.selectOptions(within(rank).getByLabelText('종류'), 'RANKING_AUTO');
    expect(within(rank).getByLabelText('상위 몇 개(1~30)')).toHaveValue(10);
    expect(within(rank).queryByText(/상품 \d+개/)).not.toBeInTheDocument();
    await user.type(within(rank).getByLabelText('제목'), '실시간 인기 랭킹');
    await user.click(within(rank).getByRole('checkbox', { name: /남은 시간 표시/ }));

    // 배너 자리 팝업 → 미리보기 아래 팝업 칸
    const banner = screen.getAllByTestId('layout-banner')[0]!;
    await user.selectOptions(within(banner).getByLabelText('자리'), 'POPUP');
    expect(within(screen.getByTestId('layout-preview')).getByTestId('layout-preview-popup')).toBeInTheDocument();

    // 탭 두 개 — 첫 탭에 넣은 테마는 둘째 탭에서 못 고름
    await user.click(screen.getByTestId('layout-add-tab'));
    await user.click(screen.getByTestId('layout-add-tab'));
    const [tab1, tab2] = screen.getAllByTestId('layout-tab');
    await user.type(within(tab1!).getByLabelText('탭 이름(20자)'), 'MD 특가');
    await user.click(within(tab1!).getByRole('checkbox', { name: /실시간 인기 랭킹/ }));
    expect(within(tab2!).getByRole('checkbox', { name: /실시간 인기 랭킹/ })).toBeDisabled();
    expect(within(rank).getByTestId('layout-theme-in-tab')).toHaveTextContent('탭 "MD 특가"');
    const preview = screen.getByTestId('layout-preview');
    expect(within(preview).getByTestId('layout-preview-tabs')).toHaveTextContent('MD 특가');
    expect(within(preview).queryByText('실시간 인기 랭킹')).not.toBeInTheDocument(); // 탭에 넣어 홈에서 빠짐
    await user.click(within(tab2!).getByRole('button', { name: '빼기' }));

    // 끝 시각 없이 남은 시간 → 422 TIMER_NEEDS_END, 그 테마 칸에
    await user.click(screen.getByTestId('layout-submit'));
    expect(await within(rank).findByTestId('layout-problem')).toHaveTextContent('끝 시각을 넣어 주세요');
    fireEvent.change(within(rank).getByLabelText('끝'), { target: { value: '2099-12-31T18:00' } });
    await user.click(screen.getByTestId('layout-submit'));
    expect(await screen.findByTestId('layout-requested')).toBeInTheDocument();

    const put = view.sent.filter((q) => q.method === 'PUT').at(-1)!;
    const sent = (await put.clone().json()) as { themes: { sectionId: string; kind: string; autoSize: number | null; productIds: string[]; showTimer?: boolean }[]; tabs: { tabKey: string; title: string; sectionIds: string[] }[]; banners: { placement: string }[] };
    expect(sent.themes[1]).toMatchObject({ kind: 'RANKING_AUTO', autoSize: 10, productIds: [], showTimer: true });
    expect(sent.tabs).toHaveLength(1);
    expect(sent.tabs[0]).toMatchObject({ title: 'MD 특가', sectionIds: [sent.themes[1]!.sectionId] });
    expect(sent.tabs[0]!.tabKey).toMatch(/^X-/);
    expect(sent.banners[0]!.placement).toBe('POPUP');
  });

  it('0.10.0 홈 중간 배너 묶음·홈 순서(위/아래)·넘김 간격(2~30초, 벗어나면 그 칸에 까닭)', async () => {
    const user = userEvent.setup();
    const view = renderAt('/display/home', as.md);
    await user.click(await screen.findByTestId('layout-new-current'));
    await screen.findByTestId('layout-state');

    // 옮긴 적 없고 묶음 없으면 홈 순서 = 테마 순서
    expect(screen.getAllByTestId('layout-order-item').map((x) => x.textContent)).toEqual([expect.stringContaining('겨울 제철 채소')]);

    // 배너를 홈 중간 묶음으로 → 새 묶음이 홈 순서 끝에
    const banner = screen.getAllByTestId('layout-banner')[0]!;
    await user.selectOptions(within(banner).getByLabelText('자리'), 'HOME_INLINE');
    expect(within(banner).getByLabelText('배너 묶음')).toHaveDisplayValue('배너 묶음 1');
    let items = screen.getAllByTestId('layout-order-item');
    expect(items[1]).toHaveTextContent('배너 묶음 1 · 배너 1개');
    await user.click(within(items[1]!).getByRole('button', { name: '위로' }));
    items = screen.getAllByTestId('layout-order-item');
    expect(items[0]).toHaveTextContent('배너 묶음 1');
    expect(within(screen.getByTestId('layout-preview')).getByTestId('layout-preview-group')).toBeInTheDocument();

    // 넘김 간격 1초 → 422 INVALID_INTERVAL, 고치면 승인 요청
    const interval = screen.getByLabelText('넘김 간격(초)');
    await user.type(interval, '1');
    await user.click(screen.getByTestId('layout-submit'));
    expect(await screen.findByText('넘김 간격은 2~30초예요(비우면 앱 기본값)')).toBeInTheDocument();
    await user.clear(interval);
    await user.type(interval, '5');
    await user.click(screen.getByTestId('layout-submit'));
    expect(await screen.findByTestId('layout-requested')).toBeInTheDocument();

    const put = view.sent.filter((q) => q.method === 'PUT').at(-1)!;
    const sent = (await put.clone().json()) as { banners: { placement: string; groupId: string | null }[]; homeOrder: string[]; bannerIntervalSeconds: number | null };
    expect(sent.bannerIntervalSeconds).toBe(5);
    expect(sent.banners[0]!.placement).toBe('HOME_INLINE');
    expect(sent.banners[0]!.groupId).toMatch(/^G-/);
    expect(sent.homeOrder).toEqual([sent.banners[0]!.groupId, 'T-WINTER-VEG']);
  });

  it('0.11.0 카테고리 화면 배너 — 자리 고르기에 있고, 홈 그림 밖 "카테고리 화면 맨 위" 칸에만, groupId 없이 보낸다', async () => {
    const user = userEvent.setup();
    const view = renderAt('/display/home', as.md);
    await user.click(await screen.findByTestId('layout-new-current'));
    await screen.findByTestId('layout-state');
    const banner = screen.getAllByTestId('layout-banner')[0]!;
    await user.selectOptions(within(banner).getByLabelText('자리'), 'CATEGORY');
    expect(within(banner).getByLabelText('자리')).toHaveDisplayValue('카테고리 화면 맨 위');
    expect(within(banner).getByText(/홈에는 나오지 않아요/)).toBeInTheDocument();
    expect(within(banner).queryByLabelText('배너 묶음')).not.toBeInTheDocument();
    const preview = screen.getByTestId('layout-preview');
    expect(within(within(preview).getByTestId('layout-preview-category')).getByRole('img', { name: '겨울 제철 채소 모음' })).toBeInTheDocument();
    expect(within(preview).getAllByRole('img', { name: '겨울 제철 채소 모음' })).toHaveLength(1); // 홈 맨 위에는 없다
    await user.click(screen.getByTestId('layout-submit'));
    expect(await screen.findByTestId('layout-requested')).toBeInTheDocument();
    const put = view.sent.filter((q) => q.method === 'PUT').at(-1)!;
    const sent = (await put.clone().json()) as { banners: { placement: string; groupId?: string | null }[]; homeOrder: string[] };
    expect(sent.banners[0]).toMatchObject({ placement: 'CATEGORY' });
    expect(sent.banners[0]!.groupId ?? null).toBeNull();
    expect(sent.homeOrder).toEqual([]);
  });

  it('0.12.0 남은 시간 모양(BR-84) — 켜면 라벨형 기본·미리보기 제목 위 글자, 띠형 고르면 띠·보낸 값 BAND, 끄면 null', async () => {
    const user = userEvent.setup();
    const view = renderAt('/display/home', as.md);
    await user.click(await screen.findByTestId('layout-new-current'));
    await screen.findByTestId('layout-state');
    const theme = screen.getAllByTestId('layout-theme')[0]!;
    expect(within(theme).queryByTestId('timer-style')).not.toBeInTheDocument();
    await user.click(within(theme).getByRole('checkbox', { name: /남은 시간 표시/ }));
    expect(within(theme).getByRole('radio', { name: '라벨형(제목 위 글자)' })).toBeChecked();
    const preview = screen.getByTestId('layout-preview');
    expect(within(preview).getByTestId('preview-timer-label')).toHaveTextContent(/⏱ .+ 남음/);
    await user.click(within(theme).getByRole('radio', { name: '띠형(시·분·초 칸)' }));
    expect(within(preview).getByTestId('preview-timer-band')).toHaveTextContent('남은 시간');
    expect(within(preview).queryByTestId('preview-timer-label')).not.toBeInTheDocument();
    fireEvent.change(within(theme).getByLabelText('끝'), { target: { value: '2099-12-31T18:00' } });
    await user.click(screen.getByTestId('layout-save'));
    await waitFor(() => expect(view.sent.some((q) => q.method === 'PUT')).toBe(true));
    const first = (await view.sent.filter((q) => q.method === 'PUT').at(-1)!.clone().json()) as { themes: { showTimer: boolean; timerStyle: string | null }[] };
    expect(first.themes[0]).toMatchObject({ showTimer: true, timerStyle: 'BAND' });
    await user.click(within(theme).getByRole('checkbox', { name: /남은 시간 표시/ }));
    expect(within(theme).queryByTestId('timer-style')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('layout-save'));
    await waitFor(() => expect(view.sent.filter((q) => q.method === 'PUT')).toHaveLength(2));
    const second = (await view.sent.filter((q) => q.method === 'PUT').at(-1)!.clone().json()) as { themes: { showTimer: boolean; timerStyle: string | null }[] };
    expect(second.themes[0]).toMatchObject({ showTimer: false, timerStyle: null });
  });

  it('홈 순서를 옮기지 않았고 묶음도 없으면 homeOrder 는 빈 채로(예전 순서)', async () => {
    const user = userEvent.setup();
    const view = renderAt('/display/home', as.md);
    await user.click(await screen.findByTestId('layout-new-current'));
    await screen.findByTestId('layout-state');
    await user.type(screen.getByLabelText('넘김 간격(초)'), '4');
    await user.click(screen.getByTestId('layout-save'));
    await waitFor(() => expect(view.sent.some((q) => q.method === 'PUT')).toBe(true));
    const sent = (await view.sent.find((q) => q.method === 'PUT')!.clone().json()) as { homeOrder: string[] };
    expect(sent.homeOrder).toEqual([]);
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
