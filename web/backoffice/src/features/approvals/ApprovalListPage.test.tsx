// 승인함 목록 — "더 보기"가 다음 쪽을 이어 붙인다(2026-11-17 사용자 신고: 눌러도 이전 기록이 안 나옴)
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { server } from '../../test/server';
import { as, renderAt } from '../../test/render';

const row = (n: number) => ({ approvalId: `APV-${n}`, type: 'PRODUCT', summary: `요청 ${n}`, requesterId: 'op-md-1', reviewState: 'APPROVED', executionState: 'APPLIED', submittedAt: '2026-11-17T00:00:00Z' });

describe('승인함 목록 — 더 보기', () => {
  it('다음 쪽(nextCursor)을 같은 필터로 묻고, 받은 줄 아래에 이어 붙인다', { timeout: 15000 }, async () => {
    server.use(
      http.get(`${API_BASE}/approvals`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        return cursor === 'C2'
          ? HttpResponse.json({ items: [row(3)], page: { nextCursor: null, size: 50 } })
          : HttpResponse.json({ items: [row(1), row(2)], page: { nextCursor: 'C2', size: 50 } });
      }),
    );
    const view = renderAt('/approvals?type=PRODUCT', as.admin);
    // 관리자 첫 화면은 메뉴 알림 등 조회가 많아 전체 시험 중에는 1초를 넘길 때가 있다 — 기다림만 늘린다(확인 내용은 그대로)
    expect(await screen.findByText('요청 2', {}, { timeout: 5000 })).toBeInTheDocument(); // 승인은 번호 없이 요약·종류·요청자·시각(ADR-0070 덧붙임)
    await userEvent.click(screen.getByRole('button', { name: '더 보기' }));
    expect(await screen.findByText('요청 3')).toBeInTheDocument();
    expect(screen.getByText('요청 1')).toBeInTheDocument(); // 앞 줄은 그대로
    await waitFor(() => expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument()); // 끝
    const second = view.sent.find((r) => new URL(r.url).searchParams.get('cursor') === 'C2')!;
    expect(new URL(second.url).searchParams.get('type')).toBe('PRODUCT'); // 같은 필터
  });

  it('다음 쪽을 못 읽으면 받은 줄은 두고 경고 — 끝이나 0건으로 보이지 않는다', async () => {
    server.use(
      http.get(`${API_BASE}/approvals`, ({ request }) =>
        new URL(request.url).searchParams.get('cursor')
          ? HttpResponse.json({ type: 'about:blank', title: 'x', status: 400, code: 'VALIDATION_FAILED' }, { status: 400, headers: { 'content-type': 'application/problem+json' } })
          : HttpResponse.json({ items: [row(1)], page: { nextCursor: 'C2', size: 50 } }),
      ),
    );
    renderAt('/approvals', as.admin);
    await userEvent.click(await screen.findByRole('button', { name: '더 보기' }));
    expect(await screen.findByText(/이전 기록을 더 불러오지 못했어요/)).toBeInTheDocument();
    expect(screen.getByText('요청 1')).toBeInTheDocument();
  });
});

describe('승인함 — 내 일 기준(2026-11-20 "뭐가 뭔지 모르겠다")', () => {
  it('처음은 "내가 심사할 것"(decidableByMe), 줄은 무엇을 승인·요약·지금 한 칸·심사하기', async () => {
    server.use(
      http.get(`${API_BASE}/approvals`, () =>
        HttpResponse.json({ items: [{ ...row(1), type: 'PRICE', reviewState: 'REVIEW_PENDING', executionState: 'NOT_REQUESTED', viewerCanDecide: true }], page: { nextCursor: null, size: 50 } }),
      ),
    );
    const view = renderAt('/approvals', as.admin);
    const first = await screen.findByTestId('approval-row');
    expect(screen.getByRole('tab', { name: /내가 심사할 것/ })).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveTextContent('가격 변경');
    expect(first).toHaveTextContent('요청 1');
    expect(first).toHaveTextContent('심사 기다림');
    expect(screen.getByTestId('approval-decide')).toHaveAttribute('href', '/approvals/APV-1');
    expect(screen.queryByTestId('approval-state')).not.toBeInTheDocument(); // 심사할 것은 상태 고르기 없음
    await waitFor(() => expect(view.sent.some((r) => new URL(r.url).searchParams.get('decidableByMe') === 'true')).toBe(true));
  });

  it('"내가 올린 것"은 requesterId = 나, "모두"에서 상태·무엇을 고르면 그 값으로 묻는다', async () => {
    server.use(http.get(`${API_BASE}/approvals`, () => HttpResponse.json({ items: [row(1)], page: { nextCursor: null, size: 50 } })));
    const user = userEvent.setup();
    const view = renderAt('/approvals', as.admin);
    await user.click(await screen.findByTestId('approval-view-mine'));
    await waitFor(() => expect(view.sent.some((r) => new URL(r.url).searchParams.get('requesterId') !== null)).toBe(true));
    await user.click(screen.getByTestId('approval-view-all'));
    const first = await screen.findByTestId('approval-row');
    expect(first).toHaveTextContent('상품 등록');
    expect(first).toHaveTextContent('승인됨 · 반영 완료'); // 심사·반영 두 축을 한 마디로
    await user.selectOptions(screen.getByTestId('approval-state'), '반려됨');
    await user.click(screen.getByRole('button', { name: '가격 변경' }));
    await waitFor(() =>
      expect(view.sent.some((r) => { const p = new URL(r.url).searchParams; return p.get('type') === 'PRICE' && p.get('reviewState') === 'REJECTED' && !p.get('decidableByMe'); })).toBe(true),
    );
  });
});
