// 2026-11-21 화면 점검에서 고친 것 — 편성 빈 칸 미리 막기·400 칸 연결, 최근 활동 몫, 배차 불가 취소 뒤 표시, 클레임 표기 반복
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../api/client';
import { as, renderAt } from '../test/render';
import { server } from '../test/server';

describe('홈 편성 — 빈 칸', () => {
  it('제목 빈 테마·빈 탭은 보내기 전에 그 칸에 까닭, 아무것도 보내지 않는다 → 채우면 저장', async () => {
    const user = userEvent.setup();
    const view = renderAt('/display/home', as.md);
    await user.click(await screen.findByTestId('layout-new-current'));
    await screen.findByTestId('layout-state');
    await user.click(screen.getByTestId('layout-add-theme'));
    await user.click(screen.getByTestId('layout-add-tab'));
    await user.click(screen.getByTestId('layout-save'));
    const theme = screen.getAllByTestId('layout-theme')[1]!;
    expect(within(theme).getByTestId('layout-problem')).toHaveTextContent('제목을 넣어 주세요');
    expect(screen.getByTestId('layout-invalid')).toHaveTextContent('고칠 곳 3군데');
    expect(screen.getByTestId('layout-invalid')).toHaveTextContent('첫 칸으로 가기');
    expect(view.sent.filter((r) => r.method === 'PUT')).toHaveLength(0);
    // 채우면 까닭이 바로 사라진다
    await user.type(within(theme).getAllByRole('textbox')[0]!, '봄나물');
    expect(within(theme).queryByTestId('layout-problem')).not.toBeInTheDocument();
  });

  it('승인 요청 때는 그림 없는 배너도 막는다("다시"가 아니라 "그림을 올려 주세요")', async () => {
    const user = userEvent.setup();
    const view = renderAt('/display/home', as.md);
    await user.click(await screen.findByTestId('layout-new-current'));
    await screen.findByTestId('layout-state');
    await user.click(screen.getByTestId('layout-add-banner'));
    const banner = screen.getAllByTestId('layout-banner')[1]!;
    await user.type(within(banner).getByLabelText('그림 설명(화면 읽기)'), '봄 배너');
    const before = view.sent.length;
    await user.click(screen.getByTestId('layout-submit'));
    expect(within(banner).getByTestId('layout-problem')).toHaveTextContent('그림을 올려 주세요');
    expect(view.sent.slice(before).filter((r) => r.method === 'PUT' || r.method === 'POST')).toHaveLength(0);
  });

  it('서버 400 VALIDATION_FAILED 도 칸에 붙인다', async () => {
    const user = userEvent.setup();
    server.use(
      http.put(`${API_BASE}/storefront/layout-drafts/:id`, () =>
        HttpResponse.json({ type: 'about:blank', status: 400, code: 'VALIDATION_FAILED', retryable: false, details: [{ field: 'body.themes[0].title', reason: 'MAX_LENGTH' }] }, { status: 400, headers: { 'content-type': 'application/problem+json' } }),
      ),
    );
    renderAt('/display/home', as.md);
    await user.click(await screen.findByTestId('layout-new-current'));
    await screen.findByTestId('layout-state');
    const theme = screen.getAllByTestId('layout-theme')[0]!;
    await user.type(within(theme).getByLabelText('제목'), '!');
    await user.click(screen.getByTestId('layout-save'));
    expect(await within(theme).findByTestId('layout-problem')).toHaveTextContent('값을 확인해 주세요');
  });
});

describe('대시보드 새로 들어온 일', () => {
  it('접수 건이 많아도 문의·승인이 종류마다 남는다', async () => {
    renderAt('/', as.admin);
    await waitFor(() => {
      const t = screen.getAllByTestId('dash-activity-item').map((i) => i.textContent ?? '');
      expect(t).toHaveLength(8);
      expect(t.some((x) => x.includes('고객 문의'))).toBe(true);
      expect(t.some((x) => x.includes('승인'))).toBe(true);
    });
  });
});

describe('배차 불가로 취소 뒤', () => {
  it('취소할 품목 줄은 감추고, 진행 중 결과는 초록이 아니다', async () => {
    const user = userEvent.setup();
    renderAt('/cases/CASE-MOCK-R9', as.cs);
    const box = await screen.findByTestId('dispatch-cancel');
    await waitFor(() => expect(within(box).getByTestId('dispatch-cancel-open')).toBeEnabled());
    await user.click(within(box).getByTestId('dispatch-cancel-open'));
    await user.click(within(screen.getByTestId('dispatch-cancel-confirm')).getByRole('button', { name: '취소하고 전액 환불' }));
    const done = await screen.findByTestId('dispatch-cancel-done');
    expect(done).not.toHaveClass('text-success');
    expect(box).not.toHaveTextContent('취소할 품목');
  });
});

describe('클레임 표기 반복', () => {
  it('클레임 상세 머리에 종류 꼬리표를 또 달지 않고, 주문 상세 안 클레임 표엔 주문 칸이 없다', async () => {
    const view = renderAt('/claims/CLM-MOCK-RF', as.cs);
    const state = await screen.findByTestId('claim-state');
    expect((state.parentElement?.textContent ?? '').match(/반품/g)).toHaveLength(2); // 제목·번호에만(꼬리표 없음)
    view.unmount();
    renderAt('/orders/ORD-MOCK-1002', as.cs);
    const row = (await screen.findAllByTestId('claim-row'))[0]!;
    const table = row.closest('table')!;
    expect(within(table).queryByRole('columnheader', { name: '주문' })).not.toBeInTheDocument();
  });
});
