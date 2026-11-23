// 리뷰 신고 확인(review 0.7.0 BR-90)·FAQ 답 의견(customer-assistant 0.4.0 BR-91) — 목(MSW) 기준.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';
import { helpfulRate } from './FaqFeedbackPage';

const posts = (sent: readonly Request[], tail: string) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith(tail));

describe('리뷰 신고', () => {
  it('확인 전: 최근 신고 순, 사유별 수·기타 글 — 숨김은 줄 안에서 한 번 더 묻고 멱등키로 보내면 처리 끝으로', async () => {
    const user = userEvent.setup();
    const view = renderAt('/review-reports', as.cs);
    const rows = await screen.findAllByTestId('review-report');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('신고 4건');
    expect(rows[0]).toHaveTextContent('욕설·비방 3');
    expect(rows[0]).toHaveTextContent('직원 욕을 써 놨어요');
    await user.type(within(rows[0]!).getByLabelText(/처리 메모/), '욕설 확인');
    await user.click(within(rows[0]!).getByRole('button', { name: '숨김' }));
    const ask = within(rows[0]!).getByRole('group', { name: '처리 확인' });
    expect(ask).toHaveTextContent('별점에서 빠져요');
    await user.click(within(ask).getByRole('button', { name: '숨김' }));
    await waitFor(() => expect(screen.getAllByTestId('review-report')).toHaveLength(1));
    const post = posts(view.sent, '/review-reports/RV-MOCK-1/resolutions')[0]!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await post.clone().json()).toEqual({ action: 'HIDE', note: '욕설 확인' });
    await user.click(screen.getByRole('tab', { name: '처리 끝' }));
    const done = (await screen.findAllByTestId('review-report')).find((r) => r.textContent?.includes('신고 4건'))!;
    expect(within(done).getByTestId('review-report-result')).toHaveTextContent('숨김');
    expect(done).toHaveTextContent('지금 숨김');
  });

  it('다른 직원이 먼저 처리(409 NO_OPEN_REPORTS)하면 목록을 다시 읽는다', async () => {
    const user = userEvent.setup();
    server.use(http.post(`${API_BASE}/review-reports/:reviewId/resolutions`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 409, code: 'NO_OPEN_REPORTS' }, { status: 409, headers: { 'content-type': 'application/problem+json' } })));
    const view = renderAt('/review-reports', as.admin);
    const row = (await screen.findAllByTestId('review-report'))[1]!;
    await user.click(within(row).getByRole('button', { name: '문제없음' }));
    await user.click(within(within(row).getByRole('group', { name: '처리 확인' })).getByRole('button', { name: '문제없음' }));
    await waitFor(() => expect(view.sent.filter((r) => r.method === 'GET' && new URL(r.url).pathname.endsWith('/review-reports')).length).toBeGreaterThan(1));
  });

  it('메뉴는 상담원·관리자만 — 라이더 운영에게는 없다', async () => {
    const view = renderAt('/session', as.cs);
    expect(await screen.findByRole('link', { name: '리뷰 신고', hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'FAQ 답 의견', hidden: true })).toBeInTheDocument();
    view.unmount();
    renderAt('/session', as.riderOps);
    await screen.findByTestId('side-menu');
    expect(screen.queryByRole('link', { name: '리뷰 신고', hidden: true })).not.toBeInTheDocument();
  });
});

describe('FAQ 답 의견', () => {
  it('서버 순서 그대로, 도움 비율은 표시만(분모 0 이면 —), 없어진 FAQ 는 "지금 FAQ 에 없음"', async () => {
    renderAt('/faq-feedback', as.cs);
    const rows = await screen.findAllByTestId('faq-feedback-row');
    expect(rows.map((r) => within(r).getByTestId('faq-feedback-rate').textContent)).toEqual(['25%', '0%', '85.7%', '—']);
    expect(rows[0]).toHaveTextContent('환불은 언제 들어오나요?');
    expect(rows[0]).toHaveTextContent('환불');
    expect(rows[2]).toHaveTextContent('주문 취소'); // 분류 이름(안내 문서 제목)
    expect(rows[1]).toHaveTextContent('지금 FAQ 에 없음');
    expect(helpfulRate(0, 0)).toBe('—');
  });

  it('못 읽으면 0 건이 아니라 오류', async () => {
    server.use(http.get(`${API_BASE}/customer-assistant/faq-feedback`, () => HttpResponse.json({ type: 'about:blank', title: 'x', status: 503, code: 'DEPENDENCY_UNAVAILABLE' }, { status: 503, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/faq-feedback', as.admin);
    expect(await screen.findByRole('button', { name: /다시/ })).toBeInTheDocument();
    expect(screen.queryByText('아직 받은 의견이 없어요.')).not.toBeInTheDocument();
  });
});
